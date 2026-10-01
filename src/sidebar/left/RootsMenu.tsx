import CloudIcon from "@mui/icons-material/Cloud";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import {
  Box,
  CircularProgress,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Root } from "../../folder/api";
import { displayPath } from "../../folder/format";
import { sshHome, sshHostOf } from "../../lib/ssh";
import { CloseMark, GitMark, MarkButton, PaneFolderMark, SIZE } from "../../marks";
import { groupRoots, ROOT_ICONS } from "./roots";
import type { SshFailed, usePanes } from "./usePanes";

export function RootsMenu({
  anchor,
  asking,
  setAsking,
  roots,
  places,
  typed,
  setTyped,
  refused,
  setRefused,
  dropPlace,
  keepTyped,
  closeRootMenu,
  hosts,
  sshTyped,
  setSshTyped,
  sshFailed,
  setSshFailed,
  reaching,
  pick,
  addSshTyped,
  forgetSsh,
}: Pick<
  ReturnType<typeof usePanes>,
  | "anchor"
  | "asking"
  | "setAsking"
  | "roots"
  | "places"
  | "typed"
  | "setTyped"
  | "refused"
  | "setRefused"
  | "dropPlace"
  | "keepTyped"
  | "closeRootMenu"
  | "hosts"
  | "sshTyped"
  | "setSshTyped"
  | "sshFailed"
  | "setSshFailed"
  | "reaching"
  | "pick"
  | "addSshTyped"
  | "forgetSsh"
>) {
  const { t } = useTranslation();
  const failedAt = (at: SshFailed["at"]) =>
    sshFailed?.at === at ? t(sshFailed.key, { reason: sshFailed.reason }) : null;
  const pathFailure = failedAt("path");
  const sshFailure = failedAt("ssh");
  // The SSH section stands where the backend's ssh-host group would: after the other roots.
  const local = (roots ?? []).filter((root) => root.kind !== "ssh-host");
  const configured = (roots ?? []).filter(
    (root) => root.kind === "ssh-host" && !hosts.includes(sshHostOf(root.path) ?? ""),
  );
  const waiting = (path: string) =>
    reaching !== null && sshHostOf(path) === reaching ? (
      <CircularProgress size={14} sx={{ ml: 1, flexShrink: 0 }} />
    ) : null;

  return (
    <Menu
      open={anchor !== null}
      anchorEl={anchor}
      onClose={closeRootMenu}
      autoFocus={false}
      slotProps={{ list: { dense: true, sx: { minWidth: 240 } } }}
    >
      {/* What a pick opens as: a pane browsing the folder, or one listing the repositories under it. */}
      <Box key="kind" sx={{ px: 1.5, pt: 0.5, pb: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={asking}
          aria-label={t("folder.openAs")}
          onChange={(_event, kind: "folder" | "repository" | null) => {
            if (kind) setAsking(kind);
          }}
        >
          <ToggleButton value="folder" sx={{ gap: 0.75, textTransform: "none" }}>
            <PaneFolderMark size={SIZE} />
            {t("folder.asFolder")}
          </ToggleButton>
          <ToggleButton value="repository" sx={{ gap: 0.75, textTransform: "none" }}>
            <GitMark on size={SIZE} />
            {t("folder.asRepositories")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

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
          error={refused || pathFailure !== null}
          placeholder={t("folder.pathHint")}
          helperText={pathFailure ?? (refused ? t("folder.noFolder") : undefined)}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefused(false);
            if (sshFailed?.at === "path") setSshFailed(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") keepTyped();
          }}
          slotProps={{ htmlInput: { spellCheck: false, "aria-label": t("folder.pathHint") } }}
        />
      </Box>

      {groupRoots(local).flatMap((group) => [
        <Divider key={`${group.kind}-rule`} sx={{ my: 0.5 }} />,
        ...group.roots.map((root) => {
          const Icon = ROOT_ICONS[root.kind];
          return (
            <MenuItem key={root.path} onClick={() => pick(root.path)}>
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

      <Divider key="ssh-rule" sx={{ my: 0.5 }} />
      <ListSubheader
        key="ssh-head"
        disableSticky
        sx={{ lineHeight: "24px", bgcolor: "transparent", typography: "caption" }}
      >
        {t("ssh.title")}
      </ListSubheader>
      {hosts.map((host) => (
        <MenuItem key={`ssh:${host}`} onClick={() => pick(sshHome(host))}>
          <SshRow label={host} detail="~" />
          {waiting(sshHome(host))}
          <Box sx={{ display: "flex", ml: 1 }}>
            <MarkButton
              label={t("ssh.forget")}
              danger
              onClick={(event) => {
                event.stopPropagation();
                forgetSsh(host);
              }}
            >
              <CloseMark />
            </MarkButton>
          </Box>
        </MenuItem>
      ))}
      {configured.map((root: Root) => (
        <MenuItem key={root.path} onClick={() => pick(root.path)}>
          <SshRow
            label={root.label}
            detail={root.detail === null ? "~" : displayPath(root.detail)}
          />
          {waiting(root.path)}
        </MenuItem>
      ))}
      {/* Held here for the same reason as the path field. */}
      <Box
        key="ssh-add"
        sx={{ px: 1.5, pt: 0.25, pb: 1, display: "flex", alignItems: "center", gap: 1 }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <TextField
          fullWidth
          size="small"
          variant="standard"
          value={sshTyped}
          error={sshFailure !== null}
          placeholder={t("ssh.addHint")}
          helperText={sshFailure ?? undefined}
          onChange={(event) => {
            setSshTyped(event.target.value);
            if (sshFailed?.at === "ssh") setSshFailed(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") addSshTyped();
          }}
          slotProps={{ htmlInput: { spellCheck: false, "aria-label": t("ssh.add") } }}
        />
      </Box>

      {(places ?? []).length > 0 && <Divider key="kept-rule" sx={{ my: 0.5 }} />}
      {(places ?? []).map((place) => (
        <MenuItem key={place.path} onClick={() => pick(place.path)}>
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
          {waiting(place.path)}
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

function SshRow({ label, detail }: { label: string; detail: string }) {
  return (
    <>
      <ListItemIcon sx={{ minWidth: 28 }}>
        <CloudIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText
        primary={label}
        secondary={detail}
        slotProps={{
          primary: { variant: "body2", noWrap: true },
          secondary: { variant: "caption", noWrap: true },
        }}
      />
    </>
  );
}
