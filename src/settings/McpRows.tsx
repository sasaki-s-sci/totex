import { Alert, Button, Checkbox, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
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
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a fresh preparation.
  useEffect(() => {
    let alive = true;
    setSetup(null);
    setFailure(null);
    setCopied("idle");
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
    <Stack sx={{ gap: 0.5 }}>
      <Row label={`Codex · ${setup.environment}`}>
        <PageButton
          onClick={() => {
            void copyText(setup.command).then(
              () => setCopied("copied"),
              () => setCopied("failed"),
            );
          }}
        >
          {t(copied === "copied" ? "canvas.mcpCopied" : "canvas.mcpCopy")}
        </PageButton>
      </Row>
      <Typography
        component="pre"
        aria-label={t("canvas.mcpCommand")}
        sx={{
          m: 0,
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          userSelect: "text",
        }}
      >
        <code>{setup.command}</code>
      </Typography>
      {copied === "failed" && <Alert severity="error">{t("canvas.mcpCopyFailed")}</Alert>}
      <Typography variant="body2" color="text.secondary">
        {t("canvas.mcpHint")}
      </Typography>
    </Stack>
  );
}
