"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  copyImageForPublication,
  createChannel,
  createDocument,
  createEvent,
  createTask,
  deleteMessage,
  downloadCollaborationFile,
  editMessage,
  getEvent,
  getMessage,
  getPublications,
  postMessage,
  publishEvent,
  removeFile,
  saveDocument,
  setChannelStatus,
  setDocumentStatus,
  setEventImage,
  setEventOrganizers,
  setOrganizerConsent,
  setTaskAssignees,
  setTaskStatus,
  unpublishEvent,
  updateChannel,
  updateEvent,
  updateTask,
  type EventInput,
  type TaskInput,
} from "@/lib/collaboration-workspace-data";
import { IMAGE_MIME_TYPES } from "@/lib/collaboration-file-type";
import {
  CHANNEL_DESCRIPTION_MAX,
  DOCUMENT_CONTENT_MAX,
  DOCUMENT_TITLE_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  MESSAGE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  channelNamePreview,
  cleanDisplayName,
  registrationUrl,
  uuidOrNull,
  type DocumentSaveState,
  type MessagePostState,
  type WorkspaceFormState,
} from "@/lib/collaboration-workspace-form";
import { readImageHeader } from "@/lib/image-header";
import { osloInstant } from "@/lib/format";
import { parseLocale, translator, type Translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { WorkspaceEventAudience, WorkspaceEventStatus, WorkspaceTaskStatus } from "@/lib/types";

/**
 * Server actions for the collaboration workspace.
 *
 * Each one confirms there is a session, shapes the input, and calls one
 * database function as the signed-in user. None decides who may do what: the
 * functions do, from auth.uid() and live rows — so a representative who is
 * not on the team, or someone whose access lapsed a second ago, is refused
 * by the database however the form was reached. The checks here only give a
 * person a readable reason for a mistake they can fix.
 *
 * `locale` travels in the form, as in the collaboration actions: a tampered
 * value changes the language of an error and nothing else. `slug` is used
 * only to revalidate and redirect, and only if it is a plain slug.
 */

type State = WorkspaceFormState;

async function session(formData: FormData): Promise<Translator> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return translator(parseLocale(formData.get("locale")));
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function length(value: string) {
  return Array.from(value).length;
}

function slugOf(formData: FormData): string | undefined {
  const slug = field(formData, "slug");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}

function refresh(slug?: string) {
  if (slug) revalidatePath(`/collaboration/${slug}`, "layout");
}

const refused = (t: Translator): State => ({ status: "error", message: t("collab.err.refused") });

// ── Channels ────────────────────────────────────────────────────────────

export async function createChannelAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const name = channelNamePreview(field(formData, "name"));
  if (!name) return { status: "error", message: t("ws.channels.nameRequired") };
  const description = field(formData, "description").trim();
  if (length(description) > CHANNEL_DESCRIPTION_MAX) {
    return { status: "error", message: t("ws.channels.descriptionTooLong", { max: CHANNEL_DESCRIPTION_MAX }) };
  }

  const id = await createChannel(field(formData, "collaborationId"), name, description || null);
  if (!id) return { status: "error", message: t("ws.channels.createFailed") };

  const slug = slugOf(formData);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}/channels/${id}` : "/collaborations");
}

export async function updateChannelAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const name = channelNamePreview(field(formData, "name"));
  if (!name) return { status: "error", message: t("ws.channels.nameRequired") };
  const description = field(formData, "description").trim();
  if (length(description) > CHANNEL_DESCRIPTION_MAX) {
    return { status: "error", message: t("ws.channels.descriptionTooLong", { max: CHANNEL_DESCRIPTION_MAX }) };
  }
  const ok = await updateChannel(field(formData, "channelId"), name, description || null);
  if (!ok) return { status: "error", message: t("ws.channel.saveFailed") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("ws.channel.saved") };
}

export async function setChannelStatusAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const status = field(formData, "status") === "archived" ? "archived" : "active";
  const ok = await setChannelStatus(field(formData, "channelId"), status);
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── Messages ────────────────────────────────────────────────────────────

/**
 * Posts and returns the row as stored, so what stays on screen is what the
 * database accepted. The author is whoever is signed in; there is no field
 * for it.
 */
export async function postMessageAction(_prev: MessagePostState, formData: FormData): Promise<MessagePostState> {
  const t = await session(formData);
  const body = field(formData, "body").trim();
  if (!body) return { status: "error", error: t("ws.msg.failed") };
  if (length(body) > MESSAGE_MAX) return { status: "error", error: t("ws.msg.tooLong", { max: MESSAGE_MAX }) };

  const id = await postMessage(field(formData, "channelId"), uuidOrNull(formData.get("parentMessageId")), body);
  const message = id ? await getMessage(id) : undefined;
  if (!message) return { status: "error", error: t("ws.msg.failed") };
  refresh(slugOf(formData));
  return { status: "ok", message };
}

export async function editMessageAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const body = field(formData, "body").trim();
  if (!body || length(body) > MESSAGE_MAX) return { status: "error", message: t("ws.msg.editFailed") };
  const ok = await editMessage(field(formData, "messageId"), body);
  if (!ok) return { status: "error", message: t("ws.msg.editFailed") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

export async function deleteMessageAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await deleteMessage(field(formData, "messageId"));
  if (!ok) return { status: "error", message: t("ws.msg.deleteFailed") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── Tasks ───────────────────────────────────────────────────────────────

function taskInput(formData: FormData, t: Translator): TaskInput | string {
  const title = cleanDisplayName(field(formData, "title"));
  if (!title) return t("ws.tasks.titleRequired");
  if (length(title) > TASK_TITLE_MAX) return t("ws.tasks.titleTooLong", { max: TASK_TITLE_MAX });
  const description = field(formData, "description").trim();
  if (length(description) > TASK_DESCRIPTION_MAX) {
    return t("ws.tasks.descriptionTooLong", { max: TASK_DESCRIPTION_MAX });
  }
  const due = field(formData, "dueOn");
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) {
    return t("ws.tasks.badDate");
  }
  return {
    title,
    description: description || null,
    dueOn: due || null,
    relatedChannelId: uuidOrNull(formData.get("relatedChannelId")),
    relatedDocumentId: uuidOrNull(formData.get("relatedDocumentId")),
    relatedEventId: uuidOrNull(formData.get("relatedEventId")),
  };
}

function assigneeIds(formData: FormData): string[] {
  return [...new Set(formData.getAll("assignee").map((value) => uuidOrNull(value)).filter(Boolean))] as string[];
}

export async function createTaskAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const input = taskInput(formData, t);
  if (typeof input === "string") return { status: "error", message: input };
  const id = await createTask(field(formData, "collaborationId"), input, assigneeIds(formData));
  if (!id) return { status: "error", message: t("ws.tasks.createFailed") };
  refresh(slugOf(formData));
  return { status: "ok", id };
}

export async function updateTaskAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const input = taskInput(formData, t);
  if (typeof input === "string") return { status: "error", message: input };
  const taskId = field(formData, "taskId");
  const ok = await updateTask(taskId, input);
  if (!ok) return { status: "error", message: t("ws.tasks.saveFailed") };
  const assigned = await setTaskAssignees(taskId, assigneeIds(formData));
  if (!assigned) return { status: "error", message: t("ws.tasks.assigneesFailed") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("ws.tasks.saved") };
}

const TASK_STATUSES: WorkspaceTaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

export async function setTaskStatusAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const status = field(formData, "status") as WorkspaceTaskStatus;
  if (!TASK_STATUSES.includes(status)) return { status: "error", message: t("ws.tasks.statusFailed") };
  const ok = await setTaskStatus(field(formData, "taskId"), status);
  if (!ok) return { status: "error", message: t("ws.tasks.statusFailed") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── Documents ───────────────────────────────────────────────────────────

export async function createDocumentAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const title = field(formData, "title").trim();
  if (!title) return { status: "error", message: t("ws.docs.titleRequired") };
  if (length(title) > DOCUMENT_TITLE_MAX) {
    return { status: "error", message: t("ws.docs.titleTooLong", { max: DOCUMENT_TITLE_MAX }) };
  }
  const id = await createDocument(field(formData, "collaborationId"), title, "");
  if (!id) return { status: "error", message: t("ws.docs.createFailed") };
  const slug = slugOf(formData);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}/docs/${id}` : "/collaborations");
}

