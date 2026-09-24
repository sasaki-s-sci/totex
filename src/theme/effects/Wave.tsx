// A slow ambient wave under the whole window. A fixed canvas at `z-index: -1` paints after the
// root's background (the body's ground, propagated to the viewport) and before every box of the
// app, so it shows wherever the app itself leaves the ground unpainted: the graph.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface WaveProps {
  /** 0–1 of the accent's strength. */
  strength: number;
  /** Seconds per cycle. */
  period: number;
  accent: string;
  accentAlt: string;
}

// Soft bands lose nothing below the screen's density; past 1.5 the fill cost only grows.
const MOST_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const SEGMENTS = 48;

// Each band: where it rests (fraction of height), how far it swings, how many crests span the
// width, how many turns it makes per period (whole, so a cycle ends where it began), and its
// share of the strength.
const BANDS = [
  { rest: 0.62, swing: 0.07, crests: 0.8, turns: 1, share: 0.55, alt: false },
  { rest: 0.7, swing: 0.05, crests: 1.3, turns: -2, share: 0.45, alt: true },
  { rest: 0.8, swing: 0.04, crests: 2.1, turns: 3, share: 0.35, alt: false },
] as const;

export function Wave(props: WaveProps) {
  return createPortal(<WaveCanvas {...props} />, document.body);
}

function WaveCanvas({ strength, period, accent, accentAlt }: WaveProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    // Seconds of motion so far; advanced only while running, so a pause resumes where it stopped.
    let elapsed = 0;
    let width = 0;
    let height = 0;

    const draw = () => {
      context.clearRect(0, 0, element.width, element.height);
      const scale = element.width / Math.max(width, 1);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const phase = (elapsed / period) * Math.PI * 2;
      for (const band of BANDS) {
        const top = height * (band.rest - band.swing);
        const gradient = context.createLinearGradient(0, top, 0, height);
        const colour = band.alt ? accentAlt : accent;
        gradient.addColorStop(0, withAlpha(colour, strength * band.share));
        gradient.addColorStop(1, withAlpha(colour, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(0, height);
        for (let step = 0; step <= SEGMENTS; step++) {
          const x = (width * step) / SEGMENTS;
          const angle = (step / SEGMENTS) * band.crests * Math.PI * 2 + phase * band.turns;
          context.lineTo(x, height * (band.rest + band.swing * Math.sin(angle)));
        }
        context.lineTo(width, height);
        context.closePath();
        context.fill();
      }
    };

    const size = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MOST_DPR);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      draw();
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      // A long gap (a stalled frame) moves the wave by one frame, not by the whole stall.
      elapsed += Math.min(now - last, FRAME_MS * 2) / 1000;
      last = now;
      draw();
    };

    const running = () => !still.matches && !document.hidden && document.hasFocus();
    const settle = () => {
      if (running()) {
        if (frame !== 0) return;
        last = performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        draw();
      }
    };

    size();
    settle();
    // A zoom changes the density without always resizing the viewport the same way.
    let density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const redensify = () => {
      density.removeEventListener("change", redensify);
      density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      density.addEventListener("change", redensify);
      size();
    };
    density.addEventListener("change", redensify);
    window.addEventListener("resize", size);
    window.addEventListener("focus", settle);
    window.addEventListener("blur", settle);
    document.addEventListener("visibilitychange", settle);
    still.addEventListener("change", settle);
    return () => {
      cancelAnimationFrame(frame);
      density.removeEventListener("change", redensify);
      window.removeEventListener("resize", size);
      window.removeEventListener("focus", settle);
      window.removeEventListener("blur", settle);
      document.removeEventListener("visibilitychange", settle);
      still.removeEventListener("change", settle);
    };
  }, [strength, period, accent, accentAlt]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-effects="wave"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
}

// Declared colours are #rgb, #rrggbb or #rrggbbaa; an alpha already in the colour scales with
// the band's. Parsed here rather than handed to `color-mix`, which a canvas may not read.
function withAlpha(hex: string, alpha: number): string {
  const digits = hex.slice(1);
  const wide = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const channel = (at: number) => Number.parseInt(wide.slice(at, at + 2), 16);
  const own = wide.length === 8 ? channel(6) / 255 : 1;
  const a = Math.round(Math.max(0, Math.min(1, alpha * own)) * 1000) / 1000;
  return `rgb(${channel(0)} ${channel(2)} ${channel(4)} / ${a})`;
}
