"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";

/** A centred line in the viewer: loading, a failure, an empty file. */
export function ViewerMessage({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "error" }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p
        role={tone === "error" ? "alert" : "status"}
        className={cn("max-w-sm text-center text-sm leading-relaxed", tone === "error" ? "text-ink-2" : "text-ink-3")}
      >
        {children}
      </p>
    </div>
  );
}

/** The strip of controls a viewer puts above its content (pages, zoom, sheets). */
export function ViewerToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-center gap-1 border-b border-line bg-surface px-2 py-1.5 text-[12px] text-ink-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-[5px] p-1.5 text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** A quiet line under the toolbar saying what kind of preview this is. */
export function ViewerNote({ children }: { children: ReactNode }) {
  return (
    <p className="shrink-0 border-b border-line bg-paper-2/60 px-4 py-1.5 text-center text-[11px] text-ink-3">
      {children}
    </p>
  );
}

export type AttachmentBytes =
  | { status: "loading" }
  | { status: "ready"; bytes: ArrayBuffer }
  | { status: "error" };

/**
 * The attachment's bytes, from its authenticated address — the same route a
 * download uses, so a preview is authorised exactly as a download is. Fetched
 * again each time a file is opened and never from a shared cache.
 */
export function useAttachmentBytes(attachment: MessageAttachment): AttachmentBytes {
  const [state, setState] = useState<AttachmentBytes>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(attachment.url, { credentials: "same-origin", cache: "no-cache", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setState({ status: "ready", bytes: await response.arrayBuffer() });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [attachment.url]);

  return state;
}

/**
 * Text from a file that did not say how it was encoded: UTF-16 when it opens
 * with a byte-order mark, UTF-8 when it is valid UTF-8, and otherwise the
 * Western single-byte encoding Excel writes on a Norwegian machine.
 */
export function decodeText(bytes: ArrayBuffer, limit: number): { text: string; truncated: boolean } {
  const view = new Uint8Array(bytes);
  const truncated = view.byteLength > limit;
  const slice = truncated ? view.subarray(0, limit) : view;

  let text: string;
  if (slice[0] === 0xff && slice[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(slice);
  } else if (slice[0] === 0xfe && slice[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(slice);
  } else {
    try {
      // A multi-byte character cut in half by the limit is not an encoding error.
      text = new TextDecoder("utf-8", { fatal: !truncated }).decode(slice);
    } catch {
      text = new TextDecoder("windows-1252").decode(slice);
    }
  }
  return { text: text.replace(/^﻿/, ""), truncated };
}

/** "A", "B", … "Z", "AA": the column letters of a spreadsheet. */
function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

export const TABLE_MAX_ROWS = 1000;
export const TABLE_MAX_COLUMNS = 60;

/**
 * Rows and columns as a read-only grid, scrollable both ways, with the row
 * numbers and column letters of a spreadsheet kept in view. Every cell is
 * plain text — nothing in a file can become markup here.
 */
export function DataTable({ rows }: { rows: string[][] }) {
  const t = useT();
  const shown = rows.slice(0, TABLE_MAX_ROWS);
  const columns = Math.min(
    TABLE_MAX_COLUMNS,
    shown.reduce((max, row) => Math.max(max, row.length), 0),
  );

  if (shown.length === 0 || columns === 0) return <ViewerMessage>{t("attachments.emptySheet")}</ViewerMessage>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {rows.length > TABLE_MAX_ROWS ? (
        <ViewerNote>{t("attachments.truncatedRows", { count: TABLE_MAX_ROWS })}</ViewerNote>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0}>
        <table className="border-separate border-spacing-0 text-[12.5px] text-ink">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-10 border-b border-r border-line bg-paper-2" />
              {Array.from({ length: columns }, (_, column) => (
                <th
                  key={column}
                  scope="col"
                  className="sticky top-0 z-10 border-b border-r border-line bg-paper-2 px-2 py-1 text-center text-[11px] font-medium text-ink-3"
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-line bg-paper-2 px-2 py-1 text-right text-[11px] font-medium tabular-nums text-ink-3"
                >
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columns }, (_, column) => (
                  <td
                    key={column}
                    className="max-w-[22rem] truncate whitespace-nowrap border-b border-r border-line px-2 py-1 align-top"
                    title={row[column] && row[column].length > 40 ? row[column] : undefined}
                  >
                    {row[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
