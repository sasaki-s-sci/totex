//! A release page on the loopback address.
//!
//! Small enough to be read in one sitting, because what it is for is being
//! obviously right: everything a test says about updating is a statement about
//! what the app does with what this hands it, and a server with anything
//! interesting in it would make that two statements.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

/// A page holding whatever the test wants a release page to hold.
pub(crate) struct Page {
    endpoint: String,
    /// Kept so that the thread answering is stopped when the test ends.
    alive: Arc<std::sync::atomic::AtomicBool>,
}

impl Page {
    /// Puts one up, holding one file per path.
    ///
    /// The port is the operating system's to pick, so two of these can be up at
    /// once and a test does not fail because something else on the machine was
    /// already on the number this one wanted.
    pub(crate) fn holding(files: HashMap<String, Vec<u8>>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port of our own");
        let at = listener.local_addr().expect("the port it picked");
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));

        let answering = Arc::clone(&alive);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if !answering.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                let Ok(stream) = stream else { continue };
                let _ = answer(stream, &files);
            }
        });

        Self {
            endpoint: format!("http://{at}/releases/latest/download/latest.json"),
            alive,
        }
    }

    /// The address the app is configured with, pointing at this page.
    pub(crate) fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Where one of the files it is holding is, as the manifest has to name it.
    pub(crate) fn url(&self, path: &str) -> String {
        let at = self
            .endpoint
            .strip_suffix("/releases/latest/download/latest.json")
            .expect("the endpoint this made");
        format!("{at}{path}")
    }
}

impl Drop for Page {
    fn drop(&mut self) {
        self.alive
            .store(false, std::sync::atomic::Ordering::Relaxed);
        // The thread is asleep in `accept`, and one more connection is what
        // wakes it up to find out it has been told to stop.
        let at = self
            .endpoint
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or_default()
            .to_string();
        let _ = std::net::TcpStream::connect(at);
    }
}

/// One request, answered with one file or with nothing.
fn answer(mut stream: TcpStream, files: &HashMap<String, Vec<u8>>) -> std::io::Result<()> {
    let mut reading = BufReader::new(stream.try_clone()?);
    let mut request = String::new();
    reading.read_line(&mut request)?;
    // The rest of the headers, which nothing here reads and everything here has
    // to get to the end of before it answers.
    let mut header = String::new();
    while reading.read_line(&mut header)? > 2 {
        header.clear();
    }

    let path = request.split_whitespace().nth(1).unwrap_or_default();
    match files.get(path) {
        Some(body) => {
            stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            )?;
            stream.write_all(body)?;
        }
        None => stream.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?,
    }
    stream.flush()
}
