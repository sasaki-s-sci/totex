//! The persistent half of the app: the program that holds the terminals,
//! started beside the window and outliving it.
//!
//! `totex-persistent --home <dir>` binds a loopback port, writes where it is into
//! `<dir>`, and answers until it is told to stop or has nothing left to hold.
//! It is started detached from whatever started it, on purpose: see `lib.rs`.

use std::path::PathBuf;
use std::sync::Arc;

use totex_persistent::{Persistent, serve};

fn main() {
    let mut args = std::env::args_os().skip(1);
    let mut home = None;
    while let Some(arg) = args.next() {
        if arg == "--home" {
            home = args.next().map(PathBuf::from);
        } else if arg == "--version" {
            println!("{}", totex_persistent::VERSION);
            return;
        }
    }
    let Some(home) = home else {
        eprintln!("usage: totex-persistent --home <dir>");
        std::process::exit(2);
    };

    let held = Persistent::new(Some(home.clone()));
    let serving = serve::stand(Arc::clone(&held), &home, Box::new(|| std::process::exit(0)));
    if let Err(error) = serving {
        eprintln!("totex-persistent: {error}");
        std::process::exit(1);
    }
    loop {
        std::thread::park();
    }
}
