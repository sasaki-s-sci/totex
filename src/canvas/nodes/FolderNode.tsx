import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CLI_GLYPH, CliMark, FolderMark, RepoRingMark } from "../../marks";
import { useGraphActions } from "../graphActions";

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const { kind, root, name, label, open, mark, tools } = data;
  const { openWork, closeFolder } = useGraphActions();

  return (
    <div className="band folder">
      {/* The mark is the drag handle and deliberately not a button: a button would fire on every drag that came to nothing. */}
      <div className={`${GRIP} nopan`} style={{ left: mark }} title={t("folder.move")}>
        {/* The folder as the sidebar graphed it; the repository as the ring the sidebar's button frames. */}
        {kind === "folder" ? (
          <FolderMark on={open} size={15} />
        ) : (
          <RepoRingMark on={open} size={15} />
        )}
      </div>

      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        {/* A repository's name takes it off the canvas; graphing it again brings it back. A folder holds nothing to take off, so its name is only a name: the sidebar is where it leaves. */}
        {kind === "folder" ? (
          <Typography
            className="folder__name folder__name--still"
            variant="body2"
            sx={{ minWidth: 0, fontWeight: "normal" }}
            noWrap
          >
            {name}
          </Typography>
        ) : (
          <button
            type="button"
            className="folder__name nopan"
            aria-label={name}
            title={t("repository.close")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              closeFolder(root);
            }}
          >
            <Typography variant="body2" sx={{ minWidth: 0, fontWeight: "normal" }} noWrap>
              {name}
            </Typography>
          </button>
        )}
      </div>

      <div className="folder__tools nopan" style={{ left: tools }}>
        <button
          type="button"
          className="tools__button"
          aria-label={t("folder.shell")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openWork({ repository: null, branch: name, cwd: root });
          }}
        >
          <CliMark size={CLI_GLYPH} />
        </button>
      </div>
    </div>
  );
}
