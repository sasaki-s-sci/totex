// Keep the extra console window from opening alongside release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    totex_lib::run()
}
