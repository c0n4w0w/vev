"use client";

import { useId, useRef } from "react";
import { cn } from "@/components/ui/primitives";
import { IconAttach, IconClose, IconFile, IconRetry } from "@/components/ui/icons";
import { formatFileSize } from "@/lib/collaboration-file-type";
import { useLocale, useT } from "@/lib/i18n/react";
import { ATTACHMENT_ACCEPT } from "@/lib/attachment-types";
import type { PendingAttachment } from "@/components/community/attachments/useAttachmentUploads";

/**
 * The quiet paperclip beside the emoji button. Opens the native file picker;
 * nothing else happens here, and picking files never sends anything.
 *
 * `lockedReason` is the member-to-member case before both people have
 * written: the button stays where it is, focusable, and says why it does
 * nothing yet — on hover, on focus, and to a screen reader.
 */
export function AttachmentButton({
  onPick,
  disabled,
  lockedReason,
  className,
}: {
  onPick: (files: FileList) => void;
  /** Temporarily unavailable: the message already has as many files as it may. */
  disabled?: boolean;
  lockedReason?: string;
  className?: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const tooltipId = useId();
  const locked = Boolean(lockedReason);

  return (
    <div className={cn("group/attach relative shrink-0", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) onPick(event.target.files);
          // The same file can be picked again after being removed.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (!locked && !disabled) inputRef.current?.click();
        }}
        // A locked button stays in the tab order so its explanation can be
        // reached; `disabled` would hide both from keyboard and hover.
        aria-disabled={locked || disabled || undefined}
        aria-describedby={locked ? tooltipId : undefined}
        aria-label={t("attachments.attach")}
        title={locked ? undefined : t("attachments.attach")}
        className={cn(
          "rounded-[5px] p-2 text-ink-3 transition-colors",
          locked || disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-paper-2 hover:text-ink",
        )}
      >
        <IconAttach size={18} />
      </button>
      {locked ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-50 w-60 rounded-[5px] bg-ink px-3 py-2",
            "text-left text-[12px] leading-snug text-white opacity-0 shadow-lg transition-opacity",
            "group-focus-within/attach:opacity-100 group-hover/attach:opacity-100",
          )}
        >
          {lockedReason}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The files picked for the message being written, above the composer: what
 * each is, how large, how far its upload has come, and a way to take it out
 * again before anything is sent.
 */
export function PendingAttachmentList({
  items,
  onRemove,
  onRetry,
  accent,
}: {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  accent: string;
}) {
  const t = useT();
  const locale = useLocale();
  if (items.length === 0) return null;

  return (
    <ul aria-label={t("attachments.selected")} className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => {
        const percent = Math.round(item.progress * 100);
        const busy = item.status === "queued" || item.status === "uploading";
        return (
          <li
            key={item.key}
            className={cn(
              "relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[6px] border bg-surface py-1.5 pl-1.5 pr-1",
              // A refused file takes the whole row, so the reason can be read.
              item.status === "error" ? "border-rust/40" : "border-line-2 sm:w-[15.5rem]",
            )}
          >
            {item.previewUrl ? (
              // A local object URL for a file the person picked themselves.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.previewUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-[4px] border border-line object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-line bg-paper text-ink-3">
                <IconFile size={18} />
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink" title={item.name}>
                {item.name}
              </span>
              <span
                className={cn(
                  "block text-[11px]",
                  item.status === "error" ? "leading-snug text-rust" : "truncate text-ink-3",
                )}
                role={item.status === "error" ? "alert" : undefined}
              >
                {item.status === "error"
                  ? (item.error ?? t("attachments.uploadFailed"))
                  : busy
                    ? t("attachments.uploadingPercent", { percent })
                    : `${item.typeLabel} · ${formatFileSize(item.sizeBytes, locale)}`}
              </span>
            </span>

            {item.status === "error" ? (
              <button
                type="button"
                onClick={() => onRetry(item.key)}
                aria-label={`${t("attachments.retry")}: ${item.name}`}
                title={t("attachments.retry")}
                className="shrink-0 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <IconRetry size={15} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              aria-label={t("attachments.remove", { name: item.name })}
              title={t("attachments.remove", { name: item.name })}
              className="shrink-0 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <IconClose size={15} />
            </button>

            {busy ? (
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={item.name}
                className="absolute inset-x-0 bottom-0 h-[2px] bg-line"
              >
                <span
                  className="block h-full transition-[width] duration-150"
                  style={{ width: `${Math.max(percent, 3)}%`, backgroundColor: accent }}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
