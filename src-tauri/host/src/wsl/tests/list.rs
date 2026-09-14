//! The list of distributions `wsl.exe` prints.

use super::super::shell::parse_list;

#[test]
fn names_every_distribution_the_list_holds() {
    let utf16: Vec<u8> = "Ubuntu\r\nDebian\r\n"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    assert_eq!(parse_list(&utf16), vec!["Ubuntu", "Debian"]);
    assert_eq!(parse_list(b"Ubuntu\nDebian\n"), vec!["Ubuntu", "Debian"]);
}
