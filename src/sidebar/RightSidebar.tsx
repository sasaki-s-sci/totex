import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Doing } from "../lib/doing";
import type { CliPlace } from "../lib/graphNav";
import { Frame, MARK_BUTTON, MarkButton } from "../marks";
import { TabStrip } from "../tab/TabStrip";
import { TabView } from "../tab/TabView";
import type { Tab } from "../tab/tab";
import { HEADER_INSET, HEADER_MARKS } from "../window/WindowControls";
import { Sidebar, type Sizing } from "./Sidebar";

import "../tab/tab.css";

const SIZING: Sizing = { min: 320, max: 1100, initial: 460, storageKey: "totex.panel.width" };

type Props = {
  tabs: readonly Tab[];
  showing: string | null;
  /** A terminal also standing on the canvas as a page follows that page's grid. */
  paged: readonly string[];
  run: readonly CliPlace[];
  doings: ReadonlyMap<string, Doing>;
  onPage: (tab: Tab) => void;
  onEnded: (tab: Tab) => void;
};

/**
 * Every tab stays mounted and hidden with `visibility`, still laid out: a terminal given no box
 * stops drawing and redraws every row when it gets one back.
 */
export function RightSidebar({ tabs, showing, paged, run, doings, onPage, onEnded }: Props) {
  const { t } = useTranslation();
  const open = tabs.find((tab) => tab.id === showing) ?? null;

  return (
    <Sidebar
      component="aside"
      side="right"
      open={open !== null}
      sizing={SIZING}
      band={
        <>
          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              height: "100%",
              pt: `${HEADER_INSET}px`,
              pl: `${HEADER_INSET}px`,
              pr: `${HEADER_MARKS + MARK_BUTTON}px`,
              pointerEvents: "none",
            }}
          >
            <TabStrip run={run} showing={showing} doings={doings} />
          </Box>
          {open && (
            <Box sx={{ position: "absolute", top: HEADER_INSET, right: HEADER_MARKS }}>
              <MarkButton label={t("cli.page")} onClick={() => onPage(open)}>
                <Frame>
                  <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                </Frame>
              </MarkButton>
            </Box>
          )}
        </>
      }
    >
      <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              visibility: tab.id === showing ? "visible" : "hidden",
            }}
          >
            <TabView
              tab={tab}
              shown={tab.id === showing}
              follow={paged.includes(tab.id)}
              onEnded={onEnded}
            />
          </Box>
        ))}
      </Box>
    </Sidebar>
  );
}
