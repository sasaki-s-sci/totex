(() => {
  const type = "totex:frame-file-drop";
  const originOf = (frame) => {
    if (frame.hasAttribute("sandbox") && !frame.sandbox.contains("allow-same-origin")) return null;
    const source = frame.getAttribute("src");
    if (frame.hasAttribute("srcdoc") || !source || source === "about:blank")
      return window.origin === "null" ? null : window.origin;
    try {
      const url = new URL(source, document.baseURI);
      return ["http:", "https:", "blob:"].includes(url.protocol) && url.origin !== "null"
        ? url.origin
        : null;
    } catch {
      return null;
    }
  };

  window.addEventListener("message", (event) => {
    if (window.parent === window || event.source !== window.parent) return;
    const data = event.data;
    if (
      !data ||
      data.type !== type ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y) ||
      !Array.isArray(data.files) ||
      !data.files.length ||
      !data.files.every((file) => file instanceof File)
    )
      return;
    const target = document.elementFromPoint(data.x, data.y);
    if (
      !target ||
      target.closest("[hidden], [inert]") ||
      getComputedStyle(target).visibility !== "visible"
    )
      return;
    if (target instanceof HTMLIFrameElement) {
      const origin = originOf(target);
      const bounds = target.getBoundingClientRect();
      if (!origin || !bounds.width || !bounds.height || !target.offsetWidth || !target.offsetHeight)
        return;
      const x = ((data.x - bounds.left) * target.offsetWidth) / bounds.width - target.clientLeft;
      const y = ((data.y - bounds.top) * target.offsetHeight) / bounds.height - target.clientTop;
      if (x < 0 || y < 0 || x >= target.clientWidth || y >= target.clientHeight) return;
      target.contentWindow?.postMessage({ type, x, y, files: data.files }, origin);
      return;
    }

    const input = target instanceof HTMLInputElement && target.type === "file" ? target : null;
    if (input?.matches(":disabled")) return;
    const transfer = new DataTransfer();
    for (const file of data.files) transfer.items.add(file);
    transfer.effectAllowed = "copy";
    transfer.dropEffect = "copy";
    const send = (name) =>
      target.dispatchEvent(
        new DragEvent(name, {
          bubbles: true,
          cancelable: true,
          clientX: data.x,
          clientY: data.y,
          dataTransfer: transfer,
        }),
      );
    // shortcut: events are untrusted, use a native WebView upload API if an application requires trust.
    send("dragenter");
    send("dragover");
    const unhandled = send("drop");
    if (!unhandled || !input?.isConnected || input.matches(":disabled")) return;
    const picked = new DataTransfer();
    for (const file of input.multiple ? data.files : data.files.slice(0, 1)) picked.items.add(file);
    input.files = picked.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
})();
