import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The three things about message attachments that only the server may do.
 *
 *   store    put an object in the private bucket. A browser has no insert
 *            policy there, so a file exists only if the upload route read its
 *            bytes, decided its type, and was allowed to open an upload by the
 *            database acting for the signed-in person.
 *   complete tell the database the object is in place, which is what makes an
 *            upload sendable (complete_message_attachment is service-role
 *            only).
 *   purge    remove objects whose row is gone. Storage refuses SQL deletes, so
 *            rows that disappear leave their object names in
 *            message_attachment_purges and this removes them.
 *
 * The service role is used for exactly these, and never to decide anything:
 * who may upload, into which conversation, how much, and who may read it
 * afterwards are all answered by the database for the caller's own session
 * before any of this runs. No `server-only` import, for the same reason as
 * lib/supabase/admin.ts: the check and maintenance scripts run it under node.
 */

const BUCKET = "message-attachments";

/** Where an image's small rendition lives, beside the original. */
export function thumbnailPath(storagePath: string): string {
  return `${storagePath.slice(0, storagePath.lastIndexOf("."))}.thumb.webp`;
}

/** Writes one object. Never overwrites: every name is generated and used once. */
export async function storeAttachmentObject(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: "0",
  });
  return !error;
}

/** Marks an upload ready. The database verifies the stored object first. */
export async function completeAttachment(attachmentId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("complete_message_attachment", {
    p_attachment_id: attachmentId,
  });
  return !error && data === true;
}

/**
 * Drops an upload that could not be finished, whatever state it reached. The
 * row is removed if it was never sent; its objects follow through the queue.
 */
export async function abandonAttachment(attachmentId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("message_attachments").delete().eq("id", attachmentId).neq("status", "sent");
  await purgeAttachmentObjects();
}

export type AttachmentPurgeResult = {
  /** Objects removed from the bucket and cleared from the queue in this run. */
  removed: number;
  /** Entries this run tried and could not finish. They are still queued. */
  failed: number;
  /** Entries left in the queue afterwards, whatever the reason. */
  remaining: number;
  /** When the oldest of those was queued. */
  oldestQueuedAt?: string;
};

/** How a batch of objects is removed. Replaceable so a failure can be rehearsed. */
type RemoveObjects = (paths: string[]) => Promise<{ error: { message: string } | null }>;

/**
 * Removes queued objects from the bucket and clears what was removed.
 *
 * Safe to run at any time and from several places at once: removing an object
 * that is already gone succeeds, and an entry is cleared only after Storage
 * has confirmed the batch.
 *
 * A failure is never silent and never final. The entry stays in
 * `message_attachment_purges` — which is the durable record of every file
 * still owed a deletion — so the next run, from any trigger, tries it again.
 * Each failed batch is logged with the reason, and the result says how many
 * entries remain and how old the oldest is, which is what the scheduled sweep
 * prints and turns into a non-zero exit. A file waiting here is already
 * unreachable: reading needs a row, and the row is gone.
 */
export async function purgeAttachmentObjects(
  limit = 200,
  options: { remove?: RemoveObjects } = {},
): Promise<AttachmentPurgeResult> {
  const admin = createSupabaseAdminClient();
  const remove: RemoveObjects = options.remove ?? ((paths) => admin.storage.from(BUCKET).remove(paths));

  let removed = 0;
  let failed = 0;

  const { data: queued, error } = await admin
    .from("message_attachment_purges")
    .select("storage_path")
    .order("queued_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error(`[attachments] could not read the purge queue: ${error.message}`);
  }

  for (let start = 0; start < (queued?.length ?? 0); start += 50) {
    const paths = queued!.slice(start, start + 50).map((row) => row.storage_path);
    let problem: string | undefined;
    try {
      problem = (await remove(paths)).error?.message;
      if (!problem) {
        const cleared = await admin.from("message_attachment_purges").delete().in("storage_path", paths);
        problem = cleared.error?.message;
      }
    } catch (thrown) {
      problem = thrown instanceof Error ? thrown.message : String(thrown);
    }
    if (problem) {
      failed += paths.length;
      console.error(
        `[attachments] ${paths.length} stored file(s) could not be removed and stay queued: ${problem}`,
      );
    } else {
      removed += paths.length;
    }
  }

  const { data: oldest, count } = await admin
    .from("message_attachment_purges")
    .select("queued_at", { count: "exact" })
    .order("queued_at", { ascending: true })
    .limit(1);
  return {
    removed,
    failed,
    remaining: count ?? failed,
    oldestQueuedAt: oldest?.[0]?.queued_at,
  };
}

/**
 * Removes uploads that were never sent — a closed tab, a send nobody retried —
 * and then their objects. `olderThanHours` is floored at ten minutes by the
 * database, so an upload in progress is never swept from under its sender.
 */
export async function sweepAbandonedAttachments(
  olderThanHours = 24,
): Promise<AttachmentPurgeResult & { swept: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("sweep_abandoned_message_attachments", {
    p_older_than: `${olderThanHours} hours`,
  });
  if (error) console.error(`[attachments] could not sweep abandoned uploads: ${error.message}`);
  const purge = await purgeAttachmentObjects(1000);
  return { swept: typeof data === "number" ? data : 0, ...purge };
}
