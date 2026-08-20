import type { AgentId } from "../lib/agents";

/**
 * The mark on an agent's button.
 *
 * Drawn here rather than shipped as artwork: they sit at eleven pixels on a
 * canvas of thousands of nodes, so what has to survive is the silhouette — the
 * burst, the knot, the prompt — and everything below that size is noise. They
 * take the button's own colour, which is the agent's.
 */
export function AgentIcon({ agent }: { agent: AgentId }) {
  switch (agent) {
    case "claude":
      return <ClaudeMark />;
    case "codex":
      return <CodexMark />;
    case "opencode":
      return <OpencodeMark />;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Rays out of a centre, long and short about turn. */
function ClaudeMark() {
  return (
    <Frame>
      <path
        strokeWidth="2.4"
        d="M14.6 12 L22 12 M14.25 13.3 L18.24 15.6 M13.3 14.25 L17 20.66
           M12 14.6 L12 19.2 M10.7 14.25 L7 20.66 M9.75 13.3 L5.76 15.6
           M9.4 12 L2 12 M9.75 10.7 L5.76 8.4 M10.7 9.75 L7 3.34
           M12 9.4 L12 4.8 M13.3 9.75 L17 3.34 M14.25 10.7 L18.24 8.4"
      />
    </Frame>
  );
}

/**
 * A six-lobed knot: three loops through one another, sixty degrees apart.
 *
 * Loops rather than a hexagon with its diagonals drawn in — that reads as a
 * cube at this size, which is a different logo altogether.
 */
function CodexMark() {
  return (
    <Frame>
      <ellipse cx="12" cy="12" rx="4.3" ry="9.6" strokeWidth="1.9" />
      <ellipse cx="12" cy="12" rx="4.3" ry="9.6" strokeWidth="1.9" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="4.3" ry="9.6" strokeWidth="1.9" transform="rotate(120 12 12)" />
    </Frame>
  );
}

/** A square o, the way the name is set. */
function OpencodeMark() {
  return (
    <Frame>
      <rect x="3.7" y="3.7" width="16.6" height="16.6" rx="5" strokeWidth="3.4" />
    </Frame>
  );
}
