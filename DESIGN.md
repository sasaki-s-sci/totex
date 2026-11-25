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

The center is a continuous evidence surface. Content fills each pane; straight separators define its bounds. A compact central tab header groups a folder path with its numbered terminals; each tab controls one shared evidence canvas.

Preserve the surrounding explorer and the existing color, style, and effects settings. These rules describe the desktop canvas and terminal area; rendered pages, images, and documents retain their own content styling.

**Key Characteristics:**

- Full-area canvas with straight separators.
- Canvas tabs above the center, with terminal navigation inside each tab.
- Theme-bound colors in light and dark modes.
- Visible keyboard focus, a New page header action, and pane controls in the context menu.

## Colors

The frontmatter records the shipped Neon palette's light and dark values. Runtime appearance remains controlled by the selected theme, with `src/theme/index.ts` mapping declarations to MUI variables. Use those variables in application CSS; the recorded defaults do not replace user theme choices.

- **Primary:** `primary-*` identifies focused panes, keyboard offers, and the current terminal through `--mui-palette-primary-main`.
- **Neutral:** `ground-*` fills the canvas, sidebar, and terminal; `surface-*` belongs to theme-managed surfaces. `edge-*` divides regions. `ink-*` and `ink-muted-*` distinguish content from secondary labels.
- **Error:** `error-*` identifies failed loads, invalid input, and file status through the existing error role.

Hover and current-item backgrounds use `--mui-palette-action-hover` and `--mui-palette-action-selected`. Preserve the terminal's selected ANSI palette. The sidecar's tonal strips are preview metadata, not additional UI colors.

## Typography

Use the style layer's UI family for controls and labels and its monospace family for code and terminals. The frontmatter records the default families and the sizes explicitly used by this surface. The theme's base UI size is configurable; MUI components keep their existing variant sizing.

Use `body` for collected URLs and `caption` for folder paths in the canvas header; terminal numbers are (11px). Canvas tabs keep the same background and label colors in every selection and hover state. Indicate the active canvas with a primary bottom edge. Terminal numbers have no fills or enclosing outlines; the current number uses primary text and a subtle glow, and keyboard focus adds an underline. Close buttons use outlines for hover and keyboard focus; folder labels and + actions show outlines only for keyboard focus. MUI text actions use the existing `button` role with sentence case. Code uses `code`; the terminal starts at `terminal` size and follows its existing zoom setting. There is no application display-heading role in the canvas shell.

## Layout

The canvas occupies the entire center between the existing explorer and the right sidebar. Its equal-fraction grid adapts to pane count and the available aspect ratio; the last pane spans any remaining columns. Use the separator spacing as the grid gap, with no outer gutter. Images contain themselves within their pane; web pages fill it; code and documents scroll within it.

The right sidebar retains its resizable width, initially (420px), capped at (40vw), with a CSS minimum of (180px). Its header has a collapse control on the left and the existing window controls on the right. The central header shares its height and has one tab per canvas. Center terminal numbers, the add-terminal button and the close button vertically; overlap the bottom border with the folder label on an opaque background. Use the last folder name, adding only enough parents to distinguish different paths with the same name. Multiple canvases of the same folder keep the same label, and the full path remains available on hover. A separate + offers known folders for new canvases, including another canvas for the same folder. Leave at least (64px) of blank header space for window dragging and file drops. Overflowing tabs scroll horizontally. Ctrl+Up moves to a higher terminal number and Ctrl+Down to a lower number within the active canvas; Ctrl+Left/Right switches canvases.

Holding Ctrl+Shift highlights the new-canvas + and offers known folders, starting with the current folder. Arrow keys move through the choices and Enter creates a separate canvas. Releasing either modifier or pressing Escape cancels and restores focus. The offer does not take input focus until arrow navigation, so existing copy/paste chords still reach the terminal; text editors keep their own selection shortcuts.

The supported composition is desktop. The reviewed widths are (900px), (1250px), and (1440px); these are verification sizes, not CSS breakpoints. Keep the continuous grid calculation instead of introducing a mobile layout. Collected URL cards and documents use content padding; code uses its existing padding (20px). Empty panes have no instruction text or input fields.

## Elevation & Depth

Canvas panes have no shadows; the right sidebar keeps its window controls. One-pixel dividers and theme backgrounds establish boundaries. Keep existing theme effects and MUI overlays under their current settings; the canvas adds no elevation, blur, or motion. New page is a text action at the right of the central header. Pane actions stay in the context menu and never reserve space over the content.

## Shapes

Canvas panes and separators are square and flush. Canvas tabs use square borders and a primary bottom edge for the active tab. Existing form controls retain the selected theme radius, represented by `control-default` for the default style. Do not apply the canvas's square geometry to the preserved explorer or unrelated settings controls.

## Components

- **Evidence pane:** content reaches its bounds. Keyboard focus and held selection use an inset primary outline (2px), with no change to layout. Holding Ctrl+Space exposes selection; release returns focus to the terminal.
- **Context menu:** right-click native canvas content for add/remove actions. Media also offers its range editor in a popover. External frames use held Ctrl+Space plus right-click, or Shift+F10 after pane selection. There are no title tabs, view choosers, hover toolbars or path fields.
- **Canvas header:** one tab per canvas, each containing a folder path and its terminals. New page adds an empty pane to the active canvas and is disabled without a canvas. Switching terminals preserves content and live frames. Closing the final terminal leaves its canvas available for files or another terminal. The sidebar header contains no folder or terminal labels.
- **MCP setup:** keep the enable switch in Settings → Canvas. When enabled, show the selected terminal's environment, one selectable registration command with a copy action, and the two-step instruction: launch totex, register once, then use Codex normally. Wrap long commands within the settings width; loading, fixed-port startup errors, preparation errors and copy failures remain inline with retry actions.
- **Empty canvas:** show collected URLs as bordered cards, with the command on the top edge and the URL below. Cards wrap into columns when space allows; long commands and URLs wrap within each card. Omit section headings and keyboard or pointer instructions. With no URLs, leave the canvas blank. Files arrive through explorer double click, drag and drop, or MCP.
- **Evidence content:** image, file, code, document, and live-page renderers keep their established content behavior. Ctrl+plus/minus changes only the focused resource or terminal, with Ctrl+0 restoring its initial scale. Collected URLs, Markdown links and terminal links open embedded pages in their owning canvas. External browser opening remains an explicit action.

## Do's and Don'ts

### Do:

- Do fill the available center with evidence panes and use the existing divider token between them.
- Do use theme variables for application surfaces, text, selection, and errors.
- Do preserve the explorer and existing window controls.
- Do keep pane controls in the context menu and New page in the header, while preserving keyboard shortcuts.

### Don't:

- Don't restore card shells around evidence panes, pane titles, tabs, toolbars, path fields or terminal summaries in the center. Collected URL buttons in empty panes use the card treatment described above.
- Don't add rounded corners, shadows, or outer gutters to canvas panes.
- Don't treat embedded content colors or headings as application design tokens.
- Don't turn canvas selection into a persistent navigation mode after Ctrl+Space is released.
