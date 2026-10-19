/**
 * Keeps the check scripts' Storage cleanup to their own files.
 *
 * Deleting a message only queues its files (message_attachment_purges); the
 * next purge, from wherever it runs, removes everything queued. A suite that
 * purged the whole queue would therefore also finish off a file someone had
 * just deleted by hand in the development app — or, through the abandoned
 * upload sweep, someone's unsent draft.
 *
 * So each suite records, before it does anything, every object in the bucket
 * and every queued name, and its purges leave exactly those alone. What it
 * creates afterwards it may remove; nothing that was there before. The app's
 * own purge after a deletion and `npm run attachments:sweep` are unchanged
 * and still take the whole queue.
 */
import { execFileSync } from "node:child_process";
import {
  purgeAttachmentObjects,
  sweepAbandonedAttachments,
  type AttachmentPurgeOptions,
} from "@/lib/attachment-storage";

let existing: Set<string> | undefined;

/** Call first in a suite's main(), before any cleanup. */
export function rememberExistingAttachmentObjects(): ReadonlySet<string> {
  const out = execFileSync(
    "docker",
    [
      "exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev",
      "psql", "-U", "postgres", "-d", "postgres", "-At", "-c",
      `select name from storage.objects where bucket_id = 'message-attachments'
       union select storage_path from public.message_attachment_purges`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString();
  existing = new Set(out.split("\n").map((line) => line.trim()).filter(Boolean));
  return existing;
}

function keep(): ReadonlySet<string> {
  if (!existing) throw new Error("rememberExistingAttachmentObjects() must run before a purge");
  return existing;
}

/** purgeAttachmentObjects, limited to objects this run created. */
export function purgeOwnAttachmentObjects(limit = 200, options: Omit<AttachmentPurgeOptions, "keep"> = {}) {
  return purgeAttachmentObjects(limit, { ...options, keep: keep() });
}

/** sweepAbandonedAttachments, whose purge is limited the same way. */
export function sweepOwnAbandonedAttachments(olderThanHours: number) {
  return sweepAbandonedAttachments(olderThanHours, { keep: keep() });
}
