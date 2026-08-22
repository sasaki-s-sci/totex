//! What the readers make of what the three agents actually leave lying around.
//!
//! Every one of these formats belongs to somebody else and none of them is
//! promised to stay put, so the cases here are the shapes seen on a real
//! machine — including the awkward ones — and the rule that a shape which has
//! moved on costs a field rather than the whole panel.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::*;

/// A temporary directory that removes itself, so a failing test leaves nothing.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "totex")
        .env("GIT_AUTHOR_EMAIL", "totex@example.invalid")
        .env("GIT_COMMITTER_NAME", "totex")
        .env("GIT_COMMITTER_EMAIL", "totex@example.invalid")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("run git");
    assert!(output.status.success(), "git {args:?} failed");
}

// ------------------------------------------------------------- the process table

#[test]
fn a_process_named_after_a_bracket_is_still_read() {
    // The command sits in brackets and is whatever the program called itself,
    // so counting fields from the left finds the wrong ones.
    let line = "42 (we (are) fine) S 7 42 42 0 -1 4194560 0 0 0 0 1 2 0 0 20 0 1 0 99";
    assert_eq!(proc::parse_stat(line), Some((7, 99)));
}

#[test]
fn boot_is_read_off_the_line_that_says_so() {
    let stat = "cpu 1 2 3\nbtime 1786891407\nprocesses 9\n";
    assert_eq!(proc::parse_btime(stat), Some(1_786_891_407));
    assert_eq!(proc::parse_btime("cpu 1 2 3\n"), None);
}

#[test]
fn a_start_stamp_becomes_a_time_of_day() {
    // A hundred ticks after boot is one second after boot.
    assert_eq!(proc::started_at(1_000, 100), 1_001_000);
}

#[test]
fn the_command_is_the_last_part_of_wherever_it_was_installed() {
    let versioned = vec!["/home/a/.local/share/claude/versions/2.1.234".to_string()];
    assert_eq!(proc::program_of(&versioned, "claude"), "claude");

    let windows = vec!["C:\\tools\\Codex.exe".to_string()];
    assert_eq!(proc::program_of(&windows, ""), "codex");

    // Nothing on the command line at all: the kernel's short name is left.
    assert_eq!(proc::program_of(&[], "opencode\n"), "opencode");
}

#[test]
fn an_agent_installed_by_a_package_manager_is_found_behind_its_interpreter() {
    // What `claude` is when npm installed it: a script with a shebang, so the
    // process is node and the command that was typed is its argument.
    let shimmed = vec![
        "/home/a/.nvm/versions/node/v24.13.0/bin/node".to_string(),
        "/home/a/.nvm/versions/node/v24.13.0/bin/claude".to_string(),
        "--continue".to_string(),
    ];
    assert_eq!(proc::program_of(&shimmed, "node"), "claude");

    // A runtime running something else is that something, not an agent.
    let vite = vec![
        "node".to_string(),
        "/repo/node_modules/.bin/vite".to_string(),
    ];
    assert_eq!(proc::program_of(&vite, "node"), "vite");

    // A runtime on its own is still just the runtime.
    assert_eq!(proc::program_of(&["node".to_string()], "node"), "node");
}

#[test]
fn a_command_line_is_split_on_the_nuls() {
    let raw = b"opencode\0--agent\0plan\0";
    assert_eq!(
        proc::parse_cmdline(raw),
        vec![
            "opencode".to_string(),
            "--agent".to_string(),
            "plan".to_string()
        ]
    );
}

// -------------------------------------------------------------------- placing

#[test]
fn a_head_says_either_a_branch_or_a_commit() {
    assert_eq!(
        place::parse_head("ref: refs/heads/feature/one\n"),
        (Some("feature/one".to_string()), None)
    );
    let detached = place::parse_head("9c1e0a3f5b2d4e6a8c0b1d2e3f4a5b6c7d8e9f00\n");
    assert_eq!(detached.0, None);
    assert!(detached.1.is_some());
    assert_eq!(place::parse_head("gitdir: elsewhere"), (None, None));
}

#[test]
fn a_directory_in_a_checkout_is_placed_on_its_branch() {
    let temp = TempDir::new("place");
    let root = temp.path();
    git(root, &["init", "--initial-branch=main", "."]);
    std::fs::write(root.join("one.txt"), "one").expect("write");
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "one"]);
    std::fs::create_dir_all(root.join("src/deep")).expect("make dirs");

    // Asked from a directory well inside the checkout, which is where an agent
    // is as often as not.
    let placed = place::locate(&Host::Local, &root.join("src/deep")).expect("placed");
    assert_eq!(placed.worktree, root);
    assert_eq!(placed.repo, root);
    assert_eq!(placed.branch.as_deref(), Some("main"));
}

