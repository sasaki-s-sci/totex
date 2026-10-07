import { Alert, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverseer } from "../hooks/useOverseer";
import { startOverseer, stopOverseer } from "../lib/overseer";
import { PageButton, Row } from "./Row";

export function OverseerRow() {
  const { t } = useTranslation();
  const { session } = useOverseer();
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = session !== null;

  async function change() {
    if (busy) return;
    setBusy(active ? "stopping" : "starting");
    setError(null);
    try {
      if (active) await stopOverseer();
      else await startOverseer();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack sx={{ gap: 0.5 }}>
      <Row label={t("overseer.control")}>
        <Typography variant="caption" role="status">
          {t(active ? "overseer.active" : "overseer.inactive")}
        </Typography>
        <PageButton disabled={busy !== null} onClick={() => void change()}>
          {t(busy ? `overseer.${busy}` : active ? "overseer.stop" : "overseer.start")}
        </PageButton>
      </Row>
      <Typography variant="caption" color="text.secondary">
        {t("overseer.help")}
      </Typography>
      {error && (
        <Alert severity="error">
          {t("overseer.failed")} {error}
        </Alert>
      )}
    </Stack>
  );
}
