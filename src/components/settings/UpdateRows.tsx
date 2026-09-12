import { Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { askStanding, declare, type Layer, take, useUpdate } from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";
import { standing } from "./updateReading";
import { VersionRow } from "./VersionRow";

/**
 * The two halves of the app, each with the press that moves it and the pin
 * that says where to. Nothing is explained beside them: which half is which is
 * said by its name, and what a press would do by the word on it.
 */
export function UpdateRows() {
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
  return (
    <>
      {(["persistent", "ephemeral"] as Layer[]).map((layer) => {
        const row = layer === "persistent" ? persistent : ephemeral;
        const press = at.presses[layer];
        const failed = press.stage === "failed";
        const stage = ["taking", "ready", "failed", "held"].includes(press.stage)
          ? press.stage
          : row.to || !row.target
            ? "rest"
            : "current";
        return (
          <Stack key={layer} sx={{ gap: 0.5 }}>
            <Row
              label={t(
                layer === "persistent" ? "update.runtimeDescription" : "update.viewDescription",
              )}
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
