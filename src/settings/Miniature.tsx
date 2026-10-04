import { useTheme } from "@mui/material/styles";
import { useLayoutEffect } from "react";
import { useMarkSizes } from "../canvas/markSizes";
import { useAppSettings } from "../lib/appSettings";
import { HISTORY_ALL } from "../lib/appSettingsModel";
import { GRID_OFF } from "../lib/grid";
import { useSaid } from "../lib/said";
import { type Part, useSettingsMap } from "./SettingsMap";

/** The window in the miniature's own units; the drawing scales to whatever column holds it. */
export const MINIATURE = { width: 300, height: 196 } as const;

const SIDEBAR = { left: 0, right: 64 } as const;
const PANEL = { left: 204, right: MINIATURE.width } as const;
/** Where the canvas draws its bands from and to; each band's tip and stack sit at its right end. */
const BAND = { start: 80, end: 142 } as const;
const COMMIT_STEP = 9;
/** The miniature shows at most this many commits; past it the band fades out on the left. */
const COMMITS_DRAWN = 7;
/** Output in the terminal panel, with a blank line here and there. */
const TERMINAL_LINES = [60, 72, 0, 50, 66, 40, 0, 56]
  .map((width, line) => ({ y: 20 + line * 7, width }))
  .filter(({ width }) => width > 0);

/**
 * totex drawn small: the folder sidebar, the canvas with a folder, two repositories and a page on
 * it, and a terminal beside them. Each part is a `Part` the settings beside it point at, and the
 * parts redraw with the settings so a change shows here as it lands on the real canvas.
 */
