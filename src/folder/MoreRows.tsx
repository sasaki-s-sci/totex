/**
 * The mark that stands where the rest of a long listing would be, and asks for
 * more of it when it comes into view.
 */

import { Box } from "@mui/material";
import { useEffect, useRef } from "react";

/**
 * Where the rows that have not been drawn yet begin.
 *
 * Nothing is asked of whoever is reading: coming near it is the request, and
 * the rows are built out of a frame the window has to spare rather than the one
 * the scroll is in — see `drawMore`. The margin is what keeps it ahead of the
 * scroll, so what arrives has arrived before it is looked at.
 */
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

  // A rule where the next rows will be, and no more than that: it is not
  // pressed and it is not read, it is only what the scroll has to reach.
  return (
    <Box ref={mark} sx={{ pl: indent, py: 0.5 }}>
      <Box sx={{ width: 20, borderTop: "2px dotted", borderColor: "text.disabled" }} />
    </Box>
  );
}