#[test]
fn a_linked_worktree_is_placed_on_the_repository_it_came_from() {
    let temp = TempDir::new("worktree");
    let root = temp.path().join("repo");
    std::fs::create_dir_all(&root).expect("make repo dir");
    git(&root, &["init", "--initial-branch=main", "."]);
    std::fs::write(root.join("one.txt"), "one").expect("write");
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "one"]);

    let linked = temp.path().join("side");
    git(
        &root,
        &[
            "worktree",
            "add",
            linked.to_str().expect("path"),
            "-b",
            "side",
        ],
    );

    let placed = place::locate(&Host::Local, &linked).expect("placed");
    assert_eq!(placed.branch.as_deref(), Some("side"));
    assert_eq!(placed.worktree, linked);
    // The whole point: two checkouts, one repository, so the map draws one.
    assert_eq!(placed.repo, root);
}

#[test]
fn somewhere_that_is_not_a_checkout_is_not_placed() {
    let temp = TempDir::new("bare-dir");
    // Some sandboxes mount their policy metadata as `/tmp/.git`. In that
    // environment the temporary directory genuinely has a repository ancestor,
    // so this case cannot be constructed under the platform temp directory.
    if temp
        .path()
        .ancestors()
        .skip(1)
        .any(|ancestor| ancestor.join(".git").exists())
    {
        return;
    }
    assert!(place::locate(&Host::Local, temp.path()).is_none());
}

// ------------------------------------------------------------- what each says

#[test]
fn a_claude_session_file_is_read_as_it_is_written() {
    let text = r#"{
      "pid": 197919,
      "sessionId": "a097d73a-77cd-470a-ba29-1e5ff37e36de",
      "cwd": "/home/a/repo/emuni-m2x",
      "startedAt": 1786891407568,
      "procStart": "1382440",
      "version": "2.1.233",
      "kind": "interactive",
      "name": "emuni-m2x-ca",
      "status": "waiting",
      "updatedAt": 1787040193827,
      "waitingFor": "input needed"
    }"#;
    let entry = claude::parse(text).expect("parsed");
    assert_eq!(entry.pid, Some(197_919));
    assert_eq!(entry.status.as_deref(), Some("waiting"));
}

