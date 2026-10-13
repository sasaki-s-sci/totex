import { Alert, Checkbox, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import type { MonitorFeatures, MonitorPatch } from "../lib/appSettingsModel";
import { useMonitorError } from "../monitor/runtime";
import { Group, Row, TICK_SX } from "./Row";

export function MonitorRows() {
  const { t } = useTranslation();
  const { monitor } = useAppSettings();
  const error = useMonitorError();
  const [argsDraft, setArgsDraft] = useState<string | null>(null);
  const [argsError, setArgsError] = useState(false);
  const set = (patch: MonitorPatch) => updateSettings({ monitor: patch });
  const field = (key: "command" | "model") => (
    <MonitorField
      value={monitor[key]}
      label={t(`monitor.${key}`)}
      placeholder={key === "model" ? t("monitor.default") : "agent-acp"}
      onCommit={(value) => set({ [key]: value })}
    />
  );
  return (
    <>
      <Row label={t("monitor.enabled")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={monitor.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
          slotProps={{ input: { "aria-label": t("monitor.enabled") } }}
        />
      </Row>
      <Group name={t("monitor.agent")}>
        <Row label={t("monitor.command")}>{field("command")}</Row>
        <Row label={t("monitor.args")}>
          <TextField
            size="small"
            value={argsDraft ?? JSON.stringify(monitor.args)}
            error={argsError}
            helperText={argsError ? t("monitor.argsInvalid") : undefined}
            onChange={(event) => {
              setArgsDraft(event.target.value);
              try {
                const args: unknown = JSON.parse(event.target.value);
                if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
                  throw new Error();
                setArgsError(false);
              } catch {
                setArgsError(true);
              }
            }}
            onBlur={() => {
              if (!argsError && argsDraft !== null) {
                set({ args: JSON.parse(argsDraft) });
                setArgsDraft(null);
              }
            }}
            slotProps={{ htmlInput: { "aria-label": t("monitor.args") } }}
            sx={{ width: 180, "& input": { py: 0.5 } }}
          />
        </Row>
        <Row label={t("monitor.model")}>{field("model")}</Row>
        <Row label={t("monitor.interval")}>
          <MonitorField
            value={String(monitor.intervalSecs)}
            label={t("monitor.interval")}
            numeric
            onCommit={(value) => {
              const parsed = Number(value);
              if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 3600)
                set({ intervalSecs: Math.round(parsed) });
            }}
          />
        </Row>
      </Group>
      <Group name={t("monitor.features")}>
        {(Object.keys(monitor.features) as (keyof MonitorFeatures)[]).map((feature) => (
          <Row key={feature} label={t(`monitor.${feature}`)}>
            <Checkbox
              size="small"
              sx={TICK_SX}
              checked={monitor.features[feature]}
              onChange={(event) => set({ features: { [feature]: event.target.checked } })}
              slotProps={{ input: { "aria-label": t(`monitor.${feature}`) } }}
            />
          </Row>
        ))}
      </Group>
      {monitor.enabled && !monitor.command.trim() && (
        <Alert severity="info">{t("monitor.commandRequired")}</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );
}

function MonitorField({
  value,
  label,
  placeholder,
  numeric,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  numeric?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid =
    numeric && (!Number.isFinite(Number(draft)) || Number(draft) < 10 || Number(draft) > 3600);
  const commit = () => {
    if (!invalid && draft !== value) onCommit(draft);
  };
  return (
    <TextField
      size="small"
      type={numeric ? "number" : "text"}
      value={draft}
      error={Boolean(invalid)}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      slotProps={{ htmlInput: { "aria-label": label, ...(numeric ? { min: 10, max: 3600 } : {}) } }}
      sx={{ width: numeric ? 90 : 180, "& input": { py: 0.5 } }}
    />
  );
}
