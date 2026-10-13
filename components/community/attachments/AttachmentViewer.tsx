"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/components/ui/primitives";
import { IconChevronLeft, IconChevronRight, IconClose, IconDownload } from "@/components/ui/icons";
import { formatFileSize } from "@/lib/collaboration-file-type";
import { useLocale, useT } from "@/lib/i18n/react";
import { attachmentTypeLabel, type MessageAttachment } from "@/lib/attachment-types";
import { ImageViewer } from "@/components/community/attachments/viewers/ImageViewer";
import { ViewerMessage } from "@/components/community/attachments/viewers/shared";

function Loading() {
  const t = useT();
  return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;
}

// One library per format, each fetched only when a file of that format is
// opened for the first time.
const PdfViewer = dynamic(() => import("./viewers/PdfViewer").then((mod) => mod.PdfViewer), {
  ssr: false,
  loading: Loading,
});
const DocxViewer = dynamic(() => import("./viewers/DocxViewer").then((mod) => mod.DocxViewer), {
  ssr: false,
  loading: Loading,
});
const SpreadsheetViewer = dynamic(
  () => import("./viewers/SpreadsheetViewer").then((mod) => mod.SpreadsheetViewer),
  { ssr: false, loading: Loading },
);
const PresentationViewer = dynamic(
  () => import("./viewers/PresentationViewer").then((mod) => mod.PresentationViewer),
  { ssr: false, loading: Loading },
);
const TextViewer = dynamic(() => import("./viewers/TextViewer").then((mod) => mod.TextViewer), {
  ssr: false,
  loading: Loading,
});

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-[5px] p-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * The one place an attachment is opened: a modal over the conversation, with
 * the file's name, a download and a close control, and beneath them whichever
 * read-only view the format has. The conversation stays where it was.
 *
 * A native modal dialog, so focus moves in and stays in, Escape closes it and
 * everything behind is inert. With several images, the arrow keys, the two
 * buttons and a sideways swipe move between them.
 *
 * Every byte shown here comes from the attachment's own authenticated address
 * — the same check as a download, made again for each request. Nothing in a
 * document is ever executed: each viewer either draws pixels, shows text, or
 * renders sanitised markup inside a frame with scripting switched off.
 */
export function AttachmentViewer({
  items,
  initialIndex,
  onClose,
}: {
  items: MessageAttachment[];
  initialIndex: number;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), items.length - 1));
  const attachment = items[index];
  const many = items.length > 1;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The page behind must not scroll while the viewer is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const go = useCallback(
    (step: number) => setIndex((current) => (current + step + items.length) % items.length),
    [items.length],
  );

  useEffect(() => {
    if (!many) return;
    function onKeyDown(event: KeyboardEvent) {
      // Left to the control that has focus when it is a text-like one.
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [go, many]);

  if (!attachment) return null;

  const meta = `${attachmentTypeLabel(attachment.mimeType)} · ${formatFileSize(attachment.sizeBytes, locale)}`;
  const dark = attachment.kind === "image";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-surface p-0 text-left text-ink shadow-xl",
        "backdrop:bg-ink/55",
        "sm:h-[calc(100dvh-3rem)] sm:w-[min(72rem,calc(100vw-3rem))] sm:rounded-[8px] sm:border sm:border-line",
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[0.9375rem] font-medium text-ink">
              {attachment.name}
            </h2>
            <p className="truncate text-[11px] text-ink-3">
              {meta}
              {many ? ` · ${t("attachments.position", { current: index + 1, total: items.length })}` : ""}
            </p>
          </div>
          {many ? (
            <div className="hidden shrink-0 items-center sm:flex">
              <HeaderButton label={t("attachments.previous")} onClick={() => go(-1)}>
                <IconChevronLeft size={18} />
              </HeaderButton>
              <HeaderButton label={t("attachments.next")} onClick={() => go(1)}>
                <IconChevronRight size={18} />
              </HeaderButton>
            </div>
          ) : null}
          <a
            href={`${attachment.url}?download=1`}
            download={attachment.name}
            aria-label={t("attachments.downloadNamed", { name: attachment.name })}
            title={t("attachments.download")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            <IconDownload size={15} />
            <span className="hidden sm:inline">{t("attachments.download")}</span>
          </a>
          <HeaderButton label={t("common.close")} onClick={onClose}>
            <IconClose size={18} />
          </HeaderButton>
        </header>

        <div className={cn("relative min-h-0 flex-1", dark ? "bg-[#1d2021]" : "bg-paper")}>
          {/* Keyed by attachment, so moving to the next file starts its view
              from scratch instead of carrying over zoom or a half-loaded file. */}
          {attachment.kind === "image" ? (
            <ImageViewer
              key={attachment.id}
              attachment={attachment}
              onPrevious={many ? () => go(-1) : undefined}
              onNext={many ? () => go(1) : undefined}
            />
          ) : attachment.kind === "pdf" ? (
            <PdfViewer key={attachment.id} attachment={attachment} />
          ) : attachment.kind === "document" ? (
            <DocxViewer key={attachment.id} attachment={attachment} />
          ) : attachment.kind === "spreadsheet" || attachment.kind === "csv" ? (
            <SpreadsheetViewer key={attachment.id} attachment={attachment} />
          ) : attachment.kind === "presentation" ? (
            <PresentationViewer key={attachment.id} attachment={attachment} />
          ) : attachment.kind === "text" ? (
            <TextViewer key={attachment.id} attachment={attachment} />
          ) : (
            <ViewerMessage>{t("attachments.previewFailed")}</ViewerMessage>
          )}
        </div>
      </div>
    </dialog>
  );
}
