"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/primitives";
import { useLocale, useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import {
  DataTable,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  ViewerMessage,
  ViewerToolbar,
  decodeText,
  useAttachmentBytes,
} from "./shared";

type Sheet = { name: string; rows: string[][] };

/** A CSV is read as text, and only its beginning needs to be. */
const CSV_LIMIT = 4 * 1024 * 1024;

/**
 * Splits delimited text into rows of cells.
 *
 * Quoted fields may contain the delimiter, line breaks and doubled quotes.
 * The delimiter is whichever of comma, semicolon and tab the first line uses
 * most outside quotes — Norwegian Excel writes semicolons.
 */
function parseDelimited(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  let delimiter = ",";
  let best = 0;
  for (const candidate of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count += 1;
    }
    if (count > best) {
      best = count;
      delimiter = candidate;
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      // A little past what is shown, so the "showing the first N" note is true.
      if (rows.length > TABLE_MAX_ROWS) return rows;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function cellText(value: unknown, locale: string): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const midnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    return midnight
      ? value.toLocaleDateString(locale, { timeZone: "UTC" })
      : value.toLocaleString(locale, { timeZone: "UTC" });
  }
  if (typeof value === "number") return value.toLocaleString(locale, { maximumFractionDigits: 10 });
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/**
 * A spreadsheet or a CSV as a read-only grid.
 *
 * An XLSX workbook is read in the browser into plain cell values — the stored
 * result of each formula, never the formula evaluated, and nothing that is a
 * macro, a script or an external link — and each sheet is its own tab. A CSV
 * is one sheet. Either way the cells reach the page as text.
 */
export function SpreadsheetViewer({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const locale = useLocale();
  const file = useAttachmentBytes(attachment);
  const [sheets, setSheets] = useState<Sheet[] | "error" | undefined>(undefined);
  const [active, setActive] = useState(0);
  const tag = locale === "nb" ? "nb-NO" : "en-GB";

  const csvSheets = useMemo(() => {
    if (attachment.kind !== "csv" || file.status !== "ready") return undefined;
    return [{ name: attachment.name, rows: parseDelimited(decodeText(file.bytes, CSV_LIMIT).text) }];
  }, [attachment.kind, attachment.name, file]);

  useEffect(() => {
    if (attachment.kind === "csv" || file.status !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const workbook = await readXlsxFile(file.bytes);
        if (cancelled) return;
        setSheets(
          workbook.map((sheet) => ({
            name: sheet.sheet,
            rows: sheet.data
              .slice(0, TABLE_MAX_ROWS + 1)
              .map((row) => row.slice(0, TABLE_MAX_COLUMNS).map((value) => cellText(value, tag))),
          })),
        );
      } catch {
        if (!cancelled) setSheets("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.kind, file, tag]);

  const resolved = csvSheets ?? sheets;

  if (file.status === "error" || resolved === "error") {
    return <ViewerMessage tone="error">{t("attachments.previewFailed")}</ViewerMessage>;
  }
  if (!resolved) return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;

  const sheet = resolved[Math.min(active, resolved.length - 1)];
  if (!sheet) return <ViewerMessage>{t("attachments.emptySheet")}</ViewerMessage>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {resolved.length > 1 ? (
        <ViewerToolbar className="justify-start overflow-x-auto flex-nowrap">
          <div role="tablist" aria-label={t("attachments.sheets")} className="flex gap-1">
            {resolved.map((item, index) => (
              <button
                key={`${index}-${item.name}`}
                type="button"
                role="tab"
                aria-selected={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  "whitespace-nowrap rounded-[5px] px-2.5 py-1 text-[12.5px] transition-colors",
                  index === active ? "bg-paper-2 font-medium text-ink" : "text-ink-2 hover:bg-paper-2/70 hover:text-ink",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
        </ViewerToolbar>
      ) : null}
      <div className="min-h-0 flex-1" role={resolved.length > 1 ? "tabpanel" : undefined}>
        <DataTable key={active} rows={sheet.rows} />
      </div>
    </div>
  );
}
