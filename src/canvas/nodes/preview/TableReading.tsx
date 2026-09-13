import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { compareTableCells, parseTable } from "./tableData";
import "./tableReading.css";

const PAGE_SIZE = 100;
type Sort = { column: number; direction: "asc" | "desc" } | null;

export function TableReading({
  text,
  path,
  truncated = false,
}: {
  text: string;
  path: string;
  truncated?: boolean;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseTable(text, /\.tsv$/i.test(path) ? "\t" : ","), [text, path]);
  const [header, setHeader] = useState(true);
  const [sort, setSort] = useState<Sort>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const columns = parsed.rows.reduce((count, row) => Math.max(count, row.length), 0);
  const rows = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    const filtered = parsed.rows
      .slice(header ? 1 : 0)
      .map((cells, index) => ({ cells, index }))
      .filter(
        ({ cells }) => !needle || cells.some((cell) => cell.toLocaleLowerCase().includes(needle)),
      );
    if (sort)
      filtered.sort(
        (a, b) =>
          compareTableCells(
            a.cells[sort.column] ?? "",
            b.cells[sort.column] ?? "",
            sort.direction,
          ) || a.index - b.index,
      );
    return filtered;
  }, [parsed, header, query, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  function changeSort(column: number) {
    setSort(
      sort?.column !== column
        ? { column, direction: "asc" }
        : sort.direction === "asc"
          ? { column, direction: "desc" }
          : null,
    );
    setPage(0);
  }

  return (
    <div className="file-preview__table nodrag nopan nowheel">
      <div className="file-preview__table-tools">
        <label>
          <input
            type="checkbox"
            checked={header}
            onChange={(event) => {
              setHeader(event.target.checked);
              setPage(0);
              setSort(null);
            }}
          />
          {t("filePreview.tableHeader", { defaultValue: "First row is a header" })}
        </label>
        <input
          type="search"
          value={query}
          aria-label={t("filePreview.tableFilter", { defaultValue: "Filter rows" })}
          placeholder={t("filePreview.tableFilter", { defaultValue: "Filter rows" })}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </div>
      {(truncated || parsed.limited) && (
        <p className="file-preview__table-notice" role="status">
          {t("filePreview.tableLimited", {
            defaultValue:
              "Partial preview. Filtering and sorting apply only to loaded rows; large tables and cells are shortened.",
          })}
        </p>
      )}
      {parsed.malformed && (
        <p className="file-preview__table-notice" role="status">
          {t("filePreview.tableMalformed", {
            defaultValue:
              "Some quoted fields are incomplete or malformed. Displayed values may be partial.",
          })}
        </p>
      )}
      <div className="file-preview__table-scroll">
        <table aria-label={path}>
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, column) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: Column positions are stable and never reordered.
                  key={column}
                  aria-sort={
                    sort?.column === column
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button type="button" onClick={() => changeSort(column)}>
                    {(header && parsed.rows[0]?.[column]) ||
                      t("filePreview.tableColumn", {
                        defaultValue: "Column {{number}}",
                        number: column + 1,
                      })}
                    <span aria-hidden="true">
                      {sort?.column === column ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
              .map(({ cells, index }) => (
                <tr key={index}>
                  {Array.from({ length: columns }, (_, column) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Column positions are stable and never reordered.
                    <td key={column}>{cells[column] ?? ""}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="file-preview__table-notice">
            {t("filePreview.tableEmpty", { defaultValue: "No rows to display." })}
          </p>
        )}
      </div>
      <div className="file-preview__table-tools">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
          aria-label={t("filePreview.previousPage")}
        >
          ‹
        </button>
        <span>
          {currentPage + 1} / {pages}
        </span>
        <button
          type="button"
          disabled={currentPage + 1 >= pages}
          onClick={() => setPage(currentPage + 1)}
          aria-label={t("filePreview.nextPage")}
        >
          ›
        </button>
        <span>
          {t("filePreview.tableRows", { defaultValue: "{{count}} rows", count: rows.length })}
        </span>
      </div>
    </div>
  );
}
