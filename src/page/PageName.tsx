import { useTranslation } from "react-i18next";
import { usePageWorkspace } from "./PageWorkspace";
import type { PagePlacement } from "./placement";

export function PageName({
  id,
  name,
  placement,
}: {
  id?: string;
  name: string;
  placement: PagePlacement;
}) {
  const workspace = usePageWorkspace();
  const { t } = useTranslation();
  const choices =
    workspace?.entries.filter((entry) => workspace.placement(entry.id) === "sidebar") ?? [];
  return (
    <span className="page__name">
      {placement === "sidebar" && id && choices.length > 1 ? (
        <select
          className="page__select nodrag"
          aria-label={t("page.select")}
          value={id}
          onChange={(event) => workspace?.show(event.target.value)}
        >
          {choices.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      ) : (
        name
      )}
    </span>
  );
}
