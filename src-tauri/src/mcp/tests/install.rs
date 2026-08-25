//! The registration an agent is set up with.

use super::super::*;

/// The registration reaches the agent as an address and not as a quoted one.
///
/// The line is handed to a shell to be run, and the two shells it is run
/// through do not read the same quotes: a POSIX shell takes the single ones off
/// and leaves the variable for the agent to expand, and `cmd` has none — it
/// would hand the agent the quotes as part of the address, which is a
/// registration that can only ever fail to connect.
#[test]
fn the_registration_is_quoted_the_way_the_shell_running_it_reads() {
    let posix = install::line('\'');
    assert!(
        posix.ends_with(&format!("'${{{ADDRESS_VAR}}}'")),
        "a POSIX shell was handed {posix}"
    );

    let windows = install::line('"');
    assert!(
        windows.ends_with(&format!("\"${{{ADDRESS_VAR}}}\"")),
        "cmd was handed {windows}"
    );
}
