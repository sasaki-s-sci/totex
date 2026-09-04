/** The window's settings, opened as a page on the graph. */

import CloseIcon from "@mui/icons-material/Close";
import { Stack } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { SettingsFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { FollowSection } from "../settings/FollowSection";
import { LanguageRow } from "../settings/LanguageRow";
import { McpSection } from "../settings/McpSection";
import { RevealRow } from "../settings/RevealRow";
import { SaidSection } from "../settings/SaidSection";
import { useSettingsControls } from "../settings/SettingsControls";
import { ThemeRow } from "../settings/ThemeRow";
import { UpdateSection } from "../settings/UpdateSection";
import { Page, PageFrame, PageTool } from "./Page";

const MIN_WIDTH = 520;
const MIN_HEIGHT = 220;

/**
 * A regular canvas page: it moves and resizes by the same chrome as a file,
 * while the settings inside it keep behaving like ordinary form controls.
 *
 * The bar carries one mark, because there is one thing to ask of a page there
 * is only ever one of: a file's card offers its patch, a pin and a fold because
 * a canvas may be holding a dozen of them and each is a different file. This is
 * the window's own page, and it is either open or it is not.
 */
export function SettingsNode(_props: NodeProps<SettingsFlowNode>) {
  const { t } = useTranslation();
  const { closeSettings } = useGraphActions();
  const mcp = useSettingsControls();

  return (
    <>
      <PageFrame minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} />
      <Page
        kind="settings-page"
        name={t("settings.title")}
        tools={
          <PageTool
            label={t("filePreview.close", { name: t("settings.title") })}
            onClick={closeSettings}
          >
            <CloseIcon sx={{ fontSize: 12 }} />
          </PageTool>
        }
      >
        <Stack sx={{ p: 2, gap: 1, minWidth: MIN_WIDTH - 2 }}>
          <ThemeRow />
          <LanguageRow />
          <RevealRow />
          <SaidSection />
          <FollowSection />
          <McpSection controls={mcp} />
          <UpdateSection />
        </Stack>
      </Page>
    </>
  );
}
