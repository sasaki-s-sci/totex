import { webAddress } from "../canvas/model.ts";

export const OPEN_PAGE = "totex:open-page";
export type PageRequest = { url: string; sessionId?: string };

export function openPage(uri: string, sessionId?: string): boolean {
  let url: string;
  try {
    url = webAddress(uri, location.origin).href;
  } catch {
    return false;
  }
  const request = new CustomEvent<PageRequest>(OPEN_PAGE, {
    detail: { url, sessionId },
    cancelable: true,
  });
  window.dispatchEvent(request);
  return request.defaultPrevented;
}
