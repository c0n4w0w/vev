import { after } from "next/server";
import {
  beginAttachment,
  getAttachment,
  getAttachmentPolicy,
  type AttachmentRefusal,
  type AttachmentTarget,
} from "@/lib/attachment-data";
import { cleanAttachmentName, detectAttachmentFileType } from "@/lib/attachment-file-type";
import {
  abandonAttachment,
  completeAttachment,
  storeAttachmentObject,
  sweepAbandonedAttachments,
  thumbnailPath,
} from "@/lib/attachment-storage";
import { makeAttachmentThumbnail, reencodeWithoutMetadata } from "@/lib/attachment-thumbnail";
import type { AttachmentPolicyReason, MessageAttachment } from "@/lib/attachment-types";
import { getCommunityById } from "@/lib/data";
import { communityTranslator, translator, PLATFORM_LOCALE, type MessageKey, type Translator } from "@/lib/i18n";
import { readImageHeader } from "@/lib/image-header";
import { stripImageMetadata } from "@/lib/image-metadata";
import { isSameOrigin } from "@/lib/same-origin";
import { getSessionUser } from "@/lib/session";

/**
 * Upload one file into one private conversation.
 *
 * A route handler rather than a server action, so a 25 MiB file does not have
 * to widen the request limit of every action in the app, and so the browser
 * can report progress. It is excluded from the proxy (proxy.ts) for the same
 * reason: the proxy buffers request bodies, and this one should not be read
 * at all until the caller is known to be allowed to send it. The session is
 * validated here instead, like everywhere else, by `getSessionUser`.
 *
 * In order, refusing as early as it can:
 *
 *   1. same origin only;
 *   2. a signed-in session (401);
 *   3. the conversation, named in the query string so it is known before the
 *      body: the database answers, for this person, whether files may be
 *      attached there right now and how large (403 with the reason — an
 *      archived channel, a member-to-member conversation where both have not
 *      yet written). A conversation the caller cannot see, or one in another
 *      community than the address says, is a 404;
 *   4. the declared size, then the real size, against that limit (413);
 *   5. the type, from the bytes (415);
 *   6. `begin_message_attachment`, with the caller's own session — the
 *      database checks all of the above again and generates the object name.
 *
 * Only then is anything stored: the original, and for an image a small
 * rendition. The object is written by the server (browsers have no write
 * access to the bucket at all), the database confirms it is there with the
 * promised size and type, and the upload becomes a file its uploader can send
 * — to that conversation and no other. Permission is asked once more before
 * answering, so access that ended while the bytes were in flight leaves
 * nothing behind.
 *
 * Replies are JSON in the community's language: `{ ok, message, attachment? }`.
 */
export const dynamic = "force-dynamic";

/** Room for the multipart envelope around the file. */
const MULTIPART_ALLOWANCE = 64 * 1024;

type Reply = { ok: boolean; message: string; attachment?: MessageAttachment };

function reply(status: number, body: Reply) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function megabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}

function closedMessage(reason: AttachmentPolicyReason): MessageKey {
  if (reason === "needs_mutual") return "err.attachmentNeedsMutual";
  if (reason === "archived") return "err.attachmentArchived";
  return "err.attachmentNotAllowed";
}

