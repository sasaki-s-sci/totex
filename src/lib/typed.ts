import { invoke } from "@tauri-apps/api/core";

export type Typed = {
  id: string;
  said: string;
};

export function typedNow(): Promise<Typed[]> {
  return invoke<Typed[]>("pty_typed");
}
