import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { AlignRow } from "./AlignRow";
import { AppearanceRows } from "./AppearanceRows";
import { FileTitleRow } from "./FileTitleRow";
import { FollowRows } from "./FollowRows";
import { GapRow } from "./GapRow";
import { GridRows } from "./GridRows";
import { HistoryRows } from "./HistoryRows";
import { LanguageRow } from "./LanguageRow";
import { MarkSizeRows } from "./MarkSizeRows";
import { RevealRow } from "./RevealRow";
import { Group, Section } from "./Row";
import { SaidRows } from "./SaidRows";
import { Callout, SettingsMap } from "./SettingsMap";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { SpareRow } from "./SpareRow";
import { TerminalSortRow } from "./TerminalSortRow";
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
        "& .MuiDivider-root:first-of-type": { display: "none" },
      }}
    >
      <SettingsSaveStatus />
      <SettingsMap>
        <Section name={t("settings.canvas")}>
          <Callout parts={["canvas"]} name={t("settings.moving")}>
            <WheelRow place="graph" />
            <RevealRow />
            <WalkRow />
          </Callout>
          <Callout parts={["grid"]} name={t("settings.background")}>
            <GridRows />
          </Callout>
          <Callout parts={["folderMark", "cliMark"]} name={t("settings.marks")}>
            <MarkSizeRows />
          </Callout>
          <Callout parts={["page"]} name={t("settings.page")}>
            <FileTitleRow />
          </Callout>
          <Group name={t("settings.graph")}>
            <Callout parts={["gap", "align"]} name={t("settings.layout")}>
              <GapRow />
              <AlignRow />
            </Callout>
            <Callout parts={["commits"]} name={t("settings.history")}>
              <HistoryRows />
            </Callout>
            <Callout parts={["remote"]} name={t("settings.remote")}>
              <FollowRows />
            </Callout>
            <Callout parts={["branch"]} name={t("settings.branches")}>
              <SpareRow />
            </Callout>
          </Group>
        </Section>
        <Section name={t("settings.terminal")}>
          <Callout parts={["terminal"]} name={t("settings.terminalView")}>
            <WheelRow place="cli" />
          </Callout>
          <Callout parts={["stack"]} name={t("settings.terminalMarks")}>
            <TerminalSortRow />
          </Callout>
          <Callout parts={["said"]} name={t("settings.saidGroup")}>
            <SaidRows />
          </Callout>
        </Section>
        <Section name={t("settings.other")}>
          <Callout parts={["window"]} name={t("settings.appearance")}>
            <ThemeRow />
            <AppearanceRows />
          </Callout>
          <Callout parts={["sidebar"]}>
            <LanguageRow />
          </Callout>
          <Callout parts={["controls"]}>
            <UpdateRow />
          </Callout>
        </Section>
      </SettingsMap>
    </Stack>
  );
}
