import { Frame, HAIRLINE, SIZE, struck } from ".";

// Still marks: what a terminal is doing is said by which mark it wears and the number beside it,
// not by motion. See `CliGlyph`.
export function CliMark({ size }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M4.8 7.6 L10.4 12 L4.8 16.4" />
      <path d="M13.4 16.4 H20" />
    </Frame>
  );
}

export function AgentMark({ size }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="12" cy="5.6" r="2.6" />
      <circle cx="5.6" cy="17.4" r="2.6" />
      <circle cx="18.4" cy="17.4" r="2.6" />
      {/* Rim to rim: a stroke under a circle doubles the hairline into a blot. */}
      <path d="M10.76 7.89 L6.84 15.11 M13.24 7.89 L17.16 15.11 M8.2 17.4 H15.8" />
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
