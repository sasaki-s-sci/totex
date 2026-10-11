import { Alert, Checkbox, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverseer } from "../hooks/useOverseer";
import { overseerDistros, scopeOf, startOverseer, stopOverseer } from "../lib/overseer";
import { Row, TICK_SX } from "./Row";

/** This machine is the empty name, so a scope can key state and pass straight to the commands. */
const LOCAL = "";

/**
 * One box per environment: this machine, and each WSL distribution. A ticked box runs a monitoring
 * agent inside that environment, watching that environment's terminals and no others.
 */
export function OverseerRow() {
  const { t } = useTranslation();
  const { sessions } = useOverseer();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const running = new Set(sessions.map((id) => scopeOf(id) ?? LOCAL));

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

  async function change(scope: string, on: boolean) {
    if (busy.has(scope)) return;
    setBusy((current) => new Set(current).add(scope));
    setError(null);
    try {
      if (on) await startOverseer(scope || null);
      else await stopOverseer(scope || null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(scope);
        return next;
      });
    }
  }

  const scopes = [LOCAL, ...distros];
  return (
    <Stack sx={{ gap: 0.5 }}>
      {scopes.map((scope) => {
        const label = scope ? t("overseer.wsl", { name: scope }) : t("overseer.local");
        const on = running.has(scope);
        return (
          <Row key={scope} label={label}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption" role="status">
                {busy.has(scope)
                  ? t(on ? "overseer.stopping" : "overseer.starting")
                  : t(on ? "overseer.active" : "overseer.inactive")}
              </Typography>
              <Checkbox
                size="small"
                sx={TICK_SX}
                checked={on}
                disabled={busy.has(scope)}
                onChange={(event) => void change(scope, event.target.checked)}
                slotProps={{ input: { "aria-label": label } }}
              />
            </Stack>
          </Row>
        );
      })}
      <Typography variant="caption" color="text.secondary">
        {t("overseer.help")}
      </Typography>
      {distros.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t("overseer.wslHelp")}
        </Typography>
      )}
      {error && (
        <Alert severity="error">
          {t("overseer.failed")} {error}
        </Alert>
      )}
    </Stack>
  );
}
