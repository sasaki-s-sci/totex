import { Box } from "@mui/material";

import { Frame, HAIRLINE, SIZE, struck } from ".";

const CARET = "M13.4 16.4 H20";

// Two half turns with a pause, not a spin. Transform only, so the compositor runs it
// without a redraw; on the drawing because the canvas and the sidebar band share no stylesheet.
const TURN = {
  // view-box: a horizontal line has no height to centre on.
  transformBox: "view-box",
  transformOrigin: "16.7px 16.4px",
  animation: "totex-cli-caret 5.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
  "@keyframes totex-cli-caret": {
    "0%": { transform: "rotate(0deg)" },
    "6.7%, 50%": { transform: "rotate(180deg)" },
    "56.7%, 100%": { transform: "rotate(360deg)" },
  },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

// A third of a turn loops seamlessly: the three points are near-evenly spaced. Runs only while working.
const SPIN = {
  // The points' own centre, a little below the square's; about the square the mark would orbit.
  transformBox: "view-box",
  transformOrigin: "12px 13.47px",
  animation: "totex-agent-turn 2.7s linear infinite",
  "@keyframes totex-agent-turn": { to: { transform: "rotate(120deg)" } },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

export function CliMark({ size, working }: { size?: number; working?: boolean }) {
  return (
    <Frame size={size}>
      <path d="M4.8 7.6 L10.4 12 L4.8 16.4" />
      {working ? <Box component="path" sx={TURN} d={CARET} /> : <path d={CARET} />}
    </Frame>
  );
}

export function AgentMark({ size, working }: { size?: number; working?: boolean }) {
  return (
    <Frame size={size}>
      <Box component="g" sx={working ? SPIN : undefined}>
        <circle cx="12" cy="5.6" r="2.6" />
        <circle cx="5.6" cy="17.4" r="2.6" />
        <circle cx="18.4" cy="17.4" r="2.6" />
        {/* Rim to rim: a stroke under a circle doubles the hairline into a blot. */}
        <path d="M10.76 7.89 L6.84 15.11 M13.24 7.89 L17.16 15.11 M8.2 17.4 H15.8" />
      </Box>
    </Frame>
  );
}

/** A run of commits, for how many of them a band shows. */
export function LengthMark() {
  return (
    <Frame>
      <path d="M3.5 12 H5.2 M9.2 12 H10 M14 12 H14.8 M18.8 12 H20.5" />
      <circle cx="7.2" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="16.8" cy="12" r="2" />
    </Frame>
  );
}

export function CloseMark() {
  return (
    <Frame>
      <path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" />
    </Frame>
  );
}

export function AddMark() {
  return (
    <Frame>
      <path d="M12 5 V19 M5 12 H19" />
    </Frame>
  );
}

export function JumpMark() {
  return (
    <Frame>
      <path d="M6.5 6.5 L17 17 M17 10.5 V17 H10.5" />
    </Frame>
  );
}

export function UpMark() {
  return (
    <Frame>
      <path d="M17.5 17.5 L7 7 M7 13.5 V7 H13.5" />
    </Frame>
  );
}

// Teeth heavier and butt-capped: at 15px a hairline tooth reads as a ray.
export function SettingsMark() {
  return (
    <Frame>
      <circle cx="12" cy="12" r="6.4" />
      <circle cx="12" cy="12" r="2.4" />
      <g strokeWidth={struck(SIZE, HAIRLINE * 1.6)} strokeLinecap="butt">
        <path d="M12 5.6 V2.8 M12 18.4 V21.2 M5.6 12 H2.8 M18.4 12 H21.2" />
        <path d="M7.47 7.47 L5.51 5.51 M16.53 16.53 L18.49 18.49 M16.53 7.47 L18.49 5.51 M7.47 16.53 L5.51 18.49" />
      </g>
    </Frame>
  );
}
