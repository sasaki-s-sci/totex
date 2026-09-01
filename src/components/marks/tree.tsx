/**
 * The marks a row of the folder column carries: what a folder holds, and
 * whether it is open.
 */

import { Box } from "@mui/material";

import { Frame, ROW_SIZE } from "../marks";

export function ExpandMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d="M3 17.5 H7.5 C13 17.5 12.5 7 17.5 7" />
      <circle cx="19.5" cy="6.6" r="2.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}

/**
 * The same mark with a number on it: how many repositories are in the folder.
 *
 * The count is the one thing about a folder that cannot be seen by opening it —
 * a repository may be several levels down — so it is said where the offer to
 * draw the folder is, rather than as a second mark of its own. A folder with
 * none carries the bare mark: it can still be put on the graph, and what it
 * draws there is a row with a terminal on it.
 *
 * Set over the corner the mark leaves empty, and outside the drawing rather
 * than inside it: the glyph is 15 pixels and a numeral cut to fit in it would
 * be four. The button's own square is where the room is.
 */
export function GraphMark({ on, count }: { on: boolean; count: number }) {
  return (
    <Box sx={{ position: "relative", display: "flex" }}>
      <ExpandMark on={on} />
      {count > 0 && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            right: -4,
            bottom: -4,
            px: "1px",
            borderRadius: "3px",
            background: "background.default",
            fontSize: 9,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {count}
        </Box>
      )}
    </Box>
  );
}

/**
 * The folder a pane is showing: the same folder, filled.
 *
 * The one folder in the column that is not a row. It is where the pane is
 * standing, and every row under it is something it holds — so it is drawn as
 * the solid one and the rows stay hollow, and a heading is told from the names
 * beneath it by the drawing rather than by anything set around it.
 *
 * It says nothing about whether those rows are showing. A chevron stood here
 * once, and a chevron is an offer to unfold a step of a tree: where the pane is
 * standing is not one of those steps, and the rows arriving or going is already
 * the whole of what the heading's click has to say.
 */
export function PaneFolderMark({ size = ROW_SIZE }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z" fill="currentColor" />
    </Frame>
  );
}

/**
 * A folder, and the same folder with its front let down.
 *
 * Hollow, like everything else drawn here: a filled block of colour is the one
 * shape in a listing that cannot be seen through, and a column of them reads as
 * a column of tabs rather than a column of names. The outline says folder just
 * as well at this size, and leaves the eye on the names.
 *
 * Shut or open is the whole of what a row's own click does, so it is the icon
 * that says it: the front panel comes down and the folder is standing open,
 * which is the same thing the rows appearing underneath it say.
 */
export function FolderMark({ on, size = ROW_SIZE }: { on: boolean; size?: number }) {
  return (
    <Frame size={size}>
      {on ? (
        <>
          <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H19.5 V11" />
          <path d="M2.5 18.5 H17.5 L21.5 11 H6.5 Z" />
        </>
      ) : (
        <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z" />
      )}
    </Frame>
  );
}

/**
 * A terminal: the prompt, and the line waiting after it.
 *
 * Drawn here rather than taken from the icon set, like everything else in this
 * file, and for the reason this file exists at all — the set's terminal is a
 * filled glyph, and a filled glyph has no line to make thinner. Beside marks
 * struck at a hairline it read as the one solid thing on the canvas, which on a
 * graph where a terminal is the commonest mark there is meant the commonest
 * mark was also the loudest.
 *
 * Two strokes, and no screen round them. The set's version draws the box as
 * well, and a box is what the drawing cannot afford: these stand at eleven
 * pixels on the canvas, where the frame takes most of the square and leaves the
 * prompt inside it two pixels to be a prompt in — and a prompt that cannot be
 * read is a rounded rectangle. Without it the two strokes have the whole square
 * and the mark says the same thing, which is what a shell has looked like on
 * every screen it has ever been on.
 *
 * The chevron is the one this file draws for a folder that is shut, which is
 * why the line after it matters: `>` alone is a direction, and `>` with
 * somewhere to type is a terminal. They never stand in the same column anyway —
 * disclosure is the folder column's, this one is the canvas's and the menus'.
 *
 * Sized by whoever draws it. On the canvas these sit on the graph's own grid
 * and are the smallest thing on it; in a menu they stand at the size the rest
 * of that row is set at.
 */

/**
 * Whether an agent started in this folder's space is handed the window's door.
 *
 * A doorway, because that is what it is: the terminal is opened in the space,
 * and this says whether what runs there is told where to say what it is doing.
 * The handle fills when it is — the same way `ExpandMark`'s ring does, so the
 * two marks a heading carries answer in the same voice.
 *
 * Drawn on every heading rather than only where a space has said something.
 * The mark is the offer as much as the answer, and a folder that has never been
 * asked is exactly the one where nobody would think to look for a place to ask.
 */
export function DoorMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d="M6.5 20.5 V4.5 H17.5 V20.5" />
      <circle cx="14.6" cy="12.6" r="1.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}
