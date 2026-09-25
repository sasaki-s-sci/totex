import type { Doing } from "../lib/doing";
import { AgentMark, CliMark } from "./row";

/** One size on the canvas and in the sidebar band: the same run of terminals read in two places. */
export const CLI_GLYPH = 11;

/** Room a number takes beside the mark: one digit at the number's size, and the gap before it. */
export const CLI_NUMBER = 7;

const GAP = 1;

// The figure is drawn a little under the mark's height so its cap lines up with the mark's square.
const NUMBER = 0.85;

type Props = {
  doing: Doing | null;
  /** The number a key would reach this terminal by, drawn after the mark; none for a terminal off the graph. */
  jump?: number | null;
  size?: number;
};

/**
 * A terminal as a mark and a number: the mark says what is up in it — a shell, or one of
 * the coding agents — and the number says which terminal it is. Nothing moves: whether
 * the session is working is not drawn here, only what kind of session it is.
 */
export function CliGlyph({ doing, jump = null, size = CLI_GLYPH }: Props) {
  const agent = doing === "agent" || doing === "working";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: GAP,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {agent ? <AgentMark size={size} /> : <CliMark size={size} />}
      {jump === null ? null : (
        <span
          style={{
            fontSize: Math.round(size * NUMBER),
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {jump}
        </span>
      )}
    </span>
  );
}
