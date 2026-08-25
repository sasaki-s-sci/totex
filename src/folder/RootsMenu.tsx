/**
 * The menu a pane is started from: every place this machine can reach, the
 * folders somebody kept, and a field to write one out in.
 */

import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { CloseMark, MarkButton } from "../components/marks";
import { groupRoots, ROOT_ICONS } from "./roots";
import type { usePanes } from "./usePanes";

export function RootsMenu({
  anchor,
  roots,
  places,
  typed,
  setTyped,
  refused,
  setRefused,
  addPane,
  dropPlace,
  keepTyped,
  closeRootMenu,
}: Pick<
  ReturnType<typeof usePanes>,
  | "anchor"
  | "roots"
  | "places"
  | "typed"
  | "setTyped"
  | "refused"
  | "setRefused"
  | "addPane"
  | "dropPlace"
  | "keepTyped"
  | "closeRootMenu"
>) {
  const { t } = useTranslation();

  return (
    <Menu
      open={anchor !== null}
      anchorEl={anchor}
      onClose={closeRootMenu}
      autoFocus={false}
      slotProps={{ list: { dense: true, sx: { minWidth: 240 } } }}
    >
      {/* Held here rather than let through: a menu answers a keystroke by
            jumping to the row it begins with, and every letter of a path would
            be one more jump out of the field it was typed in. */}
      <Box
        key="path"
        sx={{ px: 1.5, pt: 0.5, pb: 1 }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <TextField
          autoFocus
          fullWidth
          size="small"
          variant="standard"
          value={typed}
          error={refused}
          placeholder={t("folder.pathHint")}
          helperText={refused ? t("folder.noFolder") : undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") keepTyped();
          }}
          slotProps={{ htmlInput: { spellCheck: false, "aria-label": t("folder.pathHint") } }}
        />
      </Box>

      {groupRoots(roots ?? []).flatMap((group) => [
        <Divider key={`${group.kind}-rule`} sx={{ my: 0.5 }} />,
        ...group.roots.map((root) => {
          const Icon = ROOT_ICONS[root.kind];
          return (
            <MenuItem key={root.path} onClick={() => addPane(root.path)}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={root.label}
                secondary={root.detail}
                slotProps={{
                  primary: { variant: "body2", noWrap: true },
                  secondary: { variant: "caption", noWrap: true },
                }}
              />
            </MenuItem>
          );
        }),
      ])}

      {/* The folders that were kept. Each carries the mark that drops it,
            which is at the end of the row where every other mark in this
            column is — and takes the press for itself, so dropping a folder is
            never also opening it. */}
      {(places ?? []).length > 0 && <Divider key="kept-rule" sx={{ my: 0.5 }} />}
      {(places ?? []).map((place) => (
        <MenuItem key={place.path} onClick={() => addPane(place.path)}>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={place.label}
            secondary={place.display}
            slotProps={{
              primary: { variant: "body2", noWrap: true },
              secondary: { variant: "caption", noWrap: true },
            }}
          />
          <Box sx={{ display: "flex", ml: 1 }}>
            <MarkButton
              label={t("folder.drop")}
              danger
              onClick={(event) => {
                event.stopPropagation();
                dropPlace(place.path);
              }}
            >
              <CloseMark />
            </MarkButton>
          </Box>
        </MenuItem>
      ))}
    </Menu>
  );
}
