/** The window's settings, opened as a page on the graph. */

import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { FileTitleRow } from "./FileTitleRow";
import { FollowRows } from "./FollowRows";
import { GridRows } from "./GridRows";
import { LanguageRow } from "./LanguageRow";
import { McpRows } from "./McpRows";
import { RevealRow } from "./RevealRow";
import { Group, Section } from "./Row";
import { SaidRows } from "./SaidRows";
import { useSettingsControls } from "./SettingsControls";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { ThemeRow } from "./ThemeRow";
import { UpdateRows } from "./UpdateRows";
import { WheelRow } from "./WheelRow";

/**
 * The form is the rendered view of the application's settings file.
 *
 * Cut by where each setting is felt — the canvas and the two kinds of thing on
 * it, a terminal, the agents' door — and the rest under one last name. See
 * `Section` for why it is cut that way rather than by what kind of control
 * each one is.
 */
export function SettingsContent() {
  const { t } = useTranslation();
  const mcp = useSettingsControls();
  return (
    // The rule each part opens with is what separates it from the one above,
    // and the first has nothing above it to be separated from.
    <Stack
      sx={{
        px: 2,
        py: 1.5,
        gap: 0.5,
        minWidth: 518,
        "& > .MuiDivider-root:first-child": { display: "none" },
      }}
    >
      <SettingsSaveStatus />
      <Section name={t("settings.canvas")}>
        <GridRows />
        <WheelRow place="graph" />
        <Group name={t("settings.page")}>
          <FileTitleRow />
        </Group>
        <Group name={t("settings.graph")}>
          <RevealRow />
          <FollowRows />
        </Group>
      </Section>
      <Section name={t("settings.terminal")}>
        <WheelRow place="cli" />
        <SaidRows />
      </Section>
      <Section name={t("settings.mcp")}>
        <McpRows controls={mcp} />
      </Section>
      <Section name={t("settings.other")}>
        <ThemeRow />
        <LanguageRow />
        <Group name={t("update.title")}>
          <UpdateRows />
        </Group>
      </Section>
    </Stack>
  );
}
