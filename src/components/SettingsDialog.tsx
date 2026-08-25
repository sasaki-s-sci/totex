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
 * One line of the page: what the thing is on the left, what can be done about it
 * on the right.
 *
 * The rest of the window says everything with a mark, because everything there
 * stands in a row already being read. This page is gone looking for and read
 * once, so here the thing is named and a mark is kept only where it says
 * something a word cannot.
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

/** The one button this page has. Quiet, in the same grey the names beside it
 *  are set in; red is kept for the two endings — a restart that takes every
 *  terminal with it, and a press that did not work. */
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

/** The three the window can be drawn in. The machine's own is first: it is where
 *  a window that has never been told starts. */
const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];

/** What each of the three is called. */
const THEME_LABELS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const;

/** Which of the three the window is drawn in. Three laid out rather than one
 *  pressed round them: something looked for is answered by showing what there
 *  is to pick. */
function ThemeRow() {
  const { t } = useTranslation();
  const { mode, setMode } = useColorScheme();
  // Undefined for the frame before the provider has read what was stored; the
  // document already carries the answer, so this is only which of the three is lit.
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
 * The door the agents say what they are working on through: the server, and the
 * one line of setup that tells an agent where it is.
 *
 * Two rows because they are two things. The switch stands a port open, which a
 * program should not do because it happened to start, so it is off until it is
 * asked for. The button under it writes the setup into somebody else's program,
 * once: what is registered is the name of a variable, not an address.
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
 * Nothing is checked until it is pressed: a window that phones a release page
 * every time it opens is doing something on the person's network they did not
 * ask for. Not drawn at all where it could not work — a binary run out of
 * `target/` was never installed.
 *
 * A press does the cheapest thing left: the pages first, which end at a reload,
 * and the program on the press after that, which ends at a restart. The restart
 * is red because every terminal in the window goes with it.
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

/** Everything the window is set by, on one page: the window in front of you,
 *  then the door the agents speak through, then the copy of the app on disk.
 *  All of it set once and left, which is why none of it is in the top band. */
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
