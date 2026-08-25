use std::fs;

/// Writes the conversation this layer speaks into the two ends of it.
///
/// The number lives in `package.json` — beside `frontContract`, and for the
/// same reason as it. It is what the program above this one compares against
/// what a downloaded layer announces, and it is what the release job writes
/// into the document a release publishes, so that a copy can tell before it
/// downloads a byte whether the two would understand each other. Two readers,
/// one line: see `scripts/update-manifest.mjs` for the other one.
fn main() {
    // Relative to the crate, which is where cargo runs a build script from.
    let package = "../../package.json";
    println!("cargo:rerun-if-changed={package}");

    let text = fs::read_to_string(package).expect("package.json is above the crate");
    let read: serde_json::Value = serde_json::from_str(&text).expect("package.json is JSON");
    let protocol = read["layerProtocol"]
        .as_u64()
        .expect("package.json declares layerProtocol");
    println!("cargo:rustc-env=LAYER_PROTOCOL={protocol}");
}
