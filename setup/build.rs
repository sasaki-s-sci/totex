//! The icon, the manifest and the version, compiled into the executable.
//!
//! All three are things Windows reads off a file rather than out of it: the
//! icon is what a download folder shows, the manifest is what stops a file
//! called setup being offered elevation it does not want, and the version is
//! the only thing in the properties dialog that says what this is. None of
//! them is something the Rust in src/ can put there.
//!
//! The icon is the one the app's own installer wears -- src-tauri/installer,
//! drawn by scripts/installer-art.mjs -- rather than a second drawing of the
//! same mark.

use std::path::{Path, PathBuf};

fn main() {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let manifest = here.join("totex-setup.manifest");
    let icon = here.join("../src-tauri/installer/icon.ico");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rerun-if-changed={}", icon.display());

    // Resources are compiled by a Windows tool, so a build hosted anywhere
    // else does not get them. That is a build for looking at rather than for
    // releasing -- the workflow that publishes this runs on Windows -- and it
    // says so rather than failing, so that `cargo check` still works on the
    // machine the rest of the repository is written on.
    if !cfg!(windows) {
        println!(
            "cargo:warning=built off Windows: no icon, no manifest, and a window Windows will stretch"
        );
        return;
    }

    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    let numbers = {
        let mut parts: Vec<&str> = version.split('.').collect();
        parts.resize(4, "0");
        parts.join(",")
    };
    let script = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("totex-setup.rc");
    std::fs::write(
        &script,
        format!(
            r#"1 ICON "{icon}"
1 24 "{manifest}"

1 VERSIONINFO
FILEVERSION {numbers}
PRODUCTVERSION {numbers}
FILEOS 0x4
FILETYPE 0x1
{{
  BLOCK "StringFileInfo"
  {{
    BLOCK "040904b0"
    {{
      VALUE "CompanyName", "totex"
      VALUE "FileDescription", "Installs totex"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "totex-setup"
      VALUE "OriginalFilename", "totex-setup.exe"
      VALUE "ProductName", "totex"
      VALUE "ProductVersion", "{version}"
    }}
  }}
  BLOCK "VarFileInfo"
  {{
    VALUE "Translation", 0x409, 1200
  }}
}}
"#,
            icon = escaped(&icon),
            manifest = escaped(&manifest),
        ),
    )
    .expect("the resource script could not be written");

    embed_resource::compile(&script, embed_resource::NONE)
        .manifest_required()
        .expect("the resource script would not compile");
}

/// A path as a resource script reads one: the separator Windows uses is also
/// the one that escapes, so every one of them has to be doubled.
fn escaped(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
}