export function Miniature() {
  const theme = useTheme();
  const palette = (theme.vars ?? theme).palette;
  const map = useSettingsMap();
  const settings = useAppSettings();
  const marks = useMarkSizes();
  const said = useSaid();

  // The leader lines are measured off the drawing, so they follow every redraw.
  useLayoutEffect(() => map?.drawn());

  const lit = (part: Part) => map?.active.has(part) ?? false;
  const ink = (part: Part, quiet = palette.text.secondary) =>
    lit(part) ? palette.primary.main : quiet;
  const hook = (part: Part) => ({
    "data-part": part,
    style: { cursor: map ? "pointer" : undefined },
    onMouseEnter: () => map?.hover([part]),
    onMouseLeave: () => map?.hover(null),
    onClick: () => map?.pick(part),
  });

  const gridStep =
    settings.backgroundGrid && settings.gridStep < GRID_OFF ? settings.gridStep : null;
  const dotStep = gridStep === null ? null : Math.max(3, gridStep * 0.3);
  const cli = marks.cli * 0.55;
  const folder = marks.folder * 0.55;
  const gap = 4 + settings.groupGap * 2.4;
  const everything = settings.historyLength >= HISTORY_ALL;
  const commits = everything ? COMMITS_DRAWN : Math.min(settings.historyLength, COMMITS_DRAWN);
  const shorter = Math.max(1, Math.min(commits, 4));
  const byTerminal = settings.canvasAlign === "terminal";

  const folderTop = 34;
  const bandA = folderTop + folder + 16 + gap;
  const bandB = bandA + 26 + gap;
  const alignX = byTerminal ? BAND.end : BAND.start;
  const span = (count: number) => (count - 1) * COMMIT_STEP;
  const bands = [
    { y: bandA, count: commits, tip: byTerminal ? BAND.end : BAND.start + span(commits) },
    { y: bandB, count: shorter, tip: byTerminal ? BAND.end : BAND.start + span(shorter) },
  ];
  const fitted = said.fitting;
  const saidLines = fitted ? 2 : Math.min(said.lines, 4);
  const saidLeft = bands[0].tip + 2 * cli + 8;
  const saidWidth = Math.min(
    PANEL.left - 4 - saidLeft,
    fitted ? 40 : Math.max(8, said.width * 0.07),
  );
  const saidThick = 1 + said.size * 0.1;
  const title = settings.fileTitle === "path" ? "~/repo/notes/README.md" : "README.md";

  return (
    <svg
      viewBox={`0 0 ${MINIATURE.width} ${MINIATURE.height}`}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "auto", userSelect: "none" }}
      fontFamily="inherit"
    >
      <defs>
        {dotStep !== null && (
          <pattern
            id="miniature-grid"
            width={dotStep}
            height={dotStep}
            patternUnits="userSpaceOnUse"
            x={SIDEBAR.right}
          >
            <circle cx={0.5} cy={0.5} r={0.5} fill={ink("grid", palette.divider)} />
          </pattern>
        )}
      </defs>

      {/* The window and the canvas it mostly is. */}
      <g {...hook("window")}>
        <rect
          x={0.5}
          y={0.5}
          width={MINIATURE.width - 1}
          height={MINIATURE.height - 1}
          rx={5}
          fill={palette.background.default}
          stroke={ink("window", palette.divider)}
          strokeWidth={lit("window") ? 1.5 : 1}
        />
        <circle data-anchor="window" cx={PANEL.left - 30} cy={1} r={0.5} fill="none" />
      </g>
      <g {...hook("canvas")}>
        <rect
          x={SIDEBAR.right}
          y={1}
          width={PANEL.left - SIDEBAR.right}
          height={MINIATURE.height - 2}
          fill="transparent"
        />
        {/* A magnifier for what the wheel and the arrows do to the view. */}
        <circle cx={190} cy={180} r={4} fill="none" stroke={ink("canvas")} />
        <path d="M193 183 L197 187" stroke={ink("canvas")} strokeLinecap="round" />
        <circle data-anchor="canvas" cx={190} cy={180} r={0.5} fill="none" />
      </g>
      {/* The grid covers the canvas, but only the strip along its top answers the pointer. */}
      {dotStep !== null && (
        <rect
          x={SIDEBAR.right}
          y={1}
          width={PANEL.left - SIDEBAR.right}
          height={MINIATURE.height - 2}
          fill="url(#miniature-grid)"
          pointerEvents="none"
        />
      )}
      <g {...hook("grid")}>
        <rect
          x={SIDEBAR.right}
          y={1}
          width={PANEL.left - SIDEBAR.right}
          height={16}
          fill="transparent"
        />
        <circle data-anchor="grid" cx={186} cy={9} r={0.5} fill="none" />
      </g>

      {/* The folder sidebar. */}
      <g {...hook("sidebar")}>
        <rect
          x={SIDEBAR.left + 0.5}
          y={0.5}
          width={SIDEBAR.right - 0.5}
          height={MINIATURE.height - 1}
          rx={5}
          fill={palette.background.paper}
        />
        <rect
          x={SIDEBAR.right - 6}
          y={0.5}
          width={6}
          height={MINIATURE.height - 1}
          fill={palette.background.paper}
        />
        <line
          x1={SIDEBAR.right}
          y1={0.5}
          x2={SIDEBAR.right}
          y2={MINIATURE.height - 0.5}
          stroke={palette.divider}
        />
        <path d="M5 7.5 H10 M7.5 5 V10" stroke={palette.text.secondary} strokeWidth={0.8} />
        <circle
          cx={16}
          cy={7.5}
          r={2}
          fill="none"
          stroke={palette.text.secondary}
          strokeWidth={0.8}
        />
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <g key={row}>
            <rect
              x={row ? 7 : 4}
              y={18 + row * 10}
              width={5}
              height={4}
              rx={0.8}
              fill="none"
              stroke={ink("sidebar")}
              strokeWidth={0.7}
            />
            <rect
              x={row ? 15 : 12}
              y={19 + row * 10}
              width={[30, 14, 26, 20, 24, 18][row]}
              height={2}
              rx={1}
              fill={ink("sidebar", row ? palette.text.disabled : palette.text.secondary)}
            />
          </g>
        ))}
        <circle data-anchor="sidebar" cx={30} cy={40} r={0.5} fill="none" />
      </g>

      {/* A folder and the terminal opened in it. */}
      <g {...hook("folderMark")}>
        <rect
          x={76}
          y={folderTop - 9}
          width={26}
          height={3}
          rx={1.5}
          fill={palette.text.disabled}
        />
        <path
          d={folderPath(76, folderTop, folder)}
          fill="none"
          stroke={ink("folderMark", palette.text.primary)}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
        <circle
          data-anchor="folderMark"
          cx={76 + folder / 2}
          cy={folderTop + folder / 2}
          r={0.5}
          fill="none"
        />
      </g>
      <g {...hook("cliMark")}>
        <path
          d={cliPath(118, folderTop + (folder - cli) / 2, cli)}
          fill="none"
          stroke={ink("cliMark", palette.text.primary)}
          strokeWidth={0.9}
        />
        <circle
          data-anchor="cliMark"
          cx={118 + cli / 2}
          cy={folderTop + folder / 2}
          r={0.5}
          fill="none"
        />
      </g>
      <path
        d={`M${76 + 2} ${folderTop + folder + 3} V${bandB} H${BAND.start - 8}`}
        fill="none"
        stroke={palette.divider}
      />

      {/* The room between one group and the next. */}
      <g {...hook("gap")}>
        {[
          [folderTop + folder + 4, bandA - 12],
          [bandA + 4, bandB - 12],
        ].map(([top, bottom]) => (
          <g key={top} stroke={ink("gap", palette.divider)} strokeWidth={0.7}>
            <line x1={70} y1={top} x2={70} y2={bottom} strokeDasharray="1.5 1.5" />
            <line x1={68} y1={top} x2={72} y2={top} />
            <line x1={68} y1={bottom} x2={72} y2={bottom} />
          </g>
        ))}
        <circle data-anchor="gap" cx={70} cy={(bandA + 4 + bandB - 12) / 2} r={0.5} fill="none" />
      </g>
      <g {...hook("align")}>
        <line
          x1={alignX}
          y1={bandA - 16}
          x2={alignX}
          y2={bandB + 8}
          stroke={ink("align", palette.divider)}
          strokeDasharray="2 2"
          strokeWidth={0.7}
        />
        <circle data-anchor="align" cx={alignX} cy={bandB + 8} r={0.5} fill="none" />
      </g>

      {/* Two repositories, each a band of commits with its terminals stacked over the tip. */}
      {bands.map((band, index) => {
        const first = band.tip - span(band.count);
        return (
          <g key={band.y}>
            {/* The repository's name, kept clear of the stack over the tip. */}
            <rect
              x={band.tip - cli / 2 - 4 - (index ? 14 : 20)}
              y={band.y - 12}
              width={index ? 14 : 20}
              height={3}
              rx={1.5}
              fill={palette.text.disabled}
            />
            <g {...hook("commits")}>
              <line
                x1={everything ? first - 10 : first}
                y1={band.y}
                x2={band.tip}
                y2={band.y}
                stroke={ink("commits", palette.divider)}
              />
              {everything && (
                <line
                  x1={first - 14}
                  y1={band.y}
                  x2={first - 10}
                  y2={band.y}
                  stroke={ink("commits", palette.divider)}
                  strokeDasharray="1 1.5"
                />
              )}
              {Array.from({ length: band.count - 1 }, (_, at) => first + at * COMMIT_STEP).map(
                (x) => (
                  <circle
                    key={x}
                    cx={x}
                    cy={band.y}
                    r={1.8}
                    fill={ink("commits", palette.text.secondary)}
                  />
                ),
              )}
              {index === 0 && (
                <circle
                  data-anchor="commits"
                  cx={first + COMMIT_STEP}
                  cy={band.y}
                  r={0.5}
                  fill="none"
                />
              )}
            </g>
            <circle
              cx={band.tip}
              cy={band.y}
              r={2.6}
              fill="none"
              stroke={ink("commits", palette.text.primary)}
              strokeWidth={0.9}
            />
            <g {...hook("stack")}>
              {[0, 1].slice(0, index ? 1 : 2).map((at) => (
                <path
                  key={at}
                  d={cliPath(band.tip - cli / 2 + at * (cli + 3), band.y - 8 - cli, cli)}
                  fill="none"
                  stroke={ink("stack", ink("cliMark", palette.text.primary))}
                  strokeWidth={0.9}
                />
              ))}
              {index === 0 && (
                <circle
                  data-anchor="stack"
                  cx={band.tip + cli + 3}
                  cy={band.y - 8 - cli / 2}
                  r={0.5}
                  fill="none"
                />
              )}
            </g>
          </g>
        );
      })}

      {/* The line a terminal's agent writes beside its mark. */}
      <g {...hook("said")}>
        <rect
          x={saidLeft - 2}
          y={bands[0].y - 10 - cli}
          width={saidWidth + 4}
          height={saidLines * 3.6 + 2}
          fill="transparent"
        />
        {!said.showing && (
          <rect
            x={saidLeft}
            y={bands[0].y - 8 - cli}
            width={saidWidth}
            height={saidLines * 3.6 - 1}
            rx={0.8}
            fill="none"
            stroke={ink("said", palette.divider)}
            strokeDasharray="1.5 1.5"
            strokeWidth={0.6}
          />
        )}
        {said.showing &&
          Array.from({ length: saidLines }, (_, line) => line).map((line) => (
            <rect
              key={`line-${line}`}
              x={saidLeft}
              y={bands[0].y - 8 - cli + line * 3.6}
              width={line === saidLines - 1 && saidLines > 1 ? saidWidth * 0.6 : saidWidth}
              height={Math.min(saidThick, 3)}
              rx={0.6}
              fill={ink(
                "said",
                said.face === "terminal" ? palette.text.secondary : palette.text.primary,
              )}
              opacity={Math.max(0.15, said.opacity / 100)}
            />
          ))}
        <circle
          data-anchor="said"
          cx={saidLeft + 2}
          cy={bands[0].y - 8 - cli}
          r={0.5}
          fill="none"
        />
      </g>

      {/* The remote the first band follows, and the spare worktree beside the second. */}
      <g {...hook("remote")}>
        <path
          d={diamond(bands[0].tip - COMMIT_STEP, bands[0].y + 7, 2.4)}
          fill="none"
          stroke={ink("remote")}
          strokeWidth={0.8}
        />
        <line
          x1={bands[0].tip - COMMIT_STEP}
          y1={bands[0].y + 2}
          x2={bands[0].tip - COMMIT_STEP}
          y2={bands[0].y + 4.6}
          stroke={ink("remote")}
          strokeWidth={0.7}
        />
        <circle
          data-anchor="remote"
          cx={bands[0].tip - COMMIT_STEP}
          cy={bands[0].y + 7}
          r={0.5}
          fill="none"
        />
      </g>
      <g {...hook("branch")}>
        <path
          d={`M${bands[1].tip} ${bands[1].y} q 6 0 8 8 h 8`}
          fill="none"
          stroke={ink("branch", palette.divider)}
          strokeDasharray="1.5 1.5"
        />
        <circle
          cx={bands[1].tip + 18}
          cy={bands[1].y + 8}
          r={2.2}
          fill="none"
          stroke={ink("branch")}
          strokeDasharray="1.2 1"
          strokeWidth={0.8}
        />
        <circle
          data-anchor="branch"
          cx={bands[1].tip + 18}
          cy={bands[1].y + 8}
          r={0.5}
          fill="none"
        />
      </g>

      {/* A file opened as a page on the canvas. */}
      <g {...hook("page")}>
        <rect
          x={78}
          y={150}
          width={78}
          height={38}
          rx={2}
          fill={palette.background.paper}
          stroke={ink("page", palette.divider)}
        />
        <line x1={78} y1={159} x2={156} y2={159} stroke={palette.divider} />
        <text
          x={82}
          y={156.8}
          fontSize={5.5}
          fill={ink("page", palette.text.primary)}
          textLength={Math.min(70, title.length * 2.9)}
          lengthAdjust="spacingAndGlyphs"
        >
          {title}
        </text>
        {[0, 1, 2, 3].map((line) => (
          <rect
            key={line}
            x={82}
            y={164 + line * 5.5}
            width={[60, 44, 54, 30][line]}
            height={1.8}
            rx={0.9}
            fill={palette.text.disabled}
          />
        ))}
        <circle
          data-anchor="page"
          cx={82 + Math.min(70, title.length * 2.9) / 2}
          cy={155}
          r={0.5}
          fill="none"
        />
      </g>

      {/* The terminal panel. */}
      <g {...hook("terminal")}>
        <rect
          x={PANEL.left}
          y={0.5}
          width={PANEL.right - PANEL.left - 0.5}
          height={MINIATURE.height - 1}
          rx={5}
          fill={palette.background.paper}
        />
        <rect
          x={PANEL.left}
          y={0.5}
          width={6}
          height={MINIATURE.height - 1}
          fill={palette.background.paper}
        />
        <line
          x1={PANEL.left}
          y1={0.5}
          x2={PANEL.left}
          y2={MINIATURE.height - 0.5}
          stroke={palette.divider}
        />
        {TERMINAL_LINES.map(({ y, width }) => (
          <rect
            key={y}
            x={PANEL.left + 6}
            y={y}
            width={width}
            height={2.2}
            rx={0.6}
            fill={ink("terminal", palette.text.disabled)}
          />
        ))}
        <rect
          x={PANEL.left + 6}
          y={20 + 8 * 7}
          width={3}
          height={4}
          fill={ink("terminal", palette.text.secondary)}
        />
        <circle data-anchor="terminal" cx={PANEL.left + 50} cy={100} r={0.5} fill="none" />
      </g>
      <g {...hook("controls")}>
        <g stroke={ink("controls")} strokeWidth={0.8} fill="none">
          <line x1={272} y1={8} x2={277} y2={8} />
          <rect x={281} y={5.5} width={5} height={5} />
          <path d="M290 5.5 l5 5 M295 5.5 l-5 5" />
        </g>
        <circle data-anchor="controls" cx={283.5} cy={8} r={0.5} fill="none" />
      </g>
    </svg>
  );
}

function folderPath(x: number, y: number, size: number): string {
  const h = size * 0.78;
  const top = y + (size - h) / 2;
  return `M${x} ${top + h} V${top} h${size * 0.38} l${size * 0.1} ${size * 0.12} h${size * 0.52} V${top + h} Z`;
}

/** The `>_` a terminal's mark is drawn with. */
function cliPath(x: number, y: number, size: number): string {
  const s = size;
  return `M${x} ${y + s * 0.2} l${s * 0.35} ${s * 0.3} l${-s * 0.35} ${s * 0.3} M${x + s * 0.45} ${y + s * 0.85} h${s * 0.55}`;
}

function diamond(x: number, y: number, r: number): string {
  return `M${x} ${y - r} l${r} ${r} l${-r} ${r} l${-r} ${-r} Z`;
}
