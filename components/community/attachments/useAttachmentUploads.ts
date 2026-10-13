"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/react";
import {
  hasSupportedExtension,
  type AttachmentPolicy,
  type MessageAttachment,
} from "@/lib/attachment-types";

/** Which conversation the composer writes to. */
export type AttachmentTargetRef = { channelId: string } | { conversationId: string };

export interface PendingAttachment {
  /** Local to this composer; the server's id arrives in `attachment`. */
  key: string;
  name: string;
  /** The browser's guess, for the label only. The server reads the bytes. */
  typeLabel: string;
  sizeBytes: number;
  status: "queued" | "uploading" | "ready" | "error";
  /** 0–1 while uploading. */
  progress: number;
  error?: string;
  /** An in-memory preview of an image the person just picked. */
  previewUrl?: string;
  attachment?: MessageAttachment;
}

type Entry = PendingAttachment & { file: File; request?: XMLHttpRequest };

const CONCURRENT_UPLOADS = 2;

function typeLabelOf(file: File): string {
  const match = /\.([a-z0-9]+)$/i.exec(file.name.trim());
  return (match ? match[1] : "fil").toUpperCase();
}

/**
 * The files someone has picked for the message they are writing.
 *
 * Each file is uploaded as soon as it is picked — to the conversation in
 * `target`, which is where it is bound from then on — and becomes sendable
 * when the server answers with its attachment. The checks made here (count,
 * size, extension) only spare a round trip; the server makes every one of
 * them again, from the bytes and from the database, and its refusal is what
 * the list shows.
 *
 * Nothing picked is ever shown as sent. A file that is removed, or left
 * behind when the composer goes away, is withdrawn on the server too; one the
 * browser never got to withdraw is swept there later.
 */
