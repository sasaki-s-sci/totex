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
import { UpdateRow } from "./UpdateRow";
import { WheelRow } from "./WheelRow";

export function SettingsContent() {
  const { t } = useTranslation();
  const mcp = useSettingsControls();
  return (
    // Each section opens with a rule; the first has nothing above it.
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
          <UpdateRow />
        </Group>
      </Section>
    </Stack>
  );
}
