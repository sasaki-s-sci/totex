import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { FilePreviewNodeData } from "../lib/graph";
import type { Session } from "../lib/session";
import { terminalPart } from "../parts";
import type { FilePageActions } from "./actions";
import { FilePage } from "./FilePage";
import { Page } from "./Page";
import { type PageControls, PageTools } from "./PageTools";
import { type PagePlacement, terminalPageId } from "./placement";

type Props = { placement: PagePlacement } & (
  | { kind: "file"; data: FilePreviewNodeData; actions: FilePageActions }
  | {
      kind: "terminal";
      session: Session;
      shown: boolean;
      scale: number;
      collapsed: boolean;
      controls: PageControls;
      terminalList?: ReactNode;
      onEnded: () => void;
    }
);

/** Both hosts render exactly the same content and header; only layout capabilities differ. */
export function PageView(props: Props) {
  if (props.kind === "file")
    return <FilePage data={props.data} actions={props.actions} placement={props.placement} />;
  return <TerminalPage {...props} />;
}

function TerminalPage({
  session,
  placement,
  shown,
  scale,
  collapsed,
  controls,
  terminalList,
  onEnded,
}: Extract<Props, { kind: "terminal" }>) {
  const { t } = useTranslation();
  const { fileTitle } = useAppSettings();
  const Terminal = terminalPart.use(true);
  const name = fileTitle === "path" ? displayPath(session.cwd) : session.branch;
  return (
    <Page
      pageId={terminalPageId(session.id)}
      placement={placement}
      kind="cli-page"
      name={name}
      title={displayPath(session.cwd)}
      collapsed={placement === "canvas" && collapsed}
      keepMounted
      heading={placement === "sidebar" ? terminalList : undefined}
      tools={
        <PageTools name={name} placement={placement} collapsed={collapsed} controls={controls} />
      }
    >
      <div className="cli-page__terminal nodrag nopan nowheel">
        {Terminal ? (
          <Terminal
            session={session}
            shown={shown}
            scale={scale}
            onEnded={onEnded}
            background={placement === "sidebar" ? "default" : "paper"}
          />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        )}
      </div>
    </Page>
  );
}
