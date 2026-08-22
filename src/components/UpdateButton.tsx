import { Box, Divider } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { askSupported, restart, takeUpdate, useUpdate } from "../lib/update";
import { MarkButton, UpdateMark } from "./marks";

/** What each state of the mark is, for something reading the window aloud. */
const LABELS = {
  unknown: "update.check",
  checking: "update.checking",
  current: "update.current",
  fetching: "update.fetching",
  ready: "update.restart",
  failed: "update.failed",
} as const;

/**
 * One mark for the whole of replacing the app, in the settings dialog.
 *
 * Nothing is checked until it is pressed. A window that phones a release page
 * on its own every time it opens is a window doing something on the person's
 * network that they did not ask for, and the answer it would come back with —
 * there is a newer one — is not urgent enough to be worth that. So the mark
 * rests at the offer to look, and what it draws after that is what happened.
 *
 * It is not drawn at all where it could not work: a `.deb`, an `.rpm` and a
 * binary run out of `target/` are all copies the updater cannot replace, and a
 * button that can only ever fail is a button that should not be there.
 *
 * The restart is red under the pointer, the way ending a session is. It is the
 * same thing at a larger size — every terminal in the window is a process that
 * goes with it — and this is the window's one way of saying so.
 *
 * The rule above it belongs to it and not to the dialog, for the same reason:
 * where there is no mark there is nothing to divide, and a line with nothing
 * under it is a row the dialog has lost.
 */
export function UpdateButton() {
  const { t } = useTranslation();
  const { supported, stage, progress } = useUpdate();

  useEffect(askSupported, []);

  if (!supported) return null;

  return (
    <>
      <Divider flexItem />
      <MarkButton
        label={t(LABELS[stage])}
        danger={stage === "ready"}
        onClick={() => (stage === "ready" ? restart() : void takeUpdate())}
      >
        {/* Failure is the one state the mark holds a colour of its own in,
            rather than waiting for the pointer to ask: it is over, and it is
            the answer to something that was pressed. */}
        <Box sx={{ display: "flex", color: stage === "failed" ? "error.main" : undefined }}>
          <UpdateMark stage={stage} progress={progress} />
        </Box>
      </MarkButton>
    </>
  );
}
