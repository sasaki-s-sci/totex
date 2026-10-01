// Keep the extra console window from opening alongside release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Before anything else: this same executable is what `ssh` runs to be
    // handed a password, and a copy started for that answers and exits here
    // without ever building a window -- see `totex_host::ssh::askpass`.
    totex_host::ssh::askpass::intercept();
    totex_lib::run()
}
