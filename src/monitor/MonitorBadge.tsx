import { Box, Button, Popover, Stack, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import type { MonitorPreview } from "../lib/appSettingsModel";
import { agentCounts, estimateMinutes, isAgent, shownStatus } from "./model";
import {
  useMonitorError,
  useMonitorGlance,
  useMonitorHistory,
  useMonitorSnapshot,
} from "./runtime";
import "./monitor.css";

/** Running spins, asking asks and failing crosses; the colour comes from `data-status`. */
function StatusIcon({ status }: { status: string }) {
  if (status === "running")
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" className="monitor-spin">
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <path
          d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  const path =
    status === "success" || status === "complete"
      ? "m4 8 3 3 5-6"
      : status === "failure"
        ? "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-2.5 4 5 5m0-5-5 5"
        : status === "permission"
          ? "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.3v.2"
          : status === "stopped" || status === "paused"
            ? "M5 4v8m6-8v8"
            : status === "initial"
              ? "M8 5v6M5 8h6"
              : status === "idle"
                ? "M4 8h8"
                : "M6 5a2 2 0 1 1 3 2c-1 1-1 1-1 2m0 2v1";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
export function MonitorBadge({ id, canvas = false }: { id: string; canvas?: boolean }) {
  const { monitor } = useAppSettings();
  const snapshot = useMonitorSnapshot(id);
  const glance = useMonitorGlance(id);
  const history = useMonitorHistory(id);
  const runtimeError = useMonitorError();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { t } = useTranslation();
  if (!monitor.enabled) return null;
  const features = monitor.features;
  const shown = (item: keyof MonitorPreview) => features[item] && monitor.preview[item];
  const error = runtimeError ?? snapshot?.error ?? refreshError;
  const status = error ? "failure" : shownStatus(glance, snapshot);
  const agent = isAgent(glance);
  const counts = snapshot ? agentCounts(snapshot.agents) : null;
  const estimate = estimateMinutes(snapshot?.estimate ?? null);
  // A command is summed up by the process running it, never by what was typed or printed.
  const running = agent ? null : glance?.running || null;
  // The text is the agent's own summary, the line typed at the terminal, or nothing at all.
  const summary =
    monitor.text === "none"
      ? null
      : monitor.text === "stdio"
        ? glance?.said || null
        : (running ??
          ((shown("taskSummary") && snapshot?.taskSummary) ||
            (shown("requestSummary") && snapshot?.requestSummary) ||
            null));
  return (
    <>
      <button
        type="button"
        className={`monitor-badge nodrag nopan${canvas ? " monitor-badge--canvas" : ""}`}
        data-status={status}
        data-width={monitor.previewWidth}
        aria-label={`${t("monitor.title")} · ${t(`monitor.states.${status}`)}`}
        aria-expanded={Boolean(anchor)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        title={summary || error || t(`monitor.states.${status}`)}
      >
        <StatusIcon status={status} />
        {agent && shown("agents") && counts && (
          <span
            className="monitor-badge__count"
            title={`shell ${counts.shell} · subagent ${counts.subagent} · background ${counts.background}`}
          >
            {counts.subagent > 0 && <RoleCount kind="subagent" count={counts.subagent} />}
            {counts.background > 0 && <RoleCount kind="background" count={counts.background} />}
          </span>
        )}
        {agent && shown("goal") && snapshot?.goal && (
          <span className="monitor-badge__extra">{t(`monitor.goals.${snapshot.goal.status}`)}</span>
        )}
        {summary && <span className="monitor-badge__summary">{summary}</span>}
        {agent && shown("estimate") && estimate !== null && (
          <span className="monitor-badge__extra">≈{estimate}m</span>
        )}
      </button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, width: 360, maxWidth: "calc(100vw - 24px)" } } }}
      >
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="body2" className="monitor-state" data-status={status}>
              <StatusIcon status={status} />
              {t(`monitor.states.${status}`)}
            </Typography>
            <Button
              size="small"
              disabled={snapshot?.monitorStatus === "running" || !snapshot}
              onClick={() => {
                setRefreshError(null);
                void invoke("monitor_refresh", { id }).catch((reason) =>
                  setRefreshError(String(reason)),
                );
              }}
            >
              {t("monitor.refresh")}
            </Button>
          </Stack>
          {running && <Detail label={t("monitor.running")} value={running} />}
          {features.requestSummary && (
            <Detail
              label={t("monitor.requestSummary")}
              value={snapshot?.requestSummary || t("monitor.unknown")}
            />
          )}
          {features.taskSummary && (
            <Detail
              label={t("monitor.taskSummary")}
              value={snapshot?.taskSummary || t("monitor.unknown")}
            />
          )}
          {features.goal && snapshot?.goal && (
            <Detail
              label={`${t("monitor.goal")} · ${t(`monitor.goals.${snapshot.goal.status}`)}`}
              value={snapshot.goal.summary}
            />
          )}
          {features.estimate && (
            <Detail
              label={t("monitor.estimate")}
              value={
                estimate === null
                  ? t("monitor.unknown")
                  : t("monitor.estimateValue", {
                      minutes: estimate,
                      confidence: t(
                        `monitor.confidence.${snapshot?.estimate?.confidence ?? "low"}`,
                      ),
                    })
              }
            />
          )}
          {features.agents && snapshot && snapshot.agents.length > 0 && (
            <Stack spacing={0.5}>
              {snapshot.agents.map((agent) => (
                <Box
                  key={agent.id}
                  className="monitor-agent"
                  data-status={agent.status}
                  title={agent.detail}
                >
                  <StatusIcon status={agent.status} />
                  <span className="monitor-agent__kind">
                    {agent.source === "observed" ? "" : "≈ "}
                    {agent.kind}
                  </span>
                  <span className="monitor-agent__label">{agent.label || agent.detail}</span>
                  <span>
                    {t(`monitor.states.${agent.status}`)}
                    {agent.progress == null ? "" : ` ${Math.round(agent.progress)}%`}
                  </span>
                  {agent.detail && agent.detail !== agent.label && (
                    <span className="monitor-agent__detail">{agent.detail}</span>
                  )}
                </Box>
              ))}
            </Stack>
          )}
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
          {history.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("monitor.history")}
              </Typography>
              <Box className="monitor-history">
                {history.map((entry) => (
                  <Box key={entry.at} className="monitor-history__row" data-status={entry.status}>
                    <time>{new Date(entry.at).toLocaleTimeString()}</time>
                    <span>{t(`monitor.states.${entry.status}`)}</span>
                    <span className="monitor-history__text">{entry.text ?? ""}</span>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </Popover>
    </>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {value}
      </Typography>
    </Box>
  );
}

function RoleCount({ kind, count }: { kind: "subagent" | "background"; count: number }) {
  const path =
    kind === "subagent" ? "M6 1v4M2 10V5h8v5" : "M6 3v3l2 1M6 1a5 5 0 1 0 0 10 5 5 0 0 0 0-10";
  return (
    <span className="monitor-role" role="img" aria-label={`${kind} ${count}`}>
      <svg
        aria-hidden="true"
        width="9"
        height="9"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        <path d={path} />
      </svg>
      {count}
    </span>
  );
}
