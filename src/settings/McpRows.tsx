import { Alert, Button, Checkbox, Stack, Typography } from "@mui/material";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import { copyText } from "../lib/clipboard";
import { type McpSetup, prepareMcp } from "../lib/mcp";
import { PageButton, Row, TICK_SX } from "./Row";

export function McpRows({ cwd }: { cwd?: string }) {
  const { t } = useTranslation();
  const { mcpServing } = useAppSettings();
  return (
    <>
      <Row label={t("canvas.mcp")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={mcpServing}
          onChange={(event) => updateSettings({ mcpServing: event.target.checked })}
          slotProps={{ input: { "aria-label": t("canvas.mcp") } }}
        />
      </Row>
      {mcpServing && <SetupCommand key={cwd ?? ""} cwd={cwd} />}
    </>
  );
}

function SetupCommand({ cwd }: { cwd?: string }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<McpSetup | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a fresh preparation.
  useEffect(() => {
    let alive = true;
    setSetup(null);
    setFailure(null);
    const read = async () => {
      try {
        const next = await prepareMcp(cwd);
        if (!alive) return;
        if (next) setSetup(next);
        else setFailure(t("canvas.mcpUnavailable"));
      } catch (error) {
        if (alive) setFailure(String(error));
      }
    };
    void read();
    return () => {
      alive = false;
    };
  }, [cwd, retry, t]);

  if (failure !== null)
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" onClick={() => setRetry((value) => value + 1)}>
            {t("canvas.mcpRetry")}
          </Button>
        }
      >
        {t("canvas.mcpFailed")} {failure}
      </Alert>
    );
  if (!setup)
    return (
      <Typography variant="body2" color="text.secondary" role="status">
        {t("canvas.mcpPreparing")}
      </Typography>
    );
  return (
    <Stack sx={{ gap: 1.5, minWidth: 0 }}>
      <Row label={t("canvas.mcpEnvironment")}>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {setup.environment}
        </Typography>
      </Row>
      {(
        [
          ["codex", "Codex"],
          ["claude", "Claude Code"],
          ["opencode", "OpenCode"],
        ] as const
      ).map(([agent, name]) => (
        <AgentCommand
          key={`${agent}:${setup.commands[agent]}`}
          name={name}
          command={setup.commands[agent]}
        />
      ))}
    </Stack>
  );
}

function AgentCommand({ name, command }: { name: string; command: string }) {
  const { t } = useTranslation();
  const heading = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Stack component="section" aria-labelledby={heading} sx={{ gap: 0.75, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography component="h3" id={heading} variant="body2" sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
        <PageButton
          title={t("canvas.mcpCopyNamed", { agent: name })}
          onClick={() => {
            void copyText(command).then(
              () => setCopied("copied"),
              () => setCopied("failed"),
            );
          }}
        >
          <Typography
            component="span"
            variant="inherit"
            sx={{ color: "text.primary" }}
            aria-live="polite"
          >
            {t(copied === "copied" ? "canvas.mcpCopied" : "canvas.mcpCopy")}
          </Typography>
        </PageButton>
      </Stack>
      <Typography
        component="pre"
        aria-label={t("canvas.mcpCommand", { agent: name })}
        sx={{
          m: 0,
          p: 1,
          bgcolor: "action.hover",
          borderRadius: 0.5,
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          userSelect: "text",
        }}
      >
        <code>{command}</code>
      </Typography>
      {copied === "failed" && <Alert severity="error">{t("canvas.mcpCopyFailed")}</Alert>}
    </Stack>
  );
}
