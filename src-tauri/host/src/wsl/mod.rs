//! Reaching into a WSL distribution instead of at the share it publishes.
//!
//! Windows shows a distribution's filesystem as `\\wsl.localhost\<distro>\...`,
//! and that share is enough to read bytes with. It is not enough to work in: a
//! `git` run from Windows over 9p reads a Linux checkout with the wrong line
//! endings and the wrong file modes, `cmd` refuses a UNC directory outright, the
//! coding agents are installed inside the distribution, and Windows' own change
//! notifications never fire for the share. So a path that names a distribution
//! is worked on *inside* it, and the share is the fallback.
//!
//! Everything here is one distribution and one Linux path — [`Location`] — got
//! from the UNC spelling, which stays the canonical form the rest of the app
//! passes around. Nothing else has to know a path is remote until it runs
//! something, and the running is [`crate::remote`]'s: a distribution is one of
//! the machines a shell is held open on there, beside the ones reached over
//! ssh, and what is left here is the spelling and `wsl.exe` itself.

pub mod shell;

#[cfg(test)]
mod tests;

pub use shell::{distros, program};

use crate::remote::{self, Output, Reach, path};

/// Runs one command inside `distro` and waits for it. The reach spelled out,
/// for the callers that already hold a distribution's name and nothing else.
pub fn exec(
    distro: &str,
    cwd: Option<&str>,
    env: &[(&str, &str)],
    argv: &[&str],
) -> Result<Output, String> {
    remote::exec(&Reach::Wsl(distro.to_string()), cwd, env, argv)
}

/// Runs a shell script inside `distro`, with `args` as `$1` onwards.
pub fn script(
    distro: &str,
    cwd: Option<&str>,
    body: &str,
    args: &[&str],
) -> Result<Output, String> {
    remote::script(&Reach::Wsl(distro.to_string()), cwd, body, args)
}

/// Where Windows' own `curl.exe` is, spelled as `distro` sees it.
///
/// A program started from a distribution through interop runs on Windows, so
/// it reaches Windows' loopback whatever networking the distribution has. That
/// is the way across for anything in a distribution that has to call this
/// program's loopback servers: under the networking WSL starts with, the
/// distribution's own `127.0.0.1` is not this machine's.
pub fn windows_curl(distro: &str) -> Result<String, String> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let windows = format!(r"{root}\System32\curl.exe");
    let said = script(
        distro,
        None,
        r#"p=$(wslpath -u "$1" 2>/dev/null) && test -x "$p" && printf '%s' "$p""#,
        &[&windows],
    )
    .map_err(|error| format!("{distro}: {error}"))?;
    let path = said.text();
    if !said.ok() || !path.starts_with('/') || path.contains(['\n', '\r', '\0']) {
        return Err(format!(
            "{distro}: Windows curl.exe cannot be run from this distribution. Enable WSL interop."
        ));
    }
    Ok(path)
}

/// An MCP server over stdio for an agent in a distribution, run as
/// `sh <this> <curl>` with the path [`windows_curl`] gave: one message a line,
/// each posted through that curl, and each answer — the servers here answer in
/// plain JSON on one line, or with nothing for a notification — written back
/// as a line.
///
/// Where to post is `$TOTEX_URL`, with `$TOTEX_TOKEN` as the bearer where
/// there is one. Without it, the session's own address the terminal was
/// started with, `$TOTEX_MCP_URL`: from this environment, or, for an agent
/// that starts its servers with only an environment of its own choosing, from
/// the nearest ancestor that has it.
pub const MCP_BRIDGE: &str = r#"curl=$1
url=${TOTEX_URL:-$TOTEX_MCP_URL}
pid=$PPID
while [ -z "$url" ] && [ "${pid:-0}" -gt 1 ]; do
  url=$(tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | sed -n 's/^TOTEX_MCP_URL=//p' | head -n 1)
  set -- $(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null)
  pid=$2
done
[ -n "$url" ] || { echo 'No totex address in this terminal.' >&2; exit 1; }
auth="X-Totex: 1"
[ -z "$TOTEX_TOKEN" ] || auth="Authorization: Bearer $TOTEX_TOKEN"
while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] || continue
  said=$(printf '%s' "$line" | "$curl" -s -H "$auth" -H 'Content-Type: application/json' --data-binary @- "$url")
  [ -z "$said" ] || printf '%s\n' "$said"
done
"#;

/// The prefix Windows publishes a distribution's filesystem under, and the one
/// older builds published it under before that.
const PREFIXES: [&str; 2] = [r"\\wsl.localhost\", r"\\wsl$\"];

/// The one this app writes, so a path means the same thing every time it is
/// compared, keyed on or stored.
const CANONICAL: &str = r"\\wsl.localhost\";

/// A path inside a WSL distribution: which one, and where in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub distro: String,
    /// An absolute Linux path — `/home/a/repo`, never the UNC spelling.
    pub path: String,
}

/// Reads the UNC spelling of a WSL path, or `None` when it is not one. Done on
/// the string rather than through `Path`, because the answer must be the same on
/// both platforms: in a Linux build a backslash is an ordinary character.
pub fn locate(raw: &str) -> Option<Location> {
    // Asked of every path the app touches, including every row of a listing, so
    // the answer for the ones that are plainly not a share costs two bytes.
    if !raw.starts_with(r"\\") && !raw.starts_with("//") {
        return None;
    }
    let uniform = raw.replace('/', "\\");
    let rest = PREFIXES
        .iter()
        .find_map(|prefix| uniform.strip_prefix(prefix))?;
    let (distro, tail) = match rest.split_once('\\') {
        Some((distro, tail)) => (distro, tail),
        None => (rest, ""),
    };
    if distro.is_empty() {
        return None;
    }
    Some(Location {
        distro: distro.to_string(),
        path: linux_path(tail),
    })
}

/// `home\a\repo` as the distribution spells it, and `/` for the share's root.
fn linux_path(tail: &str) -> String {
    let cleaned = tail.replace('\\', "/");
    let trimmed = cleaned.trim_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        format!("/{trimmed}")
    }
}

/// The UNC spelling of a Linux path in a distribution, which is what the rest of
/// the app stores, compares and hands back over IPC.
pub fn unc(distro: &str, path: &str) -> String {
    let inner = path.trim_start_matches('/').replace('/', "\\");
    if inner.is_empty() {
        format!("{CANONICAL}{distro}")
    } else {
        format!("{CANONICAL}{distro}\\{inner}")
    }
}

impl Location {
    pub fn unc(&self) -> String {
        unc(&self.distro, &self.path)
    }

    /// The same distribution, at another path in it.
    pub fn at(&self, path: &str) -> Self {
        Self {
            distro: self.distro.clone(),
            path: path.to_string(),
        }
    }

    /// The directory holding this one, or `None` at the root of the distribution
    /// — which is where a walk upwards has to stop.
    pub fn parent(&self) -> Option<Self> {
        path::parent(&self.path).map(|parent| self.at(parent))
    }

    /// The last part of the path. The root has none, so it is called by the
    /// distribution it is the root of.
    pub fn name(&self) -> String {
        path::name(&self.path)
            .map(str::to_string)
            .unwrap_or_else(|| self.distro.clone())
    }
}

/// Runs one command inside `distro` with `input` as what it reads — see
/// [`remote::exec_input`].
pub fn exec_input(distro: &str, argv: &[&str], input: &[u8]) -> Result<Output, String> {
    remote::exec_input(&Reach::Wsl(distro.to_string()), None, &[], argv, input)
}
