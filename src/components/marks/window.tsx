/**
 * The mark that says an update is on its way, and the window's own controls.
 */

import { Box } from "@mui/material";

import type { UpdateStage } from "../../lib/update";
import { Frame } from "../marks";

/**
 * The radius the two ring marks are struck at, and the way round it.
 *
 * A circle's dash offset is counted in the length of its own outline, so the
 * circumference has to be a number here rather than a shape — it is what says
 * how much of the ring a part-finished download has filled.
 */
const RING = 7.5;
const AROUND = 2 * Math.PI * RING;

/** The turn the two waiting rings are spun at. */
const SPIN = {
  transformOrigin: "12px 12px",
  animation: "totex-mark-spin 900ms linear infinite",
  "@keyframes totex-mark-spin": { to: { transform: "rotate(360deg)" } },
  // A window that has asked for less movement gets a ring standing still,
  // which still says the same thing: three quarters of a circle is not a
  // circle, and what is missing from it is what is being waited for.
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

/**
 * Where one half of the app is in being replaced, as one mark on one button.
 *
 * Six drawings, one press between them, the way `MaximiseMark` is one button
 * for both of its moves: an arrow down for the offer to take a release, a ring
 * while it is being taken, the same ring filling instead of turning once the
 * download has said how long it is, a tick for nothing to do, two arrows round
 * a circle for the reload that finishes the pages, and one arrow round a circle
 * for the restart that finishes the program. A failure is the arrow again, in
 * red — see the update rows of `SettingsDialog`, which is what colours it: what
 * went wrong is not a thing this window has a word for, and pressing again is
 * the whole of what can be done about it.
 *
 * The last is the arrow struck through: a release this half cannot take. The
 * two circles are told apart by how many arrows are in them, which is also how
 * much of the app each of them replaces.
 *
 * The arrow is the download and not a version number, because the version is
 * said in the pull-down above the row: the mark is what the press is doing
 * about it.
 */
export function UpdateMark({ stage, progress }: { stage: UpdateStage; progress: number | null }) {
  if (stage === "taking" && progress === null) {
    return (
      <Frame>
        {/* Three quarters of a ring: a whole one turning is a whole one. */}
        <Box component="g" sx={SPIN}>
          <path d="M12 4.5 A7.5 7.5 0 1 1 4.5 12" />
        </Box>
      </Frame>
    );
  }

  if (stage === "taking") {
    return (
      <Frame>
        {/* The ring it is filling, faint, so that how far along it is can be
            read against how far there is to go. */}
        <circle cx="12" cy="12" r={RING} opacity={0.3} />
        <circle
          cx="12"
          cy="12"
          r={RING}
          strokeDasharray={AROUND}
          strokeDashoffset={AROUND * (1 - (progress ?? 0))}
          // Dashes start where the outline does, which is the right-hand side.
          // Turned a quarter back so that a ring fills from the top.
          transform="rotate(-90 12 12)"
        />
      </Frame>
    );
  }

  if (stage === "current") {
    return (
      <Frame>
        <path d="M5.5 12.5 L10 17 L18.5 7" />
      </Frame>
    );
  }

  if (stage === "swapped") {
    return (
      <Frame>
        {/* Two halves of a ring chasing each other, both stopped and both with
            a head: the page going round again, which is all a reload is. */}
        <path d="M4.5 12 A7.5 7.5 0 0 1 16.6 6.1" />
        <path d="M13.9 4.1 L17 6.2 L14.9 9.3" />
        <path d="M19.5 12 A7.5 7.5 0 0 1 7.4 17.9" />
        <path d="M10.1 19.9 L7 17.8 L9.1 14.7" />
      </Frame>
    );
  }

  if (stage === "ready") {
    return (
      <Frame>
        {/* Three quarters of a ring again, but stopped and with a head on it:
            the waiting is over and the last of it is a press away. */}
        <path d="M19.5 12 A7.5 7.5 0 1 1 12 4.5" />
        <path d="M9.8 2.3 L12 4.5 L9.8 6.7" />
      </Frame>
    );
  }

  if (stage === "held") {
    return (
      <Frame>
        {/* The arrow that would have taken it, struck through: there is one,
            and it is not this copy's to have. */}
        <path d="M12 4 V14.6" />
        <path d="M7.6 10.2 L12 14.6 L16.4 10.2" />
        <path d="M5 19 H19" />
        <path d="M4.4 20.4 L19.6 5.2" />
      </Frame>
    );
  }

  return (
    <Frame>
      <path d="M12 4 V14.6" />
      <path d="M7.6 10.2 L12 14.6 L16.4 10.2" />
      {/* The line it lands on: an arrow with nothing under it is a direction,
          and this one is a thing arriving somewhere. */}
      <path d="M5 19 H19" />
    </Frame>
  );
}
/** A line: the window down to the taskbar. */
export function MinimiseMark() {
  return (
    <Frame>
      <path d="M5 12 H19" />
    </Frame>
  );
}

/** The window filling the screen, or coming back off it. */
export function MaximiseMark({ on }: { on: boolean }) {
  return (
    <Frame>
      {on ? (
        <>
          <path d="M8.5 8.5 V6.5 H17.5 V15.5 H15.5" />
          <rect x="5.5" y="11.5" width="10" height="7" rx="1" />
        </>
      ) : (
        <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
      )}
    </Frame>
  );
}
