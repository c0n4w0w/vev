/**
 * The vocabulary of message attachments, shared by the server and the browser.
 *
 * Nothing here decides anything. The allowlist is the database's
 * (message_attachment_extension), the limits are the database's
 * (message_attachment_policy), and the type of a file is read from its bytes
 * on the server (lib/attachment-file-type.ts). This module only names the
 * same things so the composer can explain a refusal before the round trip
 * and the message list knows how to draw what it is given.
 */

/** How an attachment is shown and previewed. */
export type AttachmentKind =
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "csv"
  | "audio";

export interface AttachmentFileType {
  mimeType: string;
  extension: string;
  kind: AttachmentKind;
}

export const ATTACHMENT_FILE_TYPES: readonly AttachmentFileType[] = [
  { mimeType: "image/jpeg", extension: "jpg", kind: "image" },
  { mimeType: "image/png", extension: "png", kind: "image" },
  { mimeType: "image/webp", extension: "webp", kind: "image" },
  { mimeType: "image/gif", extension: "gif", kind: "image" },
  { mimeType: "application/pdf", extension: "pdf", kind: "pdf" },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
    kind: "document",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    kind: "spreadsheet",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
    kind: "presentation",
  },
  { mimeType: "text/plain", extension: "txt", kind: "text" },
  { mimeType: "text/csv", extension: "csv", kind: "csv" },
  { mimeType: "audio/mpeg", extension: "mp3", kind: "audio" },
  { mimeType: "audio/wav", extension: "wav", kind: "audio" },
  { mimeType: "audio/mp4", extension: "m4a", kind: "audio" },
];

const BY_MIME = new Map(ATTACHMENT_FILE_TYPES.map((type) => [type.mimeType, type]));

export function attachmentFileType(mimeType: string): AttachmentFileType | undefined {
  return BY_MIME.get(mimeType);
}

export function attachmentKind(mimeType: string): AttachmentKind {
  return BY_MIME.get(mimeType)?.kind ?? "text";
}

/** What the native file picker offers. A hint only; the server decides. */
export const ATTACHMENT_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".pdf",
  ".docx",
  ".txt",
  ".xlsx",
  ".csv",
  ".pptx",
  ".mp3",
  ".wav",
  ".m4a",
].join(",");

const EXTENSIONS = new Set([...ATTACHMENT_FILE_TYPES.map((type) => type.extension), "jpeg"]);

/** Whether a chosen file's name ends in one of the supported extensions. */
export function hasSupportedExtension(filename: string): boolean {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? EXTENSIONS.has(match[1].toLowerCase()) : false;
}

/** The short label on a file card: "PDF", "DOCX", "MP3". */
export function attachmentTypeLabel(mimeType: string): string {
  return (BY_MIME.get(mimeType)?.extension ?? "fil").toUpperCase();
}

/**
 * Why attachments are or are not available in a conversation, as the database
 * answered for this viewer (message_attachment_policy).
 */
export type AttachmentPolicyReason =
  | "ok"
  | "not_found"
  | "unsupported"
  | "archived"
  | "read_only"
  | "closed"
  | "needs_mutual";

export interface AttachmentPolicy {
  allowed: boolean;
  reason: AttachmentPolicyReason;
  /** Largest single file, in bytes. Zero where attachments do not exist. */
  maxBytes: number;
  /** Most files in one message. */
  maxFiles: number;
}

export const NO_ATTACHMENTS: AttachmentPolicy = {
  allowed: false,
  reason: "unsupported",
  maxBytes: 0,
  maxFiles: 0,
};

/** One file sent with a message, as the message list draws it. */
export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  /** Images only: pixel size as displayed, for reserving space before load. */
  width?: number;
  height?: number;
  /**
   * The authenticated address of the original. `?variant=thumb` gives the
   * small rendition of an image when `hasThumbnail`; `?download=1` saves it.
   * Never a storage URL: every request is authorised again by the server.
   */
  url: string;
  hasThumbnail: boolean;
}

export function attachmentUrl(communityId: string, attachmentId: string): string {
  return `/community/${encodeURIComponent(communityId)}/attachments/${attachmentId}`;
}

/**
 * The member-to-member rule, mirrored for the composer: each of the two has
 * sent at least one message with real text in it. The database applies the
 * same test when a file is uploaded and again when the message is sent; this
 * only lets the paperclip wake up the moment the second person writes,
 * without waiting for a reload.
 */
export function bothHaveWritten(
  messages: readonly { authorId: string; body: string }[],
  participantIds: readonly [string, string],
  /** Participants already recorded as having written, whatever their messages say now. */
  alreadyWrote: readonly string[] = [],
): boolean {
  const written = new Set<string>(alreadyWrote);
  for (const message of messages) {
    if (/\S/.test(message.body)) written.add(message.authorId);
  }
  return participantIds.every((id) => written.has(id));
}
