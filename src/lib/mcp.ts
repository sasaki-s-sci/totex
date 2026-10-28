import { invoke } from "@tauri-apps/api/core";

export function servingNow(): Promise<number | null> {
  return invoke<number | null>("mcp_serving");
}

export function serve(): Promise<number> {
  return invoke<number>("mcp_serve");
}

export function stopServing(): Promise<void> {
  return invoke<void>("mcp_stop");
}
