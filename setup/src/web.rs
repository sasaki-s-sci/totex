//! One address read into memory, over the HTTPS the machine already has.
//!
//! WinHTTP rather than anything carried: this file is published on a cycle of
//! its own precisely because nothing in it names a release, so a copy somebody
//! downloaded a year ago is a copy still being run -- and a TLS stack inside
//! that copy would be a year stale, while the one under this is patched by
//! whoever patches Windows. It also follows the redirect from github.com to
//! the storage a release actually sits on without being told that is what a
//! release download does.

use std::ffi::c_void;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::GetLastError;
use windows_sys::Win32::Networking::WinHttp::{
    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_QUERY_CONTENT_LENGTH,
    WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE, WinHttpCloseHandle, WinHttpConnect,
    WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse,
    WinHttpSendRequest, WinHttpSetTimeouts,
};

/// What this calls itself to a server. api.github.com turns down a request
/// that will not say, and a name is the polite half of being rate limited.
const AGENT: &str = concat!("totex-setup/", env!("CARGO_PKG_VERSION"));

/// How long any one step is given. A download's is per read rather than for
/// the whole of it, so this is not a ceiling on a slow line -- it is how long
/// a line that has stopped answering is waited on.
const PATIENCE: i32 = 30_000;

/// How much is read at once. Big enough that a bundle is not a hundred
/// thousand round trips, small enough that what is drawn moves.
const CHUNK: usize = 64 * 1024;

/// A WinHTTP handle that closes itself, so that a step failing part way
/// through leaves nothing open behind it.
struct Handle(*mut c_void);

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { WinHttpCloseHandle(self.0) };
    }
}

/// UTF-16 with a nul on the end, which is the only kind of string these take.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The two halves of an https address: what to connect to, and what to ask it
/// for.
///
/// Deliberately narrow. Every address this is given is either written into the
/// program below or read out of a release manifest, and a manifest naming a
/// port or a user name is a manifest to stop at rather than one to follow.
fn split(url: &str) -> Result<(&str, &str), String> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| format!("{url} is not an https address"))?;
    let (host, path) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, "/"),
    };
    if host.is_empty() || host.contains(['@', ':']) {
        return Err(format!("{url} does not name a host to ask"));
    }
    Ok((host, path))
}

/// Reads an address into memory, saying how far it has got as it goes.
///
/// `most` is what the answer is allowed to weigh. It is checked against what
/// the server says it is about to send and again against what it has actually
/// sent, because the first is only a claim.
pub fn get(
    url: &str,
    most: usize,
    headers: Option<&str>,
    mut progress: impl FnMut(usize, Option<usize>),
) -> Result<Vec<u8>, String> {
    let (host, path) = split(url)?;
    let (host, path) = (wide(host), wide(path));
    let agent = wide(AGENT);
    let verb = wide("GET");
    let headers = headers.map(wide);

    unsafe {
        let session = WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            null(),
            null(),
            0,
        );
        if session.is_null() {
            return Err(why("this machine will not open an HTTPS session"));
        }
        let session = Handle(session);
        WinHttpSetTimeouts(session.0, PATIENCE, PATIENCE, PATIENCE, PATIENCE);

        let connection = WinHttpConnect(session.0, host.as_ptr(), 443, 0);
        if connection.is_null() {
            return Err(why(&format!("{url} could not be reached")));
        }
        let connection = Handle(connection);

        let request = WinHttpOpenRequest(
            connection.0,
            verb.as_ptr(),
            path.as_ptr(),
            null(),
            null(),
            null(),
            WINHTTP_FLAG_SECURE,
        );
        if request.is_null() {
            return Err(why(&format!("{url} could not be asked for")));
        }
        let request = Handle(request);

        let (extra, extra_len) = match &headers {
            Some(text) => (text.as_ptr(), u32::MAX),
            None => (null(), 0),
        };
        if WinHttpSendRequest(request.0, extra, extra_len, null(), 0, 0, 0) == 0 {
            return Err(why(&format!("{url} could not be asked for")));
        }
        if WinHttpReceiveResponse(request.0, null_mut()) == 0 {
            return Err(why(&format!("{url} did not answer")));
        }

        match number(request.0, WINHTTP_QUERY_STATUS_CODE) {
            Some(200) => {}
            Some(404) => return Err(format!("{url} is not there")),
            Some(status) => return Err(format!("{url} answered {status}")),
            None => return Err(why(&format!("{url} answered nothing this understands"))),
        }

        // What the server says it is about to send. A server that says nothing
        // is read anyway and stopped by the same limit below.
        let expected =
            number(request.0, WINHTTP_QUERY_CONTENT_LENGTH).map(|length| length as usize);
        if expected.is_some_and(|length| length > most) {
            return Err(format!("{url} is larger than anything this installs"));
        }

        let mut body = Vec::with_capacity(expected.unwrap_or(CHUNK).min(most));
        let mut chunk = vec![0u8; CHUNK];
        progress(0, expected);
        loop {
            let mut read = 0u32;
            if WinHttpReadData(
                request.0,
                chunk.as_mut_ptr().cast::<c_void>(),
                CHUNK as u32,
                &mut read,
            ) == 0
            {
                return Err(why(&format!("{url} stopped part way")));
            }
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read as usize]);
            if body.len() > most {
                return Err(format!("{url} is larger than anything this installs"));
            }
            progress(body.len(), expected);
        }
        Ok(body)
    }
}

/// One of the numeric headers, read as the number it is rather than as text.
unsafe fn number(request: *mut c_void, what: u32) -> Option<u32> {
    let mut value = 0u32;
    let mut length = size_of::<u32>() as u32;
    let ok = unsafe {
        WinHttpQueryHeaders(
            request,
            what | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            (&raw mut value).cast::<c_void>(),
            &mut length,
            null_mut(),
        )
    };
    (ok != 0).then_some(value)
}

/// A failure with the number Windows gave for it on the end. Nobody reads
/// these for pleasure, but "0x2f7f" is the difference between a machine that
/// cannot resolve github.com and one whose proxy is turning this down.
fn why(what: &str) -> String {
    format!("{what} (Windows says 0x{:x})", unsafe { GetLastError() })
}
