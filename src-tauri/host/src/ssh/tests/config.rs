//! The names picked out of an ssh config.

use super::super::parse_config;

#[test]
fn every_host_line_names_its_machines_in_order() {
    let config = "\
# the machines
Host box
  HostName box.example.com
  User a

host   second third
HOST=fourth
Host \"quoted name\"
Host box
";
    assert_eq!(
        parse_config(config),
        ["box", "second", "third", "fourth", "quoted name"]
    );
}

#[test]
fn patterns_and_negations_are_not_machines() {
    let config = "\
Host *
  ServerAliveInterval 30
Host *.example.com !gateway.example.com box
Host wh?t
Match host box
  User b
Include ~/.ssh/other
";
    assert_eq!(parse_config(config), ["box"]);
}

#[test]
fn an_empty_or_absent_config_names_nothing() {
    assert!(parse_config("").is_empty());
    assert!(parse_config("Host\n").is_empty());
    assert!(parse_config("HostName box.example.com\n").is_empty());
}