/**
 * Save, naming the revision the editor started from. A conflict writes
 * nothing and says so; the text stays in the editor.
 */
export async function saveDocumentAction(_prev: DocumentSaveState, formData: FormData): Promise<DocumentSaveState> {
  const t = await session(formData);
  const title = field(formData, "title").trim();
  const content = field(formData, "content").replace(/\r\n/g, "\n");
  if (!title) return { status: "error", message: t("ws.docs.titleRequired") };
  if (length(title) > DOCUMENT_TITLE_MAX) {
    return { status: "error", message: t("ws.docs.titleTooLong", { max: DOCUMENT_TITLE_MAX }) };
  }
  if (length(content) > DOCUMENT_CONTENT_MAX) {
    return { status: "error", message: t("ws.docs.tooLong", { max: DOCUMENT_CONTENT_MAX }) };
  }
  const expected = Number(field(formData, "revision"));
  if (!Number.isInteger(expected) || expected < 1) return { status: "error", message: t("ws.docs.saveFailed") };

  const result = await saveDocument(field(formData, "documentId"), expected, title, content);
  if (!result) return { status: "error", message: t("ws.docs.saveFailed") };
  refresh(slugOf(formData));

  const restoredFrom = Number(field(formData, "restoredFrom"));
  if (result.result === "saved") {
    return {
      status: "saved",
      revision: result.revision,
      message: Number.isInteger(restoredFrom) && restoredFrom > 0
        ? t("ws.docs.restored", { from: restoredFrom, revision: result.revision })
        : t("ws.docs.saved", { revision: result.revision }),
    };
  }
  if (result.result === "unchanged") {
    return { status: "unchanged", revision: result.revision, message: t("ws.docs.unchanged") };
  }
  return { status: "conflict", revision: result.revision, message: t("ws.docs.conflict", { revision: result.revision }) };
}

