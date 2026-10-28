import { Box, Button, Popover, Stack, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import { type MonitorPreview, type MonitorText, monitorShows } from "../lib/appSettingsModel";
import { estimateMinutes, type Glance, isAgent, type MonitorSnapshot, shownStatus } from "./model";
import {
  useMonitorError,
  useMonitorGlance,
  useMonitorHistory,
  useMonitorSnapshot,
} from "./runtime";
import "./monitor.css";

/** The text beside the badge: the agent's summary or the running command, or nothing. */
function summaryOf(
  text: MonitorText,
  glance: Glance | undefined,
  running: string | null,
  snapshot: MonitorSnapshot | undefined,
  shown: (item: keyof MonitorPreview) => boolean,
): string | null {
  if (text === "none") return null;
  if (text === "stdio") return glance?.said || null;
  // The user's request has its own row above; it must not fall back into this one.
  return running ?? ((shown("taskSummary") && snapshot?.taskSummary) || null);
}

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
export function MonitorBadge({ id, workers = true }: { id: string; workers?: boolean }) {
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
  const shown = (item: keyof MonitorPreview) => monitorShows(monitor, item);
  const error = runtimeError ?? snapshot?.error ?? refreshError;
  const agent = isAgent(glance);
  const status = shownStatus(glance, snapshot);
  const estimate = estimateMinutes(snapshot?.estimate ?? null);
  // A command is summed up by the process running it, never by what was typed or printed.
  const running = agent ? null : glance?.running || null;
  const summary = summaryOf(monitor.text, glance, running, snapshot, shown);
  const request =
    agent && monitor.text !== "none" && shown("requestSummary")
      ? snapshot?.requestSummary || null
      : null;
  const agents = workers && shown("agents") && snapshot && snapshot.agents.length > 0 && (
    <AgentChips agents={snapshot.agents} />
  );
  // Top row first: a single line of output is the first line, not the bottom one.
  const terminalLines = [...(glance?.tail ?? "").split("\n").slice(-2), "", ""].slice(0, 2);
  return (
    <>
      <button
        type="button"
        className="monitor-badge"
        data-status={status}
        data-width={monitor.previewWidth}
        aria-label={`${t("monitor.title")} · ${t(`monitor.states.${status}`)}`}
        aria-expanded={Boolean(anchor)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        title={
          [request, agent ? summary : glance?.tail, error].filter(Boolean).join("\n") ||
          t(`monitor.states.${status}`)
        }
      >
        {agent ? (
          <>
            <span className="monitor-badge__row" data-role="request">
              <PromptIcon />
              {request && <span className="monitor-badge__summary">{request}</span>}
            </span>
            <span className="monitor-badge__row" data-status={status}>
              <StatusIcon status={status} />
              {summary && <span className="monitor-badge__summary">{summary}</span>}
              {shown("goal") && snapshot?.goal && (
                <span className="monitor-badge__extra">
                  {t(`monitor.goals.${snapshot.goal.status}`)}
                </span>
              )}
              {shown("estimate") && estimate !== null && (
                <span className="monitor-badge__extra">≈{estimate}m</span>
              )}
              {agents}
            </span>
          </>
        ) : (
          ["previous", "last"].map((row, at) => (
            <span
              key={row}
              className="monitor-badge__row"
              data-role="terminal"
              data-status={status}
            >
              <span className="monitor-badge__summary">{terminalLines[at]}</span>
            </span>
          ))
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

/** The prompt the user's request is typed after; shown from the first render, before any request. */
function PromptIcon() {
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
      <path d="m5 3.5 4.5 4.5L5 12.5" />
    </svg>
  );
}

const KIND_PATHS = {
  monitor:
    "M1.5 8C3 5.4 5.3 4 8 4s5 1.4 6.5 4C13 10.6 10.7 12 8 12S3 10.6 1.5 8Zm4.5 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z",
  subagent: "M6 1v4M2 10V5h8v5",
  background: "M6 3v3l2 1M6 1a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
  shell: "M2.5 3.5 5.5 6l-3 2.5M7 10.5h4.5",
} as const;
const KINDS = ["monitor", "subagent", "background", "shell"] as const;

/** Worker indicators shared by compact summaries and expanded agent pages. */
export function MonitorAgents({ id }: { id: string }) {
  const { monitor } = useAppSettings();
  const snapshot = useMonitorSnapshot(id);
  const glance = useMonitorGlance(id);
  if (
    !monitor.enabled ||
    !monitorShows(monitor, "agents") ||
    !isAgent(glance) ||
    !snapshot?.agents.length
  )
    return null;
  return <AgentChips agents={snapshot.agents} />;
}

/** Each kind of observed worker as a chip: its glyph, how many, and the most pressing state of them. */
function AgentChips({ agents }: { agents: MonitorSnapshot["agents"] }) {
  const { t } = useTranslation();
  return (
    <span className="monitor-badge__count">
      {KINDS.map((kind) => {
        const same = agents.filter((agent) => agent.kind === kind);
        if (same.length === 0) return null;
        const pressing = same.find((agent) =>
          ["permission", "running", "failure"].includes(agent.status),
        );
        const title = same
          .map((agent) => `${agent.label || agent.detail} · ${t(`monitor.states.${agent.status}`)}`)
          .join("\n");
        return (
          <span
            key={kind}
            className="monitor-role"
            role="img"
            aria-label={`${t(`monitor.kinds.${kind}`)} ${same.length}`}
            title={title}
            data-kind={kind}
            data-status={pressing?.status ?? same[0].status}
          >
            <svg
              aria-hidden="true"
              width="8"
              height="8"
              viewBox={kind === "monitor" ? "0 0 16 16" : "0 0 12 12"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <path d={KIND_PATHS[kind]} />
            </svg>
            {same.length}
          </span>
        );
      })}
    </span>
  );
}
