//! The headless browser an observer may look at a page with: a chrome-devtools
//! MCP server that the observer is started with, its tools allowed one by one,
//! and nothing else of its own. Only the claude observer, on this machine.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The MCP server's name, and so the prefix of its tools.
const SERVER: &str = "chrome-devtools";

/// Moving to a page and looking at it. No script, no clicks, no typing.
pub(super) const TOOLS: [&str; 2] = [
    "mcp__chrome-devtools__navigate_page",
    "mcp__chrome-devtools__take_screenshot",
];

/// The browser profile an observer uses: one shared by every folder, or the
/// folder's own. `separate` keeps the sites a terminal opened out of the
/// folder's files; `folder` keeps them with the folder.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    #[default]
    Separate,
    Folder,
}

/// Off unless the window asks for it. `allowed_url` is a URL pattern the
/// browser refuses to leave: the only pages an observer can reach.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Browser {
    pub enabled: bool,
    pub allowed_url: String,
    pub profile: Profile,
}

impl Default for Browser {
    fn default() -> Self {
        Self {
            enabled: false,
            allowed_url: "http://localhost:*/*".into(),
            profile: Profile::Separate,
        }
    }
}

/// Where the screenshot of an observation is written, and the MCP config that
/// lets the observer take it.
pub(super) struct Setup {
    pub config: String,
}

/// The directory screenshots are written to. Inside the temp directory, which
/// the MCP server may write to without being given more roots.
pub(super) fn shots_dir() -> PathBuf {
    std::env::temp_dir().join("totex-monitor-shots")
}

/// The file one observation's screenshot is written to: named by the session
/// and the time, so each shot is a file of its own. The session id is kept to
/// characters that can name a file on every platform.
pub(super) fn shot_path(session: &str, at: u64) -> PathBuf {
    let name: String = session
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    shots_dir().join(format!("{name}-{at}.png"))
}

/// The profile directory for `profile` in the folder `cwd`, or nothing when
/// there is no home directory to put the shared one in.
fn profile_dir(profile: Profile, cwd: &str, home: Option<PathBuf>) -> Option<PathBuf> {
    match profile {
        Profile::Folder => Some(Path::new(cwd).join(".totex").join("browser")),
        Profile::Separate => Some(home?.join(".local/share/totex/monitor-browser")),
    }
}

/// The setup for an observation in `cwd`, or nothing when the browser is off.
pub(super) fn setup(browser: &Browser, cwd: &str, home: Option<PathBuf>) -> Option<Setup> {
    if !browser.enabled {
        return None;
    }
    let profile = profile_dir(browser.profile, cwd, home)?;
    Some(Setup {
        config: config(&browser.allowed_url, &profile).to_string(),
    })
}

/// The MCP configuration for the observer: a headless Chrome the user has
/// installed, on `profile`, that leaves only `allowed_url`.
fn config(allowed_url: &str, profile: &Path) -> Value {
    json!({
        "mcpServers": {
            SERVER: {
                "command": "npx",
                "args": [
                    "-y",
                    "chrome-devtools-mcp@latest",
                    "--headless",
                    "--userDataDir",
                    profile.to_string_lossy(),
                    "--allowedUrlPattern",
                    allowed_url,
                    "--javascriptEvaluation",
                    "false",
                    "--fileNavigations",
                    "false",
                    "--no-usage-statistics",
                    "--no-performance-crux",
                ],
            }
        }
    })
}

/// The instruction added to the observer's prompt when the browser is on.
pub(super) fn instruction(shot: &Path) -> String {
    format!(
        "\nBrowser, for this observation only: the tools {} are available. If the terminal's work is a web page, navigate to it and save a screenshot with take_screenshot, filePath set to {}, only when the page's visible state is progress worth showing. Do not click, type, scroll or run scripts. Do not call any other tool.\n",
        TOOLS.join(", "),
        shot.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_set_up_while_the_browser_is_off() {
        assert!(setup(&Browser::default(), "/work", Some("/home/a".into())).is_none());
    }

    #[test]
    fn the_observer_is_given_only_the_two_tools_and_a_headless_profile() {
        let on = Browser {
            enabled: true,
            ..Browser::default()
        };
        let setup = setup(&on, "/work/app", Some("/home/a".into())).unwrap();
        let config: Value = serde_json::from_str(&setup.config).unwrap();
        let args = config["mcpServers"][SERVER]["args"].as_array().unwrap();
        let has = |flag: &str| args.iter().any(|arg| arg == flag);
        assert!(has("--headless"));
        assert!(has("--javascriptEvaluation"));
        assert!(has("false"));
        assert!(args.iter().any(|arg| arg == "http://localhost:*/*"));
        assert!(
            args.iter()
                .any(|arg| arg.as_str().is_some_and(|s| s.ends_with("monitor-browser")))
        );
        assert_eq!(TOOLS.len(), 2);
    }

    #[test]
    fn a_folder_profile_lives_in_the_folder() {
        let folder = Browser {
            enabled: true,
            profile: Profile::Folder,
            ..Browser::default()
        };
        let setup = setup(&folder, "/work/app", None).unwrap();
        assert!(setup.config.contains(".totex"));
    }

    #[test]
    fn a_session_id_becomes_a_safe_file_name() {
        let path = shot_path("../x y/1", 42);
        assert_eq!(path.file_name().unwrap(), "xy1-42.png");
    }
}
