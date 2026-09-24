import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { AppearanceRows } from "./AppearanceRows";
import { FileTitleRow } from "./FileTitleRow";
import { FollowRows } from "./FollowRows";
import { GapRow } from "./GapRow";
import { GridRows } from "./GridRows";
import { HistoryRows } from "./HistoryRows";
import { LanguageRow } from "./LanguageRow";
import { RevealRow } from "./RevealRow";
import { Group, Section } from "./Row";
import { SaidRows } from "./SaidRows";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { SpareRow } from "./SpareRow";
import { ThemeRow } from "./ThemeRow";
import { UpdateRow } from "./UpdateRow";
import { WalkRow } from "./WalkRow";
import { WheelRow } from "./WheelRow";

export function SettingsContent() {
  const { t } = useTranslation();
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
          <GapRow />
          <RevealRow />
          <WalkRow />
          <HistoryRows />
          <FollowRows />
          <SpareRow />
        </Group>
      </Section>
      <Section name={t("settings.terminal")}>
        <WheelRow place="cli" />
        <SaidRows />
      </Section>
      <Section name={t("settings.other")}>
        <ThemeRow />
        <Group name={t("settings.appearance")}>
          <AppearanceRows />
        </Group>
        <LanguageRow />
        <UpdateRow />
      </Section>
    </Stack>
  );
}
