//! Associates Codex request metadata with identities emitted by each terminal.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

const OSC_LIMIT: usize = 1024;
const THREAD_LIMIT: usize = 4096;

#[derive(Default)]
pub(super) struct Binding {
    terminals: HashMap<String, Terminal>,
}

#[derive(Default)]
struct Terminal {
    parser: Parser,
    threads: HashSet<String>,
}

impl Binding {
    pub fn observe(&mut self, terminal: &str, chunk: &str) {
        let terminal = self.terminals.entry(terminal.to_string()).or_default();
        for byte in chunk.bytes() {
            if let Some(thread) = terminal.parser.push(byte)
                && terminal.threads.len() < THREAD_LIMIT
            {
                terminal.threads.insert(thread);
            }
        }
    }

    pub fn forget(&mut self, terminal: &str) {
        self.terminals.remove(terminal);
    }

    pub fn resolve(&self, meta: &Value) -> Result<String, String> {
        for key in ["threadId", "sessionId"] {
            let Some(id) = meta.get(key).and_then(Value::as_str).filter(|id| uuid(id)) else {
                continue;
            };
            let id = id.to_ascii_lowercase();
            let mut matches = self.terminals.iter().filter(|(_, terminal)| {
                terminal.threads.iter().any(|prefix| id.starts_with(prefix))
            });
            if let Some((terminal, _)) = matches.next() {
                if matches.next().is_some() {
                    return Err("This Codex thread is visible in more than one terminal. Close its duplicate terminal before using the canvas.".to_string());
                }
                return Ok(terminal.clone());
            }
        }
        Err("No totex terminal is associated with this Codex thread. Use the registered totex MCP connection with threadId/sessionId metadata; an inherited TOTEX_MCP_URL cannot identify this conversation. Complete the Codex MCP registration and open Codex in a totex terminal.".to_string())
    }
}

#[derive(Default)]
struct Parser {
    state: State,
    bytes: Vec<u8>,
}

#[derive(Default)]
enum State {
    #[default]
    Text,
    Escape,
    Osc,
    OscEscape,
    Discard,
    DiscardEscape,
}

impl Parser {
    fn push(&mut self, byte: u8) -> Option<String> {
        match self.state {
            State::Text => {
                if byte == 0x1b {
                    self.state = State::Escape;
                }
            }
            State::Escape => match byte {
                b']' => self.begin(),
                0x1b => {}
                _ => self.state = State::Text,
            },
            State::Osc => match byte {
                0x07 => return self.finish(),
                0x1b => self.state = State::OscEscape,
                0x18 | 0x1a => self.cancel(),
                0x00..=0x1f | 0x7f => self.discard(),
                _ if self.bytes.len() < OSC_LIMIT => self.bytes.push(byte),
                _ => self.discard(),
            },
            State::OscEscape => match byte {
                b'\\' => return self.finish(),
                b']' => self.begin(),
                _ => self.discard(),
            },
            State::Discard => match byte {
                0x07 | 0x18 | 0x1a => self.cancel(),
                0x1b => self.state = State::DiscardEscape,
                _ => {}
            },
            State::DiscardEscape => match byte {
                b'\\' | 0x07 | 0x18 | 0x1a => self.cancel(),
                b']' => self.begin(),
                0x1b => {}
                _ => self.state = State::Discard,
            },
        }
        None
    }

    fn begin(&mut self) {
        self.bytes.clear();
        self.state = State::Osc;
    }

    fn cancel(&mut self) {
        self.bytes.clear();
        self.state = State::Text;
    }

    fn discard(&mut self) {
        self.bytes.clear();
        self.state = State::Discard;
    }

    fn finish(&mut self) -> Option<String> {
        let thread = std::str::from_utf8(&self.bytes).ok().and_then(title_thread);
        self.cancel();
        thread
    }
}

fn title_thread(osc: &str) -> Option<String> {
    let title = osc.strip_prefix("0;").or_else(|| osc.strip_prefix("2;"))?;
    let first = title.split(' ').next()?;
    // Codex currently renders thread-id as 29 UUID characters followed by three dots.
    let id = match first.strip_suffix("...") {
        Some(prefix) if prefix.len() == 29 && uuid_prefix(prefix) => prefix,
        None if uuid(first) => first,
        _ => return None,
    };
    Some(id.to_ascii_lowercase())
}

fn uuid(id: &str) -> bool {
    id.len() == 36 && uuid_prefix(id)
}

