import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Frame, MarkButton } from "../marks";
import { PageSlot, usePageWorkspace } from "../page/PageWorkspace";
import { HEADER_HEIGHT, HEADER_INSET, HEADER_MARKS } from "../window/WindowControls";
import { Sidebar, type Sizing } from "./Sidebar";

const SIZING: Sizing = { min: 320, max: 1100, initial: 460, storageKey: "totex.panel.width" };

export function RightSidebar() {
  const workspace = usePageWorkspace();
  const { t } = useTranslation();
  if (!workspace) return null;
  const { entries, showing, lower, active, placement } = workspace;
  const pages = entries.filter((entry) => placement(entry.id) === "sidebar");
  const open = pages.some((entry) => entry.id === showing);
  return (
    <>
      {!open && pages.length > 0 && (
        <Box sx={{ position: "absolute", top: HEADER_INSET, right: HEADER_MARKS, zIndex: 1200 }}>
          <MarkButton
            label={t("page.openSidebar")}
            aria-expanded={false}
            aria-controls="cli-sidebar"
            onClick={() => workspace.show(pages[0].id)}
          >
            <Frame>
              <path d="m15 6-6 6 6 6" />
            </Frame>
          </MarkButton>
        </Box>
      )}
      <Sidebar
        id="cli-sidebar"
        component="aside"
        side="right"
        open={open}
        sizing={SIZING}
        band={null}
        sx={{
          "--page-header-height": `${HEADER_HEIGHT}px`,
        }}
      >
        <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
          {/* Split, the shown page takes the top half and the lower page the bottom one. */}
          {pages.map((entry) => {
            const top = entry.id === showing;
            const bottom = entry.id === lower;
            return (
              <Box
                key={entry.id}
                data-page-pane={entry.id}
                data-active={entry.id === active || undefined}
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: bottom ? "50%" : 0,
                  bottom: top && lower ? "50%" : 0,
                  borderTop: bottom ? 1 : 0,
                  borderColor: "divider",
                  outline:
                    lower && entry.id === active
                      ? "2px solid var(--mui-palette-primary-main)"
                      : "none",
                  outlineOffset: -2,
                  zIndex: entry.id === active ? 1 : 0,
                  visibility: top || bottom ? "visible" : "hidden",
                }}
              >
                <PageSlot id={entry.id} place="sidebar" />
              </Box>
            );
          })}
        </Box>
      </Sidebar>
    </>
  );
}
