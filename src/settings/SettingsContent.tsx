import { Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { usePageWorkspace } from "../page/PageWorkspace";
import { terminalPageId } from "../page/placement";
import { AppearanceRows } from "./AppearanceRows";
import { FollowRows } from "./FollowRows";
import { LanguageRow } from "./LanguageRow";
import { McpRows } from "./McpRows";
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
  const workspace = usePageWorkspace();
  const terminal =
    workspace?.terminals.find((session) => terminalPageId(session.id) === workspace.active) ??
    workspace?.terminals.find((session) => terminalPageId(session.id) === workspace.showing) ??
    workspace?.terminals[0];
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
      <Section name={t("canvas.title")}>
        <McpRows cwd={terminal?.cwd} />
        <FollowRows />
        <SpareRow />
      </Section>
      <Section name={t("settings.page")}>
        <TextSizeRow place="page" />
        <UndoRow />
      </Section>
      <Section name={t("settings.terminal")}>
        <WheelRow />
        <TextSizeRow place="terminal" />
        <TerminalSortRow />
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
