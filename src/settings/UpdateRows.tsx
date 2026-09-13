import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { askStanding, declare, type Layer, take, useUpdate } from "../lib/update";
import { UpdateMark } from "../marks";
import { PageButton } from "./Row";
import { standing } from "./updateReading";
import { VersionRow } from "./VersionRow";

/** A patch swaps the pages under the running app; a minor replaces the app and its terminals. */
const WORDS = {
  ephemeral: {
    name: "update.front",
    hint: "update.frontHint",
    blockedHint: "update.requiresRuntime",
  },
  persistent: {
    name: "update.runtime",
    hint: "update.runtimeHint",
    blockedHint: "update.unavailable",
  },
} as const;

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
      {(["ephemeral", "persistent"] as Layer[]).map((layer) => {
        const row = layer === "persistent" ? persistent : ephemeral;
        const press = at.presses[layer];
        const failed = press.stage === "failed";
        const stage = ["taking", "ready", "failed", "held"].includes(press.stage)
          ? press.stage
          : row.to || !row.target
            ? "rest"
            : "current";
        const words = WORDS[layer];
        return (
          <VersionRow
            key={layer}
            name={t(words.name)}
            hint={t(words.hint)}
            standing={row}
            blockedHint={t(words.blockedHint)}
            disabled={busy}
            onChange={(version) => {
              void declare([{ layer, version }]);
            }}
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
          </VersionRow>
        );
      })}
    </>
  );
}
