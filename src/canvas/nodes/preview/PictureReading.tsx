import { useCallback, useEffect, useRef } from "react";
import { ZOOM_EVENT, zoomed, zoomKey } from "../../../lib/zoom";
import "./pictureReading.css";

export function PictureReading({
  source,
  name,
  onError,
}: {
  source: string;
  name: string;
  onError: () => void;
}) {
  const host = useRef<HTMLElement>(null);
  const zoom = useRef(1);
  const resize = useCallback((value: number, point?: { x: number; y: number }) => {
    const element = host.current;
    if (!element) return;
    const next = Math.min(8, Math.max(0.25, value));
    const ratio = next / zoom.current;
    const x = point?.x ?? element.clientWidth / 2;
    const y = point?.y ?? element.clientHeight / 2;
    const left = (element.scrollLeft + x) * ratio - x;
    const top = (element.scrollTop + y) * ratio - y;
    zoom.current = next;
    element.style.setProperty("--picture-zoom", String(next));
    element.scrollTo(left, top);
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const bounds = element.getBoundingClientRect();
      resize(zoom.current * Math.exp(-event.deltaY * unit * 0.002), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    // React's delegated wheel listeners are passive, so browser zoom needs a native listener.
    const keyZoom = (event: Event) => {
      const step = (event as CustomEvent).detail;
      if (step === -1 || step === 0 || step === 1) resize(zoomed(zoom.current, step));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener(ZOOM_EVENT, keyZoom);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener(ZOOM_EVENT, keyZoom);
    };
  }, [resize]);
  return (
    <section
      ref={host}
      className="picture-reading nodrag nopan nowheel"
      aria-label={name}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users focus the image viewport to zoom and scroll it.
      tabIndex={0}
      onKeyDown={(event) => {
        const step = zoomKey({
          isComposing: event.nativeEvent.isComposing,
          key: event.key,
          code: event.code,
          ctrlKey: true,
          metaKey: event.metaKey,
          altKey: event.altKey,
        });
        if (step === null) return;
        event.preventDefault();
        event.stopPropagation();
        resize(zoomed(zoom.current, step));
      }}
    >
      <img src={source} alt={name} draggable={false} onLoad={() => resize(1)} onError={onError} />
    </section>
  );
}
