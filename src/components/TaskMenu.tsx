import { Box, CircularProgress, Dialog, InputBase, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "../lib/session";
import { directoryTasks, matching, type Param, runLine, type Task } from "../lib/tasks";

type Props = {
  /** The workspace being asked, or null while the list is not open. */
  session: Session | null;
  onClose: () => void;
  /** Runs one line, which is a terminal of its own with the line typed in. */
  onRun: (session: Session, line: string) => void;
};

/**
 * What this repository says can be run in it, over the window.
 *
 * A list of lines rather than of buttons: every row here is a command somebody
 * would have typed into the terminal that is already open in that directory,
 * and pressing one types it into a terminal beside it. Nothing is wrapped, and
 * nothing is run any differently than it runs in a shell — which is the whole
 * argument for reading the runners' own files instead of keeping a list of our
 * own somewhere in the app.
 *
 * The mark down the left is which runner said so. It is there because two
 * runners in one repository is ordinary — this one has a Taskfile and a mise
 * config — and `check` under one of them is not `check` under the other.
 *
 * Typing filters and does nothing else: the field is where the focus lands, so
 * a list of forty is narrowed the way a name is remembered, and the arrows and
 * Return are the whole of the rest of it.
 *
 * A task that takes something is a second step rather than a line that runs and
 * fails. What it takes is drawn beside its name, so the step is not a surprise
 * the press springs — see `Filling`.
 */
export function TaskMenu({ session, onClose, onRun }: Props) {
  const { t } = useTranslation();
  /** Null while the directory has not answered yet, which is what draws the
   *  turning mark: an empty list is an answer, and looks like one. */
  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [typed, setTyped] = useState("");
  /** Which row Return would run, counted through what is drawn. */
  const [at, setAt] = useState(0);
  /** The task being given what it takes, or null while the list is the list. */
  const [filling, setFilling] = useState<Task | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // The list fades on its way out, so it has to keep what it was showing for as
  // long as that takes: the workspace it was opened for is already gone.
  const asked = useRef<Session | null>(null);
  if (session) asked.current = session;
  const shown = session ?? asked.current;

  // Asked once per opening, and asked afresh every time: a runner's file is
  // edited between one opening and the next, and a list that was cached would
  // be the one from before the task was added.
  useEffect(() => {
    if (!session) return;
    setTasks(null);
    setTyped("");
    setAt(0);
    setFilling(null);

    let alive = true;
    directoryTasks(session.cwd)
      .then((found) => alive && setTasks(found))
      // Nothing to run is what a directory that could not be asked comes to,
      // and it is what the empty list already says.
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [session]);

  const rows = useMemo(() => matching(tasks ?? [], typed), [tasks, typed]);
  // A directory that holds no runner at all, which is the one emptiness worth
  // words: a list narrowed to nothing by what was typed says so already, in
  // the field it was typed into.
  const barren = tasks !== null && tasks.length === 0;
  // Narrowing the list moves the row Return would run out from under it, so the
  // pick goes back to the top — which is where the narrowing was aiming.
  // biome-ignore lint/correctness/useExhaustiveDependencies: typing is the trigger
  useEffect(() => setAt(0), [typed]);

  // The pick can be walked past the bottom of what the box shows, and a pick
  // that cannot be seen is a Return nobody knows the answer to.
  useEffect(() => {
    list.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!shown) return null;

  const step = (by: number) => {
    if (rows.length === 0) return;
    setAt((current) => (current + by + rows.length) % rows.length);
  };

  /** What a row comes to: the line, or the step that fills the line in. */
  const take = (task: Task) => {
    if (task.params.length > 0) setFilling(task);
    else onRun(shown, task.line);
  };

  return (
    <Dialog
      open={session !== null}
      onClose={(_, why) => {
        // Out of the second step and back to the list, rather than out of the
        // box altogether: the row was reached by typing, and having to type it
        // again to change one's mind about an argument is a box that punishes
        // going in.
        if (why === "escapeKeyDown" && filling) setFilling(null);
        else onClose();
      }}
      // Up where a list that grows downwards has room to grow, rather than in
      // the middle where every row added moves every row already read.
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
            {/* Which workspace this is a list for. The box stands over the whole
                window, and the terminal that says so is behind it. */}
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

/** One line that can be run, and which of the four runners says so. */
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
      // The pick follows the pointer rather than being drawn twice: a row under
      // the cursor and a row Return would run are one row.
      onMouseMove={onPoint}
      onClick={onTake}
      // The focus stays in the field, so the row is never tabbed to and the
      // press is the pointer's alone -- see the parent for the keys.
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
      {/* What it takes, in the runner's own spelling. Drawn here so that the
          row that opens a second step is a row that said it would. */}
      {task.params.length > 0 && (
        <Typography
          variant="body2"
          sx={{ flexShrink: 0, fontFamily: "monospace", fontSize: 12, color: "text.disabled" }}
        >
          {task.params.map(spelled).join(" ")}
        </Typography>
      )}
      {/* What the file says it is for, where it says anything. Cut rather than
          wrapped: a row that is two lines high in a list of forty is a list
          nobody reads to the end of. */}
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

/**
 * Giving a task what it takes, before it is run.
 *
 * One field per thing it takes, in the order they are passed, and the line
 * being built under them. The line is there because it is what actually
 * happens: this box is a way of typing a command, not a form that submits
 * something, and seeing it come together is the whole difference between the
 * two.
 *
 * Nothing is filled in for the ones that stand at something already. Their
 * default is drawn where the typing would go, so leaving a field alone and
 * leaving it off the line are the same gesture — which is what the runner
 * itself does with an argument nobody passed.
 *
 * The way back to the list is Escape, which is answered by the box around this
 * -- there is nothing here to draw a press on, and the row this came from is
 * one keystroke away.
 */
function Filling({ task, onRun }: { task: Task; onRun: (line: string) => void }) {
  const [values, setValues] = useState<string[]>(() => task.params.map(() => ""));
  /** Whether a press has been turned down for want of something, which is what
   *  reddens the names of the fields still wanting it. Not drawn before the
   *  press: a box that is red before anything has been done to it is a box
   *  complaining about not having been filled in yet. */
  const [refused, setRefused] = useState(false);
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const line = runLine(task, values);

  const run = () => {
    // A required one left empty is not a refusal to say so — it is the field
    // the focus should have been in, so that is where the press puts it.
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
        {/* What it is for, where its file says: the row it was picked out of is
            behind this now, and the words on it were the reason it was. */}
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

      {/* What is about to be typed into a terminal, as it will be typed. */}
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

/** One thing a task takes, and where it is typed. */
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
  /** Whether the focus lands here when the step opens. */
  first: boolean;
  /** Whether a press has already been turned down for want of this one. */
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
          // Faded where the task can be run without it, and red where a press
          // has already been turned down for want of it: between them that is
          // the whole of what a field here has to say about itself.
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
        // What it stands at, drawn where the typing goes: a field left alone is
        // an argument left off, and the line under the fields shows what that
        // comes to.
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

/** A parameter as its runner writes it: the sigil says how much it takes. */
function spelled(param: Param): string {
  if (param.variadic) return `${param.required ? "+" : "*"}${param.name}`;
  return param.default === null ? param.name : `${param.name}=${param.default}`;
}
