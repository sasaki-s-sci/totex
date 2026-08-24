import {
  Button,
  Dialog,
  Divider,
  MenuItem,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useServing } from "../hooks/useServing";
import {
  askStanding,
  type Half,
  pick,
  reload,
  restart,
  stageOf,
  take,
  type UpdateStage,
  useUpdate,
  wanted,
} from "../lib/update";
import type { ThemeMode } from "../theme";
import { UpdateMark } from "./marks";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * One line of the page: what the thing is on the left, what can be done about
 * it on the right.
 *
 * The rest of the window says everything with a mark, because everything else
 * in it stands in a row that is already being read — a folder, a branch, a
 * terminal — and a word beside the mark there would be a word in the way. This
 * page is the one place that is not true. It is gone looking for, it is read
 * once and left alone, and a mark that has to be hovered to find out what it
 * would do is a mark that is read twice. So here the thing is named, and the
 * mark is only kept where it says something a word cannot — see the ring on the
 * update button, which is how much of the download has arrived.
 *
 * The name and the line under it are the left half whether or not there is a
 * line: a row with nothing to explain is a row with nothing under its name, and
 * it still sits at the same height as the rest.
 */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  /** The half-sentence a name cannot carry. Left out where the name is enough. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minHeight: 34 }}
    >
      <Stack sx={{ gap: 0.25 }}>
        <Typography variant="body2">{label}</Typography>
        {hint && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {hint}
          </Typography>
        )}
      </Stack>
      {children}
    </Stack>
  );
}

/**
 * The one button this page has, in the one shape it takes.
 *
 * Quiet: the window is a tool and nothing in it shouts, so a button that offers
 * something reads as the same grey the names beside it are set in, and answers
 * the pointer rather than the room. Red is kept for the two endings — a restart
 * that takes every terminal with it, and a press that did not work — which is
 * the same thing red says everywhere else in the window.
 */
function PageButton({
  danger,
  disabled,
  icon,
  onClick,
  children,
}: {
  /** Red at rest: for the press that ends something, and the one that failed. */
  danger?: boolean;
  disabled?: boolean;
  /** The one mark the page draws, where a word cannot say what it says. */
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="small"
      variant="outlined"
      color={danger ? "error" : "inherit"}
      disabled={disabled}
      startIcon={icon}
      onClick={onClick}
      sx={{ flexShrink: 0, color: danger ? undefined : "text.secondary" }}
    >
      {children}
    </Button>
  );
}

/**
 * The three the window can be drawn in, in the order they are offered.
 *
 * The machine's own is first because it is where a window that has never been
 * told starts, and going back to it is how that is given back.
 */
const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];

/** What each of the three is called. */
const THEME_LABELS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const;

/**
 * Which of the three the window is drawn in.
 *
 * Three laid out rather than one pressed round them: this is a thing gone
 * looking for, and something looked for is answered by showing what there is to
 * pick, not by a button that has to be pressed twice to find out what the third
 * state was.
 */
