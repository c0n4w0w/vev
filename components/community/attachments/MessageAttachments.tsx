"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/components/ui/primitives";
import { IconAudio, IconDownload, IconFile } from "@/components/ui/icons";
import { formatFileSize } from "@/lib/collaboration-file-type";
import { useLocale, useT } from "@/lib/i18n/react";
import { attachmentTypeLabel, type MessageAttachment } from "@/lib/attachment-types";

// The viewer — and the document libraries behind it — is only fetched when
// someone opens a file, so a conversation costs nothing extra to read.
const AttachmentViewer = dynamic(
  () => import("@/components/community/attachments/AttachmentViewer").then((mod) => mod.AttachmentViewer),
  { ssr: false },
);

/** Every address a message list asks for is the authenticated route, never storage. */
function thumbnailSrc(attachment: MessageAttachment) {
  return attachment.hasThumbnail ? `${attachment.url}?variant=thumb` : attachment.url;
}

function downloadHref(attachment: MessageAttachment) {
  return `${attachment.url}?download=1`;
}

function ImageTile({
  attachment,
  single,
  onOpen,
}: {
  attachment: MessageAttachment;
  single: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("attachments.open", { name: attachment.name })}
      className={cn(
        "group/tile relative block overflow-hidden rounded-[6px] border border-line bg-paper-2 text-left",
        "transition-[border-color] hover:border-ink-3",
        single ? "max-w-full" : "aspect-square w-full",
      )}
      style={
        single
          ? // One image keeps its own shape, inside a box no taller than it is wide.
            {
              width: `${Math.round(Math.min(20, Math.max(9, 15 * ratio)) * 16)}px`,
              aspectRatio: String(ratio),
              maxHeight: "20rem",
            }
          : undefined
      }
    >
      {/* Served by an authenticated route with per-request authorisation, so
          next/image — which fetches without the viewer's session — cannot be
          used here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailSrc(attachment)}
        alt={attachment.name}
        width={attachment.width}
        height={attachment.height}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    </button>
  );
}

function FileCard({ attachment, onOpen }: { attachment: MessageAttachment; onOpen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const meta = `${attachmentTypeLabel(attachment.mimeType)} · ${formatFileSize(attachment.sizeBytes, locale)}`;

  return (
    <div className="flex w-full max-w-[22rem] items-stretch overflow-hidden rounded-[6px] border border-line bg-surface text-left">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("attachments.open", { name: attachment.name })}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-paper-2/70"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-line bg-paper text-ink-3">
          <IconFile size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink">{attachment.name}</span>
          <span className="block truncate text-[11px] text-ink-3">{meta}</span>
        </span>
      </button>
      <a
        href={downloadHref(attachment)}
        download={attachment.name}
        aria-label={t("attachments.downloadNamed", { name: attachment.name })}
        title={t("attachments.download")}
        className="flex shrink-0 items-center border-l border-line px-2.5 text-ink-3 transition-colors hover:bg-paper-2/70 hover:text-ink"
      >
        <IconDownload size={16} />
      </a>
    </div>
  );
}

function AudioCard({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const locale = useLocale();
  const meta = `${attachmentTypeLabel(attachment.mimeType)} · ${formatFileSize(attachment.sizeBytes, locale)}`;

  return (
    <div className="w-full max-w-[22rem] overflow-hidden rounded-[6px] border border-line bg-surface text-left">
      <div className="flex items-center gap-2.5 px-2.5 pt-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-line bg-paper text-ink-3">
          <IconAudio size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{attachment.name}</span>
          <span className="block truncate text-[11px] text-ink-3">{meta}</span>
        </span>
        <a
          href={downloadHref(attachment)}
          download={attachment.name}
          aria-label={t("attachments.downloadNamed", { name: attachment.name })}
          title={t("attachments.download")}
          className="shrink-0 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <IconDownload size={16} />
        </a>
      </div>
      {/* Nothing is fetched until someone presses play. */}
      <audio
        controls
        preload="none"
        src={attachment.url}
        aria-label={attachment.name}
        className="block h-10 w-full px-1.5 pb-1.5 pt-1"
      />
    </div>
  );
}

/**
 * The files sent with one message, the same in every private conversation:
 * images inline (one keeps its shape, several form a compact grid) and
 * opening in a lightbox; documents as compact cards that open a read-only
 * preview, with a separate download; audio with the browser's own player.
 */
export function MessageAttachments({
  attachments,
  align = "start",
  className,
}: {
  attachments: MessageAttachment[] | undefined;
  /** `end` for the viewer's own messages in a direct conversation. */
  align?: "start" | "end";
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState<{ items: MessageAttachment[]; index: number } | null>(null);
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((attachment) => attachment.kind === "image");
  const others = attachments.filter((attachment) => attachment.kind !== "image");

  return (
    <div
      aria-label={t("attachments.list")}
      role="group"
      className={cn("flex flex-col gap-1.5", align === "end" ? "items-end" : "items-start", className)}
    >
      {images.length === 1 ? (
        <ImageTile attachment={images[0]} single onOpen={() => setOpen({ items: images, index: 0 })} />
      ) : images.length > 1 ? (
        <div
          className={cn(
            "grid w-full gap-1",
            images.length === 2 || images.length === 4 ? "max-w-[20rem] grid-cols-2" : "max-w-[24rem] grid-cols-3",
          )}
        >
          {images.map((image, index) => (
            <ImageTile
              key={image.id}
              attachment={image}
              single={false}
              onOpen={() => setOpen({ items: images, index })}
            />
          ))}
        </div>
      ) : null}

      {others.map((attachment) =>
        attachment.kind === "audio" ? (
          <AudioCard key={attachment.id} attachment={attachment} />
        ) : (
          <FileCard
            key={attachment.id}
            attachment={attachment}
            onOpen={() => setOpen({ items: [attachment], index: 0 })}
          />
        ),
      )}

      {open ? (
        <AttachmentViewer items={open.items} initialIndex={open.index} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
