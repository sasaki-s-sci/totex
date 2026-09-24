// The stylesheets the effects layer writes, as plain strings so they can be read and tested
// without a document. `null` means the sheet is not in the document at all.
import type { ColorsDeclaration, EffectsDeclaration } from "../declaration";

const HALVES = ["light", "dark"] as const;

// index.html paints the body in the default preset's hard-coded grounds, at `:root[…] body`
// strength, until the window is drawn. The body is where the ground belongs once a see-through
// window or the wave needs the app's own column to stop painting it, so it is repainted in the
// palette's ground here, one step stronger than the boot rule.
export const GROUND_SHEET =
  ":root:root[data-color-scheme] body { background-color: var(--mui-palette-background-default); }";

// A variable cannot be mixed into its own override, so the declared colours are mixed instead,
// once per half, stronger than MUI's `[data-color-scheme]` and any other `:root[…]` palette.
export function opacitySheet(
  effects: EffectsDeclaration,
  colors: ColorsDeclaration,
): string | null {
  const { opacity } = effects.window;
  if (opacity >= 1) return null;
  const percent = `${round(opacity * 100)}%`;
  const mix = (colour: string) => `color-mix(in srgb, ${colour} ${percent}, transparent)`;
  const halves = HALVES.map((half) => {
    const { ground, surface } = colors[half];
    return (
      `:root:root[data-color-scheme="${half}"] {\n` +
      `  --mui-palette-background-default: ${mix(ground)};\n` +
      `  --mui-palette-background-paper: ${mix(surface)};\n` +
      "}"
    );
  });
  // The body alone paints the ground; the root under it must not paint it a second time.
  return [":root:root { background: transparent; }", ...halves].join("\n");
}

const FLOATING = [
  ".MuiPopover-paper",
  ".MuiMenu-paper",
  ".MuiDialog-paper",
  ".MuiDrawer-paper",
].map((selector) => `:root ${selector}`);

// Floating surfaces are few and short-lived; a backdrop filter on a graph node would be
// thousands of them, so the list stops at MUI's own overlays.
export function blurSheet(effects: EffectsDeclaration): string | null {
  const { blur } = effects;
  if (blur <= 0) return null;
  const filter = `backdrop-filter: blur(${round(blur)}px);`;
  return (
    `${FLOATING.join(",\n")} {\n` +
    `  ${filter}\n` +
    "  background-color: color-mix(in srgb, var(--mui-palette-background-paper) 72%, transparent);\n" +
    "}\n" +
    ":root .MuiTooltip-tooltip {\n" +
    `  ${filter}\n` +
    "  background-color: color-mix(in srgb, var(--mui-palette-Tooltip-bg) 70%, transparent);\n" +
    "}"
  );
}

// xterm already makes `.xterm` a positioned box; the overlay sits over its canvases and helpers
// but takes no pointer, so selection and the IME textarea are untouched.
export function scanlineSheet(effects: EffectsDeclaration): string | null {
  const { scanlines } = effects;
  if (scanlines <= 0) return null;
  const alpha = round(scanlines * 0.6 * 1000) / 1000;
  return (
    ".xterm::after {\n" +
    '  content: "";\n' +
    "  position: absolute;\n" +
    "  inset: 0;\n" +
    "  z-index: 20;\n" +
    "  pointer-events: none;\n" +
    `  background: repeating-linear-gradient(to bottom, rgb(0 0 0 / ${alpha}) 0 1px, transparent 1px 3px);\n` +
    "}"
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
