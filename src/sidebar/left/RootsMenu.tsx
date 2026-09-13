import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { displayPath } from "../../folder/format";
import { CloseMark, MarkButton } from "../../marks";
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
      {/* Held here: a menu jumps to the row a keystroke begins with, and every letter of a path
          would be a jump. */}
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
                secondary={root.detail === null ? null : displayPath(root.detail)}
                slotProps={{
                  primary: { variant: "body2", noWrap: true },
                  secondary: { variant: "caption", noWrap: true },
                }}
              />
            </MenuItem>
          );
        }),
      ])}

      {(places ?? []).length > 0 && <Divider key="kept-rule" sx={{ my: 0.5 }} />}
      {(places ?? []).map((place) => (
        <MenuItem key={place.path} onClick={() => addPane(place.path)}>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={place.label}
            secondary={displayPath(place.display)}
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
