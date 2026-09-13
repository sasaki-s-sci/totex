import { type RefObject, useCallback, useEffect, useRef } from "react";

import { COMMIT_STEP } from "../../lib/graph";
import { LINES, type Said, useSaid, WIDTH } from "../../lib/said";

// The stylesheet's line height, copied so the fit is not a per-frame measurement.
const LINE = 1.35;

const SHARE = 0.4;

type Written = {
  size: string;
  lines: string;
  width: string;
  opacity: string;
};

function clamp(value: number, room: { least: number; most: number }): number {
  return Math.min(room.most, Math.max(room.least, Math.round(value)));
}

function fitted(across: number, size: number): { width: number; lines: number } {
  return {
    width: clamp(across * SHARE, WIDTH),
    lines: clamp(COMMIT_STEP.y / (size * LINE), LINES),
  };
}

function written(said: Said, across: number | null): Written {
  const fits = said.fitting && across !== null ? fitted(across, said.size) : null;
  return {
    size: `${said.size}px`,
    lines: String(fits ? fits.lines : said.lines),
    width: `${fits ? fits.width : said.width}px`,

    opacity: said.showing ? String(said.opacity / 100) : "1",
  };
}

// Written onto .graph by hand rather than a style prop: other hooks write there too, and the fitted half changes on every wheel step.
export function useSaidStyle(host: RefObject<HTMLDivElement | null>) {
  const said = useSaid();

  const zoom = useRef(1);

  const standing = useRef<Written | null>(null);

  const apply = useCallback(
    (next: Said, at: number) => {
      const canvas = host.current;
      if (!canvas) return;

      const across = at > 0 ? canvas.clientWidth / at : null;

      canvas.dataset.saidFace = next.face;

      const write = written(next, across);
      const before = standing.current;
      if (
        before &&
        before.size === write.size &&
        before.lines === write.lines &&
        before.width === write.width &&
        before.opacity === write.opacity
      ) {
        return;
      }
      standing.current = write;
      canvas.style.setProperty("--said-size", write.size);
      canvas.style.setProperty("--said-lines", write.lines);
      canvas.style.setProperty("--said-width", write.width);
      canvas.style.setProperty("--said-opacity", write.opacity);
    },
    [host],
  );

  const fit = useCallback(
    (at: number) => {
      zoom.current = at;
      apply(said, at);
    },
    [apply, said],
  );

  useEffect(() => {
    apply(said, zoom.current);
  }, [apply, said]);

  useEffect(() => {
    const canvas = host.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const watching = new ResizeObserver(() => apply(said, zoom.current));
    watching.observe(canvas);
    return () => watching.disconnect();
  }, [apply, host, said]);

  return fit;
}
