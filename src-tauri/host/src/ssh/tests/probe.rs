//! Reading what a failed `ssh` said into what the window can do about it.

use super::super::{Reached, classify};

#[test]
fn a_refusal_is_a_password_wanted() {
    assert_eq!(
        classify("a@10.0.0.2: Permission denied (publickey,password).\r\n"),
        Reached::NeedsPassword
    );
    assert_eq!(
        classify("Received disconnect from 10.0.0.2 port 22:2: Too many authentication failures\n"),
        Reached::NeedsPassword
    );
}

#[test]
fn a_server_that_takes_no_password_is_not_asked_for_one() {
    assert_eq!(
        classify("a@10.0.0.2: Permission denied (publickey).\r\n"),
        Reached::Unreachable("a@10.0.0.2: Permission denied (publickey).".to_string())
    );
    assert_eq!(
        classify("a@10.0.0.2: Permission denied (publickey,keyboard-interactive).\n"),
        Reached::NeedsPassword
    );
}

#[test]
fn a_changed_key_is_the_host_key_even_when_a_refusal_follows() {
    assert_eq!(
        classify("Host key verification failed.\n"),
        Reached::HostKey
    );
    let banner = "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n\
                  @    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n\
                  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n\
                  Password authentication is disabled to avoid man-in-the-middle attacks.\n\
                  a@box: Permission denied (publickey).\n";
    assert_eq!(classify(banner), Reached::HostKey);
}

#[test]
fn anything_else_is_unreachable_with_the_first_thing_said() {
    assert_eq!(
        classify("\n  ssh: connect to host 10.0.0.2 port 2222: Connection refused\r\n"),
        Reached::Unreachable(
            "ssh: connect to host 10.0.0.2 port 2222: Connection refused".to_string()
        )
    );
    assert_eq!(
        classify("ssh: Could not resolve hostname nowhere: Name or service not known\n"),
        Reached::Unreachable(
            "ssh: Could not resolve hostname nowhere: Name or service not known".to_string()
        )
    );
    assert_eq!(classify(""), Reached::Unreachable(String::new()));
}
