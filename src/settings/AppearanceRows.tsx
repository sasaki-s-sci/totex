import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { updateSettings } from "../lib/appSettings";
import { useAppearance } from "../theme/appearance";
import { LAYER_KINDS, type LayerKind } from "../theme/declaration";
import { declarationsOf, THEMES_DIRECTORY, useThemeFiles, useThemesError } from "../theme/registry";
import { PageButton, PICK_SX, Row } from "./Row";

const LABELS = {
  colors: "settings.colors",
  style: "settings.style",
  effects: "settings.effects",
} as const satisfies Record<LayerKind, string>;

// Error lines are file paths and parser messages; they wrap rather than widen the page.
const REFUSED_SX = { color: "error.main", overflowWrap: "anywhere" } as const;

function LayerRow({ kind }: { kind: LayerKind }) {
  const { t } = useTranslation();
  // What is in effect, not what is saved: a saved id whose file has gone falls back, and the
  // pull-down says so rather than showing a value it has no entry for. It also re-renders on
  // every reload of the files, which is what keeps the list below current.
  const current = useAppearance()[kind].id;
  return (
    <Row label={t(LABELS[kind])}>
      <Select
        size="small"
        value={current}
        onChange={(event) => updateSettings({ appearance: { [kind]: event.target.value } })}
        inputProps={{ "aria-label": t(LABELS[kind]) }}
        sx={PICK_SX}
      >
        {declarationsOf(kind).map((declaration) => (
          <MenuItem key={declaration.id} value={declaration.id}>
            {declaration.name}
          </MenuItem>
        ))}
      </Select>
    </Row>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function AppearanceRows() {
  const { t } = useTranslation();
  const refused = useThemeFiles().filter((file) => !file.ok);
  const loadError = useThemesError();
  return (
    <>
      {LAYER_KINDS.map((kind) => (
        <LayerRow key={kind} kind={kind} />
      ))}
      <Row label={t("settings.themeFiles")}>
        <PageButton
          title={THEMES_DIRECTORY}
          onClick={() => {
            // Opened by the backend: the window may only open web links itself.
            void invoke("themes_open").catch((error) =>
              console.error("Could not open the themes folder", error),
            );
          }}
        >
          {t("settings.openThemes")}
        </PageButton>
      </Row>
      {loadError || refused.length > 0 ? (
        <Stack sx={{ gap: 0.25 }}>
          {loadError ? (
            <Typography variant="caption" sx={REFUSED_SX}>
              {t("settings.themesUnread", { error: loadError })}
            </Typography>
          ) : null}
          {refused.map((file) =>
            file.ok ? null : (
              <Typography key={file.path} variant="caption" sx={REFUSED_SX} title={file.path}>
                {t("settings.themeRefused", { file: fileName(file.path), error: file.error })}
              </Typography>
            ),
          )}
        </Stack>
      ) : null}
    </>
  );
}
