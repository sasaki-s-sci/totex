import { Box, Stack, Typography } from "@mui/material";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Miniature } from "./Miniature";
import { NEST_SX, ROW_HEIGHT } from "./Row";

/** The pieces of the miniature a setting can point at. */
export type Part =
  | "window"
  | "controls"
  | "sidebar"
  | "canvas"
  | "grid"
  | "folderMark"
  | "cliMark"
  | "page"
  | "gap"
  | "align"
  | "commits"
  | "remote"
  | "branch"
  | "stack"
  | "said"
  | "terminal";

type SettingsMapValue = {
  active: ReadonlySet<Part>;
  hover: (parts: readonly Part[] | null) => void;
  /** Bring the first settings pointing at this part into view. */
  pick: (part: Part) => void;
  register: (id: string, element: HTMLElement, parts: readonly Part[]) => () => void;
  /** The miniature redrew, so its anchors may have moved. */
  drawn: () => void;
};

const SettingsMapContext = createContext<SettingsMapValue | null>(null);

export function useSettingsMap(): SettingsMapValue | null {
  return useContext(SettingsMapContext);
}

/** Below this the page is a column: the miniature sits on top and draws no leader lines. */
const WIDE = 600;
const GUTTER = 40;
const NONE: ReadonlySet<Part> = new Set();

type Point = { x: number; y: number };
type Leader = { key: string; parts: readonly Part[]; from: Point; to: Point; bend: number };

/**
 * Settings laid out beside a miniature of the window, each callout joined by a line to the part
 * of the window it changes. The miniature stays put while the settings scroll past it.
 */
export function SettingsMap({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLDivElement>(null);
  const callouts = useRef(new Map<string, { element: HTMLElement; parts: readonly Part[] }>());
  const [width, setWidth] = useState(0);
  const [leaders, setLeaders] = useState<readonly Leader[]>([]);
  const [hovered, setHovered] = useState<readonly Part[] | null>(null);
  const frame = useRef(0);
  const wide = width >= WIDE;

  const measure = useCallback(() => {
    const box = root.current;
    const drawing = figure.current;
    if (!box || !drawing || !wide) {
      setLeaders((current) => (current.length ? [] : current));
      return;
    }
    const at = box.getBoundingClientRect();
    // The page may sit on a zoomed canvas; leaders are drawn in the page's own pixels.
    const scale = at.width / box.offsetWidth || 1;
    const view = scrollParent(box)?.getBoundingClientRect() ?? at;
    const local = (x: number, y: number): Point => ({
      x: round((x - at.left) / scale),
      y: round((y - at.top) / scale),
    });
    const bend = round((drawing.getBoundingClientRect().right - at.left) / scale + 6);
    const next: Leader[] = [];
    for (const [id, { element, parts }] of callouts.current) {
      const rect = element.getBoundingClientRect();
      const y = rect.top + (ROW_HEIGHT / 2) * scale;
      if (y < view.top || y > view.bottom) continue;
      const to = local(rect.left - 4 * scale, y);
      for (const part of parts) {
        const anchor = drawing.querySelector(`[data-anchor="${part}"]`);
        if (!anchor) continue;
        const a = anchor.getBoundingClientRect();
        next.push({
          key: `${id}:${part}`,
          parts,
          from: local(a.left + a.width / 2, a.top + a.height / 2),
          to,
          bend,
        });
      }
    }
    setLeaders((current) => (sameLeaders(current, next) ? current : next));
  }, [wide]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const scroller = scrollParent(box);
    const sized = new ResizeObserver(() => {
      setWidth(box.offsetWidth);
      schedule();
    });
    sized.observe(box);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      sized.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  const pick = useCallback((part: Part) => {
    const box = root.current;
    const scroller = box && scrollParent(box);
    const found = [...callouts.current.values()].find(({ parts }) => parts.includes(part));
    if (!box || !scroller || !found) return;
    const scale = box.getBoundingClientRect().width / box.offsetWidth || 1;
    const offset = found.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    // Clear of the miniature when it stands on top in a narrow column.
    const above = figure.current && !wideNow(box) ? figure.current.offsetHeight : 0;
    scroller.scrollBy({ top: offset / scale - above - 12, behavior: "smooth" });
    setHovered(found.parts);
  }, []);

  const value = useMemo<SettingsMapValue>(
    () => ({
      active: hovered ? new Set(hovered) : NONE,
      hover: setHovered,
      pick,
      register: (id, element, parts) => {
        callouts.current.set(id, { element, parts });
        schedule();
        return () => {
          callouts.current.delete(id);
          schedule();
        };
      },
      drawn: schedule,
    }),
    [hovered, pick, schedule],
  );

  const figureWidth = Math.round(Math.min(300, Math.max(200, width * 0.36)));
  const lit = (parts: readonly Part[]) => parts.some((part) => value.active.has(part));

  return (
    <SettingsMapContext.Provider value={value}>
      <Box
        ref={root}
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: wide ? `${figureWidth}px 1fr` : "1fr",
          columnGap: `${GUTTER}px`,
          rowGap: 1,
          alignItems: "start",
        }}
      >
        <Box
          ref={figure}
          sx={{
            position: wide ? "sticky" : "static",
            top: 8,
            width: wide ? undefined : "100%",
            maxWidth: wide ? undefined : 320,
            justifySelf: wide ? undefined : "center",
            pt: wide ? 1 : 0,
          }}
        >
          <Miniature />
        </Box>
        <Stack sx={{ gap: 0.5, minWidth: 0 }}>{children}</Stack>
        {wide && (
          <svg
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            {leaders.map(({ key, parts, from, to, bend }) => {
              const on = lit(parts);
              const ink = on
                ? "var(--mui-palette-primary-main)"
                : "var(--mui-palette-text-secondary)";
              // At rest a leader starts at the miniature's edge, so the drawing stays readable;
              // only the lit one runs all the way into its part.
              return (
                <g
                  key={key}
                  style={{ transition: "opacity 120ms" }}
                  opacity={on ? 1 : hovered ? 0.12 : 0.4}
                >
                  <path
                    d={`M${on ? from.x : bend - 6} ${from.y} H${bend} L${to.x - 10} ${to.y} H${to.x}`}
                    fill="none"
                    stroke={ink}
                    strokeWidth={on ? 1.25 : 0.75}
                  />
                  <circle cx={from.x} cy={from.y} r={on ? 2.5 : 1.5} fill={ink} />
                </g>
              );
            })}
          </svg>
        )}
      </Box>
    </SettingsMapContext.Provider>
  );
}

