// Tauri's native file handler takes HTML5 drops on Windows; pointer drags keep both paths working.
export function startPointerDrag(
  event: PointerEvent,
  source: HTMLElement,
  write: (data: DataTransfer) => string,
  column: HTMLElement | null | undefined,
): void {
  if (
    event.button !== 0 ||
    !event.isPrimary ||
    (event.target as Element).closest("button, a, input, textarea, select, [contenteditable=true]")
  )
    return;
  const origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let point = event;
  let data: DataTransfer | null = null;
  let target: Element | null = null;
  let label: HTMLDivElement | null = null;
  let frame = 0;

  function send(type: string, to: Element | null, relatedTarget: Element | null = null) {
    return (
      to?.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: point.clientX,
          clientY: point.clientY,
          ctrlKey: point.ctrlKey,
          altKey: point.altKey,
          metaKey: point.metaKey,
          shiftKey: point.shiftKey,
          relatedTarget,
        }),
      ) === false
    );
  }

  function over() {
    const next = document.elementFromPoint(point.clientX, point.clientY);
    if (target !== next) send("dragleave", target, next);
    target = next;
    return send("dragover", target);
  }

  function finish(drop = false) {
    listeners.abort();
    cancelAnimationFrame(frame);
    if (data) {
      if (drop && over()) send("drop", target);
      send("dragleave", target);
      send("dragend", source);
      // A captured pointer still clicks its source after a drag.
      const clear = () => {
        window.removeEventListener("click", swallow, true);
        window.removeEventListener("pointerdown", clear, true);
      };
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopImmediatePropagation();
        clear();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.addEventListener("pointerdown", clear, { capture: true, once: true });
      if (drop) setTimeout(clear, 0);
    }
    label?.remove();
    if (source.hasPointerCapture(origin.id)) source.releasePointerCapture(origin.id);
  }

  function scroll() {
    if (column) {
      const box = column.getBoundingClientRect();
      if (
        point.clientX >= box.left &&
        point.clientX <= box.right &&
        point.clientY >= box.top &&
        point.clientY <= box.bottom
      ) {
        const before = column.scrollTop;
        column.scrollTop +=
          point.clientY < box.top + 24 ? -8 : point.clientY > box.bottom - 24 ? 8 : 0;
        if (column.scrollTop !== before) over();
      }
    }
    frame = requestAnimationFrame(scroll);
  }

  source.addEventListener("dragstart", (drag) => drag.preventDefault(), options);
  source.setPointerCapture(origin.id);
  source.addEventListener("lostpointercapture", () => finish(), options);
  window.addEventListener("blur", () => finish(), options);
  window.addEventListener(
    "pointercancel",
    (cancel) => {
      if (cancel.pointerId === origin.id) finish();
    },
    options,
  );
  window.addEventListener(
    "keydown",
    (key) => {
      if (key.key === "Escape") {
        key.preventDefault();
        key.stopPropagation();
        finish();
      }
    },
    { ...options, capture: true },
  );
  window.addEventListener(
    "pointermove",
    (move) => {
      if (move.pointerId !== origin.id) return;
      point = move;
      if (!(move.buttons & 1)) return finish();
      if (!data) {
        if (Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < 5) return;
        data = new DataTransfer();
        const name = write(data);
        label = document.createElement("div");
        label.textContent = name;
        label.setAttribute("aria-hidden", "true");
        const style = getComputedStyle(source);
        Object.assign(label.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: "9999",
          padding: "4px 8px",
          borderRadius: "4px",
          background: "var(--mui-palette-background-paper)",
          color: "var(--mui-palette-text-primary)",
          border: "1px solid var(--mui-palette-divider)",
          font: style.font,
          maxWidth: "320px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        });
        document.body.append(label);
        frame = requestAnimationFrame(scroll);
      }
      move.preventDefault();
      if (label) {
        label.style.left = `${move.clientX + 12}px`;
        label.style.top = `${move.clientY + 12}px`;
      }
      over();
    },
    options,
  );
  window.addEventListener(
    "pointerup",
    (up) => {
      if (up.pointerId !== origin.id) return;
      point = up;
      finish(true);
    },
    options,
  );
}
