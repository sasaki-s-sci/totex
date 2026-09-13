import { Box } from "@mui/material";
import { useEffect, useRef } from "react";

/** Coming near it is the request; the margin keeps it ahead of the scroll. See `drawMore`. */
export function MoreRows({ indent, onSeen }: { indent: number; onSeen: () => void }) {
  const mark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = mark.current;
    if (!element) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onSeen();
      },
      { rootMargin: "320px" },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [onSeen]);

  return (
    <Box ref={mark} sx={{ pl: indent, py: 0.5 }}>
      <Box sx={{ width: 20, borderTop: "2px dotted", borderColor: "text.disabled" }} />
    </Box>
  );
}
