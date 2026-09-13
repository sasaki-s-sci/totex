import { Box, CircularProgress, Dialog, InputBase, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "../lib/session";
import { directoryTasks, matching, type Param, runLine, type Task } from "../lib/tasks";

type Props = {
  session: Session | null;
  onClose: () => void;
  onRun: (session: Session, line: string) => void;
};

export function TaskMenu({ session, onClose, onRun }: Props) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState(0);
  const [filling, setFilling] = useState<Task | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Kept for the fade-out after the session is gone.
  const asked = useRef<Session | null>(null);
  if (session) asked.current = session;
  const shown = session ?? asked.current;

  useEffect(() => {
    if (!session) return;
    setTasks(null);
    setTyped("");
    setAt(0);
    setFilling(null);

    let alive = true;
    directoryTasks(session.cwd)
      .then((found) => alive && setTasks(found))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [session]);

  const rows = useMemo(() => matching(tasks ?? [], typed), [tasks, typed]);
  const barren = tasks !== null && tasks.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: typing is the trigger
  useEffect(() => setAt(0), [typed]);

  useEffect(() => {
    list.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!shown) return null;

  const step = (by: number) => {
    if (rows.length === 0) return;
    setAt((current) => (current + by + rows.length) % rows.length);
  };

  const take = (task: Task) => {
    if (task.params.length > 0) setFilling(task);
    else onRun(shown, task.line);
  };

  return (
    <Dialog
      open={session !== null}
      onClose={(_, why) => {
        if (why === "escapeKeyDown" && filling) setFilling(null);
        else onClose();
      }}
      sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }}
      slotProps={{ paper: { sx: { width: 560, maxWidth: "92vw", mt: "12vh" } } }}
    >
      {filling ? (
        <Filling task={filling} onRun={(line) => onRun(shown, line)} />
      ) : (
        <Stack
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              step(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              step(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const task = rows[at];
              if (task) take(task);
            }
          }}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 1.5, py: 1 }}>
            <InputBase
              autoFocus
              fullWidth
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t("tasks.find")}
              sx={{ fontSize: 14 }}
            />
            {shown.branch && (
              <Typography variant="caption" sx={{ color: "text.disabled", whiteSpace: "nowrap" }}>
                {shown.branch}
              </Typography>
            )}
          </Stack>
          {(tasks === null || barren || rows.length > 0) && (
            <Box
              ref={list}
              sx={{
                maxHeight: "50vh",
                overflowY: "auto",
                py: 0.5,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              {tasks === null && (
                <Stack sx={{ alignItems: "center", py: 2 }}>
                  <CircularProgress size={16} color="inherit" sx={{ color: "text.disabled" }} />
                </Stack>
              )}

              {barren && (
                <Typography variant="body2" sx={{ color: "text.disabled", px: 1.5, py: 1 }}>
                  {t("tasks.empty")}
                </Typography>
              )}

              {rows.map((task, index) => (
                <Row
                  key={`${task.runner} ${task.name}`}
                  task={task}
                  at={index}
                  picked={index === at}
                  onPoint={() => setAt(index)}
                  onTake={() => take(task)}
                />
              ))}
            </Box>
          )}
        </Stack>
      )}
    </Dialog>
  );
}

function Row({
  task,
  at,
  picked,
  onPoint,
  onTake,
}: {
  task: Task;
  at: number;
  picked: boolean;
  onPoint: () => void;
  onTake: () => void;
}) {
  return (
    <Stack
      component="button"
      type="button"
      direction="row"
      data-at={at}
      onMouseMove={onPoint}
      onClick={onTake}
      tabIndex={-1}
      sx={{
        width: "100%",
        alignItems: "baseline",
        gap: 1.25,
        px: 1.5,
        py: 0.5,
        border: "none",
        background: "none",
        bgcolor: picked ? "action.selected" : "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Typography
        variant="caption"
        sx={{ width: 34, flexShrink: 0, fontFamily: "monospace", color: "text.disabled" }}
      >
        {task.runner}
      </Typography>
      <Typography variant="body2" sx={{ flexShrink: 0, color: "text.primary" }}>
        {task.name}
      </Typography>
      {task.params.length > 0 && (
        <Typography
          variant="body2"
          sx={{ flexShrink: 0, fontFamily: "monospace", fontSize: 12, color: "text.disabled" }}
        >
          {task.params.map(spelled).join(" ")}
        </Typography>
      )}
      <Typography
        variant="body2"
        sx={{
          minWidth: 0,
          color: "text.disabled",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.about}
      </Typography>
    </Stack>
  );
}

function Filling({ task, onRun }: { task: Task; onRun: (line: string) => void }) {
  const [values, setValues] = useState<string[]>(() => task.params.map(() => ""));
  const [refused, setRefused] = useState(false);
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const line = runLine(task, values);

  const run = () => {
    const missing = task.params.findIndex(
      (param, index) => param.required && !values[index]?.trim(),
    );
    if (missing >= 0) {
      setRefused(true);
      fields.current[missing]?.focus();
      return;
    }
    onRun(line);
  };

  return (
    <Stack
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          run();
        }
      }}
    >
      <Stack direction="row" sx={{ alignItems: "baseline", gap: 1.25, px: 1.5, py: 1 }}>
        <Typography
          variant="caption"
          sx={{ width: 34, flexShrink: 0, fontFamily: "monospace", color: "text.disabled" }}
        >
          {task.runner}
        </Typography>
        <Typography variant="body2">{task.name}</Typography>
        <Typography
          variant="body2"
          sx={{
            minWidth: 0,
            color: "text.disabled",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.about}
        </Typography>
      </Stack>
      <Stack sx={{ gap: 1, px: 1.5, py: 1.5, borderTop: 1, borderColor: "divider" }}>
        {task.params.map((param, index) => (
          <Field
            key={param.name}
            param={param}
            value={values[index] ?? ""}
            first={index === 0}
            wanting={refused && param.required && !values[index]?.trim()}
            hold={(element) => {
              fields.current[index] = element;
            }}
            onChange={(next) =>
              setValues((current) => current.map((was, at) => (at === index ? next : was)))
            }
          />
        ))}
      </Stack>
      <Typography
        variant="caption"
        sx={{
          px: 1.5,
          py: 1,
          fontFamily: "monospace",
          color: "text.disabled",
          borderTop: 1,
          borderColor: "divider",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {line}
      </Typography>
    </Stack>
  );
}

function Field({
  param,
  value,
  first,
  wanting,
  hold,
  onChange,
}: {
  param: Param;
  value: string;
  first: boolean;
  wanting: boolean;
  hold: (element: HTMLInputElement | null) => void;
  onChange: (next: string) => void;
}) {
  return (
    <Stack direction="row" sx={{ alignItems: "baseline", gap: 1.25 }}>
      <Typography
        variant="body2"
        sx={{
          width: 120,
          flexShrink: 0,
          fontFamily: "monospace",
          fontSize: 12,
          textAlign: "right",
          color: wanting ? "error.main" : param.required ? "text.secondary" : "text.disabled",
        }}
      >
        {spelled(param)}
      </Typography>
      <InputBase
        autoFocus={first}
        inputRef={hold}
        fullWidth
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={param.default ?? param.about}
        sx={{
          fontSize: 13,
          fontFamily: "monospace",
          px: 0.75,
          borderRadius: 0.5,
          bgcolor: "action.hover",
        }}
      />
    </Stack>
  );
}

function spelled(param: Param): string {
  if (param.variadic) return `${param.required ? "+" : "*"}${param.name}`;
  return param.default === null ? param.name : `${param.name}=${param.default}`;
}
