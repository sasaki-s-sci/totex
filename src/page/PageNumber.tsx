import { useTranslation } from "react-i18next";
import { usePageWorkspace } from "./PageWorkspace";

export function PageNumber({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const workspace = usePageWorkspace();
  const number = (workspace?.numbered.findIndex((entry) => entry.id === id) ?? -1) + 1;
  if (!number) return null;
  return (
    <button
      type="button"
      className="page-terminal-number"
      data-active={workspace?.active === id}
      aria-label={`${number}: ${t("page.openViewer", { name })}`}
      title={t("page.openViewer", { name })}
      onClick={() => workspace?.show(id)}
    >
      {number}
    </button>
  );
}
