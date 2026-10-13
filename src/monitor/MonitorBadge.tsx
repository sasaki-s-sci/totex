import { Box, Button, Popover, Stack, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import { type AgentStatus, agentCounts, estimateMinutes } from "./model";
import { agentLabel } from "./models";
import { useMonitorError, useMonitorSnapshot } from "./runtime";
import "./monitor.css";

function StatusIcon({ status }: { status: string }) {
  const path =
    status === "success" || status === "complete"
      ? "m4 8 3 3 5-6"
      : status === "failure"
        ? "m5 5 6 6m0-6-6 6"
        : status === "permission"
          ? "M8 3v6m0 3v1"
          : status === "running" || status === "active"
            ? "m6 4 6 4-6 4Z"
            : status === "stopped" || status === "paused"
              ? "M5 4v8m6-8v8"
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
  const runtimeError = useMonitorError();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { t } = useTranslation();
  if (!monitor.enabled) return null;
  const features = monitor.features;
  const status: AgentStatus = snapshot?.status ?? "unknown";
  const error = runtimeError ?? snapshot?.error ?? refreshError;
  const counts = snapshot ? agentCounts(snapshot.agents) : null;
  const estimate = estimateMinutes(snapshot?.estimate ?? null);
  const inferred = !snapshot || snapshot.source === "inferred";
  const summary =
    (features.taskSummary && snapshot?.taskSummary) ||
    (features.requestSummary && snapshot?.requestSummary);
  const observer = snapshot?.monitorStatus ?? "idle";
  return (
    <>
      <button
        type="button"
        className={`monitor-badge nodrag nopan${canvas ? " monitor-badge--canvas" : ""}`}
        data-status={error ? "failure" : features.status ? status : observer}
        aria-label={t("monitor.title")}
        aria-expanded={Boolean(anchor)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        title={summary || error || t("monitor.title")}
      >
        <StatusIcon status={error ? "failure" : features.status ? status : observer} />
        <span className="monitor-badge__status">
          {error
            ? t("monitor.states.failure")
            : features.status
              ? `${inferred ? "≈ " : ""}${t(`monitor.states.${status}`)}`
              : "monitor"}
        </span>
        {features.agents && counts && (
          <span
            className="monitor-badge__count"
            title={`monitor ${counts.monitor} · shell ${counts.shell} · subagent ${counts.subagent} · background ${counts.background}`}
          >
            <RoleCount kind="monitor" count={counts.monitor} />
            <RoleCount kind="shell" count={counts.shell} />
            {counts.subagent > 0 && <RoleCount kind="subagent" count={counts.subagent} />}
            {counts.background > 0 && <RoleCount kind="background" count={counts.background} />}
          </span>
        )}
        {features.goal && snapshot?.goal && (
          <span className="monitor-badge__extra">{t(`monitor.goals.${snapshot.goal.status}`)}</span>
        )}
        {summary && <span className="monitor-badge__summary">{summary}</span>}
        {features.estimate && estimate !== null && (
          <span className="monitor-badge__extra">≈{estimate}m</span>
        )}
      </button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, width: 340, maxWidth: "calc(100vw - 24px)" } } }}
      >
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle2">{t("monitor.title")}</Typography>
            <Button
              size="small"
              disabled={observer === "running" || !snapshot}
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
          <Typography variant="caption" color="text.secondary" className="monitor-observer">
            {agentLabel(monitor.agent, monitor.command.trim() || t("monitor.custom"))} ·{" "}
            {monitor.model || t("monitor.default")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {snapshot?.environment ?? t("monitor.waiting")} · monitor{" "}
            {t(`monitor.observer.${observer}`)}
          </Typography>
          {features.status && (
            <Typography variant="body2" className="monitor-state" data-status={status}>
              <StatusIcon status={status} />
              {t(`monitor.states.${status}`)} ·{" "}
              {t(inferred ? "monitor.inferred" : "monitor.observed")}
            </Typography>
          )}
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
          {features.agents && counts && (
            <>
              <Typography variant="caption" color="text.secondary">
                monitor {counts.monitor} · shell {counts.shell} · subagent{" "}
                {snapshot?.updatedAt ? counts.subagent : "?"} · background{" "}
                {snapshot?.updatedAt ? counts.background : "?"}
              </Typography>
              <Stack spacing={0.5}>
                {snapshot?.agents.map((agent) => (
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
            </>
          )}
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
          {snapshot?.updatedAt ? (
            <Typography variant="caption" color="text.secondary">
              {t("monitor.updated")} {new Date(snapshot.updatedAt).toLocaleTimeString()}
            </Typography>
          ) : null}
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

function RoleCount({
  kind,
  count,
}: {
  kind: "monitor" | "shell" | "subagent" | "background";
  count: number;
}) {
  const path =
    kind === "monitor"
      ? "M1 2h10v7H1ZM4 11h4M6 9v2"
      : kind === "shell"
        ? "m2 3 3 3-3 3m5 0h3"
        : kind === "subagent"
          ? "M6 1v4M2 10V5h8v5"
          : "M6 3v3l2 1M6 1a5 5 0 1 0 0 10 5 5 0 0 0 0-10";
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
