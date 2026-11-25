(() => {
  const type = "totex:frame-context-menu";
  const zoomType = "totex:frame-zoom";
  let enabled = false;
  const frames = () => [...document.querySelectorAll("iframe")];
  const owns = (frame) =>
    frame.hasAttribute("data-canvas-context-menu") && frame.closest("[data-canvas-pane]");
  const configure = (frame) =>
    frame.contentWindow?.postMessage(
      { type: `${type}:enable`, enabled: enabled || !!owns(frame) },
      "*",
    );
  const forward = (x, y) => window.parent.postMessage({ type, x, y }, "*");

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (
      data.type === `${type}:enable` &&
      window.parent !== window &&
      event.source === window.parent &&
      typeof data.enabled === "boolean"
    ) {
      enabled = data.enabled;
      for (const frame of frames()) configure(frame);
      return;
    }
    if (data.type !== type && data.type !== `${type}:ready` && data.type !== zoomType) return;
    const frame = frames().find((frame) => frame.contentWindow === event.source);
    if (!frame) return;
    if (data.type === `${type}:ready`) {
      configure(frame);
      return;
    }
    if (!enabled && !owns(frame)) return;
    const bounds = frame.getBoundingClientRect();
    if (
      !frame.clientWidth ||
      !frame.clientHeight ||
      !bounds.width ||
      !bounds.height ||
      frame.closest("[hidden], [inert]") ||
      getComputedStyle(frame).visibility !== "visible"
    )
      return;
    if (data.type === zoomType) {
      if (document.activeElement !== frame || ![-1, 0, 1].includes(data.step)) return;
      if (enabled) window.parent.postMessage({ type: zoomType, step: data.step }, "*");
      else frame.dispatchEvent(new CustomEvent("totex:zoom", { bubbles: true, detail: data.step }));
      return;
    }
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    const x =
      bounds.left +
      ((frame.clientLeft + Math.max(0, Math.min(data.x, frame.clientWidth))) * bounds.width) /
        frame.offsetWidth;
    const y =
      bounds.top +
      ((frame.clientTop + Math.max(0, Math.min(data.y, frame.clientHeight))) * bounds.height) /
        frame.offsetHeight;
    if (enabled) forward(x, y);
    else if (document.elementFromPoint(x, y) === frame) {
      frame.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: x,
          clientY: y,
        }),
      );
    }
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        !enabled ||
        !event.isTrusted ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      const step =
        event.key === "+" || event.key === "=" || event.code === "NumpadAdd"
          ? 1
          : event.key === "-" || event.code === "NumpadSubtract"
            ? -1
            : event.key === "0"
              ? 0
              : null;
      if (step === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.parent.postMessage({ type: zoomType, step }, "*");
    },
    true,
  );
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (!enabled || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      forward(event.clientX, event.clientY);
    },
    true,
  );
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLIFrameElement) configure(event.target);
    },
    true,
  );
  if (window.parent !== window) window.parent.postMessage({ type: `${type}:ready` }, "*");
})();