/**
 * Settings that change one or more parts of the window. A leader runs from each part to the
 * callout's heading, and pointing at either lights both.
 */
export function Callout({
  parts,
  name,
  children,
}: {
  parts: readonly Part[];
  name?: string;
  children: React.ReactNode;
}) {
  const map = useSettingsMap();
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const key = parts.join(" ");
  const register = map?.register;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `parts`.
  useEffect(() => {
    if (!register || !box.current) return;
    return register(id, box.current, parts);
  }, [register, id, key]);
  const lit = parts.some((part) => map?.active.has(part));
  const hover = map?.hover;

  return (
    <Stack
      ref={box}
      sx={{ gap: 0.5, mt: 0.5 }}
      onMouseEnter={() => hover?.(parts)}
      onMouseLeave={() => hover?.(null)}
      onFocus={() => hover?.(parts)}
      onBlur={() => hover?.(null)}
    >
      {name && (
        <Typography
          variant="body2"
          sx={{
            color: lit ? "primary.main" : "text.secondary",
            fontWeight: 600,
            minHeight: ROW_HEIGHT,
            display: "flex",
            alignItems: "center",
            transition: "color 120ms",
          }}
        >
          {name}
        </Typography>
      )}
      <Stack
        sx={{
          ...NEST_SX,
          borderColor: lit ? "primary.main" : "divider",
          transition: "border-color 120ms",
        }}
      >
        {children}
      </Stack>
    </Stack>
  );
}

function wideNow(box: HTMLElement): boolean {
  return box.offsetWidth >= WIDE;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 2) / 2;
}

function sameLeaders(a: readonly Leader[], b: readonly Leader[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (leader, at) =>
        leader.key === b[at].key &&
        leader.bend === b[at].bend &&
        leader.from.x === b[at].from.x &&
        leader.from.y === b[at].from.y &&
        leader.to.x === b[at].to.x &&
        leader.to.y === b[at].to.y,
    )
  );
}
