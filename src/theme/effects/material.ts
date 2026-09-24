// The OS backdrop behind the see-through main window. Only Windows draws these; elsewhere the
// call is accepted and nothing happens.
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import type { Material } from "../declaration";

const EFFECT: Record<Exclude<Material, "none">, Effect> = {
  mica: Effect.Mica,
  acrylic: Effect.Acrylic,
  blur: Effect.Blur,
};

// Whether this window carries an effect we set: "none" from the start never calls the OS, so a
// window that never asked for a material is exactly the window it was before.
let applied = false;

export function useMaterial(material: Material, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || material === "none") {
      if (applied) void clear();
      return;
    }
    void apply(material);
    // Undone on the way out too, so an unmount (or the next material) starts from bare glass.
    return () => void clear();
  }, [material, enabled]);
}

async function apply(material: Exclude<Material, "none">): Promise<void> {
  applied = true;
  try {
    await getCurrentWindow().setEffects({ effects: [EFFECT[material]] });
  } catch (reason) {
    // No window (a browser preview) or an OS without this material: the page still works.
    console.warn(`window material ${material}:`, reason);
  }
}

async function clear(): Promise<void> {
  applied = false;
  try {
    await getCurrentWindow().clearEffects();
  } catch (reason) {
    console.warn("window material none:", reason);
  }
}
