import {
  Button,
  Dialog,
  Divider,
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
import { askSupported, reload, restart, takeUpdate, useUpdate } from "../lib/update";
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

/** What each state of the update button is, which is also what a press does. */
const UPDATE = {
  unknown: "update.check",
  checking: "update.checking",
  current: "update.current",
  fetching: "update.fetching",
  swapped: "update.reload",
  ready: "update.restart",
  held: "update.held",
  failed: "update.failed",
} as const;

/**
 * Replacing the app with a newer one, where that can work.
 *
 * Nothing is checked until it is pressed. A window that phones a release page
 * on its own every time it opens is a window doing something on the person's
 * network that they did not ask for, and the answer it would come back with is
 * not urgent enough to be worth that. So the button rests at the offer to look,
 * and what it says after that is what happened.
 *
 * It is not drawn at all where it could not work: a binary run out of `target/`
 * was never installed, so there is nothing a release page can do for it. A
 * `.deb` and an `.rpm` are drawn: the program in those belongs to a package
 * manager and is left to it, but the pages are the app's own and are replaced
 * the same way everywhere.
 *
 * A press does the cheapest thing left — the pages first, which end at a
 * reload; the program on the press after that, which ends at a restart. Two
 * presses rather than one because they cost different things, and the second
 * cost is one nobody should pay by having pressed once. The restart is red for
 * the same reason ending a session is: every terminal in the window is a
 * process that goes with it.
 *
 * The rule above it belongs to it and not to the page: where there is no
 * button there is nothing to divide.
 */
function UpdateSection() {
  const { t } = useTranslation();
  const { supported, stage, progress } = useUpdate();

  useEffect(askSupported, []);

  if (!supported) return null;

  return (
    <>
      <Divider />
      <Row label={t("settings.update")}>
        <PageButton
          danger={stage === "ready" || stage === "failed"}
          disabled={stage === "checking" || stage === "fetching" || stage === "held"}
          // The mark is kept here alone, because it is the one thing on the
          // page saying what the words do not: a ring that turns while the
          // release page is being read, and fills as the download arrives.
          icon={<UpdateMark stage={stage} progress={progress} />}
          onClick={() => {
            if (stage === "ready") restart();
            else if (stage === "swapped") reload();
            else void takeUpdate();
          }}
        >
          {t(UPDATE[stage])}
        </PageButton>
      </Row>
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
