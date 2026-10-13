"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import { ViewerMessage, ViewerNote, decodeText, useAttachmentBytes } from "./shared";

/** As much of a text file as is useful to read in a window. */
const TEXT_LIMIT = 512 * 1024;

/**
 * A plain-text file, as text. It is placed in the page as a text node inside
 * a `<pre>`, so whatever the file contains — markup included — is shown, not
 * interpreted.
 */
export function TextViewer({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const file = useAttachmentBytes(attachment);
  const decoded = useMemo(
    () => (file.status === "ready" ? decodeText(file.bytes, TEXT_LIMIT) : undefined),
    [file],
  );

  if (file.status === "loading") return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;
  if (file.status === "error" || !decoded) {
    return <ViewerMessage tone="error">{t("attachments.previewFailed")}</ViewerMessage>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {decoded.truncated ? <ViewerNote>{t("attachments.truncatedText")}</ViewerNote> : null}
      <div className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0}>
        <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words px-5 py-5 font-mono text-[13px] leading-relaxed text-ink">
          {decoded.text}
        </pre>
      </div>
    </div>
  );
}
