//! A release the whole way through this program: brought down, checked, put in
//! once the window has gone, and what the window asked for started -- with the
//! shell that was open still open when the next window looks.
//!
//! `src/update.rs` checks the pieces: a signature refused, a file written over,
//! a bundle swapped. This is the one that runs them against each other in the
//! program as a release ships it, because what a patch release promises is
//! exactly this sequence and nothing less: the window goes, the release goes
//! in, the next window comes up, and the terminals were never touched.

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::json;
use totex_persistent::talk::{Link, Missing};
use totex_persistent::update::{Install, Kind, Taken};

/// A temporary directory that removes itself, so a failing test cannot leave
/// an address file behind for a real window to find.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "totex-relaunch-{tag}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The program cargo built beside this test.
fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_totex-persistent"))
}

/// A release page on the loopback address, holding one file under every path.
///
/// Answers until the test binary exits; there is nothing to stop, because the
/// thread is asleep in `accept` and the process ending is what ends it.
fn page(body: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a port of our own");
    let at = listener.local_addr().expect("the port it picked");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reading = BufReader::new(match stream.try_clone() {
                Ok(reading) => reading,
                Err(_) => continue,
            });
            let mut line = String::new();
            while reading.read_line(&mut line).is_ok_and(|read| read > 2) {
                line.clear();
            }
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            );
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        }
    });
    format!("http://{at}/totex-linux-x86_64.AppImage")
}

/// A key of this test's own and a signature over `bytes`, both in the shape
/// the release manifest carries them: base64 around the text `minisign`
/// writes. Nothing here goes near the app's own key.
fn signed(bytes: &[u8]) -> (String, String) {
    let pair = minisign::KeyPair::generate_unencrypted_keypair().expect("a key pair");
    let key = pair.pk.to_box().expect("the public half").to_string();
    let signature = minisign::sign(Some(&pair.pk), &pair.sk, bytes, None, None)
        .expect("a signature")
        .to_string();
    (BASE64.encode(key), BASE64.encode(signature))
}

/// Waits for a file to appear, up to a point.
fn appears(path: &std::path::Path, most: Duration) -> bool {
    let deadline = Instant::now() + most;
    while Instant::now() < deadline {
        if path.is_file() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    path.is_file()
}

#[test]
fn a_release_goes_in_after_the_window_has_gone_and_the_shell_is_still_there() {
    let temp = TempDir::new("release");
    let home = &temp.0;

    // The program as an installed copy runs it: a file that, started, says so.
    // Its replacement is the same kind of file saying something else, which is
    // what tells the two apart afterwards.
    let marker = home.join("started");
    let old = format!("#!/bin/sh\nprintf old > '{}'\n", marker.display());
    let new = format!("#!/bin/sh\nprintf new > '{}'\n", marker.display());
    let target = home.join("totex.AppImage");
    std::fs::write(&target, &old).expect("the old program");

    let (key, signature) = signed(new.as_bytes());
    let url = page(new.clone().into_bytes());

    let first = Link::reach(home, &program()).expect("the program comes up");
    first
        .ask(
            "open",
            json!({ "id": "kept", "cwd": std::env::temp_dir(), "rows": 24, "cols": 80 }),
        )
        .expect("a shell starts");

    // A release signed by somebody else is turned down before a byte of it is
    // kept, whatever the page says.
    let (_, another) = signed(b"something else");
    let refused = first
        .ask(
            "take_program",
            json!({ "url": url, "signature": another, "key": key }),
        )
        .expect_err("not our release");
    assert!(refused.contains("signed"), "{refused}");
    assert!(
        std::fs::read_dir(home.join("release"))
            .map(|dir| dir.count())
            .unwrap_or(0)
            == 0,
        "something was kept"
    );

    // The release itself, brought down and checked by the program that will
    // put it in.
    let taken: Taken = serde_json::from_value(
        first
            .ask(
                "take_program",
                json!({ "url": url, "signature": signature, "key": key }),
            )
            .expect("the release comes down"),
    )
    .expect("where it was kept");
    assert_eq!(
        std::fs::read_to_string(&taken.path).expect("the release"),
        new,
        "what was kept is not what was served"
    );
    assert_eq!(
        std::fs::read_to_string(&target).expect("the old program"),
        old,
        "the program was written over while the window was still open"
    );

    // The window asks to be started again once it has gone, with the release
    // put in first, and goes.
    let install = Install {
        kind: Kind::AppImage,
        download: taken.path.clone(),
        target: target.clone(),
    };
    first
        .relaunch(&target, &[], Some(&install))
        .expect("the program hears what to start");
    drop(first);

    // What was started is the release, in the place the old program was.
    assert!(
        appears(&marker, Duration::from_secs(10)),
        "nothing was started after the window went"
    );
    assert_eq!(
        std::fs::read_to_string(&marker).expect("what was started said"),
        "new",
        "the old program was started instead of the release"
    );
    assert_eq!(
        std::fs::read_to_string(&target).expect("the program"),
        new,
        "the release did not go in"
    );
    assert!(
        !home.join("relaunch.log").exists(),
        "the program wrote down a failure: {}",
        std::fs::read_to_string(home.join("relaunch.log")).unwrap_or_default()
    );

    // And the next window finds the same program, still holding the shell.
    let second = Link::reach(home, &program()).expect("the program is still there");
    let listed = second.ask("sessions", json!({})).expect("asked");
    assert_eq!(
        listed[0]["id"],
        json!("kept"),
        "the shell went with the window"
    );

    second.stop();
    assert!(
        second.wait_gone(Duration::from_secs(5)),
        "stop did not end it"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if matches!(Link::connect(home), Err(Missing::Nobody)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("the program is still answering after stop");
}
