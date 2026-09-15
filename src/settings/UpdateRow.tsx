import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  askStanding,
  declare,
  type Layer,
  reading,
  take,
  type UpdateStage,
  useUpdate,
} from "../lib/update";
import { UpdateMark } from "../marks";
import { PageButton } from "./Row";
import { VersionRow } from "./VersionRow";

/**
 * One button per layer. A patch swaps the pages under the running app; a minor
 * installs and restarts the app, and every terminal goes with it.
 */
const BUTTONS = {
  ephemeral: "update.patch",
  persistent: "update.minor",
} as const satisfies Record<Layer, string>;

export function UpdateRow() {
  const { t } = useTranslation();
  const at = useUpdate();
  useEffect(() => {
    void askStanding();
  }, []);
  const read = reading(at);
  if (!read) return null;
  const busy = Object.values(at.presses).some(
    (press) => press.stage === "taking" || press.stage === "ready",
  );
  return (
    <VersionRow
      read={read}
      disabled={busy}
      onChange={(version) => {
        void declare(version);
      }}
    >
      {(["ephemeral", "persistent"] as Layer[]).map((layer) => {
        const target = layer === "ephemeral" ? read.patch : read.minor;
        const there = layer === "ephemeral" ? read.at : read.app;
        const press = at.presses[layer];
        const failed = press.stage === "failed";
        const stage: UpdateStage = ["taking", "ready", "failed", "held"].includes(press.stage)
          ? press.stage
          : target && target.version !== there
            ? "rest"
            : "current";
        const moves = Boolean(target) && target?.version !== there;
        return (
          <PageButton
            key={layer}
            danger={failed || (layer === "persistent" && moves)}
            disabled={busy || !target || (!moves && !failed)}
            icon={<UpdateMark stage={stage} progress={press.progress} />}
            onClick={() => {
              if (target) void take(layer, target.version);
            }}
          >
            {press.stage === "taking"
              ? t("update.adjusting")
              : press.stage === "ready"
                ? t("update.ready")
                : failed
                  ? t("update.failed")
                  : t(moves ? "update.take" : target ? "update.kept" : "update.none", {
                      kind: t(BUTTONS[layer]),
                      version: target?.version,
                    })}
          </PageButton>
        );
      })}
    </VersionRow>
  );
}
