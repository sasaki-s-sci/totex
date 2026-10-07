//! Structured replies from official agent interfaces; terminal text is never parsed here.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub key: String,
    pub agent: String,
    pub session_id: String,
    pub turn_id: String,
    pub status: ReplyStatus,
    pub text: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplyStatus {
    InProgress,
    Completed,
    Failed,
    Interrupted,
}

impl Reply {
    pub fn new(agent: &str, session: &str, turn: &str, status: ReplyStatus, text: &str) -> Self {
        // Bound the retained body, at a UTF-8 boundary, and disclose any truncation.
        let mut end = text.len().min(128 * 1024);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        (agent, session, turn, status, text).hash(&mut hash);
        Self {
            key: format!("{:016x}", hash.finish()),
            agent: agent.into(),
            session_id: session.into(),
            turn_id: turn.into(),
            status,
            text: text[..end].into(),
            truncated: end < text.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_unicode_body_is_bounded_without_breaking_utf8_and_discloses_truncation() {
        let body = "本文".repeat(30000);
        let reply = Reply::new("codex", "s", "t", ReplyStatus::Completed, &body);
        assert!(reply.truncated);
        assert!(reply.text.len() <= 128 * 1024);
        assert!(body.starts_with(&reply.text));
    }
}
