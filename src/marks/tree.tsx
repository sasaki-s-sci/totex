import { Frame, MarkButton, ROW_SIZE, SIZE, struck } from ".";

const SHUT = "M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z";

/** The same canvas and placement mark for folders and repositories. */
export function CanvasButton({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <MarkButton label={label} aria-pressed={on} onClick={onClick}>
      <Frame size={ROW_SIZE}>
        <circle cx="12" cy="12" r="7.5" fill={on ? "currentColor" : "none"} />
      </Frame>
    </MarkButton>
  );
}

/** The ring the canvas draws a repository by: a row's grip on the canvas. */
export function RepoRingMark({ on, size = SIZE }: { on: boolean; size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="12" cy="12" r="6.5" />
      {on && <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />}
    </Frame>
  );
}

export function PaneFolderMark({ size = ROW_SIZE }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d={SHUT} />
    </Frame>
  );
}

export const FOLDER_GLYPH = 7;

// Drawn twice: first in the canvas colour and wider, as clearance so the ring's rim stops short of the folder.
export function RimFolderMark({ size = FOLDER_GLYPH }: { size?: number }) {
  const canvas = "var(--mui-palette-background-default)";
  return (
    <Frame size={size} spill>
      <path d={SHUT} style={{ fill: canvas, stroke: canvas }} strokeWidth={struck(size, 3)} />
      <path d={SHUT} />
    </Frame>
  );
}

export function FolderMark({ on, size = ROW_SIZE }: { on: boolean; size?: number }) {
  return (
    <Frame size={size}>
      {on ? (
        <>
          <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H19.5 V11" />
          <path d="M2.5 18.5 H17.5 L21.5 11 H6.5 Z" />
        </>
      ) : (
        <path d={SHUT} />
      )}
    </Frame>
  );
}

export function FileMark() {
  return (
    <Frame size={ROW_SIZE}>
      <path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 12 H16 M9 16 H16" />
    </Frame>
  );
}

export function LinkMark() {
  return (
    <Frame size={12}>
      <path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2 M14 17l-2 2a5 5 0 0 1-7-7l2-2 M8 16l8-8" />
    </Frame>
  );
}
