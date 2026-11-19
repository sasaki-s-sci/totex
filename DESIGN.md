---
name: totex
description: Desktop evidence canvas and terminal workspace.
colors:
  primary-light: '#1f8bff'
  primary-dark: '#43a5ff'
  ground-light: '#eef1f7'
  ground-dark: '#070a11'
  surface-light: '#ffffff'
  surface-dark: '#141a28'
  edge-light: '#d5dcea'
  edge-dark: '#242e44'
  ink-light: '#111826'
  ink-dark: '#e8edf7'
  ink-muted-light: '#5a6885'
  ink-muted-dark: '#8d9bb5'
  error-light: '#ff2d55'
  error-dark: '#ff5c78'
typography:
  body:
    fontFamily: system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 13px
    fontWeight: 400
  label:
    fontFamily: system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 12px
    fontWeight: 400
  caption:
    fontFamily: system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 11px
    fontWeight: 400
  button:
    fontFamily: system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.75
  code:
    fontFamily: ui-monospace, "Cascadia Mono", Consolas, monospace
    fontSize: 13px
    lineHeight: 1.6
  terminal:
    fontFamily: ui-monospace, "Cascadia Mono", Consolas, monospace
    fontSize: 12px
rounded:
  flush: 0px
  control-default: 6px
spacing:
  separator: 1px
  compact: 4px
  tools: 6px
  small: 8px
  row: 12px
  content: 24px
components:
  canvas-pane:
    backgroundColor: '{colors.ground-light}'
    textColor: '{colors.ink-light}'
    rounded: '{rounded.flush}'
  canvas-pane-dark:
    backgroundColor: '{colors.ground-dark}'
    textColor: '{colors.ink-dark}'
    rounded: '{rounded.flush}'

---

# Design System: totex

## Overview

**Creative North Star: "Full-area evidence canvas"**

The center is a continuous evidence surface. Content fills each pane; straight separators define its bounds. The original compact terminal header keeps the evidence and active terminal prominent; added repositories and folders remain visible by name, including those with no terminal.

Preserve the surrounding explorer and the existing color, style, and effects settings. These rules describe the desktop canvas and terminal area; rendered pages, images, and documents retain their own content styling.

**Key Characteristics:**

- Full-area canvas with straight separators.
- Compact terminal navigation above the active terminal.
- Theme-bound colors in light and dark modes.
- Visible keyboard focus and controls available only from the context menu.

## Colors

The frontmatter records the shipped Neon palette's light and dark values. Runtime appearance remains controlled by the selected theme, with `src/theme/index.ts` mapping declarations to MUI variables. Use those variables in application CSS; the recorded defaults do not replace user theme choices.

- **Primary:** `primary-*` identifies focused panes, keyboard offers, and the current terminal through `--mui-palette-primary-main`.
- **Neutral:** `ground-*` fills the canvas, sidebar, and terminal; `surface-*` belongs to theme-managed surfaces. `edge-*` divides regions. `ink-*` and `ink-muted-*` distinguish content from secondary labels.
- **Error:** `error-*` identifies failed loads, invalid input, and file status through the existing error role.

Hover and current-item backgrounds use `--mui-palette-action-hover` and `--mui-palette-action-selected`. Preserve the terminal's selected ANSI palette. The sidecar's tonal strips are preview metadata, not additional UI colors.

## Typography

Use the style layer's UI family for controls and labels and its monospace family for code and terminals. The frontmatter records the default families and the sizes explicitly used by this surface. The theme's base UI size is configurable; MUI components keep their existing variant sizing.

Use `body` for empty-pane shortcut hints and `caption` for the original compact terminal header. Current terminal numbers use bold weight (700) and tabular figures. MUI text actions use the existing `button` role with sentence case. Code uses `code`; the terminal starts at `terminal` size and follows its existing zoom setting. There is no application display-heading role in the canvas shell.

## Layout

The canvas occupies the entire center between the existing explorer and the right sidebar. Its equal-fraction grid adapts to pane count and the available aspect ratio; the last pane spans any remaining columns. Use the separator spacing as the grid gap, with no outer gutter. Images contain themselves within their pane; web pages fill it; code and documents scroll within it.

The right sidebar retains its resizable width, initially (420px), capped at (40vw), with a CSS minimum of (180px). The original horizontal terminal header sits directly above the active terminal, with folder names and terminal numbers in its compact groups. Added repositories and folders with no terminal show only their names in the same header, even when no terminal is running. Ctrl+Shift highlights these names in place; horizontal overflow scrolls to the selected name. There is no dropdown or extra repository row.

The supported composition is desktop. The reviewed widths are (900px), (1250px), and (1440px); these are verification sizes, not CSS breakpoints. Keep the continuous grid calculation instead of introducing a mobile layout. Empty-pane guidance and documents use content padding; code uses its existing padding (20px). Shortcut hints are limited to (42ch). Empty panes contain no input fields or buttons.

## Elevation & Depth

Canvas panes have no shadows; the right sidebar keeps its established terminal header. One-pixel dividers and theme backgrounds establish boundaries. Keep existing theme effects and MUI overlays under their current settings; the canvas adds no elevation, blur, or motion. Canvas actions appear only in the context menu; they never reserve space over the content.

## Shapes

Canvas panes and separators are square and flush. The terminal header keeps its original shape and spacing. Existing form controls retain the selected theme radius, represented by `control-default` for the default style. Do not apply the canvas's square geometry to the preserved explorer or unrelated settings controls.

## Components

- **Evidence pane:** content reaches its bounds. Keyboard focus and held selection use an inset primary outline (2px), with no change to layout. Holding Ctrl+Space exposes selection; release returns focus to the terminal.
- **Context menu:** right-click native canvas content for add/remove actions. Media also offers its range editor in a popover. External frames use held Ctrl+Space plus right-click, or Shift+F10 after pane selection. There are no title tabs, view choosers, hover toolbars or path fields.
- **Terminal header:** reuse the original PageView header and horizontal TerminalList. Empty-folder names remain visible after the explorer's + adds them. Click a name to start, or select it with Ctrl+Shift and arrows, then Enter.
- **MCP setup:** keep the enable switch in Settings → Canvas. When enabled, show the selected terminal's environment, one selectable registration command with a copy action, and the two-step instruction: launch totex, register once, then use Codex normally. Wrap long commands within the settings width; loading, fixed-port startup errors, preparation errors and copy failures remain inline with retry actions.
- **Empty canvas:** show only its shortcut hint. Files arrive through explorer double click, drag and drop, or MCP.
- **Evidence content:** image, file, code, document, and live-page renderers keep their established content behavior. Do not extract the typography or colors inside an embedded page into the application shell.

## Do's and Don'ts

### Do:

- Do fill the available center with evidence panes and use the existing divider token between them.
- Do use theme variables for application surfaces, text, selection, and errors.
- Do preserve the explorer and the original compact terminal header.
- Do keep canvas controls in the context menu, while preserving keyboard shortcuts.

### Don't:

- Don't restore card shells, pane titles, tabs, toolbars, path fields or terminal summaries in the center.
- Don't add rounded corners, shadows, or outer gutters to canvas panes.
- Don't treat embedded content colors or headings as application design tokens.
- Don't turn canvas selection into a persistent navigation mode after Ctrl+Space is released.
