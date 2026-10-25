import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import type { Session } from "../../lib/session";
import { useGraphActions } from "../graphActions";

export function SessionEnd({ session }: { session: Session }) {
  const { t } = useTranslation();
  const { endSession } = useGraphActions();
  return (
    <button
      type="button"
      className="cli__end nodrag nopan"
      aria-label={t("cli.end")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        endSession(session);
      }}
    >
      <CloseIcon sx={{ fontSize: 9 }} />
    </button>
  );
}
