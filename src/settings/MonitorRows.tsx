import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  createFilterOptions,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import {
  defaultModel,
  MONITOR_AGENTS,
  MONITOR_PREVIEW_WIDTHS,
  MONITOR_PROFILES,
  MONITOR_TEXTS,
  type MonitorAgent,
  type MonitorFeatures,
  type MonitorPatch,
  type MonitorPreview,
  type MonitorPreviewWidth,
  type MonitorProfile,
  type MonitorText,
} from "../lib/appSettingsModel";
import { agentLabel, type MonitorModel, useMonitorModels } from "../monitor/models";
import { useMonitorError } from "../monitor/runtime";
import { Group, PICK_SX, Row, TICK_SX } from "./Row";
import { Callout } from "./SettingsMap";

const FIELD_WIDTH = 200;

export function MonitorRows() {
  const { t } = useTranslation();
  const { monitor } = useAppSettings();
  const error = useMonitorError();
  const [argsDraft, setArgsDraft] = useState<string | null>(null);
  const [argsError, setArgsError] = useState(false);
  const set = (patch: MonitorPatch) => updateSettings({ monitor: patch });
  const custom = monitor.agent === "custom";
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
      <Row label={t("monitor.agentsOnly")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={monitor.agentsOnly}
          onChange={(event) => set({ agentsOnly: event.target.checked })}
          slotProps={{ input: { "aria-label": t("monitor.agentsOnly") } }}
        />
      </Row>
      <Group name={t("monitor.agent")}>
        <Row label={t("monitor.cli")}>
          <Select
            size="small"
            value={monitor.agent}
            inputProps={{ "aria-label": t("monitor.cli") }}
            // A model id belongs to one agent, so switching starts from the new agent's default.
            onChange={(event) => {
              const agent = event.target.value as MonitorAgent;
              set({ agent, model: defaultModel(agent) });
            }}
            sx={{ ...PICK_SX, width: FIELD_WIDTH }}
          >
            {MONITOR_AGENTS.map((agent) => (
              <MenuItem key={agent} value={agent}>
                {agentLabel(agent, t("monitor.custom"))}
              </MenuItem>
            ))}
          </Select>
        </Row>
        {custom && (
          <>
            <Row label={t("monitor.command")}>
              <MonitorField
                value={monitor.command}
                label={t("monitor.command")}
                placeholder="agent-acp"
                onCommit={(command) => set({ command })}
              />
            </Row>
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
                sx={{ width: FIELD_WIDTH, "& input": { py: 0.5 } }}
              />
            </Row>
          </>
        )}
        <ModelRow />
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
      <Callout parts={["monitor"]} name={t("monitor.preview")}>
        <Row label={t("monitor.text")}>
          <Select
            size="small"
            value={monitor.text}
            inputProps={{ "aria-label": t("monitor.text") }}
            onChange={(event) => set({ text: event.target.value as MonitorText })}
            sx={{ ...PICK_SX, width: FIELD_WIDTH }}
          >
            {MONITOR_TEXTS.map((text) => (
              <MenuItem key={text} value={text}>
                {t(`monitor.texts.${text}`)}
              </MenuItem>
            ))}
          </Select>
        </Row>
        <Row label={t("monitor.previewWidth")}>
          <Select
            size="small"
            value={monitor.previewWidth}
            inputProps={{ "aria-label": t("monitor.previewWidth") }}
            onChange={(event) =>
              set({ previewWidth: Number(event.target.value) as MonitorPreviewWidth })
            }
            sx={{ ...PICK_SX, width: 90 }}
          >
            {MONITOR_PREVIEW_WIDTHS.map((width) => (
              <MenuItem key={width} value={width}>
                {width}px
              </MenuItem>
            ))}
          </Select>
        </Row>
        {(Object.keys(monitor.preview) as (keyof MonitorPreview)[]).map((item) => (
          <Row key={item} label={t(`monitor.${item}`)}>
            <Checkbox
              size="small"
              sx={TICK_SX}
              disabled={!monitor.features[item]}
              checked={monitor.preview[item]}
              onChange={(event) => set({ preview: { [item]: event.target.checked } })}
              slotProps={{
                input: { "aria-label": `${t("monitor.preview")} ${t(`monitor.${item}`)}` },
              }}
            />
          </Row>
        ))}
      </Callout>
      <Group name={t("monitor.browser")}>
        <Row label={t("monitor.browserEnabled")}>
          <Checkbox
            size="small"
            sx={TICK_SX}
            checked={monitor.browser.enabled}
            onChange={(event) => set({ browser: { enabled: event.target.checked } })}
            slotProps={{ input: { "aria-label": t("monitor.browserEnabled") } }}
          />
        </Row>
        <Row label={t("monitor.browserProfile")}>
          <Select
            size="small"
            value={monitor.browser.profile}
            inputProps={{ "aria-label": t("monitor.browserProfile") }}
            onChange={(event) =>
              set({ browser: { profile: event.target.value as MonitorProfile } })
            }
            sx={{ ...PICK_SX, width: FIELD_WIDTH }}
          >
            {MONITOR_PROFILES.map((profile) => (
              <MenuItem key={profile} value={profile}>
                {t(`monitor.profiles.${profile}`)}
              </MenuItem>
            ))}
          </Select>
        </Row>
        <Row label={t("monitor.browserUrl")}>
          <MonitorField
            value={monitor.browser.allowedUrl}
            label={t("monitor.browserUrl")}
            placeholder="http://localhost:*/*"
            onCommit={(allowedUrl) => set({ browser: { allowedUrl } })}
          />
        </Row>
      </Group>
      {monitor.enabled && custom && !monitor.command.trim() && (
        <Alert severity="info">{t("monitor.commandRequired")}</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );
}

const filterModels = createFilterOptions<MonitorModel>({
  stringify: (model) => `${model.name} ${model.id} ${model.description ?? ""}`,
});

/** Picks from the agent's own model list, but a typed id is kept even when the list fails. */
function ModelRow() {
  const { t } = useTranslation();
  const { monitor } = useAppSettings();
  const models = useMonitorModels(monitor);
  const [draft, setDraft] = useState(monitor.model);
  useEffect(() => setDraft(monitor.model), [monitor.model]);
  const commit = (model: string) => {
    const next = model.trim();
    setDraft(next);
    if (next !== monitor.model) updateSettings({ monitor: { model: next } });
  };
  // Autocomplete resets its text whenever the value's identity changes, so the options must
  // stay the same objects between renders or typing would be wiped on the next one.
  const list = models.list;
  const options = useMemo<MonitorModel[]>(
    () => [
      // The default entry names the model the agent would pick on its own, when it says.
      { id: "", name: t("monitor.default"), description: list?.current ?? null },
      ...(list?.models ?? []),
    ],
    [t, list],
  );
  const value = options.find((option) => option.id === monitor.model) ?? monitor.model;
  return (
    <Stack sx={{ gap: 0.25 }}>
      <Row label={t("monitor.model")}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
          <Autocomplete<MonitorModel, false, false, true>
            freeSolo
            size="small"
            options={options}
            value={value}
            inputValue={draft}
            onInputChange={(_, next) => setDraft(next)}
            onChange={(_, next) => commit(typeof next === "string" ? next : (next?.id ?? ""))}
            onBlur={() => commit(draft)}
            filterOptions={filterModels}
            getOptionLabel={(option) => (typeof option === "string" ? option : option.id)}
            isOptionEqualToValue={(option, chosen) =>
              option.id === (typeof chosen === "string" ? chosen : chosen.id)
            }
            renderOption={({ key, ...props }, option) => (
              <Box component="li" key={key || "default"} {...props}>
                <Stack sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {option.name || option.id}
                  </Typography>
                  {(option.id || option.description) && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {[option.id !== option.name ? option.id : "", option.description]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t("monitor.default")}
                slotProps={{
                  ...params.slotProps,
                  htmlInput: { ...params.slotProps.htmlInput, "aria-label": t("monitor.model") },
                }}
              />
            )}
            slotProps={{
              listbox: { sx: { maxHeight: 280 } },
              // Descriptions need more room than the field; grow leftwards from its right edge.
              popper: { placement: "bottom-end", sx: { minWidth: 300 } },
            }}
            sx={{
              width: FIELD_WIDTH,
              // Match the height of the other small fields in a settings row.
              "&& .MuiOutlinedInput-root.MuiInputBase-sizeSmall": { py: "1.5px" },
            }}
          />
        </Stack>
      </Row>
      {models.status === "failed" && (
        <Typography
          variant="caption"
          color="error"
          sx={{ alignSelf: "flex-end", maxWidth: FIELD_WIDTH + 24, overflowWrap: "anywhere" }}
        >
          {models.error}
        </Typography>
      )}
    </Stack>
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
      sx={{ width: numeric ? 90 : FIELD_WIDTH, "& input": { py: 0.5 } }}
    />
  );
}
