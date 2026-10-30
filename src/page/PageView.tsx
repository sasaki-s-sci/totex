import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { FilePreviewNodeData } from "../lib/graph";
import type { Session } from "../lib/session";
import { MonitorAgents, MonitorBadge } from "../monitor/MonitorBadge";
import { isAgent } from "../monitor/model";
import { useMonitorGlance } from "../monitor/runtime";
import { terminalPart } from "../parts";
import type { FilePageActions } from "./actions";
import { FilePage } from "./FilePage";
import { Page } from "./Page";
import { type PageControls, PageTools } from "./PageTools";
import { usePageWorkspace } from "./PageWorkspace";
import { type PagePlacement, terminalPageId } from "./placement";
import { TerminalList } from "./TerminalList";

type Props = { placement: PagePlacement } & (
  | { kind: "file"; data: FilePreviewNodeData; actions: FilePageActions; scale: number }
  | {
      kind: "terminal";
      session: Session;
      number: number;
      shown: boolean;
      scale: number;
      compact: boolean;
      viewer?: boolean;
      resize?: boolean;
      controls: PageControls;
      onEnded: () => void;
    }
);

/** The same terminal and file views stay mounted while their hosts change. */
export function PageView(props: Props) {
  if (props.kind === "file")
    return (
      <FilePage
        data={props.data}
        actions={props.actions}
        placement={props.placement}
        zoom={props.scale}
      />
    );
  return <TerminalPage {...props} />;
}

function TerminalPage({
  session,
  number,
  placement,
  shown,
  scale,
  compact,
  viewer,
  resize,
  controls,
  onEnded,
}: Extract<Props, { kind: "terminal" }>) {
  const { t } = useTranslation();
  const { fileTitle, monitor } = useAppSettings();
  const workspace = usePageWorkspace();
  const glance = useMonitorGlance(session.id);
  const agent = monitor.enabled && isAgent(glance);
  const agentSummary = placement === "canvas" && compact && agent;
  const terminalBody = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const previousView = useRef({ agentSummary, compact });
  useLayoutEffect(() => {
    const page = terminalBody.current?.closest(".page");
    const trackFocus = (event: Event) => {
      focused.current = event.target instanceof Node && Boolean(page?.contains(event.target));
    };
    focused.current = Boolean(page?.contains(document.activeElement));
    document.addEventListener("focusin", trackFocus);
    document.addEventListener("pointerdown", trackFocus, true);
    return () => {
      document.removeEventListener("focusin", trackFocus);
      document.removeEventListener("pointerdown", trackFocus, true);
    };
  }, []);
  useLayoutEffect(() => {
    const previous = previousView.current;
    previousView.current = { agentSummary, compact };
    if (
      !focused.current ||
      (previous.agentSummary === agentSummary && previous.compact === compact)
    )
      return;
    // Remember focus before the old view is hidden or removed; idle cards never take it.
    terminalBody.current
      ?.closest(".page")
      ?.querySelector<HTMLElement>(agentSummary ? ".page-agent button" : ".xterm-helper-textarea")
      ?.focus({ preventScroll: true });
  }, [agentSummary, compact]);
  const Terminal = terminalPart.use(true);
  const name = fileTitle === "path" ? displayPath(session.cwd) : session.branch;
  return (
    <Page
      pageId={terminalPageId(session.id)}
      placement={placement}
      kind="cli-page"
      name={name}
      heading={placement === "sidebar" ? <TerminalList /> : undefined}
      title={displayPath(session.cwd)}
      keepMounted
      toolsAtSide={placement === "canvas"}
      compact={compact}
      tools={<PageTools name={name} placement={placement} controls={controls} />}
    >
      {placement === "canvas" && (
        <button
          type="button"
          className="page-terminal-number"
          data-active={workspace?.active === terminalPageId(session.id)}
          aria-label={`${t("cli.shell")} ${number}: ${t("page.openViewer", { name })}`}
          title={t("page.openViewer", { name })}
          onClick={() => workspace?.show(terminalPageId(session.id))}
        >
          {number}
        </button>
      )}
      <div className="page-terminal-content">
        {agentSummary && (
          <div className="page-agent nodrag nopan nowheel">
            <MonitorBadge id={session.id} workers={false} />
          </div>
        )}
        <div
          ref={terminalBody}
          className="cli-page__terminal nodrag nopan nowheel"
          aria-hidden={agentSummary || undefined}
          inert={agentSummary}
        >
          {Terminal ? (
            <Terminal
              session={session}
              shown={shown}
              compact={compact}
              viewer={viewer}
              resize={resize}
              scale={scale}
              onEnded={onEnded}
              background={placement === "sidebar" ? "default" : "paper"}
            />
          ) : (
            <p className="file-preview__message">{t("filePreview.loading")}</p>
          )}
        </div>
      </div>
      {agent && (
        <div className="page-agent-workers">
          <MonitorAgents id={session.id} />
        </div>
      )}
    </Page>
  );
}
