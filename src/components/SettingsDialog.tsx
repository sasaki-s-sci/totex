import { Dialog, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { LanguageRow } from "./settings/LanguageRow";
import { McpSection } from "./settings/McpSection";
import { ThemeRow } from "./settings/ThemeRow";
import { UpdateSection } from "./settings/UpdateSection";

/**
 * Everything the window is set by, on one page.
 *
 * It reads top to bottom in the order the things belong to: the window in front
 * of you first, then the door the agents speak through, then the copy of the
 * app on disk. All of it is set once and left, which is why none of it is out
 * in the one row the window reserves along the top — that band is for what is
 * reached while working, and this is what is reached instead of working.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 380 } } }}>
      <Stack sx={{ p: 2, gap: 1 }}>
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {t("settings.title")}
        </Typography>
        <ThemeRow />
        <LanguageRow />
        <McpSection />
        <UpdateSection />
      </Stack>
    </Dialog>
  );
}
