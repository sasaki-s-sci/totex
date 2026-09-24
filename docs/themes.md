# Themes

A theme is a JSON file declaring one of three independent layers. The settings pick
one of each (`appearance.colors`, `appearance.style`, `appearance.effects` in
`~/.totex/totex.json`); the light/dark `theme` setting still chooses which half of the
colours is drawn.

| kind | what it decides | missing fields |
|---|---|---|
| `colors` | every colour, per `light` and `dark` half, plus the terminal's 16 | refused whole |
| `style` | corner radius and type | taken from `default` |
| `effects` | window material and opacity, floating-surface blur, wave, scanlines | taken from `none` |

Built-ins live in `src/theme/builtin/<id>.<kind>.json` and are read by the same code
as user files (`src/theme/declaration.ts`). Put your own in `~/.totex/themes/*.json`
(any file name). They are reloaded whenever the window regains focus; a file with a
built-in's `id` and `kind` replaces it. A file that does not parse is listed with its
error under Settings → Appearance and is otherwise ignored.

## colors

```json
{
  "kind": "colors",
  "id": "my-colours",
  "name": "My colours",
  "light": {
    "ground": "#eef1f7", "surface": "#ffffff", "edge": "#d5dcea",
    "ink": "#111826", "inkMuted": "#5a6885",
    "accent": "#1f8bff", "accentAlt": "#a92bff",
    "added": "#00a961", "changed": "#ef7000", "removed": "#ff2d55",
    "terminal": {
      "black": "#…", "red": "#…", "green": "#…", "yellow": "#…",
      "blue": "#…", "magenta": "#…", "cyan": "#…", "white": "#…",
      "brightBlack": "#…", "brightRed": "#…", "brightGreen": "#…", "brightYellow": "#…",
      "brightBlue": "#…", "brightMagenta": "#…", "brightCyan": "#…", "brightWhite": "#…"
    }
  },
  "dark": { "…": "the same keys" }
}
```

`ground` is the canvas; `surface` is what stands on it (columns, cards, dialogs), so the
two must differ. `terminal` is optional; without it xterm's defaults apply. Colours are
`#rgb`, `#rrggbb` or `#rrggbbaa`.

## style

```json
{ "kind": "style", "id": "round", "name": "Round", "radius": 12,
  "font": { "ui": "system-ui, sans-serif", "mono": "\"Cascadia Mono\", monospace", "size": 14 } }
```

`radius` is 0–24 px, `font.size` is the UI size in px (10–18). `font.mono` is used by
terminals and the agent views; file previews keep their own face, as their gutters are
measured against it.

## effects

```json
{ "kind": "effects", "id": "glass", "name": "Glass",
  "window": { "material": "acrylic", "opacity": 0.8 },
  "blur": 16,
  "wave": { "enabled": true, "strength": 0.5, "period": 12 },
  "scanlines": 0.3 }
```

- `window.material`: `none`, `mica`, `acrylic` or `blur`, drawn by Windows behind a
  see-through window. `window.opacity` (0–1) is how much of the ground and surfaces is
  painted over it.
- `blur`: px of backdrop blur behind menus, dialogs, popovers and drawers.
- `wave`: an ambient wave behind the canvas, tinted with the accents; `strength` 0–1,
  `period` in seconds. It stands still under reduced motion and pauses while the window
  is hidden or unfocused. Giving a `wave` object turns it on unless `enabled` says otherwise.
- `scanlines`: 0–1, CRT lines over terminals.
