import { Box } from "@mui/material";

import type { UpdateStage } from "../lib/update";
import { Frame } from ".";

// Circumference as a number: the dash offset is what fills the ring by progress.
const RING = 7.5;
const AROUND = 2 * Math.PI * RING;

const SPIN = {
  transformOrigin: "12px 12px",
  animation: "totex-mark-spin 900ms linear infinite",
  "@keyframes totex-mark-spin": { to: { transform: "rotate(360deg)" } },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

export function UpdateMark({ stage, progress }: { stage: UpdateStage; progress: number | null }) {
  if (stage === "taking" && progress === null) {
    return (
      <Frame>
        <Box component="g" sx={SPIN}>
          <path d="M12 4.5 A7.5 7.5 0 1 1 4.5 12" />
        </Box>
      </Frame>
    );
  }

  if (stage === "taking") {
    return (
      <Frame>
        <circle cx="12" cy="12" r={RING} opacity={0.3} />
        <circle
          cx="12"
          cy="12"
          r={RING}
          strokeDasharray={AROUND}
          strokeDashoffset={AROUND * (1 - (progress ?? 0))}
          // Dashes start at the right; turned back a quarter so the ring fills from the top.
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
        <path d="M19.5 12 A7.5 7.5 0 1 1 12 4.5" />
        <path d="M9.8 2.3 L12 4.5 L9.8 6.7" />
      </Frame>
    );
  }

  if (stage === "held") {
    return (
      <Frame>
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
      <path d="M5 19 H19" />
    </Frame>
  );
}
export function MinimiseMark() {
  return (
    <Frame>
      <path d="M5 12 H19" />
    </Frame>
  );
}

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
