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
import { LayoutRow } from "./LayoutRow";
import { MarkSizeRows } from "./MarkSizeRows";
import { MonitorRows } from "./MonitorRows";
import { ResumeRows } from "./ResumeRows";
import { RevealRow } from "./RevealRow";
import { Group, Section } from "./Row";
import { Callout, SettingsMap } from "./SettingsMap";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { SpareRow } from "./SpareRow";
import { TerminalSortRow } from "./TerminalSortRow";
import { TextSizeRow } from "./TextSizeRow";
import { ThemeRow } from "./ThemeRow";
import { UndoRow } from "./UndoRow";
import { UpdateRow } from "./UpdateRow";
import { UsageRow } from "./UsageRow";
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
      <LayoutRow />
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
            <TextSizeRow place="page" />
            <UndoRow />
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
            <TextSizeRow place="terminal" />
          </Callout>
          <Callout parts={["stack"]} name={t("settings.terminalMarks")}>
            <TerminalSortRow />
          </Callout>
        </Section>
        <Section name={t("monitor.title")}>
          <MonitorRows />
        </Section>
        <Section name={t("resume.title")}>
          <ResumeRows />
        </Section>
        <Section name={t("settings.other")}>
          <Callout parts={["window"]} name={t("settings.appearance")}>
            <ThemeRow />
            <AppearanceRows />
          </Callout>
          <Callout parts={["sidebar"]}>
            <UsageRow />
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
