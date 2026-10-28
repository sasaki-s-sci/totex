import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { AppearanceRows } from "./AppearanceRows";
import { FileTitleRow } from "./FileTitleRow";
import { FollowRows } from "./FollowRows";
import { LanguageRow } from "./LanguageRow";
import { MonitorRows } from "./MonitorRows";
import { ResumeRows } from "./ResumeRows";
import { Group, Section } from "./Row";
import { SettingsSaveStatus } from "./SettingsSaveStatus";
import { SpareRow } from "./SpareRow";
import { TerminalSortRow } from "./TerminalSortRow";
import { TextSizeRow } from "./TextSizeRow";
import { ThemeRow } from "./ThemeRow";
import { UndoRow } from "./UndoRow";
import { UpdateRow } from "./UpdateRow";
import { UsageRow } from "./UsageRow";
import { WheelRow } from "./WheelRow";

export function SettingsContent() {
  const { t } = useTranslation();
  return (
    <Stack
      sx={{
        px: 2,
        py: 1.5,
        gap: 0.5,
        "& .MuiDivider-root:first-of-type": { display: "none" },
      }}
    >
      <SettingsSaveStatus />
      <Section name={t("cards.title")}>
        <TextSizeRow place="card" />
        <FollowRows />
        <SpareRow />
      </Section>
      <Section name={t("settings.page")}>
        <FileTitleRow />
        <TextSizeRow place="page" />
        <UndoRow />
      </Section>
      <Section name={t("settings.terminal")}>
        <WheelRow />
        <TextSizeRow place="terminal" />
        <TerminalSortRow />
      </Section>
      <Section name={t("monitor.title")}>
        <MonitorRows />
      </Section>
      <Section name={t("resume.title")}>
        <ResumeRows />
      </Section>
      <Section name={t("settings.other")}>
        <Group name={t("settings.appearance")}>
          <ThemeRow />
          <AppearanceRows />
        </Group>
        <UsageRow />
        <LanguageRow />
        <UpdateRow />
      </Section>
    </Stack>
  );
}
