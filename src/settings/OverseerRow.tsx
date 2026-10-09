import { Alert, MenuItem, Select, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverseer } from "../hooks/useOverseer";
import { overseerDistros, startOverseer, stopOverseer } from "../lib/overseer";
import { PageButton, PICK_SX, Row } from "./Row";

export function OverseerRow() {
  const { t } = useTranslation();
  const { session } = useOverseer();
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const [distro, setDistro] = useState("");
  const active = session !== null;
  const selectedDistro = active
    ? /^\\\\wsl\.localhost\\([^\\]+)\\/i.exec(session)?.[1] || ""
    : distro;

  useEffect(() => {
    let alive = true;
    void overseerDistros().then(
      (names) => {
        if (alive) setDistros(names);
      },
      (reason) => {
        if (alive) setError(String(reason));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  async function change() {
    if (busy) return;
    setBusy(active ? "stopping" : "starting");
    setError(null);
    try {
      if (active) await stopOverseer();
      else await startOverseer(distro || null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack sx={{ gap: 0.5 }}>
      {distros.length > 0 && (
        <Row label={t("overseer.location")}>
          <Select
            size="small"
            value={selectedDistro}
            disabled={active || busy !== null}
            onChange={(event) => setDistro(event.target.value)}
            inputProps={{ "aria-label": t("overseer.location") }}
            sx={PICK_SX}
          >
            <MenuItem value="">{t("overseer.local")}</MenuItem>
            {distros.map((name) => (
              <MenuItem key={name} value={name}>
                WSL: {name}
              </MenuItem>
            ))}
          </Select>
        </Row>
      )}
      <Row label={t("overseer.control")}>
        <Typography variant="caption" role="status">
          {t(active ? "overseer.active" : "overseer.inactive")}
        </Typography>
        <PageButton disabled={busy !== null} onClick={() => void change()}>
          {t(busy ? `overseer.${busy}` : active ? "overseer.stop" : "overseer.start")}
        </PageButton>
      </Row>
      <Typography variant="caption" color="text.secondary">
        {t(selectedDistro ? "overseer.wslHelp" : "overseer.help")}
      </Typography>
      {error && (
        <Alert severity="error">
          {t("overseer.failed")} {error}
        </Alert>
      )}
    </Stack>
  );
}
