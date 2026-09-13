import { Box } from "@mui/material";

import { Frame, ROW_SIZE, struck } from ".";

export function ExpandMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d="M3 17.5 H7.5 C13 17.5 12.5 7 17.5 7" />
      <circle cx="19.5" cy="6.6" r="2.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}

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

const SHUT = "M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z";

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
