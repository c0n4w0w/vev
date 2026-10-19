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
 *   expire   delete disappearing direct messages whose time is up
 *            (purge_expired_direct_messages, service role only), so their
 *            files join that same queue. Reading them was already refused by
 *            the database from the moment they expired.
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

export type AttachmentPurgeOptions = {
  remove?: RemoveObjects;
  /**
   * Queued names this run must leave alone — neither removed nor counted.
   * Only the check scripts pass it, with every object that existed before
   * they started, so a suite never removes a file it did not create. The app
   * and the scheduled sweep purge the whole queue.
   */
  keep?: ReadonlySet<string>;
};

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
  options: AttachmentPurgeOptions = {},
): Promise<AttachmentPurgeResult> {
  const admin = createSupabaseAdminClient();
  const remove: RemoveObjects = options.remove ?? ((paths) => admin.storage.from(BUCKET).remove(paths));

  let removed = 0;
  let failed = 0;

  const keep = options.keep ?? new Set<string>();
  const { data: read, error } = await admin
    .from("message_attachment_purges")
    .select("storage_path")
    .order("queued_at", { ascending: true })
    .limit(limit + keep.size);
  if (error) {
    console.error(`[attachments] could not read the purge queue: ${error.message}`);
  }
  const queued = (read ?? []).filter((row) => !keep.has(row.storage_path)).slice(0, limit);

  for (let start = 0; start < queued.length; start += 50) {
    const paths = queued.slice(start, start + 50).map((row) => row.storage_path);
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

  if (keep.size > 0) {
    const { data: left } = await admin
      .from("message_attachment_purges")
      .select("storage_path, queued_at")
      .order("queued_at", { ascending: true });
    const own = (left ?? []).filter((row) => !keep.has(row.storage_path));
    return { removed, failed, remaining: own.length, oldestQueuedAt: own[0]?.queued_at };
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
  purgeOptions: AttachmentPurgeOptions = {},
): Promise<AttachmentPurgeResult & { swept: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("sweep_abandoned_message_attachments", {
    p_older_than: `${olderThanHours} hours`,
  });
  if (error) console.error(`[attachments] could not sweep abandoned uploads: ${error.message}`);
  const purge = await purgeAttachmentObjects(1000, purgeOptions);
  return { swept: typeof data === "number" ? data : 0, ...purge };
}

/** Expired messages deleted per database call; a busy backlog takes several. */
const EXPIRE_BATCH = 500;

/**
 * Deletes disappearing direct messages that have expired, then removes their
 * files' objects through the purge queue.
 *
 * Nothing is decided here: the database chooses the rows by their own
 * `expires_at` against its own clock, locks each one and re-reads it before
 * deleting, so a late or repeated run never touches a message whose timer
 * started meanwhile, and runs from several places at once skip each other.
 * `conversationIds` limits it to those conversations; the app passes the one
 * just opened, the check suite its own, the scheduled sweep nothing (all).
 */
export async function purgeExpiredDirectMessages(
  options: { conversationIds?: string[]; purge?: AttachmentPurgeOptions; maxBatches?: number } = {},
): Promise<AttachmentPurgeResult & { expired: number }> {
  const admin = createSupabaseAdminClient();
  let expired = 0;
  for (let batch = 0; batch < (options.maxBatches ?? 20); batch += 1) {
    const { data, error } = await admin.rpc("purge_expired_direct_messages", {
      p_limit: EXPIRE_BATCH,
      ...(options.conversationIds ? { p_conversation_ids: options.conversationIds } : {}),
    });
    if (error) {
      console.error(`[messages] could not delete expired direct messages: ${error.message}`);
      break;
    }
    const count = typeof data === "number" ? data : 0;
    expired += count;
    if (count < EXPIRE_BATCH) break;
  }
  const purge = await purgeAttachmentObjects(1000, options.purge);
  return { expired, ...purge };
}
