/** The window's settings, opened as a page on the graph. */

import CloseIcon from "@mui/icons-material/Close";
import { Stack } from "@mui/material";
import { type NodeProps, NodeResizer } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { SettingsFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { LanguageRow } from "../settings/LanguageRow";
import { McpSection } from "../settings/McpSection";
import { useSettingsControls } from "../settings/SettingsControls";
import { ThemeRow } from "../settings/ThemeRow";
import { UpdateSection } from "../settings/UpdateSection";

const MIN_WIDTH = 520;
const MIN_HEIGHT = 220;

/**
 * A regular canvas page: it moves and resizes by the same chrome as a file,
 * while the settings inside it keep behaving like ordinary form controls.
 */
export function SettingsNode(_props: NodeProps<SettingsFlowNode>) {
  const { t } = useTranslation();
  const { closeSettings } = useGraphActions();
  const mcp = useSettingsControls();

  return (
    <>
      <NodeResizer
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        lineClassName="settings-page__edge"
        handleClassName="settings-page__corner"
      />
      <article className="file-preview settings-page">
        <header className="file-preview__header">
          <span className="file-preview__name">{t("settings.title")}</span>
          <button
            type="button"
            className="file-preview__button nodrag"
            aria-label={t("filePreview.close", { name: t("settings.title") })}
            onClick={(event) => {
              event.stopPropagation();
              closeSettings();
            }}
          >
            <CloseIcon sx={{ fontSize: 12 }} />
          </button>
        </header>
        <div className="settings-page__body nodrag nowheel">
          <Stack sx={{ p: 2, gap: 1, minWidth: MIN_WIDTH - 2 }}>
            <ThemeRow />
            <LanguageRow />
            <McpSection controls={mcp} />
            <UpdateSection />
          </Stack>
        </div>
      </article>
    </>
  );
}