function refusalReply(t: Translator, refusal: AttachmentRefusal, name: string, maxBytes: number) {
  switch (refusal) {
    case "needsMutual":
      return reply(403, { ok: false, message: t("err.attachmentNeedsMutual") });
    case "archived":
      return reply(403, { ok: false, message: t("err.attachmentArchived") });
    case "notAllowed":
      return reply(403, { ok: false, message: t("err.attachmentNotAllowed") });
    case "tooLarge":
      return reply(413, { ok: false, message: t("err.attachmentTooLarge", { name, max: megabytes(maxBytes) }) });
    case "type":
      return reply(415, { ok: false, message: t("err.attachmentType", { name }) });
    default:
      return reply(500, { ok: false, message: t("err.attachmentUploadFailed", { name }) });
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/community/[communityId]/attachments/upload">,
) {
  const { communityId } = await context.params;
  const fallback = translator(PLATFORM_LOCALE);

  if (!(await isSameOrigin(request))) {
    return reply(403, { ok: false, message: fallback("err.attachmentNotAllowed") });
  }

  const user = await getSessionUser();
  if (!user) return reply(401, { ok: false, message: fallback("err.attachmentNotAllowed") });

  const query = new URL(request.url).searchParams;
  const channelId = query.get("channel");
  const conversationId = query.get("conversation");
  let target: AttachmentTarget;
  if (channelId && !conversationId && channelId.length <= 200) {
    target = { channelId };
  } else if (conversationId && !channelId && UUID.test(conversationId)) {
    target = { conversationId };
  } else {
    return reply(404, { ok: false, message: fallback("err.attachmentNotAllowed") });
  }

  const [community, policy] = await Promise.all([getCommunityById(communityId), getAttachmentPolicy(target)]);
  if (!community || policy.reason === "not_found" || policy.communityId !== community.id) {
    return reply(404, { ok: false, message: fallback("err.attachmentNotAllowed") });
  }
  const t = communityTranslator(community);
  if (!policy.allowed) return reply(403, { ok: false, message: t(closedMessage(policy.reason)) });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > policy.maxBytes + MULTIPART_ALLOWANCE) {
    return reply(413, {
      ok: false,
      message: t("err.attachmentTooLarge", { name: t("attachments.theFile"), max: megabytes(policy.maxBytes) }),
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { ok: false, message: t("err.attachmentUploadFailed", { name: t("attachments.theFile") }) });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return reply(400, { ok: false, message: t("err.attachmentUploadFailed", { name: t("attachments.theFile") }) });
  }
  const shownName = file.name.slice(0, 80) || t("attachments.theFile");
  if (file.size === 0) return reply(400, { ok: false, message: t("err.attachmentEmpty", { name: shownName }) });
  if (file.size > policy.maxBytes) {
    return reply(413, {
      ok: false,
      message: t("err.attachmentTooLarge", { name: shownName, max: megabytes(policy.maxBytes) }),
    });
  }

  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > policy.maxBytes) {
    return reply(413, {
      ok: false,
      message: t("err.attachmentTooLarge", { name: shownName, max: megabytes(policy.maxBytes) }),
    });
  }

  const type = detectAttachmentFileType(bytes, file.name);
  if (!type) return reply(415, { ok: false, message: t("err.attachmentType", { name: shownName }) });

  // An image is stored without its metadata — where it was taken, on what
  // device, when — and that stored file is the only one there is, so what is
  // later shown, previewed and downloaded as the original is the cleaned
  // file. The compressed picture is copied untouched (lib/image-metadata.ts);
  // only a file that cannot be rewritten that way is re-encoded instead, and
  // one that cannot be read at all is refused rather than stored as it came.
  //
  // It must also be one a browser can lay out: a readable header with real
  // dimensions. All of this, and the small rendition, happens before
  // anything is reserved, so a refused upload has cost only this request.
  let width: number | undefined;
  let height: number | undefined;
  let thumbnail: Uint8Array | undefined;
  if (type.kind === "image") {
    const cleaned =
      stripImageMetadata(bytes, type.mimeType) ?? (await reencodeWithoutMetadata(bytes, type.mimeType));
    if (!cleaned) return reply(415, { ok: false, message: t("err.attachmentType", { name: shownName }) });
    bytes = cleaned;

    const header = readImageHeader(bytes, ["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!header.ok || header.contentType !== type.mimeType || header.width > 30000 || header.height > 30000) {
      return reply(415, { ok: false, message: t("err.attachmentType", { name: shownName }) });
    }
    const made = await makeAttachmentThumbnail(bytes, header);
    width = made?.displayWidth ?? header.width;
    height = made?.displayHeight ?? header.height;
    thumbnail = made?.bytes;
  }

  const displayName = cleanAttachmentName(file.name, type);
  const begun = await beginAttachment(target, {
    displayName,
    mimeType: type.mimeType,
    sizeBytes: bytes.byteLength,
    width,
    height,
  });
  if (!begun.ok) return refusalReply(t, begun.refusal, shownName, policy.maxBytes);

  const failed = async () => {
    await abandonAttachment(begun.attachmentId);
    return reply(500, { ok: false, message: t("err.attachmentUploadFailed", { name: shownName }) });
  };

  if (!(await storeAttachmentObject(begun.storagePath, bytes, type.mimeType))) return failed();
  if (thumbnail) {
    // Best effort: without it the message shows the original instead.
    await storeAttachmentObject(thumbnailPath(begun.storagePath), thumbnail, "image/webp");
  }
  if (!(await completeAttachment(begun.attachmentId))) return failed();

  // Asked again now that the bytes are in: a person removed from the channel,
  // or a channel archived, while the upload was in flight keeps nothing.
  const [still, attachment] = await Promise.all([
    getAttachmentPolicy(target),
    getAttachment(begun.attachmentId),
  ]);
  if (!still.allowed || !attachment) {
    await abandonAttachment(begun.attachmentId);
    return reply(403, { ok: false, message: t(closedMessage(still.reason)) });
  }

  // Housekeeping after the response: uploads nobody ever sent, and any
  // objects whose row is gone.
  after(async () => {
    try {
      await sweepAbandonedAttachments();
    } catch (error) {
      // The next upload, or the scheduled sweep, tries again.
      console.error("[attachments] sweep after upload failed", error);
    }
  });

  return reply(201, { ok: true, message: displayName, attachment });
}
