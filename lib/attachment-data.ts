import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageAttachmentRow } from "@/lib/supabase/database.types";
import {
  NO_ATTACHMENTS,
  attachmentKind,
  attachmentUrl,
  type AttachmentPolicy,
  type AttachmentPolicyReason,
  type MessageAttachment,
} from "@/lib/attachment-types";

/**
 * Message attachments, read and written as the signed-in person.
 *
 * Like the rest of the data layer, nothing here decides who may do what.
 * Every function runs with the caller's own session: the policy, the limits
 * and the mutual-text rule come from message_attachment_policy(); the rows
 * and the objects come back only if row level security admits them; and the
 * two send functions re-check all of it at the moment of sending. The two
 * steps a browser must never be able to perform — storing an object and
 * vouching for it — are not here at all (lib/attachment-storage.ts).
 */

export const ATTACHMENT_BUCKET = "message-attachments";

/** Which conversation: a channel or a direct conversation, never both. */
export type AttachmentTarget =
  | { channelId: string; conversationId?: undefined }
  | { conversationId: string; channelId?: undefined };

// The generated argument types are non-null, but each function takes exactly
// one of the two ids and null for the other.
function targetArgs(target: AttachmentTarget) {
  return {
    p_channel_id: (target.channelId ?? null) as string,
    p_conversation_id: (target.conversationId ?? null) as string,
  };
}

const REASONS = new Set<AttachmentPolicyReason>([
  "ok",
  "not_found",
  "unsupported",
  "archived",
  "read_only",
  "closed",
  "needs_mutual",
]);

export type ResolvedAttachmentPolicy = AttachmentPolicy & { communityId?: string };

/**
 * Whether the caller may attach files in this conversation, and how much.
 * A conversation they cannot see, a failed lookup and a signed-out caller are
 * all the same closed answer.
 */
export async function getAttachmentPolicy(target: AttachmentTarget): Promise<ResolvedAttachmentPolicy> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("message_attachment_policy", targetArgs(target)).maybeSingle();
  if (error || !data) return { ...NO_ATTACHMENTS, reason: "not_found" };

  const reason = REASONS.has(data.reason as AttachmentPolicyReason)
    ? (data.reason as AttachmentPolicyReason)
    : "not_found";
  return {
    allowed: data.allowed === true && reason === "ok",
    reason,
    maxBytes: Number(data.max_bytes) || 0,
    maxFiles: data.max_files ?? 0,
    communityId: data.community_id ?? undefined,
  };
}

export function toMessageAttachment(row: MessageAttachmentRow): MessageAttachment {
  return {
    id: row.id,
    name: row.display_name,
    mimeType: row.mime_type,
    kind: attachmentKind(row.mime_type),
    sizeBytes: row.size_bytes,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    url: attachmentUrl(row.community_id, row.id),
    hasThumbnail: Boolean(row.thumb_path),
  };
}

function groupBy(
  rows: MessageAttachmentRow[],
  key: (row: MessageAttachmentRow) => string | null,
): Map<string, MessageAttachment[]> {
  const grouped = new Map<string, MessageAttachment[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const list = grouped.get(id);
    if (list) list.push(toMessageAttachment(row));
    else grouped.set(id, [toMessageAttachment(row)]);
  }
  return grouped;
}

/** A channel's sent attachments, by message id, in the order they were attached. */
export async function getChannelAttachments(channelId: string): Promise<Map<string, MessageAttachment[]>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("message_attachments")
    .select("*")
    .eq("channel_id", channelId)
    .eq("status", "sent")
    .order("position", { ascending: true });
  return groupBy(data ?? [], (row) => row.message_id);
}

/** A direct conversation's sent attachments, by direct message id. */
export async function getConversationAttachments(
  conversationId: string,
): Promise<Map<string, MessageAttachment[]>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("message_attachments")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "sent")
    .order("position", { ascending: true });
  return groupBy(data ?? [], (row) => row.direct_message_id);
}

export type AttachmentRefusal =
  | "notAllowed"
  | "needsMutual"
  | "archived"
  | "type"
  | "tooLarge"
  | "tooMany"
  | "invalid"
  | "tooLong"
  | "mention"
  | "tooManyMentions"
  | "failed";

