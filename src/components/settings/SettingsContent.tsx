/** The window's settings, opened as a page on the graph. */

import { Stack } from "@mui/material";
import { FileTitleRow } from "./FileTitleRow";
import { FollowSection } from "./FollowSection";
import { LanguageRow } from "./LanguageRow";
import { McpSection } from "./McpSection";
import { RevealRow } from "./RevealRow";
import { SaidSection } from "./SaidSection";
import { useSettingsControls } from "./SettingsControls";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { ThemeRow } from "./ThemeRow";
import { UpdateSection } from "./UpdateSection";

/** The form is the rendered view of the application's settings file. */
export function SettingsContent() {
  const mcp = useSettingsControls();
  return (
    <Stack sx={{ p: 2, gap: 1, minWidth: 518 }}>
      <SettingsSaveStatus />
      <ThemeRow />
      <LanguageRow />
      <FileTitleRow />
      <RevealRow />
      <SaidSection />
      <FollowSection />
      <McpSection controls={mcp} />
      <UpdateSection />
    </Stack>
  );
}