#[test]
fn a_session_file_that_has_moved_on_costs_only_the_fields_it_dropped() {
    // None of this is a published format; a version that renames half of it
    // must still leave an agent on the map rather than emptying it.
    let entry = claude::parse(r#"{"pid": 5, "somethingNew": true}"#).expect("parsed");
    assert_eq!(entry.pid, Some(5));
    assert_eq!(entry.session_id, None);
    assert!(claude::parse("not json at all").is_none());
}

#[test]
fn a_rollout_says_which_thread_it_is_and_where() {
    let line = r#"{"timestamp":"2026-07-08T22:23:48.536Z","type":"session_meta","payload":{"session_id":"019f43d3","cwd":"/home/a/repo/emuni-e3","originator":"codex-tui","cli_version":"0.143.0"}}"#;
    let meta = codex::parse_meta(line).expect("parsed");
    assert_eq!(meta.session_id.as_deref(), Some("019f43d3"));
    assert_eq!(meta.cwd.as_deref(), Some("/home/a/repo/emuni-e3"));

    // Every other line of the file is the conversation, and says nothing.
    assert!(codex::parse_meta(r#"{"type":"response_item","payload":{}}"#).is_none());
}

#[test]
fn a_rollout_started_by_the_agent_itself_says_which_subagent_it_is() {
    // The one place any of the three admits to a subagent from outside. The
    // shape has changed once already, so what is read is "whatever names it".
    let line = r#"{"type":"session_meta","payload":{"session_id":"019f","cwd":"/repo","thread_source":"subagent","source":{"subagent":{"other":"guardian"}}}}"#;
    let meta = codex::parse_meta(line).expect("parsed");
    assert_eq!(codex::subagent_role(&meta).as_deref(), Some("guardian"));

    // A thread somebody is talking to is not one, whatever else it carries.
    let mine = r#"{"type":"session_meta","payload":{"session_id":"019a","thread_source":"user","source":"cli"}}"#;
    assert_eq!(
        codex::subagent_role(&codex::parse_meta(mine).expect("parsed")),
        None
    );

    // Known to be one, with nothing in it that says which.
    let bare = r#"{"type":"session_meta","payload":{"thread_source":"subagent"}}"#;
    assert_eq!(
        codex::subagent_role(&codex::parse_meta(bare).expect("parsed")).as_deref(),
        Some("subagent")
    );
}

#[test]
fn a_subagent_shows_while_its_thread_is_still_being_written_to() {
    let parent = agent_at("codex:one", 30, "/home/a/repo/one");
    let thread = |written: u64| {
        codex::Thread {
        rollout_id: "019f0000-0000-7000-8000-000000000001".to_string(),
        meta: codex::parse_meta(
            r#"{"type":"session_meta","payload":{"session_id":"019f","thread_source":"subagent","source":{"subagent":{"other":"guardian"}}}}"#,
        )
        .expect("parsed"),
        subagent: Some("guardian".to_string()),
        updated_at: Some(written),
    }
    };

    let now = 1_000_000;
    let live = from_subagent(&parent, &thread(now - 1_000), now).expect("a live subagent");
    assert_eq!(live.parent.as_deref(), Some("codex:one"));
    assert_eq!(live.key, "codex:019f0000-0000-7000-8000-000000000001");
    assert_eq!(
        live.session_id.as_deref(),
        Some("019f0000-0000-7000-8000-000000000001")
    );
    assert_eq!(live.name.as_deref(), Some("guardian"));
    // Standing where its parent is standing, which is the whole reason it is
    // worth drawing: the work lands in that checkout.
    assert_eq!(live.cwd, parent.cwd);
    assert_eq!(live.pid, None);

    // Nothing on disk says a thread has finished, so one that has stopped being
    // written to has to be let go of rather than left on the map for good.
    assert!(from_subagent(&parent, &thread(now - CODEX_ACTIVE_MS), now).is_none());
}

#[test]
fn two_codex_processes_in_one_worktree_claim_different_threads() {
    let thread = |rollout_id: &str, session_id: &str| {
        codex::Thread {
        rollout_id: rollout_id.to_string(),
        meta: codex::parse_meta(&format!(
            r#"{{"type":"session_meta","payload":{{"session_id":"{session_id}","cwd":"/repo","thread_source":"user"}}}}"#
        ))
        .expect("parsed"),
        subagent: None,
        updated_at: Some(1_000),
    }
    };
    let threads = vec![
        thread("rollout-new", "session-new"),
        thread("rollout-old", "session-old"),
    ];
    let mut claimed = HashSet::new();

    let first = codex::claim_thread(&threads, Path::new("/repo"), &mut claimed).expect("first");
    let second = codex::claim_thread(&threads, Path::new("/repo"), &mut claimed).expect("second");

    assert_eq!(first.meta.session_id.as_deref(), Some("session-new"));
    assert_eq!(second.meta.session_id.as_deref(), Some("session-old"));
    assert!(codex::claim_thread(&threads, Path::new("/repo"), &mut claimed).is_none());
}

#[test]
fn a_subagent_is_only_attached_to_its_own_codex_thread() {
    let child = |rollout_id: &str, parent: &str| {
        codex::Thread {
        rollout_id: rollout_id.to_string(),
        meta: codex::parse_meta(&format!(
            r#"{{"type":"session_meta","payload":{{"session_id":"{parent}","cwd":"/repo","thread_source":"subagent","source":{{"subagent":{{"other":"guardian"}}}}}}}}"#
        ))
        .expect("parsed"),
        subagent: Some("guardian".to_string()),
        updated_at: Some(1_000),
    }
    };
    let threads = vec![
        child("child-one", "parent-one"),
        child("child-two", "parent-two"),
    ];

    let found = codex::subagents_in(&threads, Path::new("/repo"), "parent-one")
        .map(|thread| thread.rollout_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(found, vec!["child-one"]);
}

#[test]
fn a_session_file_left_behind_by_a_dead_process_is_not_read_onto_a_live_one() {
    // Pids come round again, and a file about the last owner of this one would
    // otherwise put somebody else's session on the map.
    let mut running = process(40, 1, "claude");
    running.start_ticks = 900;

    let same = claude::parse(r#"{"pid":40,"procStart":"900"}"#).expect("parsed");
    let stale = claude::parse(r#"{"pid":40,"procStart":"12"}"#).expect("parsed");
    let quiet = claude::parse(r#"{"pid":40}"#).expect("parsed");

    assert!(wrote(&same, &running));
    assert!(!wrote(&stale, &running));
    // Nothing to check against is not a reason to throw the file away.
    assert!(wrote(&quiet, &running));
}

#[test]
fn an_opencode_command_line_says_the_mode_and_the_agent() {
    let words = |line: &str| line.split(' ').map(str::to_string).collect::<Vec<_>>();

    let served = opencode::read(&words("opencode serve --port 4096"));
    assert_eq!(served.mode.as_deref(), Some("serve"));

    let planning = opencode::read(&words("opencode --agent plan"));
    assert_eq!(planning.agent.as_deref(), Some("plan"));
    assert_eq!(planning.mode, None);

    // The default subcommand takes a directory where a subcommand would be, and
    // the directory is already known from the process itself.
    let opened = opencode::read(&words("opencode /home/a/repo/vrc"));
    assert_eq!(opened.mode, None);
}

// --------------------------------------------------------------- the assembly

/// A process, for the tests that only care about who started whom.
fn process(pid: u32, ppid: u32, program: &str) -> proc::Process {
    proc::Process {
        pid,
        ppid,
        started_at: Some(1_000),
        program: program.to_string(),
        args: vec![program.to_string()],
        cwd: Some(PathBuf::from("/home/a/repo/one")),
        start_ticks: 1,
    }
}

fn agent_at(key: &str, pid: u32, cwd: &str) -> Agent {
    let mut agent = base(Tool::Claude, key.to_string(), None, Path::new(cwd), None);
    agent.pid = Some(pid);
    agent
}

#[test]
fn an_agent_started_through_a_shell_still_hangs_off_the_one_that_started_it() {
    let table = [
        process(10, 1, "claude"),
        // The shell in between is not an agent and gets no node of its own.
        process(11, 10, "bash"),
        process(12, 11, "codex"),
    ];
    let by_pid: HashMap<u32, &proc::Process> = table.iter().map(|one| (one.pid, one)).collect();

    let mut agents = vec![
        agent_at("claude:one", 10, "/home/a/repo/one"),
        agent_at("codex:two", 12, "/home/a/repo/one"),
    ];
    link_parents(&mut agents, &by_pid);

    assert_eq!(agents[0].parent, None);
    assert_eq!(agents[1].parent.as_deref(), Some("claude:one"));
}

#[test]
fn an_agent_of_its_own_hangs_off_nothing() {
    let table = [process(20, 1, "claude")];
    let by_pid: HashMap<u32, &proc::Process> = table.iter().map(|one| (one.pid, one)).collect();

    let mut agents = vec![agent_at("claude:alone", 20, "/home/a/repo/one")];
    link_parents(&mut agents, &by_pid);
    assert_eq!(agents[0].parent, None);
}

#[test]
fn an_agent_this_window_opened_is_known_to_be_its_own() {
    // The window draws what it started itself, chip and close button and all.
    // Drawn again from the sweep it would be two of everything, so the sweep
    // says which are already accounted for — by descent, since a terminal and
    // the shell inside it write nothing down about whose they are.
    let ours = std::process::id();
    let table = [
        // this window → its terminal's shell → the agent typed into it
        process(ours, 1, "totex"),
        process(ours + 1, ours, "bash"),
        process(ours + 2, ours + 1, "claude"),
        // and one somebody started in a terminal of their own
        process(ours + 3, 1, "claude"),
    ];
    let by_pid: HashMap<u32, &proc::Process> = table.iter().map(|one| (one.pid, one)).collect();

    let mut agents = vec![
        agent_at("claude:mine", ours + 2, "/home/a/repo/one"),
        agent_at("claude:theirs", ours + 3, "/home/a/repo/one"),
    ];
    claim_ours(&mut agents, &by_pid);

    assert!(agents[0].own);
    assert!(!agents[1].own);
}

#[test]
fn two_sweeps_that_found_the_same_thing_are_the_same_answer() {
    // What the window is told is diffed against what it was told last, so an
    // order that depends on the order the machine listed its processes in would
    // redraw the map every couple of seconds for nothing.
    let one = settle(vec![
        agent_at("claude:b", 2, "/home/a/repo/two"),
        agent_at("claude:a", 1, "/home/a/repo/one"),
    ]);
    let two = settle(vec![
        agent_at("claude:a", 1, "/home/a/repo/one"),
        agent_at("claude:b", 2, "/home/a/repo/two"),
    ]);
    assert_eq!(one, two);
    assert_eq!(one.agents[0].key, "claude:a");
}

#[test]
fn a_machine_whose_processes_cannot_be_read_still_shows_what_wrote_itself_down() {
    let entry = claude::parse(
        r#"{"pid":7,"sessionId":"s-7","cwd":"/home/a/repo/one","status":"busy","kind":"bg"}"#,
    )
    .expect("parsed");
    let agents = from_sessions(&Host::Local, &[entry]);

    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].key, "claude:s-7");
    assert_eq!(agents[0].activity, Activity::Busy);
    assert!(agents[0].background);
    // Nothing confirmed it is alive, and the map says which of the two it is.
    assert_eq!(agents[0].source, Source::Session);
}

// ------------------------------------------------------- inside a distribution

/// A distribution to look into, or `None` where there is none to reach — which
/// is every machine the CI builds on, so these skip rather than fail.
fn reachable() -> Option<Host> {
    crate::wsl::distros().into_iter().next().map(Host::Wsl)
}

/// The process table of a machine that is not this one.
///
/// A working directory is the whole answer to "where is this agent working",
/// and on Windows there is no way to read one at all — so a window there sees
/// no agents until it asks the distribution, which is what this is.
#[test]
fn reads_the_process_table_of_a_distribution() {
    let Some(host) = reachable() else {
        return;
    };
    let table = proc::table(&host);
    assert!(!table.is_empty(), "nothing at all was running");

    let init = table
        .iter()
        .find(|process| process.pid == 1)
        .expect("the first process");
    assert!(!init.program.is_empty());
    assert!(
        init.started_at.unwrap_or(0) > 1_600_000_000_000,
        "the boot clock did not come back: {:?}",
        init.started_at
    );

    // Every directory it reports is named the way the window names paths, so a
    // running agent lands on the repository the graph already drew.
    let mut standing = table.iter().filter_map(|process| process.cwd.as_ref());
    assert!(
        standing.all(|cwd| cwd.to_string_lossy().starts_with(r"\\wsl.localhost\")),
        "a directory came back in the distribution's own spelling"
    );
}

/// Placing a directory inside a distribution: the same three files git leaves
/// lying about, read over there in one go.
#[test]
fn places_a_directory_inside_a_distribution() {
    let Some(host) = reachable() else {
        return;
    };
    let root = host.canonical("/tmp/totex-place-remote");
    host.exec(None, &[], &["rm", "-rf", "/tmp/totex-place-remote"])
        .expect("a shell");
    host.exec(
        None,
        &[],
        &[
            "mkdir",
            "-p",
            "/tmp/totex-place-remote/repo/.git",
            "/tmp/totex-place-remote/repo/deep",
        ],
    )
    .expect("a shell");
    host.exec(
        None,
        &[],
        &[
            "sh",
            "-c",
            "printf 'ref: refs/heads/main\n' > /tmp/totex-place-remote/repo/.git/HEAD",
        ],
    )
    .expect("a shell");

    let placed = place::locate(&host, &host.canonical("/tmp/totex-place-remote/repo/deep"))
        .expect("a place");
    assert_eq!(placed.repo, host.canonical("/tmp/totex-place-remote/repo"));
    assert_eq!(placed.worktree, placed.repo);
    assert_eq!(placed.branch.as_deref(), Some("main"));

    // A directory that is in no repository at all is drawn as itself.
    assert_eq!(place::locate(&host, &root), None);
}

/// A linked worktree keeps a line of text where its `.git` would be, and points
/// back at the repository through `commondir`.
#[test]
fn places_a_linked_worktree_inside_a_distribution() {
    let Some(host) = reachable() else {
        return;
    };
    host.exec(None, &[], &["rm", "-rf", "/tmp/totex-place-linked"])
        .expect("a shell");
    host.exec(
        None,
        &[],
        &[
            "mkdir",
            "-p",
            "/tmp/totex-place-linked/repo/.git/worktrees/topic",
            "/tmp/totex-place-linked/topic",
        ],
    )
    .expect("a shell");
    host.exec(
        None,
        &[],
        &[
            "sh",
            "-c",
            "cd /tmp/totex-place-linked; \
             printf 'gitdir: /tmp/totex-place-linked/repo/.git/worktrees/topic\n' > topic/.git; \
             printf '../..\n' > repo/.git/worktrees/topic/commondir; \
             printf 'ref: refs/heads/topic\n' > repo/.git/worktrees/topic/HEAD",
        ],
    )
    .expect("a shell");

    let placed =
        place::locate(&host, &host.canonical("/tmp/totex-place-linked/topic")).expect("a place");
    assert_eq!(placed.repo, host.canonical("/tmp/totex-place-linked/repo"));
    assert_eq!(
        placed.worktree,
        host.canonical("/tmp/totex-place-linked/topic")
    );
    assert_eq!(placed.branch.as_deref(), Some("topic"));
}
