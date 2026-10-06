use super::{Watcher, feed};
use crate::ask::Doing;
use totex_persistent::monitor::ActivityState;

#[test]
fn native_work_survives_redraws_without_interrupt_text() {
    let mut watcher = Watcher::new(24, 80);
    watcher.activity(Some(ActivityState::Working));
    assert_eq!(watcher.turned(), Some(Doing::Working));
    feed(
        &mut watcher,
        "\x1b[?1004h\x1b[2J\x1b[HProcessing a request\r\n",
    );
    watcher.resize(12, 40);
    feed(&mut watcher, "\x1b[2J\x1b[HAnother redraw\r\n");
    assert_eq!(watcher.doing(), Doing::Working);
    assert_eq!(watcher.turned(), None);
    watcher.activity(Some(ActivityState::Agent));
    assert_eq!(watcher.turned(), Some(Doing::Agent));
}

#[test]
fn native_activity_remains_authoritative_when_terminal_modes_change() {
    let mut watcher = Watcher::new(24, 80);
    feed(&mut watcher, "\x1b[?1004hProcessing\r\n");
    watcher.activity(Some(ActivityState::Working));
    feed(&mut watcher, "\x1b[?1004l\x1b[2J\x1b[H$ ");
    assert_eq!(watcher.doing(), Doing::Working);
    watcher.activity(None);
    assert_eq!(watcher.doing(), Doing::Idle);
    feed(&mut watcher, "sleep 30\r\n");
    assert_eq!(watcher.doing(), Doing::Running);
}

#[test]
fn clearing_native_activity_restores_screen_detection() {
    let mut watcher = Watcher::new(24, 80);
    feed(
        &mut watcher,
        "\x1b[?1004h❯ Try a command\r\nesc to interrupt\r\n",
    );
    watcher.activity(Some(ActivityState::Agent));
    assert_eq!(watcher.doing(), Doing::Agent);
    watcher.activity(None);
    assert_eq!(watcher.doing(), Doing::Working);
}

#[test]
fn native_state_can_be_restored_without_a_terminal_takeover() {
    let mut watcher = Watcher::new(24, 80);
    watcher.replay("$ ", 2);
    watcher.activity(Some(ActivityState::Working));
    assert_eq!(watcher.doing(), Doing::Working);
    feed(&mut watcher, "\r\nupdated output\r\n");
    assert_eq!(watcher.doing(), Doing::Working);
    watcher.activity(Some(ActivityState::Agent));
    assert_eq!(watcher.doing(), Doing::Agent);
    watcher.activity(None);
    assert_eq!(watcher.doing(), Doing::Running);
}
