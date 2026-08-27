//! One entry, and everything under it, put somewhere else.
//!
//! Both ends are free to be on either machine, and there are two ways of doing
//! it. The one worth reaching for is the pair: a path on this machine and a path
//! inside a distribution are, from inside that distribution, two ordinary paths
//! — Windows publishes its disks there, and `wslpath` is the distribution's own
//! answer for where. So that copy is one `cp` run inside the distribution,
//! whatever it comes to, with none of it read up into this program and written
//! back down. It is also the only way what lands inside a distribution belongs
//! to the account that works in it.
//!
//! The other is the walk, and it is what a copy between two distributions comes
//! to, or one onto a machine that has no name for the other: entry by entry,
//! bytes through here, and a ceiling on how much of that one gesture is allowed
//! to be.
//!
//! The two answer differently about symbolic links, and deliberately rather
//! than accidentally. `cp` brings a link across as a link, which is what a file
//! manager does. The walk cannot: it would have to make links on the far
//! machine, which on Windows is a privilege and not an operation. So it follows
//! a link to a file — a copy of the file is what was meant — and leaves a link
//! to a folder behind, because what is on the far side of one can be the folder
//! being copied and a walk into that never ends. `cp` has no such trouble; it
//! knows a cycle when it sees one.

use std::path::Path;

use crate::host::{Host, Stat};
use crate::wsl;

/// How much one copy is allowed to come to, in entries and in bytes.
///
/// A folder is copied whole, and a folder on a working disk is `node_modules`
/// as often as not: with no ceiling, one gesture is an unbounded walk with the
/// window waiting on the end of it. What runs over is refused — and swept up,
/// rather than left standing as half a folder somebody has to tell from a whole
/// one.
///
/// The walk alone. A copy the distribution runs for itself is not measured
/// first: measuring it would be the walk this is the ceiling on, and `cp` is
/// answerable for its own work in a way a walk driven from here is not.
const MAX_ENTRIES: usize = 20_000;
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// One entry and everything under it, from wherever it is onto wherever it goes.
///
/// Told what the source is rather than asking: a listing already answered for
/// every row in it, and inside a distribution asking again is a second crossing
/// per file — which on a folder of any size is most of what the copy would cost.
pub(super) fn copy_tree(
    from: &Host,
    source: &Path,
    stat: &Stat,
    to: &Host,
    target: &Path,
) -> Result<(), String> {
    if let Some((distro, source, target)) = side_by_side(from, source, to, target) {
        return copy_inside(&distro, &source, &target);
    }
    let mut budget = Budget {
        entries: MAX_ENTRIES,
        bytes: MAX_BYTES,
    };
    place(from, source, stat, to, target, &mut budget)
}

/// Sweeps up what a copy that stopped part way left behind.
///
/// Said with no answer of its own: the error worth giving back is the one that
/// stopped the copy, not anything about the tidying after it.
pub(super) fn sweep(to: &Host, target: &Path) {
    to.remove_all(target);
}

/// The two ends as one distribution spells them, when one of them can spell
/// both.
///
/// Three ways that happens, and a fourth that is deliberately not here: two
/// paths on this machine are copied by this machine, which is what the walk
/// already does without any crossing at all.
fn side_by_side(
    from: &Host,
    source: &Path,
    to: &Host,
    target: &Path,
) -> Option<(String, String, String)> {
    match (from, to) {
        (Host::Local, Host::Wsl(distro)) => {
            Some((distro.clone(), named_in(distro, source)?, to.native(target)))
        }
        (Host::Wsl(distro), Host::Local) => Some((
            distro.clone(),
            from.native(source),
            named_in(distro, target)?,
        )),
        (Host::Wsl(one), Host::Wsl(other)) if one == other => {
            Some((one.clone(), from.native(source), to.native(target)))
        }
        _ => None,
    }
}

/// How a distribution names a path that is on the machine outside it, or `None`
/// where it has none for it.
///
/// On Windows every disk is mounted inside every distribution, and `wslpath` is
/// that distribution's own answer for where — asked rather than worked out here,
/// because where a disk is mounted is settled by the distribution's own
/// configuration and not by any rule this program could hold.
///
/// Off Windows this program is already inside a distribution, and the only one
/// that can name its files is that one. A `/home/a` in the distribution next
/// door is a different `/home/a`, which is the whole reason paths are carried
/// around here with the distribution's name on the front of them.
fn named_in(distro: &str, path: &Path) -> Option<String> {
    let spelled = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        let output = wsl::exec(distro, None, &[], &["wslpath", "-u", &spelled]).ok()?;
        let named = output.text().trim().to_string();
        (output.ok() && named.starts_with('/')).then_some(named)
    } else {
        (std::env::var("WSL_DISTRO_NAME").ok()? == distro).then_some(spelled)
    }
}

/// The whole copy, run by the distribution that can name both ends of it.
///
/// Refusing to replace what is there, the same way every other copy in the app
/// does: the name was chosen against a listing, and a file that arrived between
/// that and this is a file this was never asked to overwrite.
///
/// `-R` and not `-RL`: links come across as links. Following them instead makes
/// `cp` refuse the whole copy the moment one of them points at a folder holding
/// it, which is a folder that cannot be copied at all rather than one copied
/// with a link in it. See this module's own note on the two answers.
fn copy_inside(distro: &str, source: &str, target: &str) -> Result<(), String> {
    let output = wsl::exec(
        distro,
        None,
        &[],
        &[
            "sh",
            "-c",
            "test ! -e \"$2\" && test ! -L \"$2\" && cp -R -- \"$1\" \"$2\"",
            "sh",
            source,
            target,
        ],
    )?;
    if output.ok() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// What is left of the ceiling, spent as the walk goes.
struct Budget {
    entries: usize,
    bytes: u64,
}

impl Budget {
    fn spend(&mut self, bytes: u64) -> Result<(), String> {
        if self.entries == 0 || bytes > self.bytes {
            return Err("too-large".to_string());
        }
        self.entries -= 1;
        self.bytes -= bytes;
        Ok(())
    }
}

/// One entry, and everything under it when it is a folder.
fn place(
    from: &Host,
    source: &Path,
    stat: &Stat,
    to: &Host,
    target: &Path,
    budget: &mut Budget,
) -> Result<(), String> {
    if !stat.is_dir {
        budget.spend(stat.size)?;
        return copy_in(from, source, to, target);
    }
    budget.spend(0)?;
    to.create_dir(target)?;
    for child in from.read_dir(source)? {
        // A link to a folder is not walked into. What is on the far side of one
        // can be the folder being copied, or anything holding it, and a copy
        // that walks into itself never finishes.
        if child.stat.is_symlink && child.stat.is_dir {
            continue;
        }
        place(
            from,
            &from.join(source, &child.name),
            &child.stat,
            to,
            &to.join(target, &child.name),
            budget,
        )?;
    }
    Ok(())
}

/// One file, out of wherever it is and onto wherever it goes.
fn copy_in(from: &Host, source: &Path, to: &Host, target: &Path) -> Result<(), String> {
    if from == to {
        // The machine holding both copies it without any of it passing through
        // this program.
        return to.copy_file(source, target);
    }
    let bytes = from.read(source)?;
    to.write_new(target, &bytes)
}
