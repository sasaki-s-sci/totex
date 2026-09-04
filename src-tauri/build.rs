use std::fs;

fn main() {
    tauri_build::build();
    contract();
}

/// Writes what this binary knows about the pages built into it.
///
/// Two numbers, both out of `package.json`, which is the pages' own manifest:
/// the agreement they were built to, and the version they are.
///
/// The pages of a release can be taken onto an older program than the one they
/// were built beside — that is the whole point of `src/front` — and what stops
/// that being a window calling commands that are not there is one number. It
/// lives in `package.json`, beside the version of the half that declares it,
/// and the release job reads the same line into the manifest the pages are
/// published under. This is the other reader: the program compares what a
/// front says it needs against what it was built with, and one line moves both.
fn contract() {
    // Relative to the crate, which is where cargo runs a build script from.
    let package = "../package.json";
    println!("cargo:rerun-if-changed={package}");

    let text = fs::read_to_string(package).expect("package.json is beside the crate");
    let read: serde_json::Value = serde_json::from_str(&text).expect("package.json is JSON");
    let contract = read["frontContract"]
        .as_u64()
        .expect("package.json declares frontContract");
    println!("cargo:rustc-env=FRONT_CONTRACT={contract}");

    // And the version of the pages built into this binary, which is the version
    // of the package they are built from -- the crate's own number in every
    // release that is cut, read from the pages' side because it is the pages'
    // number that is compared against a taken front's.
    let version = read["version"]
        .as_str()
        .expect("package.json declares a version");
    println!("cargo:rustc-env=FRONT_VERSION={version}");
}
