import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

// Screen pixels, so the same hand movement means the same at any zoom; a threshold, not a rate, since a fetch is asked for or not.
const REACH = 44;

const SLOP = 6;

type Options = {
  onFetch: () => void;

  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;

  live: boolean;
};

export function useFetchPull({ onFetch, onOpen, live }: Options) {
  const handle = useRef<HTMLButtonElement>(null);

  // Ref, not closure: a pull outlives the render it began in.
  const latest = useRef({ onFetch, onOpen, live });
  latest.current = { onFetch, onOpen, live };

  const frame = useRef(0);

  const pulling = useRef(false);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || !latest.current.live) return;
    const element = handle.current;
    if (!element) return;

    pulling.current = false;

    const origin = event.clientX;
    let at = origin;

    let drawn = -1;

    const share = () => Math.min(1, Math.max(0, at - origin) / REACH);

    const draw = () => {
      frame.current = 0;
      const reached = share();
      if (reached === drawn) return;
      drawn = reached;
      element.style.setProperty("--reach", `${reached}`);
      element.classList.toggle("is-reached", reached === 1);
    };

    const move = (moved: globalThis.PointerEvent) => {
      at = moved.clientX;
      if (!pulling.current) {
        if (Math.abs(at - origin) < SLOP) return;
        pulling.current = true;
        element.classList.add("is-pulling");
      }

      // requestAnimationFrame never returns 0, so 0 means no frame owed.
      if (frame.current === 0) frame.current = requestAnimationFrame(draw);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      element.classList.remove("is-pulling", "is-reached");
      element.style.removeProperty("--reach");

      if (pulling.current && share() === 1) latest.current.onFetch();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // The release also fires a click; it is swallowed after a pull.
  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (pulling.current) {
      pulling.current = false;
      return;
    }
    latest.current.onOpen(event);
  }, []);

  return { handle, onPointerDown, onClick };
}
