import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { Box, InputBase, ListItemIcon } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderMark } from "../components/marks";
import { ICON } from "./rows";

/**
 * A name being typed in the column: a row that is being made, or one that is
 * being called something else.
 *
 * Held by the column rather than by the level that draws it, for the same
 * reason the context menu is: one name is being typed at a time however many
 * folders are open. It also has to outlast the level — the folder a new file
 * goes in may not be open yet, and it is this that says which folder to open on
 * the way down to it.
 */
export interface Naming {
  /** The pane the field is drawn in. Two of them can be showing one folder,
   *  and the name is being typed in one of the two. */
  pane: number;
  kind: "new-file" | "new-folder" | "rename";
  /** The folder whose rows the field stands among. */
  folder: string;
  /** The row being renamed, or null when the row is being made. */
  path: string | null;
  /** What the field starts out holding. */
  from: string;
}

interface Props {
  /** The indent of the rows around it, so it stands in the list as one. */
  indent: number;
  /** Drawn as a folder rather than as a file. */
  isDir: boolean;
  /** What the field starts out holding — empty for a row being made. */
  from: string;
  /** What it is called before anything is typed in it. */
  placeholder: string;
  /** Takes the name. A refusal comes back as a rejection, and leaves the field
   *  where it is with what was typed still in it. */
  onDone: (name: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The row a name is typed into, drawn among the rows it will be one of.
 *
 * In the tree and not over it: nothing else in the window is covered up while a
 * file is being named, so the folder it is going into is still there to be read
 * and everything else — the terminal in the panel, the graph, another pane — is
 * still there to be used. The name is a row's, and the place a row's name is
 * asked for is the row.
 *
 * Return takes it and Escape drops it. Moving the focus away takes it too, the
 * way a field in a listing is expected to: what was typed is the one thing here
 * that cannot be worked out again, so it is written rather than thrown away.
 * An empty field, or a rename to the name it already had, is nothing to write
 * and simply goes.
 */
export function NameField({ indent, isDir, from, placeholder, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(from);
  const [busy, setBusy] = useState(false);
  /** The disk would not have the name. Said by the field itself and nowhere
   *  else: what is wrong is the name, and the name is here. */
  const [failed, setFailed] = useState(false);
  /** Set the moment the field is answered, so the blur that follows the row
   *  leaving the tree is not read as a second answer. */
  const settled = useRef(false);
  const hold = useRef<HTMLInputElement>(null);
  const wanted = name.trim();

  /* Focused as it appears, and a rename starts on the part in front of the
     extension: that is the part being changed, and a selection over the whole
     name takes the extension with it as soon as anything is typed. A leading
     dot is the name itself.

     Taken in an effect rather than as the input is handed over, because the
     menu this was asked from is coming down in the same commit and gives the
     focus back to the row it was opened on as it goes. That happens in the same
     pass as this, and a mount runs after an unmount there — so the field takes
     the focus last, which is the whole point of it appearing. */
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
    // Nothing typed, or nothing changed: there is nothing to write, and asking
    // the disk to rename a file to what it is already called is a call that
    // fails for a reason nobody wants to read about.
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
      /* The same box a row is: one step in from its folder, an icon at the
         `ListItemButton` padding, and the name where the name goes. */
      sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: indent, pr: 0.5, py: 1 }}
      // The pane behind it offers its own folder to anything right-clicked that
      // is not a row, and the field is not a row yet.
      onContextMenu={(event) => event.stopPropagation()}
    >
      <ListItemIcon sx={ICON}>
        {/* A folder that is not open, because there is nothing in it yet. */}
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
          // The row's own height, so the rows above and below do not move to
          // make room for a name being typed among them.
          "& .MuiInputBase-input": { p: 0, height: 20, lineHeight: "20px" },
          ...(failed
            ? { outline: "1px solid", outlineColor: "error.main", outlineOffset: "-1px" }
            : null),
        }}
      />
    </Box>
  );
}
