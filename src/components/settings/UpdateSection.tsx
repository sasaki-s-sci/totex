import { Divider, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { askStanding, declare, type Layer, take, useUpdate } from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";
import { compatibleChoices, standing } from "./updateReading";
import { VersionRow } from "./VersionRow";

export function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();
  useEffect(() => {
    void askStanding();
  }, []);
  const persistent = standing(at, "persistent");
  const ephemeral = standing(at, "ephemeral");
  if (!persistent || !ephemeral) return null;
  const busy = Object.values(at.presses).some(
    (press) => press.stage === "taking" || press.stage === "ready",
  );
  const range = (contract: string | null) =>
    compatibleChoices(at, contract)
      .map((choice) => choice.version)
      .join(", ") || "—";
  const currentContract =
    at.rungs?.find((rung) => rung.layer === "persistent")?.ephemeralContract ?? null;
  return (
    <>
      <Divider />
      <Row label={t("update.title")} />
      {(["persistent", "ephemeral"] as Layer[]).map((layer) => {
        const row = layer === "persistent" ? persistent : ephemeral;
        const press = at.presses[layer];
        const failed = press.stage === "failed";
        const stage = ["taking", "ready", "failed", "held"].includes(press.stage)
          ? press.stage
          : row.to || !row.target
            ? "rest"
            : "current";
        const hint =
          layer === "persistent"
            ? row.can
              ? t("update.runtimeMove", {
                  version: row.target?.version ?? row.at,
                  versions: range(row.target?.ephemeralContract ?? currentContract),
                })
              : t("update.held")
            : t("update.viewRange", { version: persistent.at, versions: range(currentContract) });
        return (
          <Stack key={layer} sx={{ gap: 0.5, pl: 1.5 }}>
            <Row
              label={t(
                layer === "persistent" ? "update.runtimeDescription" : "update.viewDescription",
              )}
              hint={
                failed
                  ? t("update.adjustFailed")
                  : press.stage === "held"
                    ? t("update.incompatible")
                    : undefined
              }
            >
              {row.can && (
                <PageButton
                  danger={failed || (layer === "persistent" && Boolean(row.to))}
                  disabled={busy || !row.target || (!row.to && !failed)}
                  icon={<UpdateMark stage={stage} progress={press.progress} />}
                  onClick={() => {
                    if (row.target) void take(layer, row.target.version);
                  }}
                >
                  {press.stage === "taking"
                    ? t("update.adjusting")
                    : press.stage === "ready"
                      ? t("update.ready")
                      : failed
                        ? t("update.failed")
                        : stage === "current"
                          ? t("update.current")
                          : layer === "persistent"
                            ? t("update.restart")
                            : t("update.apply")}
                </PageButton>
              )}
            </Row>
            <VersionRow
              name={t(`update.${layer}`)}
              standing={row}
              hint={hint}
              blockedHint={t(
                layer === "ephemeral" ? "update.requiresPersistent" : "update.unavailable",
              )}
              disabled={busy}
              onChange={(version) => {
                void declare([{ layer, version }]);
              }}
            />
          </Stack>
        );
      })}
    </>
  );
}
