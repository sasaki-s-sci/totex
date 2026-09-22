import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  askChoices,
  declare,
  type Layer,
  layerOf,
  reading,
  take,
  type UpdateStage,
  useUpdate,
} from "../lib/update";
import { UpdateMark } from "../marks";
import { PageButton } from "./Row";
import { VersionRow } from "./VersionRow";

/**
 * One button per cost. A patch stays on the running line and keeps every
 * terminal: the pages are swapped under the running app, or the program is
 * installed and the window reopened. A minor installs and restarts the app,
 * and every terminal goes with it.
 */
type Cost = "patch" | "minor";
const BUTTONS = { patch: "update.patch", minor: "update.minor" } as const satisfies Record<
  Cost,
  string
>;

export function UpdateRow() {
  const { t } = useTranslation();
  const at = useUpdate();
  // Opening the page is looking for a release, so the list is asked for again rather than
  // left at whatever the last round of the poll found.
  useEffect(() => {
    void askChoices();
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
      {(["patch", "minor"] as Cost[]).map((cost) => {
        const target = cost === "patch" ? read.patch : read.minor;
        const there = cost === "patch" ? read.at : read.app;
        // Which layer brings it is the release's to say; a patch is taken by either.
        const layer: Layer =
          (target && layerOf(at, target)) ?? (cost === "patch" ? "ephemeral" : "persistent");
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
            key={cost}
            danger={failed || (cost === "minor" && moves)}
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
                  : t(
                      moves
                        ? cost === "patch" && read.reopens
                          ? "update.reopen"
                          : "update.take"
                        : target
                          ? "update.kept"
                          : "update.none",
                      { kind: t(BUTTONS[cost]), version: target?.version },
                    )}
          </PageButton>
        );
      })}
    </VersionRow>
  );
}