function ThemeRow() {
  const { t } = useTranslation();
  const { mode, setMode } = useColorScheme();
  // Undefined for the frame before the provider has read what was stored. The
  // document already carries the answer by then — `applyStoredMode` wrote it —
  // so this is only which of the three is lit, and the machine's own is what a
  // window that has never been told is set to.
  const current = mode ?? "system";

  return (
    <Row label={t("settings.theme")}>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label={t("settings.theme")}
        value={current}
        onChange={(_, next: ThemeMode | null) => next && setMode(next)}
      >
        {THEMES.map((option) => (
          <ToggleButton key={option} value={option} sx={{ px: 1.25, py: 0.4 }}>
            {t(THEME_LABELS[option])}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Row>
  );
}

/** What each state of the setup button is. */
const REGISTER = {
  rest: "mcp.register",
  working: "mcp.registering",
  done: "mcp.registered",
  failed: "mcp.refused",
} as const;

/**
 * The door the agents say what they are working on through: the server this
 * window stands beside its terminals, and the one line of setup that tells an
 * agent where it is.
 *
 * Two rows, because they are two things. The switch stands a port open on this
 * machine, which is exactly the kind of thing a program should not do because
 * it happened to start — so it is off until it is asked for, and what was asked
 * for outlives the window. The button under it writes the setup into somebody
 * else's program, which is done once and never again: what is registered is the
 * name of a variable every terminal is handed a value in, rather than an
 * address that changes.
 *
 * Neither is urgent, which is why both are in here rather than out in the one
 * row the window reserves. What they turn on is drawn on the canvas: a card
 * beside a terminal, saying what the agent in it is working on.
 */
function McpSection() {
  const { t } = useTranslation();
  const { serving, toggle, installing, register } = useServing();

  return (
    <>
      <Divider />
      <Row label={t("settings.mcp")} hint={t("settings.mcpHint")}>
        {/* The name is drawn beside it rather than tied to it, so the box
            says what it is for itself to anything reading the page aloud. */}
        <Switch
          size="small"
          checked={serving}
          onChange={toggle}
          slotProps={{ input: { "aria-label": t("settings.mcp") } }}
        />
      </Row>
      <Row label={t("settings.register")} hint={t("settings.registerHint")}>
        <PageButton
          danger={installing === "failed"}
          disabled={installing === "working"}
          onClick={register}
        >
          {t(REGISTER[installing])}
        </PageButton>
      </Row>
    </>
  );
}

/**
 * What each state of a row is, which is also what a press of it does.
 *
 * Two maps rather than one, because the two halves cost different things and
 * end in different words. Each carries a word for the ending the other reaches
 * — a reload never finishes a program and a restart never finishes a page — so
 * that a row is a plain lookup rather than a lookup and a special case.
 */
const PAGES = {
  rest: "update.take",
  taking: "update.taking",
  current: "update.current",
  swapped: "update.reload",
  ready: "update.reload",
  held: "update.inProgram",
  failed: "update.failed",
} as const satisfies Record<UpdateStage, string>;

const PROGRAM = {
  rest: "update.take",
  // Named apart from the pages' word for the same state: this is eighty
  // megabytes and a ring that fills, and "downloading" is what that is.
  taking: "update.fetching",
  current: "update.current",
  swapped: "update.restart",
  ready: "update.restart",
  held: "update.held",
  failed: "update.failed",
} as const satisfies Record<UpdateStage, string>;

/**
 * The words one row draws itself with: one of the two maps above, kept as the
 * literal keys they are so that a name no locale carries does not compile.
 */
type Words = typeof PAGES | typeof PROGRAM;

/**
 * One half of a release, and the one press that brings it.
 *
 * The mark is kept here rather than replaced by a word, because it is the one
 * thing on the page saying what the words do not: a ring that turns while the
 * release page is being read, and fills as the download arrives.
 *
 * Red is kept for the two endings — a restart that takes every terminal with
 * it, and a press that did not work. A reload is neither: the program under the
 * window is the same program, and everything running in it goes on running.
 */
function HalfRow({
  half,
  label,
  hint,
  words,
  supported,
  stage,
  progress,
}: {
  half: Half;
  label: string;
  hint: string;
  words: Words;
  /** Whether this half can be replaced here at all — see `update.rs`. */
  supported: boolean;
  stage: UpdateStage;
  progress: number | null;
}) {
  const { t } = useTranslation();
  // A half this copy cannot have is drawn at its ending rather than left out:
  // being told the program belongs to a package manager is worth more than a
  // row that is not there.
  const at = supported ? stage : "held";

  return (
    <Row label={label} hint={hint}>
      <PageButton
        danger={at === "ready" || at === "failed"}
        disabled={at === "taking" || at === "held"}
        icon={<UpdateMark stage={at} progress={progress} />}
        onClick={() => {
          if (at === "ready") restart();
          else if (at === "swapped") reload();
          else void take(half);
        }}
      >
        {t(words[at])}
      </PageButton>
    </Row>
  );
}

/**
 * Replacing the app with another release of it, where that can work.
 *
 * Three rows: which release, and then each of the two halves that release comes
 * in. The pages the window is drawn out of are a download of about a megabyte
 * and a reload; the program under them is a large one and a restart that ends
 * every terminal in the window. They were always two mechanisms — see
 * `src-tauri/src/front` — and this is the two of them said out loud, because
 * the second cost is one nobody should pay by having pressed once.
 *
 * The release is named rather than implied. A window that can only ever be
 * carried forwards is a window somebody has to reinstall by hand the first time
 * a release turns out worse than the one before it, so the pull-down is every
 * release there is and the rows act on the one it is left on. Which releases
 * exist is asked for on a loop from the moment the window opens — see
 * `watchVersions` — so that the list is full when it is opened.
 *
 * Neither row is drawn where nothing could be replaced: a binary run out of
 * `target/` was never installed, so there is nothing a release page can do for
 * it. A `.deb` and an `.rpm` are drawn: the program in those belongs to a
 * package manager and is left to it, but the pages are the app's own and are
 * replaced the same way everywhere — which is the whole reason the two halves
 * are controlled apart.
 *
 * The rule above it belongs to it and not to the page: where there are no rows
 * there is nothing to divide.
 */
function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();
  const { standing, versions } = at;

  useEffect(() => {
    void askStanding();
  }, []);

  if (!standing || (!standing.front && !standing.whole)) return null;

  // Nothing has answered with a list of releases yet, or nothing can: the rows
  // still work, and what they mean is whatever the release page says is newest.
  const release = wanted(at) ?? "";
  const taking = at.front.stage === "taking" || at.whole.stage === "taking";

  return (
    <>
      <Divider />
      <Row label={t("settings.update")}>
        <Select
          size="small"
          value={release}
          disabled={versions.length === 0 || taking}
          onChange={(event) => pick(event.target.value)}
          aria-label={t("settings.update")}
          sx={{ minWidth: 132 }}
        >
          {versions.length === 0 ? (
            <MenuItem value="">{t("update.newest")}</MenuItem>
          ) : (
            versions.map((version) => (
              <MenuItem key={version} value={version}>
                {version}
              </MenuItem>
            ))
          )}
        </Select>
      </Row>
      <HalfRow
        half="front"
        label={t("update.pages")}
        hint={t("update.drawn", { version: standing.drawn })}
        words={PAGES}
        supported={standing.front}
        stage={stageOf(at, "front")}
        progress={at.front.progress}
      />
      <HalfRow
        half="whole"
        label={t("update.program")}
        hint={t("update.running", { version: standing.running })}
        words={PROGRAM}
        supported={standing.whole}
        stage={stageOf(at, "whole")}
        progress={at.whole.progress}
      />
    </>
  );
}

/**
 * Everything the window is set by, on one page.
 *
 * It reads top to bottom in the order the things belong to: the window in front
 * of you first, then the door the agents speak through, then the copy of the
 * app on disk. All of it is set once and left, which is why none of it is out
 * in the one row the window reserves along the top — that band is for what is
 * reached while working, and this is what is reached instead of working.
 */
export function SettingsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 380 } } }}>
      <Stack sx={{ p: 2, gap: 1 }}>
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {t("settings.title")}
        </Typography>
        <ThemeRow />
        <McpSection />
        <UpdateSection />
      </Stack>
    </Dialog>
  );
}
