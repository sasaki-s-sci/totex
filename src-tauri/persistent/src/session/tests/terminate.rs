use std::fs;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::Sessions;

struct Fixture {
    home: std::path::PathBuf,
    sessions: Arc<Sessions>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.sessions.close("termination");
        if let Ok(pid) = fs::read_to_string(self.home.join("detached.pid"))
            && let Ok(pid) = pid.trim().parse::<i32>()
        {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        let _ = fs::remove_dir_all(&self.home);
    }
}

fn alive(pid: u32) -> bool {
    let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    // A zombie has already stopped executing and only awaits its parent's reap.
    stat.rsplit_once(')')
        .and_then(|(_, rest)| rest.split_whitespace().next())
        != Some("Z")
}

#[test]
fn closing_terminal_ends_background_jobs_that_ignore_hangup() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let home =
        std::env::temp_dir().join(format!("totex-termination-{}-{unique}", std::process::id()));
    fs::create_dir(&home).unwrap();
    let sessions = Arc::new(Sessions::default());
    let fixture = Fixture {
        home: home.clone(),
        sessions: Arc::clone(&sessions),
    };
    sessions
        .open("termination", home.to_str().unwrap(), 24, 80, None)
        .unwrap();
    // The background shell and its sleep both ignore HUP and occupy a job
    // control group different from the interactive shell's root process group.
    sessions.write("termination", "sh -c 'trap \"\" HUP; echo $$ > background.pid; sleep 60 & echo $! > sleep.pid; wait' &\nsetsid sh -c 'echo $$ > detached.pid; exec sleep 60' &\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let (background, sleep, detached) = loop {
        let read = |name| {
            fs::read_to_string(home.join(name))
                .ok()?
                .trim()
                .parse::<u32>()
                .ok()
        };
        if let (Some(background), Some(sleep), Some(detached)) = (
            read("background.pid"),
            read("sleep.pid"),
            read("detached.pid"),
        ) {
            break (background, sleep, detached);
        }
        assert!(Instant::now() < deadline, "fixture jobs failed to start");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert!(alive(background) && alive(sleep));
    let root = sessions.running()[0].pid.unwrap();
    assert_ne!(unsafe { libc::getsid(detached as i32) }, root as i32);
    assert_eq!(unsafe { libc::getsid(background as i32) }, root as i32);
    sessions.close("termination");
    while (alive(background) || alive(sleep)) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        !alive(background),
        "background shell survived terminal closure"
    );
    assert!(!alive(sleep), "background child survived terminal closure");
    assert!(sessions.running().is_empty());
    assert!(
        alive(detached),
        "detached service was killed with the terminal jobs"
    );
    drop(fixture);
}