/** The database's refusal, as one of the reasons the interface can explain. */
export function attachmentRefusal(message: string | undefined): AttachmentRefusal {
  const text = message ?? "";
  if (text.includes("attachment_not_allowed:needs_mutual")) return "needsMutual";
  if (text.includes("attachment_not_allowed:archived")) return "archived";
  if (text.includes("attachment_not_allowed")) return "notAllowed";
  if (text.includes("attachment_type")) return "type";
  if (text.includes("attachment_too_large")) return "tooLarge";
  if (text.includes("attachment_too_many")) return "tooMany";
  if (text.includes("attachment_invalid") || text.includes("attachment_required")) return "invalid";
  if (text.includes("message_too_long")) return "tooLong";
  if (text.includes("message_error:mention_not_allowed")) return "mention";
  if (text.includes("message_error:too_many_mentions")) return "tooManyMentions";
  return "failed";
}

export type BeginAttachmentResult =
  | { ok: true; attachmentId: string; storagePath: string }
  | { ok: false; refusal: AttachmentRefusal };

/**
 * Opens an upload for the caller in one conversation. The database checks the
 * policy, the type and the size for this person and returns the row id and the
 * object name it generated; nothing about either comes from the browser.
 */
export async function beginAttachment(
  target: AttachmentTarget,
  file: { displayName: string; mimeType: string; sizeBytes: number; width?: number; height?: number },
): Promise<BeginAttachmentResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("begin_message_attachment", {
      ...targetArgs(target),
      p_display_name: file.displayName,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
      p_width: file.width,
      p_height: file.height,
    })
    .maybeSingle();

  if (error || !data) return { ok: false, refusal: attachmentRefusal(error?.message) };
  return { ok: true, attachmentId: data.attachment_id, storagePath: data.storage_path };
}

/** One attachment row, if the caller may read it right now. */
export async function getAttachment(attachmentId: string): Promise<MessageAttachment | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("message_attachments").select("*").eq("id", attachmentId).maybeSingle();
  return data ? toMessageAttachment(data) : undefined;
}

/** Takes back one of the caller's own unsent uploads. */
export async function discardAttachment(attachmentId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("discard_message_attachment", {
    p_attachment_id: attachmentId,
  });
  return !error && data === true;
}

export type AttachmentFile = {
  /** The object's name in the bucket. Stays on the server. */
  path: string;
  name: string;
  mimeType: string;
  /** False when the small rendition was asked for but there is none. */
  thumbnail: boolean;
  /** In a direct conversation, where a message may be set to disappear. */
  direct: boolean;
};

/**
 * Which object an attachment address refers to — if the caller may read it.
 *
 * The row is selected under `message_attachments_select` with the caller's own
 * session, so this is the authorisation: it comes back only for someone who
 * can read the conversation right now (or for the uploader's own unsent
 * file). Keyed by community as well as id, so an id from another community
 * matches nothing. Signed out, never in the conversation, removed from it
 * since, a deleted message, an id that never existed — all `undefined`.
 */
export async function findAttachmentFile(
  communityId: string,
  attachmentId: string,
  variant: "original" | "thumb",
): Promise<AttachmentFile | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("message_attachments")
    .select("storage_path, thumb_path, display_name, mime_type, conversation_id")
    .eq("community_id", communityId)
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return undefined;

  const thumbnail = variant === "thumb" && Boolean(row.thumb_path);
  return {
    path: thumbnail ? row.thumb_path! : row.storage_path,
    name: row.display_name,
    mimeType: thumbnail ? "image/webp" : row.mime_type,
    thumbnail,
    direct: Boolean(row.conversation_id),
  };
}

/**
 * The object's bytes, again with the caller's own session: the bucket's read
 * policy looks the row up once more, independently of the select above.
 */
export async function readAttachmentObject(path: string): Promise<Blob | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: blob } = await supabase.storage.from(ATTACHMENT_BUCKET).download(path);
  return blob ?? undefined;
}

export type SendWithAttachmentsResult =
  | { ok: true; messageId: string }
  | { ok: false; refusal: AttachmentRefusal };

/**
 * Sends a message with files. The database writes the message and attaches
 * the caller's own ready uploads for this conversation in one transaction,
 * after re-checking the conversation, the limits and — for member-to-member
 * direct messages — that both people have written.
 */
export async function sendWithAttachments(
  target: AttachmentTarget,
  body: string,
  attachmentIds: string[],
): Promise<SendWithAttachmentsResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = target.channelId
    ? await supabase.rpc("send_channel_message_with_attachments", {
        p_channel_id: target.channelId,
        p_body: body,
        p_attachment_ids: attachmentIds,
      })
    : await supabase.rpc("send_direct_message_with_attachments", {
        p_conversation_id: target.conversationId!,
        p_body: body,
        p_attachment_ids: attachmentIds,
      });

  if (error || !data) return { ok: false, refusal: attachmentRefusal(error?.message) };
  return { ok: true, messageId: data };
}
