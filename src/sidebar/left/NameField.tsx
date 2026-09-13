import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { Box, InputBase, ListItemIcon } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderMark } from "../../marks";
import { ICON } from "./rows";

/**
 * Held by the column: one name at a time, and it must outlast the level, since the folder may not
 * be open yet.
 */
export interface Naming {
  /** Two panes can show one folder; the name is typed in one. */
  pane: number;
  kind: "new-file" | "new-folder" | "rename";
  folder: string;
  path: string | null;
  from: string;
}

interface Props {
  indent: number;
  isDir: boolean;
  from: string;
  placeholder: string;
  /** A refusal rejects and leaves the field with what was typed. */
  onDone: (name: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * In the tree, not over it. Return takes, Escape drops, and blur takes too: what was typed cannot
 * be recovered. Empty or unchanged just goes.
 */
export function NameField({ indent, isDir, from, placeholder, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(from);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Set as the field is answered, so the blur that follows is not a second answer.
  const settled = useRef(false);
  const hold = useRef<HTMLInputElement>(null);
  const wanted = name.trim();

  // Focused as it appears; a rename selects the part before the extension. A leading dot is the
  // name itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field is focused as it appears and never again
  useEffect(() => {
    const input = hold.current;
    if (!input) return;
    input.focus();
    const dot = from.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : from.length);
  }, []);

  function drop() {
    settled.current = true;
    onCancel();
  }

  async function settle() {
    if (settled.current || busy) return;
    // Nothing typed or nothing changed: renaming to the same name fails for no useful reason.
    if (!wanted || wanted === from) return drop();
    setBusy(true);
    setFailed(false);
    try {
      await onDone(wanted);
      settled.current = true;
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: indent, pr: 0.5, py: 1 }}
      // The pane offers its folder to any right-click that is not a row, and the field is not a row
      // yet.
      onContextMenu={(event) => event.stopPropagation()}
    >
      <ListItemIcon sx={ICON}>
        {isDir ? <FolderMark on={false} /> : <DescriptionOutlinedIcon fontSize="small" />}
      </ListItemIcon>
      <InputBase
        inputRef={hold}
        fullWidth
        value={name}
        readOnly={busy}
        placeholder={placeholder}
        title={failed ? t("file.failed") : undefined}
        slotProps={{ input: { spellCheck: false, autoCorrect: "off", autoCapitalize: "off" } }}
        onChange={(event) => {
          setName(event.target.value);
          setFailed(false);
        }}
        onBlur={() => void settle()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void settle();
          } else if (event.key === "Escape") {
            event.preventDefault();
            drop();
          }
        }}
        sx={{
          fontSize: 14,
          px: 0.75,
          borderRadius: 0.5,
          bgcolor: "action.hover",
          // The row's own height, so neighbours do not move.
          "& .MuiInputBase-input": { p: 0, height: 20, lineHeight: "20px" },
          ...(failed
            ? { outline: "1px solid", outlineColor: "error.main", outlineOffset: "-1px" }
            : null),
        }}
      />
    </Box>
  );
}