export function useAttachmentUploads({
  communityId,
  target,
  policy,
}: {
  communityId: string;
  target: AttachmentTargetRef;
  policy: AttachmentPolicy;
}) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const entriesRef = useRef<Entry[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const targetQuery =
    "channelId" in target
      ? `channel=${encodeURIComponent(target.channelId)}`
      : `conversation=${encodeURIComponent(target.conversationId)}`;
  const uploadUrl = useMemo(
    () => `/community/${encodeURIComponent(communityId)}/attachments/upload?${targetQuery}`,
    [communityId, targetQuery],
  );
  // Keys whose upload has been started, so a re-render between starting a
  // request and recording it can never start the same file twice.
  const started = useRef(new Set<string>());

  const patch = useCallback((key: string, change: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));
  }, []);

  const withdraw = useCallback((attachment: MessageAttachment | undefined, keepalive = false) => {
    if (!attachment) return;
    // Best effort. The server only removes the caller's own unsent upload,
    // and sweeps whatever this never reaches.
    void fetch(attachment.url, { method: "DELETE", keepalive }).catch(() => undefined);
  }, []);

  const start = useCallback(
    (entry: Entry) => {
      if (started.current.has(entry.key)) return;
      started.current.add(entry.key);
      const request = new XMLHttpRequest();
      const form = new FormData();
      form.set("file", entry.file, entry.file.name);

      request.open("POST", uploadUrl);
      request.responseType = "json";
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) patch(entry.key, { progress: event.loaded / event.total });
      };
      request.onload = () => {
        const body = request.response as
          | { ok?: boolean; message?: string; attachment?: MessageAttachment }
          | null;
        if (request.status === 201 && body?.ok && body.attachment) {
          // Removed while the last bytes were in flight: take it back.
          if (!entriesRef.current.some((item) => item.key === entry.key)) {
            withdraw(body.attachment);
            return;
          }
          patch(entry.key, { status: "ready", progress: 1, attachment: body.attachment, request: undefined });
          return;
        }
        patch(entry.key, {
          status: "error",
          request: undefined,
          error: body?.message ?? t("err.attachmentUploadFailed", { name: entry.name }),
        });
      };
      request.onerror = () => {
        patch(entry.key, {
          status: "error",
          request: undefined,
          error: t("err.attachmentUploadFailed", { name: entry.name }),
        });
      };
      // An abort is the person removing the file; the entry is already gone.
      request.send(form);
      patch(entry.key, { status: "uploading", progress: 0, error: undefined, request });
    },
    [patch, t, uploadUrl, withdraw],
  );

  // Starts queued files, a couple at a time, as slots free up.
  useEffect(() => {
    const active = entries.filter((entry) => entry.status === "uploading").length;
    const next = entries.filter((entry) => entry.status === "queued").slice(0, CONCURRENT_UPLOADS - active);
    for (const entry of next) start(entry);
  }, [entries, start]);

  const add = useCallback(
    (files: FileList | File[]) => {
      if (!policy.allowed) return;
      const picked = Array.from(files);
      if (picked.length === 0) return;

      const room = Math.max(0, policy.maxFiles - entriesRef.current.length);
      const maxMb = Math.round(policy.maxBytes / (1024 * 1024));
      let problem: string | undefined;
      const accepted: Entry[] = [];

      for (const file of picked) {
        if (accepted.length >= room) {
          problem = t("err.attachmentTooMany", { max: policy.maxFiles });
          break;
        }
        if (file.size === 0) {
          problem = t("err.attachmentEmpty", { name: file.name });
          continue;
        }
        if (file.size > policy.maxBytes) {
          problem = t("err.attachmentTooLarge", { name: file.name, max: maxMb });
          continue;
        }
        if (!hasSupportedExtension(file.name)) {
          problem = t("err.attachmentType", { name: file.name });
          continue;
        }
        counter.current += 1;
        accepted.push({
          key: `pending-${Date.now()}-${counter.current}`,
          file,
          name: file.name,
          typeLabel: typeLabelOf(file),
          sizeBytes: file.size,
          status: "queued",
          progress: 0,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }

      setNotice(problem);
      if (accepted.length > 0) setEntries((current) => [...current, ...accepted]);
    },
    [policy.allowed, policy.maxBytes, policy.maxFiles, t],
  );

  const remove = useCallback(
    (key: string) => {
      const entry = entriesRef.current.find((item) => item.key === key);
      if (!entry) return;
      entry.request?.abort();
      withdraw(entry.attachment);
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      setEntries((current) => current.filter((item) => item.key !== key));
      setNotice(undefined);
    },
    [withdraw],
  );

  const retry = useCallback(
    (key: string) => {
      started.current.delete(key);
      patch(key, { status: "queued", progress: 0, error: undefined });
    },
    [patch],
  );

  /**
   * Hands the ready files to a send and empties the list. Returns a function
   * that puts them back, for a send the server refused: the uploads are still
   * there, so the person can simply press send again.
   */
  const take = useCallback(() => {
    const taken = entriesRef.current;
    setEntries([]);
    setNotice(undefined);
    return {
      attachments: taken.flatMap((entry) => (entry.attachment ? [entry.attachment] : [])),
      restore: () => setEntries((current) => [...taken, ...current]),
      release: () => {
        for (const entry of taken) if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      },
    };
  }, []);

  // Leaving the conversation with files still picked: stop what is in flight
  // and withdraw what was uploaded but never sent.
  useEffect(
    () => () => {
      for (const entry of entriesRef.current) {
        entry.request?.abort();
        withdraw(entry.attachment, true);
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      }
    },
    [withdraw],
  );

  const items: PendingAttachment[] = entries;
  const uploading = entries.some((entry) => entry.status === "queued" || entry.status === "uploading");
  const failed = entries.some((entry) => entry.status === "error");

  return {
    items,
    /** A refusal that applied to the pick itself (too many, too large, wrong type). */
    notice,
    clearNotice: useCallback(() => setNotice(undefined), []),
    add,
    remove,
    retry,
    take,
    /** Something is still on its way up. */
    uploading,
    /** A picked file was refused or failed, and is still in the list. */
    failed,
    /** Every picked file is uploaded and none failed. */
    sendable: entries.length > 0 && !uploading && !failed,
    isEmpty: entries.length === 0,
    /** No room for another file in this message. */
    full: entries.length >= policy.maxFiles,
  };
}
