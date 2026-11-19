// Keep the extra console window from opening alongside release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Before anything else: this same executable is what `ssh` runs to be
    // handed a password, and a copy started for that answers and exits here
    // without ever building a window -- see `totex_host::ssh::askpass`.
    totex_host::ssh::askpass::intercept();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args
        .first()
        .is_some_and(|arg| arg == "--register-codex-mcp")
    {
        #[cfg(windows)]
        // The GUI executable needs its caller's console to report setup errors.
        unsafe {
            windows_sys::Win32::System::Console::AttachConsole(
                windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
            );
        }
        match totex_lib::register_codex(&args[1..]) {
            Ok(()) => println!("totex MCP registered. Start Codex normally inside totex."),
            Err(error) => {
                eprintln!("Could not register totex MCP: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    totex_lib::run()
}
