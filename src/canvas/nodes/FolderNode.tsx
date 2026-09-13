import { Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { FolderFlowNode } from "../../lib/graph";
import { GRIP } from "../../lib/graph/folders";
import { CLI_GLYPH, CliMark, FolderMark } from "../../marks";
import { useGraphActions } from "../graphActions";

export function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const { t } = useTranslation();
  const { root, name, label, open, mark, tools } = data;
  const { openWork, toggleFolder } = useGraphActions();

  return (
    <div className="band folder">
      {/* The mark is the drag handle and deliberately not a button: a button would fire on every drag that came to nothing. */}
      <div className={`${GRIP} nopan`} style={{ left: mark }} title={t("folder.move")}>
        <FolderMark on={open} size={15} />
      </div>

      <div
        className="band__name"
        style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
      >
        <button
          type="button"
          className="folder__name nopan"
          aria-label={name}
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleFolder(root);
          }}
        >
          <Typography variant="body2" sx={{ minWidth: 0, fontWeight: "normal" }} noWrap>
            {name}
          </Typography>
        </button>
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