fn uuid_prefix(id: &str) -> bool {
    id.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIRST: &str = "550e8400-e29b-41d4-a716-446655440000";
    const SECOND: &str = "650e8400-e29b-41d4-a716-446655440000";

    fn title(thread: &str) -> String {
        format!("\x1b]2;{thread} | codex | project\x07")
    }

    fn meta(thread: &str) -> Value {
        json!({"threadId": thread, "sessionId": thread})
    }

    #[test]
    fn terminals_keep_their_own_threads_and_background_work() {
        let mut binding = Binding::default();
        binding.observe("one", &title(FIRST));
        binding.observe("two", &title(SECOND));
        assert_eq!(binding.resolve(&meta(FIRST)).unwrap(), "one");
        assert_eq!(binding.resolve(&meta(SECOND)).unwrap(), "two");

        let next = "750e8400-e29b-41d4-a716-446655440000";
        binding.observe("one", &title(next));
        binding.observe("one", "\x1b]2;ordinary shell title\x07");
        assert_eq!(binding.resolve(&meta(next)).unwrap(), "one");
        assert_eq!(binding.resolve(&meta(FIRST)).unwrap(), "one");
        assert_eq!(
            binding
                .resolve(&json!({"threadId": SECOND, "sessionId": FIRST}))
                .unwrap(),
            "two"
        );
        assert_eq!(
            binding
                .resolve(
                    &json!({"threadId": "850e8400-e29b-41d4-a716-446655440000", "sessionId": FIRST})
                )
                .unwrap(),
            "one"
        );
    }

    #[test]
    fn title_sequences_can_be_split_at_every_byte() {
        for sequence in [title(FIRST), format!("\x1b]0;{FIRST}\x1b\\")] {
            for split in 0..=sequence.len() {
                let mut binding = Binding::default();
                binding.observe("one", &sequence[..split]);
                binding.observe("one", &sequence[split..]);
                assert_eq!(
                    binding.resolve(&meta(FIRST)).unwrap(),
                    "one",
                    "split {split}"
                );
            }
        }
    }

    #[test]
    fn codex_truncated_identity_and_spinner_are_recognized() {
        for suffix in ["", " | project", " ⠋ a task | project"] {
            let mut binding = Binding::default();
            binding.observe("one", &format!("\x1b]2;{}...{suffix}\x07", &FIRST[..29]));
            assert_eq!(binding.resolve(&meta(FIRST)).unwrap(), "one");
            assert!(binding.resolve(&meta(SECOND)).is_err());
            assert!(
                binding
                    .resolve(&meta(&format!("{}...", &FIRST[..29])))
                    .is_err()
            );
        }
    }

    #[test]
    fn ambiguous_identity_is_not_routed_even_when_root_is_unique() {
        let mut binding = Binding::default();
        binding.observe("one", &title(FIRST));
        binding.observe("two", &title(FIRST));
        binding.observe("one", &title(SECOND));
        assert!(
            binding
                .resolve(&json!({"threadId": FIRST, "sessionId": SECOND}))
                .is_err()
        );
        binding.forget("two");
        assert_eq!(binding.resolve(&meta(FIRST)).unwrap(), "one");
        binding.forget("one");
        assert!(binding.resolve(&meta(FIRST)).is_err());
    }

    #[test]
    fn matching_truncated_prefixes_are_ambiguous() {
        let mut binding = Binding::default();
        binding.observe("one", &format!("\x1b]2;{}...\x07", &FIRST[..29]));
        let collision = "550e8400-e29b-41d4-a716-446655449999";
        binding.observe("two", &format!("\x1b]2;{}...\x07", &collision[..29]));
        assert!(binding.resolve(&meta(FIRST)).is_err());
        assert!(binding.resolve(&meta(collision)).is_err());
    }

    #[test]
    fn ordinary_output_and_malformed_titles_do_not_bind() {
        let invalid = [
            FIRST.to_string(),
            format!("\x1b]1;{FIRST}\x07"),
            format!("\x1b]2;task | {FIRST}\x07"),
            format!("\x1b]2;{FIRST}extra\x07"),
            format!("\x1b]2;{FIRST}\n\x07"),
            format!("\x1b]2;{FIRST}\x18\x07"),
            format!("\x1b]2;{}...\x07", &FIRST[..28]),
            format!("\x1b]2;{}\x07", FIRST.replace('-', "g")),
            format!("\x1b]52;c;{FIRST}\x07"),
            format!("\x1b]2;{FIRST} | {}\x07", "x".repeat(OSC_LIMIT)),
        ];
        for sequence in invalid {
            let mut binding = Binding::default();
            binding.observe("one", &sequence);
            assert!(binding.resolve(&meta(FIRST)).is_err(), "{sequence:?}");
            assert!(binding.terminals["one"].parser.bytes.len() <= OSC_LIMIT);
            binding.observe("one", &title(FIRST));
            assert_eq!(binding.resolve(&meta(FIRST)).unwrap(), "one");
        }
    }

    #[test]
    fn missing_or_invalid_metadata_never_selects_a_terminal() {
        let mut binding = Binding::default();
        binding.observe("one", &title(FIRST));
        for meta in [
            Value::Null,
            json!({}),
            json!({"threadId": 3}),
            meta("not-a-uuid"),
        ] {
            assert!(binding.resolve(&meta).is_err());
        }
    }

    #[test]
    fn forgetting_a_terminal_also_discards_its_partial_title() {
        let mut binding = Binding::default();
        binding.observe("one", &format!("\x1b]2;{FIRST}"));
        binding.forget("one");
        binding.observe("one", "\x07");
        assert!(binding.resolve(&meta(FIRST)).is_err());
    }

    #[test]
    fn identity_limit_keeps_existing_routes_without_growing() {
        let mut binding = Binding::default();
        for index in 0..=THREAD_LIMIT {
            binding.observe(
                "one",
                &title(&format!("{index:08x}-e29b-41d4-a716-446655440000")),
            );
        }
        assert_eq!(binding.terminals["one"].threads.len(), THREAD_LIMIT);
        assert_eq!(
            binding
                .resolve(&meta("00000000-e29b-41d4-a716-446655440000"))
                .unwrap(),
            "one"
        );
        assert!(
            binding
                .resolve(&meta(&format!(
                    "{THREAD_LIMIT:08x}-e29b-41d4-a716-446655440000"
                )))
                .is_err()
        );
    }
}