export async function setDocumentStatusAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const status = field(formData, "status") === "archived" ? "archived" : "active";
  const ok = await setDocumentStatus(field(formData, "documentId"), status);
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── Files ───────────────────────────────────────────────────────────────

export async function removeFileAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await removeFile(field(formData, "fileId"));
  if (!ok) return { status: "error", message: t("ws.files.removeFailed") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── Events ──────────────────────────────────────────────────────────────

const AUDIENCES: WorkspaceEventAudience[] = ["public", "participating_organizations", "invite_only"];
const EVENT_STATUSES: WorkspaceEventStatus[] = ["draft", "confirmed", "cancelled"];

function eventInput(formData: FormData, t: Translator): EventInput | string {
  const title = field(formData, "title").trim();
  if (!title) return t("ws.events.titleRequired");
  const description = field(formData, "description").trim();
  const internalNotes = field(formData, "internalNotes").trim();
  const location = field(formData, "location").trim();
  if (
    length(title) > EVENT_TITLE_MAX ||
    length(description) > EVENT_DESCRIPTION_MAX ||
    length(internalNotes) > EVENT_NOTES_MAX ||
    length(location) > EVENT_LOCATION_MAX
  ) {
    return t("ws.events.tooLong");
  }

  // One day, a start and an optional end, in Oslo time — the same shape as
  // community events. A date without a start time is not a time.
  const date = field(formData, "date");
  const startTime = field(formData, "startTime");
  const endTime = field(formData, "endTime");
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (date || startTime || endTime) {
    if (!date || !startTime) return t("ws.events.badTime");
    startsAt = osloInstant(date, startTime);
    if (!startsAt) return t("ws.events.badTime");
    if (endTime) {
      endsAt = osloInstant(date, endTime);
      if (!endsAt) return t("ws.events.badTime");
      if (endsAt < startsAt) return t("ws.events.endBeforeStart");
    }
  }

  const url = registrationUrl(field(formData, "registrationUrl"));
  if (url === undefined) return t("ws.events.badUrl");

  const audience = field(formData, "audience") as WorkspaceEventAudience;
  const status = field(formData, "status") as WorkspaceEventStatus;
  return {
    title,
    description: description || null,
    internalNotes: internalNotes || null,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    location: location || null,
    audience: AUDIENCES.includes(audience) ? audience : "public",
    registrationUrl: url,
    status: EVENT_STATUSES.includes(status) ? status : "draft",
  };
}

export async function createEventAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const input = eventInput(formData, t);
  if (typeof input === "string") return { status: "error", message: input };
  const id = await createEvent(field(formData, "collaborationId"), input);
  if (!id) return { status: "error", message: t("ws.events.createFailed") };
  const slug = slugOf(formData);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}/events/${id}` : "/collaborations");
}

/** Changes the private plan only. A publication is untouched until updated. */
export async function updateEventAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const input = eventInput(formData, t);
  if (typeof input === "string") return { status: "error", message: input };
  const ok = await updateEvent(field(formData, "eventId"), input);
  if (!ok) return { status: "error", message: t("ws.events.saveFailed") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("ws.events.saved") };
}

export async function setEventOrganizersAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ids = formData.getAll("participantId").map((value) => uuidOrNull(value)).filter(Boolean) as string[];
  const ok = await setEventOrganizers(field(formData, "eventId"), [...new Set(ids)]);
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  return { status: "ok", message: t("ws.pub.organizersSaved") };
}

/**
 * A unit's own answer to being named as a public organiser. The database
 * accepts it only from that unit's representative; revoking also takes the
 * unit off the live public page at once.
 */
export async function setOrganizerConsentAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const consent = field(formData, "consent") === "1";
  const eventId = uuidOrNull(formData.get("eventId"));
  const participantId = uuidOrNull(formData.get("participantId"));
  if (!eventId || !participantId) return refused(t);
  const ok = await setOrganizerConsent(eventId, participantId, consent);
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  return { status: "ok", message: consent ? t("collab.requests.approvedMsg") : t("collab.requests.revokedMsg") };
}

export async function setEventImageAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await setEventImage(field(formData, "eventId"), uuidOrNull(formData.get("fileId")));
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  return { status: "ok", message: t("ws.pub.imageSaved") };
}

/**
 * Publish, or update what is published: one explicit act. If the event has
 * a chosen image that is not already the published one, it is first copied —
 * read from the private bucket under the caller's own access, checked to be
 * an image by its bytes, and written to the publication bucket — and only
 * then does the database snapshot the allowlisted fields.
 */
export async function publishEventAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const collaborationId = uuidOrNull(formData.get("collaborationId"));
  const eventId = uuidOrNull(formData.get("eventId"));
  if (!collaborationId || !eventId) return refused(t);

  const [event, publications] = await Promise.all([
    getEvent(collaborationId, eventId),
    getPublications(collaborationId),
  ]);
  if (!event) return refused(t);
  const current = publications[eventId];

  let imagePath: string | null = null;
  if (event.publicImageFileId && current?.imageSourceFileId !== event.publicImageFileId) {
    const source = await downloadCollaborationFile(collaborationId, event.publicImageFileId);
    if (!source || !IMAGE_MIME_TYPES.has(source.file.mimeType)) {
      return { status: "error", message: t("ws.pub.imageFailed") };
    }
    const bytes = new Uint8Array(await source.blob.arrayBuffer());
    const header = readImageHeader(bytes, ["image/png", "image/jpeg", "image/webp"]);
    if (!header.ok) return { status: "error", message: t("ws.pub.imageFailed") };
    const extension = header.contentType === "image/jpeg" ? "jpg" : header.contentType.split("/")[1];
    imagePath = await copyImageForPublication(event.publicAssetKey, { bytes, extension, mimeType: header.contentType });
    if (!imagePath) return { status: "error", message: t("ws.pub.imageFailed") };
  }

  const slug = await publishEvent(eventId, imagePath);
  if (!slug) return { status: "error", message: t("ws.pub.failed") };

  refresh(slugOf(formData));
  revalidatePath(`/arrangement/${slug}`);
  return {
    status: "ok",
    message: current?.status === "published" ? t("ws.pub.updated") : t("ws.pub.done"),
  };
}

export async function unpublishEventAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const eventId = uuidOrNull(formData.get("eventId"));
  const collaborationId = uuidOrNull(formData.get("collaborationId"));
  if (!eventId || !collaborationId) return refused(t);
  const current = (await getPublications(collaborationId))[eventId];
  const ok = await unpublishEvent(eventId);
  if (!ok) return refused(t);
  refresh(slugOf(formData));
  if (current) revalidatePath(`/arrangement/${current.slug}`);
  return { status: "ok", message: t("ws.pub.unpublished") };
}
