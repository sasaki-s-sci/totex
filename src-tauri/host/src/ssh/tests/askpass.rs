//! What the copy of the app `ssh` starts as its askpass prints.

use super::super::askpass::answer;

#[test]
fn a_password_prompt_is_answered_with_the_secret_and_a_newline() {
    let said = Some("hunter2\n".to_string());
    assert_eq!(answer("a@10.0.0.2's password: ", "hunter2"), said);
    assert_eq!(answer("Password: ", "hunter2"), said);
    assert_eq!(answer("Password for a@box: ", "hunter2"), said);
    assert_eq!(answer("(a@box) PASSWORD:", "hunter2"), said);
}

#[test]
fn a_host_key_question_is_never_answered() {
    let question = "The authenticity of host 'box (10.0.0.2)' can't be established.\n\
                    ED25519 key fingerprint is SHA256:abc.\n\
                    Are you sure you want to continue connecting (yes/no/[fingerprint])? ";
    assert_eq!(answer(question, "hunter2"), None);
    assert_eq!(
        answer("Type yes/no for your password policy", "hunter2"),
        None
    );
}

#[test]
fn a_passphrase_or_anything_else_is_refused() {
    assert_eq!(
        answer(
            "Enter passphrase for key '/home/a/.ssh/id_ed25519': ",
            "hunter2"
        ),
        None
    );
    assert_eq!(answer("Verification code: ", "hunter2"), None);
    assert_eq!(answer("", "hunter2"), None);
}

#[test]
fn an_empty_secret_answers_nothing() {
    assert_eq!(answer("a@box's password: ", ""), None);
}
