import { Box } from "@mui/material";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useFrontState } from "../shell/state";
import { movePage, type PageLayout, type PageSide, reconcileLayout } from "./pageLayout";

type Card = { id: string; content: ReactNode; visible?: boolean };
type Drop = { id: string; side: PageSide };
const DIRECTIONS: Partial<Record<string, PageSide>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};
const DRAG_TYPE = "application/x-totex-page";

export function PageBoard({
  cards,
  storageKey = "cards.layout",
  onLayout,
}: {
  cards: Card[];
  storageKey?: string;
  onLayout?: (rows: PageLayout) => void;
}) {
  const [saved, setSaved] = useFrontState<PageLayout>(storageKey, []);
  const rows = useMemo(
    () =>
      reconcileLayout(
        saved,
        cards.map((card) => card.id),
      ),
    [saved, cards],
  );
  const visible = rows
    .map((row) =>
      row.filter((id) => cards.some((card) => card.id === id && card.visible !== false)),
    )
    .filter((row) => row.length);
  const [drop, setDrop] = useState<Drop | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const moving = useRef<string | null>(null);
  useEffect(() => onLayout?.(rows), [rows, onLayout]);

  // Page portals follow a different React tree; drag events must follow the actual DOM hosts.
  useEffect(() => {
    const board = host.current;
    if (!board) return;
    const cardAt = (target: EventTarget | null) => {
      let card = target instanceof Element ? target.closest<HTMLElement>("[data-page-card]") : null;
      while (card && card.closest(".page-board") !== board)
        card = card.parentElement?.closest<HTMLElement>("[data-page-card]") ?? null;
      return card;
    };
    const targetAt = (event: DragEvent): Drop | null => {
      const card = cardAt(event.target);
      if (!card?.dataset.pageCard) return null;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      const edges: [PageSide, number][] = [
        ["left", x],
        ["right", 1 - x],
        ["top", y],
        ["bottom", 1 - y],
      ];
      edges.sort((a, b) => a[1] - b[1]);
      return { id: card.dataset.pageCard, side: edges[0][0] };
    };
    const start = (event: DragEvent) => {
      const header =
        event.target instanceof Element ? event.target.closest(".page__header, .page__drag") : null;
      if (header?.closest(".page-board") !== board) return;
      const card = header && cardAt(header);
      if (!card?.dataset.pageCard || !event.dataTransfer) return;
      moving.current = card.dataset.pageCard;
      event.dataTransfer.setData(DRAG_TYPE, moving.current);
      event.dataTransfer.effectAllowed = "move";
    };
    const over = (event: DragEvent) => {
      if (!moving.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const next = targetAt(event);
      setDrop((held) => (held?.id === next?.id && held?.side === next?.side ? held : next));
    };
    const end = () => {
      moving.current = null;
      setDrop(null);
    };
    const place = (event: DragEvent) => {
      const source = moving.current;
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      const target = targetAt(event);
      if (target) setSaved(movePage(rows, source, target.id, target.side));
      end();
    };
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const header =
        event.target instanceof Element && event.target.matches(".page__header, .page__drag");
      if (event.target instanceof Element && event.target.closest(".page-board") !== board) return;
      const card = header ? cardAt(event.target) : null;
      const side = DIRECTIONS[event.key];
      if (!card?.dataset.pageCard || !side) return;
      event.preventDefault();
      event.stopPropagation();
      const ids = rows
        .flat()
        .filter((id) => cards.some((card) => card.id === id && card.visible !== false));
      const source = card.dataset.pageCard;
      const index = ids.indexOf(source);
      const target = ids[index + (side === "left" || side === "top" ? -1 : 1)];
      if (target) {
        setSaved(movePage(rows, source, target, side));
        requestAnimationFrame(() => {
          board
            .querySelector<HTMLElement>(
              `[data-page-card="${CSS.escape(source)}"] :is(.page__header, .page__drag)`,
            )
            ?.focus();
        });
      }
    };
    board.addEventListener("dragstart", start);
    board.addEventListener("dragover", over);
    board.addEventListener("drop", place);
    board.addEventListener("dragend", end);
    board.addEventListener("keydown", key);
    return () => {
      board.removeEventListener("dragstart", start);
      board.removeEventListener("dragover", over);
      board.removeEventListener("drop", place);
      board.removeEventListener("dragend", end);
      board.removeEventListener("keydown", key);
    };
  }, [rows, cards]);

  return (
    <Box
      ref={host}
      className="page-board"
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {visible.map((row) => (
        <Box
          key={row[0]}
          className="page-board__row"
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
            gap: 2,
            alignItems: "start",
          }}
        >
          {row.map((id) => {
            const card = cards.find((card) => card.id === id);
            if (!card) return null;
            return (
              <Box
                key={id}
                data-page-card={id}
                data-drop-side={drop?.id === id ? drop.side : undefined}
                sx={{
                  position: "relative",
                  minWidth: 0,
                  "&[data-drop-side]::after": {
                    content: '""',
                    position: "absolute",
                    zIndex: 5,
                    pointerEvents: "none",
                    bgcolor: "primary.main",
                  },
                  "&[data-drop-side=left]::after": { top: 0, bottom: 0, left: -5, width: 3 },
                  "&[data-drop-side=right]::after": { top: 0, bottom: 0, right: -5, width: 3 },
                  "&[data-drop-side=top]::after": { top: -5, left: 0, right: 0, height: 3 },
                  "&[data-drop-side=bottom]::after": { bottom: -5, left: 0, right: 0, height: 3 },
                }}
              >
                {card.content}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
