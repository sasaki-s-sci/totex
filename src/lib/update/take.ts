import { Channel, invoke } from "@tauri-apps/api/core";
import { ephemeralIdentity, swapEphemeral } from "../../ephemeral/runtime";
import type { Layer, UpdateStage } from "./model";
import { askStanding, settlePress, state, wanted } from "./store";

export function confirmFront(): void {
  invoke("confirm_front", { version: ephemeralIdentity().version || null }).catch(() => undefined);
}

type Took = "taken" | "current" | "held";
let busy = false;

/** A view update has no path to session control, document reload or application exit. */
export async function take(layer: Layer, target?: string | null): Promise<UpdateStage> {
  if (busy) return "held";
  busy = true;
  const version = target === undefined ? wanted(state, layer) : target;
  settlePress(layer, {
    stage: "taking",
    progress: null,
    version: state.rungs?.find((rung) => rung.layer === layer)?.picked ?? null,
  });
  let staged = false;
  let undo: (() => void) | undefined;
  try {
    const coming = new Channel<{ taken: number; length: number | null }>();
    coming.onmessage = ({ taken, length }) => {
      if (length) settlePress(layer, { progress: Math.min(1, taken / length) });
    };
    const took = await invoke<Took>("update_take", { layer, version, coming });
    if (took === "taken") {
      if (layer === "ephemeral") {
        staged = true;
        undo = await swapEphemeral(version ?? undefined);
        await invoke("confirm_front", { version: ephemeralIdentity().version });
        staged = false;
        undo = undefined;
        settlePress(layer, { stage: "swapped", progress: null });
      } else {
        // The installed bundle contains both the new host and the views built for it.
        await invoke("update_restart");
        settlePress(layer, { stage: "ready", progress: null });
      }
    } else {
      settlePress(layer, { stage: took, progress: null });
    }
  } catch {
    undo?.();
    if (staged) await invoke("rollback_front").catch(() => undefined);
    settlePress(layer, { stage: "failed", progress: null });
  } finally {
    busy = false;
    await askStanding(true);
  }
  return state.presses[layer].stage;
}
