import { Frame, ROW_SIZE, SIZE, struck } from ".";

export function ExpandMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d="M3 17.5 H7.5 C13 17.5 12.5 7 17.5 7" />
      <circle cx="19.5" cy="6.6" r="2.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}

const SHUT = "M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z";

// The shut folder with its top-right corner given up to the ring: the same ring `ExpandMark` fills.
const SHUT_CUT = "M2.5 18.5 V5.5 H8.5 L10.5 8 H15.8 M21.5 10.5 V18.5 H2.5";

/** The folder goes on the canvas as a folder: a row and the terminals round it, nothing scanned. */
export function GraphFolderMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d={SHUT_CUT} />
      <circle cx="19.5" cy="6.6" r="2.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}

/** The ring the canvas draws a repository by: a row's grip on the canvas, and the figure inside `GraphRepoMark`. */
export function RepoRingMark({ on, size = SIZE }: { on: boolean; size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="12" cy="12" r="6.5" />
      {on && <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />}
    </Frame>
  );
}

/**
 * The repository goes on the canvas as the one repository it is: the canvas, as a frame, with the
 * ring the canvas draws a repository by inside it. Off, the ring stands empty with a plus for what
 * pressing does; on, it is filled, the repository being there.
 */
export function GraphRepoMark({ on, size = SIZE }: { on: boolean; size?: number }) {
  return (
    <Frame size={size}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <circle cx="12" cy="12" r="4.4" fill={on ? "currentColor" : "none"} />
      {!on && <path d="M12 9.8 V14.2 M9.8 12 H14.2" />}
    </Frame>
  );
}

/**
 * A repository, by git's own figure: a line with a branch off it. `on` fills the points, which is a
 * row opened out to its files.
 */
export function GitMark({ on = false, size = ROW_SIZE }: { on?: boolean; size?: number }) {
  const fill = on ? "currentColor" : "none";
  return (
    <Frame size={size}>
      <path d="M6 7.6 V16.4 M18 10.6 C18 14.6 6 12.6 6 16.4" />
      <circle cx="6" cy="5" r="2.6" fill={fill} />
      <circle cx="6" cy="19" r="2.6" fill={fill} />
      <circle cx="18" cy="8" r="2.6" fill={fill} />
    </Frame>
  );
}

/** The header of a pane listing repositories: git's figure with its points filled, as the folder pane's header is a filled folder. */
export function PaneRepoMark({ size = ROW_SIZE }: { size?: number }) {
  return <GitMark on size={size} />;
}

export function PaneFolderMark({ size = ROW_SIZE }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d={SHUT} fill="currentColor" />
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

export function McpMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <g fill="currentColor" fillRule="evenodd" stroke="none" opacity={on ? 1 : 0.4}>
        <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
        <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
      </g>
    </Frame>
  );
}
