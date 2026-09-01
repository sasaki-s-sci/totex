//! Base64, which two things in here need bytes turned into.
//!
//! A command crosses a channel's pipe as one line, and a path is allowed to
//! hold a newline; a picture crosses the layer's own pipe as JSON, and a byte
//! written as a number is four characters where this is one and a third.
//! Written out rather than depended on: it is sixteen lines.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut block = [0u8; 3];
        block[..chunk.len()].copy_from_slice(chunk);
        let packed = u32::from_be_bytes([0, block[0], block[1], block[2]]);
        for step in 0..4 {
            if step <= chunk.len() {
                let index = (packed >> (18 - step * 6)) & 0x3f;
                out.push(ALPHABET[index as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn encodes_the_way_base64_reads_it_back() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert!(!encode("echo 'it\\'s'".as_bytes()).contains('\n'));
    }
}
