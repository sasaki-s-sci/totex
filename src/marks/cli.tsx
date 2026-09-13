import type { Doing } from "../lib/doing";
import { Frame } from ".";
import { AgentMark, CliMark } from "./row";

/** One size on the canvas and in the sidebar band: the same run of terminals read in two places. */
export const CLI_GLYPH = 11;

// Baseline placed by hand: engines disagree on dominant-baseline. CAP is the
// figure height of system-ui as a share of the font size.
const NUMBER = 19.5;
const CAP = 0.7;
const BASELINE = 12 + (NUMBER * CAP) / 2;

type Props = {
  doing: Doing | null;
  jump?: number | null;
  size?: number;
};

export function CliGlyph({ doing, jump = null, size = CLI_GLYPH }: Props) {
  if (jump !== null) {
    return (
      <Frame size={size} spill>
        <text
          x="12"
          y={BASELINE}
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize={NUMBER}
          fontWeight={600}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {jump}
        </text>
      </Frame>
    );
  }

  if (doing === "agent" || doing === "working") {
    return <AgentMark size={size} working={doing === "working"} />;
  }

  return <CliMark size={size} working={doing === "running"} />;
}
