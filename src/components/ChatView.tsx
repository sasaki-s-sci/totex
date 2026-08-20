import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import {
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AGENT_DATA_EVENT,
  AGENT_EXIT_EVENT,
  type AgentChunk,
  type AgentEnded,
  cancelAgent,
  plainText,
  runAgent,
} from "../lib/agentRun";
import type { Agent } from "../lib/agents";
import type { Session } from "../lib/session";

type Message = {
  key: number;
  role: "you" | "agent";
  text: string;
  state: "running" | "done" | "failed";
};

type Props = { session: Session; agent: Agent };

/**
 * A conversation with an agent, in the worktree of the branch it was opened on.
 *
 * The agent's CLI is not a conversation — it is a command — so one message here
 * is one whole run of it, and the agent's own session store is what carries the
 * thread between them. That is why the second message onwards asks it to
 * continue: the history lives with the agent, not in this panel.
 */
export function ChatView({ session, agent }: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(0);
  // Whether the agent already has a thread in this directory to carry on from.
  const started = useRef(false);
  // Whether what the session was opened for has been said.
  const opened = useRef(false);
  const foot = useRef<HTMLDivElement>(null);

  /** Rewrites the reply being streamed, which is always the last message. */
  const onReply = useCallback((change: (message: Message) => Message) => {
    setMessages((current) => {
      const last = current.at(-1);
      if (last?.role !== "agent") return current;
      return [...current.slice(0, -1), change(last)];
    });
  }, []);

  // A reply arrives in far more pieces than it has anything to say: rewriting
  // the thread for each one costs a render and a scroll apiece, for text that
  // is a few characters longer than it was a moment ago. What has come in is
  // held and applied once a frame, which is as often as any of it can be seen.
  const held = useRef("");
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const apply = () => {
      frame.current = null;
      const arrived = held.current;
      if (!arrived) return;
      held.current = "";
      // Stripped here rather than as each piece lands, because an escape
      // sequence split between two of them is not one either of them contains.
      onReply((message) => ({ ...message, text: message.text + plainText(arrived) }));
    };

    const data = listen<AgentChunk>(AGENT_DATA_EVENT, (event) => {
      if (event.payload.id !== session.id) return;
      held.current += event.payload.data;
      if (frame.current === null) frame.current = requestAnimationFrame(apply);
    });
    const done = listen<AgentEnded>(AGENT_EXIT_EVENT, (event) => {
      if (event.payload.id !== session.id) return;
      // Whatever is still held is the end of the reply being finished, so it
      // goes in before the reply is called done rather than a frame after.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      apply();
      const ok = event.payload.ok;
      // A run that said nothing leaves an empty bubble, and one that failed
      // leaves an empty bubble outlined in red. Both are the whole of what
      // happened, and neither is worth a sentence in the agent's own voice.
      onReply((message) => ({
        ...message,
        state: ok ? "done" : "failed",
        text: message.text.trim(),
      }));
      if (ok) started.current = true;
      setBusy(false);
    });

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      void data.then((stop) => stop());
      void done.then((stop) => stop());
    };
  }, [session.id, onReply]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new message is what scrolls
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // A session opened with something to do says it, once, as soon as it is up.
  // The panel is what knows how to send, so this is where that happens — and
  // from the agent's side it is an opening message like any other.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sending is the effect, and it is guarded to run once
  useEffect(() => {
    if (opened.current || !session.opening) return;
    opened.current = true;
    void send(session.opening);
  }, [session.opening]);

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { key: key.current++, role: "you", text: prompt, state: "done" },
      { key: key.current++, role: "agent", text: "", state: "running" },
    ]);

    try {
      await runAgent(session.id, session.cwd, agent.command, agent.turn(prompt, !started.current));
    } catch {
      onReply((message) => ({ ...message, state: "failed", text: "" }));
      setBusy(false);
    }
  }

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.5, py: 1.5 }}>
        <Stack spacing={1.25}>
          {messages.map((message) => (
            <Paper
              key={message.key}
              elevation={0}
              variant="outlined"
              sx={{
                alignSelf: message.role === "you" ? "flex-end" : "stretch",
                maxWidth: message.role === "you" ? "82%" : "100%",
                px: 1.25,
                py: 0.75,
                borderColor: message.state === "failed" ? "error.main" : "divider",
                bgcolor: message.role === "you" ? "action.hover" : "background.paper",
              }}
            >
              <Typography
                component="pre"
                variant="body2"
                color={message.state === "failed" ? "error" : "text.primary"}
                sx={{
                  m: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    message.role === "you"
                      ? undefined
                      : 'ui-monospace, "Cascadia Mono", Consolas, monospace',
                  fontSize: message.role === "you" ? undefined : 12,
                }}
              >
                {message.text}
              </Typography>
              {/* A reply that has not started arriving yet. The bubble is
                  already there, so what is missing is the only thing worth
                  drawing — and it stops of its own accord when the first
                  characters land. */}
              {message.state === "running" && !message.text && (
                <CircularProgress size={11} sx={{ color: "text.disabled", my: 0.25 }} />
              )}
            </Paper>
          ))}
        </Stack>
        <div ref={foot} />
      </Box>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "flex-end", p: 1, borderTop: 1, borderColor: "divider" }}
      >
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={8}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter sends; the newline is on the modifier, because a prompt is
            // usually one line and sending it is what happens next.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        {busy ? (
          <IconButton
            size="small"
            aria-label={t("chat.stop")}
            onClick={() => void cancelAgent(session.id)}
          >
            <StopIcon fontSize="small" />
          </IconButton>
        ) : (
          <IconButton
            size="small"
            color="primary"
            aria-label={t("chat.send")}
            disabled={!draft.trim()}
            onClick={() => void send(draft)}
          >
            <SendIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    </>
  );
}
