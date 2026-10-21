import { getRequestLocale } from "@/lib/i18n/server";
import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import {
  getCollaborationBySlug,
  getCollaborationTeam,
  getMyCollaborationPersona,
  hasCollaborationAccess,
  isCollaborationManager,
} from "@/lib/collaboration-data";
import { initialsFor } from "@/lib/format";
import { parseLocale, translator, type Translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Collaboration,
  CollaborationPersona,
  EventPublication,
  OrganizerRequest,
  PublicEvent,
  PublishedOrganizer,
  User,
  WorkspaceChannel,
  WorkspaceDocument,
  WorkspaceDocumentVersion,
  WorkspaceEvent,
  WorkspaceEventAudience,
  WorkspaceEventStatus,
  WorkspaceFile,
  WorkspaceMessage,
  WorkspaceTask,
  WorkspaceTaskStatus,
  WorkspaceThreadSummary,
} from "@/lib/types";

/**
 * The collaboration workspace side of the data seam.
 *
 * Every read runs as the signed-in user and is decided by RLS — each private
 * table answers `has_collaboration_access()` and nothing else — and every
 * write is exactly one SECURITY DEFINER function that takes the actor from
 * auth.uid(). Nothing here re-implements a permission; where the interface
 * needs to know what to offer, it asks the database (`manages_…`).
 *
 * People on any of these rows are account ids. They are rendered only through
 * `getWorkspacePeople()`, which reads `collaboration_profiles` — never the
 * account or a community persona. An id with no visible profile renders as
 * "Ukjent".
 */

// ── The workspace gate ──────────────────────────────────────────────────

export interface Workspace {
  user: User;
  collaboration: Collaboration;
  /** How the viewer appears here. Always a collaboration profile. */
  me: CollaborationPersona;
  /** Collaboration manager AND on the team — may manage inside the workspace. */
  manager: boolean;
  t: Translator;
  base: string;
}

/**
 * For every workspace page. Somebody without effective access — a
 * representative who is not on the team, a sponsored person who has not
 * joined, someone whose sponsorship lapsed — is sent to the collaboration's
 * front page, which shows them only what Step 1 allows. Someone on the team
 * without a collaboration profile sets one up first; nothing is ever shown
 * under another identity in the meantime.
 *
 * This is navigation, not protection: RLS refuses the same people every row.
 */
export const loadWorkspace = cache(async (slug: string): Promise<Workspace> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();
  const base = `/collaboration/${collaboration.slug}`;

  const access = await hasCollaborationAccess(collaboration.id);
  if (!access) redirect(base);
  const me = await getMyCollaborationPersona(collaboration.id, user.id);
  if (!me) redirect(`${base}/profile`);
  const manager = await isCollaborationManager(collaboration.id);

  return {
    user,
    collaboration,
    me,
    manager,
    t: translator(await getRequestLocale(collaboration)),
    base,
  };
});

// ── People ──────────────────────────────────────────────────────────────

/**
 * Collaboration personas the viewer may see here: the current team, plus
 * anyone whose content is on screen (historical authors, assignees). RLS
 * decides; nobody else's profile — and no account — is ever consulted.
 */
export const getWorkspacePeople = cache(
  async (collaborationId: string): Promise<Record<string, CollaborationPersona>> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("collaboration_profiles")
      .select("collaboration_id, user_id, display_name, bio")
      .eq("collaboration_id", collaborationId);
    const people: Record<string, CollaborationPersona> = {};
    for (const row of data ?? []) {
      if (!row.display_name) continue;
      people[row.user_id] = {
        id: row.user_id,
        collaborationId: row.collaboration_id,
        name: row.display_name,
        initials: initialsFor(row.display_name),
        bio: row.bio ?? "",
      };
    }
    return people;
  },
);

/**
 * The current team: people with effective access right now who have a
 * collaboration profile — `getCollaborationTeam()`, cached per request.
 * Former members may still appear as authors via `getWorkspacePeople`, but
 * never here.
 */
export const getWorkspaceTeam = cache(getCollaborationTeam);

// ── Channels and messages ───────────────────────────────────────────────

type ChannelRow = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  status: "active" | "archived";
  is_default: boolean;
};

function toChannel(row: ChannelRow): WorkspaceChannel {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    position: row.position,
    status: row.status,
    isDefault: row.is_default,
  };
}

export const getChannels = cache(async (collaborationId: string): Promise<WorkspaceChannel[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_channels")
    .select("id, name, description, position, status, is_default")
    .eq("collaboration_id", collaborationId)
    .order("position")
    .order("name");
  return (data ?? []).map(toChannel);
});

type MessageRow = {
  id: string;
  channel_id: string;
  author_id: string | null;
  parent_message_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

const MESSAGE_COLUMNS =
  "id, channel_id, author_id, parent_message_id, body, created_at, edited_at, deleted_at" as const;

export function toWorkspaceMessage(row: MessageRow): WorkspaceMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    parentMessageId: row.parent_message_id,
    body: row.deleted_at ? "" : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
    deleted: row.deleted_at !== null,
  };
}

const CHANNEL_PAGE = 200;

/**
 * The latest top-level messages of one channel, oldest first, with each
 * thread summarised. The channel id and the collaboration id are both
 * filtered on, so a channel id from another collaboration returns nothing
 * even for someone with access to both.
 */
export async function getChannelMessages(
  collaborationId: string,
  channelId: string,
): Promise<{ messages: WorkspaceMessage[]; threads: Record<string, WorkspaceThreadSummary> }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_messages")
    .select(MESSAGE_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .eq("channel_id", channelId)
    .is("parent_message_id", null)
    .order("created_at", { ascending: false })
    .limit(CHANNEL_PAGE);
  const messages = (data ?? []).map(toWorkspaceMessage).reverse();

  const threads: Record<string, WorkspaceThreadSummary> = {};
  if (messages.length > 0) {
    const { data: replies } = await supabase
      .from("collaboration_messages")
      .select("parent_message_id, created_at")
      .eq("collaboration_id", collaborationId)
      .eq("channel_id", channelId)
      .in("parent_message_id", messages.map((message) => message.id))
      .is("deleted_at", null);
    for (const reply of replies ?? []) {
      if (!reply.parent_message_id) continue;
      const summary = (threads[reply.parent_message_id] ??= { replyCount: 0 });
      summary.replyCount += 1;
      if (!summary.lastReplyAt || reply.created_at > summary.lastReplyAt) {
        summary.lastReplyAt = reply.created_at;
      }
    }
  }
  return { messages, threads };
}

/** One thread: its top-level message and every reply, oldest first. */
export async function getThread(
  collaborationId: string,
  channelId: string,
  messageId: string,
): Promise<{ root: WorkspaceMessage; replies: WorkspaceMessage[] } | undefined> {
  const supabase = await createSupabaseServerClient();
  const [{ data: root }, { data: replies }] = await Promise.all([
    supabase
      .from("collaboration_messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", messageId)
      .eq("collaboration_id", collaborationId)
      .eq("channel_id", channelId)
      .is("parent_message_id", null)
      .maybeSingle(),
    supabase
      .from("collaboration_messages")
      .select(MESSAGE_COLUMNS)
      .eq("collaboration_id", collaborationId)
      .eq("channel_id", channelId)
      .eq("parent_message_id", messageId)
      .order("created_at"),
  ]);
  if (!root) return undefined;
  return { root: toWorkspaceMessage(root), replies: (replies ?? []).map(toWorkspaceMessage) };
}

export async function getMessage(messageId: string): Promise<WorkspaceMessage | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", messageId)
    .maybeSingle();
  return data ? toWorkspaceMessage(data) : undefined;
}

/** Latest top-level activity per channel, for the channel list and overview. */
export async function getRecentMessages(
  collaborationId: string,
  limit: number,
): Promise<WorkspaceMessage[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_messages")
    .select(MESSAGE_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(toWorkspaceMessage);
}

// ── Tasks ───────────────────────────────────────────────────────────────

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: WorkspaceTaskStatus;
  due_on: string | null;
  related_channel_id: string | null;
  related_document_id: string | null;
  related_event_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  collaboration_task_assignees: { user_id: string }[];
};

const TASK_COLUMNS =
  "id, title, description, status, due_on, related_channel_id, related_document_id, related_event_id, created_by_user_id, created_at, updated_at, collaboration_task_assignees(user_id)" as const;

function toTask(row: TaskRow): WorkspaceTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    dueOn: row.due_on ?? undefined,
    relatedChannelId: row.related_channel_id ?? undefined,
    relatedDocumentId: row.related_document_id ?? undefined,
    relatedEventId: row.related_event_id ?? undefined,
    createdBy: row.created_by_user_id,
    assigneeIds: (row.collaboration_task_assignees ?? []).map((a) => a.user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTasks(collaborationId: string): Promise<WorkspaceTask[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_tasks")
    .select(TASK_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  return ((data ?? []) as TaskRow[]).map(toTask);
}

export async function getTask(collaborationId: string, taskId: string): Promise<WorkspaceTask | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_tasks")
    .select(TASK_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .eq("id", taskId)
    .maybeSingle();
  return data ? toTask(data as TaskRow) : undefined;
}

// ── Documents ───────────────────────────────────────────────────────────

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  status: "active" | "archived";
  revision: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function toDocument(row: DocumentRow): WorkspaceDocument {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    revision: row.revision,
    createdBy: row.created_by_user_id,
    updatedBy: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every document, without its text: the list never needs the bodies. */
export async function getDocuments(collaborationId: string): Promise<WorkspaceDocument[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_documents")
    .select("id, title, status, revision, created_by_user_id, updated_by_user_id, created_at, updated_at")
    .eq("collaboration_id", collaborationId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((row) => toDocument({ ...row, content: "" }));
}

export async function getDocument(
  collaborationId: string,
  documentId: string,
): Promise<WorkspaceDocument | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_documents")
    .select("id, title, content, status, revision, created_by_user_id, updated_by_user_id, created_at, updated_at")
    .eq("collaboration_id", collaborationId)
    .eq("id", documentId)
    .maybeSingle();
  return data ? toDocument(data) : undefined;
}

export async function getDocumentVersions(
  collaborationId: string,
  documentId: string,
): Promise<WorkspaceDocumentVersion[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_document_versions")
    .select("revision, title, content, created_by_user_id, created_at")
    .eq("collaboration_id", collaborationId)
    .eq("document_id", documentId)
    .order("revision", { ascending: false });
  return (data ?? []).map((row) => ({
    revision: row.revision,
    title: row.title,
    content: row.content,
    createdBy: row.created_by_user_id,
    createdAt: row.created_at,
  }));
}

// ── Files ───────────────────────────────────────────────────────────────

type FileRow = {
  id: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_user_id: string | null;
  created_at: string;
  storage_path: string;
};

function toFile(row: FileRow): WorkspaceFile {
  return {
    id: row.id,
    displayName: row.display_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by_user_id,
    createdAt: row.created_at,
  };
}

/** Removed files are gone: RLS returns only files still in use. */
export async function getFiles(collaborationId: string): Promise<WorkspaceFile[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_files")
    .select("id, display_name, mime_type, size_bytes, uploaded_by_user_id, created_at, storage_path")
    .eq("collaboration_id", collaborationId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toFile);
}

/**
 * One file's bytes, for the download route. The metadata row is read first
 * (RLS: access, not removed), and the object is then read by the path stored
 * on that row — never by a path from the request. The object read is a
 * second, independent check by the storage policy.
 */
export async function downloadCollaborationFile(
  collaborationId: string,
  fileId: string,
): Promise<{ file: WorkspaceFile; blob: Blob } | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("collaboration_files")
    .select("id, display_name, mime_type, size_bytes, uploaded_by_user_id, created_at, storage_path")
    .eq("collaboration_id", collaborationId)
    .eq("id", fileId)
    .maybeSingle();
  if (!row) return undefined;
  const { data: blob, error } = await supabase.storage.from("collaboration-files").download(row.storage_path);
  if (error || !blob) return undefined;
  return { file: toFile(row), blob };
}

// ── Events and publication ──────────────────────────────────────────────

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  internal_notes: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  audience: WorkspaceEventAudience;
  registration_url: string | null;
  status: WorkspaceEventStatus;
  public_image_file_id: string | null;
  public_asset_key: string;
  created_at: string;
  updated_at: string;
  collaboration_event_public_organizers: { participant_id: string; position: number }[];
  collaboration_event_organizer_consents: { participant_id: string }[];
};

const EVENT_COLUMNS =
  "id, title, description, internal_notes, starts_at, ends_at, location, audience, registration_url, status, public_image_file_id, public_asset_key, created_at, updated_at, collaboration_event_public_organizers(participant_id, position), collaboration_event_organizer_consents(participant_id)" as const;

function toEvent(row: EventRow): WorkspaceEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    internalNotes: row.internal_notes ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    location: row.location ?? undefined,
    audience: row.audience,
    registrationUrl: row.registration_url ?? undefined,
    status: row.status,
    publicImageFileId: row.public_image_file_id ?? undefined,
    publicAssetKey: row.public_asset_key,
    organizerParticipantIds: [...(row.collaboration_event_public_organizers ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((o) => o.participant_id),
    organizerConsentIds: (row.collaboration_event_organizer_consents ?? []).map((c) => c.participant_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getEvents(collaborationId: string): Promise<WorkspaceEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_events")
    .select(EVENT_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  return ((data ?? []) as EventRow[]).map(toEvent);
}

export async function getEvent(collaborationId: string, eventId: string): Promise<WorkspaceEvent | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaboration_events")
    .select(EVENT_COLUMNS)
    .eq("collaboration_id", collaborationId)
    .eq("id", eventId)
    .maybeSingle();
  return data ? toEvent(data as EventRow) : undefined;
}

function toOrganizers(value: unknown): PublishedOrganizer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    if (typeof o.communityName !== "string") return [];
    return [
      {
        communityName: o.communityName,
        localGroupName: typeof o.localGroupName === "string" ? o.localGroupName : undefined,
        accent: typeof o.accent === "string" ? o.accent : "#1f4a3d",
        monogram: typeof o.monogram === "string" ? o.monogram : "",
        markStyle: o.markStyle === "serif" || o.markStyle === "mono" ? o.markStyle : "sans",
      },
    ];
  });
}

/** The team's view of what is (or was) live, keyed by source event. */
export async function getPublications(collaborationId: string): Promise<Record<string, EventPublication>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("published_collaboration_events")
    .select(
      "source_event_id, public_slug, status, title, description, starts_at, ends_at, location, audience, registration_url, is_cancelled, organizers, public_image_path, public_image_source_file_id, published_at",
    )
    .eq("collaboration_id", collaborationId);
  const out: Record<string, EventPublication> = {};
  for (const row of data ?? []) {
    out[row.source_event_id] = {
      sourceEventId: row.source_event_id,
      slug: row.public_slug,
      status: row.status,
      title: row.title,
      description: row.description ?? undefined,
      startsAt: row.starts_at,
      endsAt: row.ends_at ?? undefined,
      location: row.location ?? undefined,
      audience: row.audience,
      registrationUrl: row.registration_url ?? undefined,
      isCancelled: row.is_cancelled,
      organizers: toOrganizers(row.organizers),
      imagePath: row.public_image_path ?? undefined,
      imageSourceFileId: row.public_image_source_file_id ?? undefined,
      publishedAt: row.published_at,
    };
  }
  return out;
}

/**
 * Requests to name the viewer's OWN units as public organisers, for their
 * representative — who may not be on the team at all. The request rows are
 * readable to the unit's representative through RLS; the event's details
 * come from `collaboration_organizer_request()`, which returns only its
 * publishable fields. Nothing else in the workspace is read.
 */
export async function getMyOrganizerRequests(participantIds: string[]): Promise<OrganizerRequest[]> {
  if (participantIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("collaboration_event_public_organizers")
    .select("event_id, participant_id")
    .in("participant_id", participantIds);
  const requests = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data } = await supabase.rpc("collaboration_organizer_request", {
        p_event_id: row.event_id,
        p_participant_id: row.participant_id,
      });
      const detail = (Array.isArray(data) ? data[0] : data) as
        | {
            title: string | null;
            starts_at: string | null;
            ends_at: string | null;
            location: string | null;
            audience: WorkspaceEventAudience | null;
            status: WorkspaceEventStatus | null;
            consented: boolean | null;
            listed: boolean | null;
          }
        | null;
      if (!detail?.title || !detail.audience || !detail.status) return undefined;
      const request: OrganizerRequest = {
        eventId: row.event_id,
        participantId: row.participant_id,
        title: detail.title,
        startsAt: detail.starts_at ?? undefined,
        endsAt: detail.ends_at ?? undefined,
        location: detail.location ?? undefined,
        audience: detail.audience,
        status: detail.status,
        consented: detail.consented === true,
        listed: detail.listed === true,
      };
      return request;
    }),
  );
  return requests
    .filter((request): request is OrganizerRequest => Boolean(request))
    .sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999"));
}

// ── The public read ─────────────────────────────────────────────────────

type PublicEventRow = {
  public_slug: string | null;
  locale: string | null;
  title: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  audience: WorkspaceEventAudience | null;
  registration_url: string | null;
  is_cancelled: boolean | null;
  organizers: unknown;
  image_path: string | null;
  updated_at: string | null;
};

async function publicEventRow(slug: string): Promise<PublicEventRow | undefined> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return undefined;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("published_event_by_slug", { p_slug: slug });
  const row = (Array.isArray(data) ? data[0] : data) as PublicEventRow | null;
  if (error || !row?.public_slug || !row.title || !row.starts_at || !row.audience) return undefined;
  return row;
}

/**
 * A published event, for anyone. Goes through the one anonymous function,
 * which returns only the allowlisted public projection.
 */
export const getPublicEvent = cache(async (slug: string): Promise<PublicEvent | undefined> => {
  const row = await publicEventRow(slug);
  if (!row) return undefined;
  return {
    slug: row.public_slug!,
    locale: parseLocale(row.locale),
    title: row.title!,
    description: row.description ?? undefined,
    startsAt: row.starts_at!,
    endsAt: row.ends_at ?? undefined,
    location: row.location ?? undefined,
    audience: row.audience!,
    registrationUrl: row.registration_url ?? undefined,
    isCancelled: row.is_cancelled === true,
    organizers: toOrganizers(row.organizers),
    hasImage: Boolean(row.image_path),
    updatedAt: row.updated_at ?? row.starts_at!,
  };
});

/** The published image's bytes, readable only while the event is published. */
export async function downloadPublicEventImage(
  slug: string,
): Promise<{ blob: Blob; path: string } | undefined> {
  const row = await publicEventRow(slug);
  if (!row?.image_path) return undefined;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from("published-event-images").download(row.image_path);
  if (error || !data) return undefined;
  return { blob: data, path: row.image_path };
}

// ── Writes (each one a single database function; the database decides) ─

type Rpc = Awaited<ReturnType<typeof createSupabaseServerClient>>["rpc"];

async function call<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => ReturnType<Rpc>)(name, args);
  return error ? null : ((data as T) ?? null);
}

const ok = (value: unknown) => value === true;
const id = (value: unknown) => (typeof value === "string" ? value : null);

export const createChannel = async (collaborationId: string, name: string, description: string | null) =>
  id(await call("create_collaboration_channel", {
    p_collaboration_id: collaborationId,
    p_name: name,
    p_description: description,
  }));

export const updateChannel = async (channelId: string, name: string, description: string | null) =>
  ok(await call("update_collaboration_channel", {
    p_channel_id: channelId,
    p_name: name,
    p_description: description,
  }));

export const setChannelStatus = async (channelId: string, status: "active" | "archived") =>
  ok(await call("set_collaboration_channel_status", { p_channel_id: channelId, p_status: status }));

export const postMessage = async (channelId: string, parentMessageId: string | null, body: string) =>
  id(await call("post_collaboration_message", {
    p_channel_id: channelId,
    p_parent_message_id: parentMessageId,
    p_body: body,
  }));

export const editMessage = async (messageId: string, body: string) =>
  ok(await call("edit_collaboration_message", { p_message_id: messageId, p_body: body }));

export const deleteMessage = async (messageId: string) =>
  ok(await call("delete_collaboration_message", { p_message_id: messageId }));

export const createDocument = async (collaborationId: string, title: string, content: string) =>
  id(await call("create_collaboration_document", {
    p_collaboration_id: collaborationId,
    p_title: title,
    p_content: content,
  }));

export async function saveDocument(
  documentId: string,
  expectedRevision: number,
  title: string,
  content: string,
): Promise<{ result: "saved" | "unchanged" | "conflict"; revision: number } | null> {
  const data = await call<unknown>("save_collaboration_document", {
    p_document_id: documentId,
    p_expected_revision: expectedRevision,
    p_title: title,
    p_content: content,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { save_result: string | null; saved_revision: number | null }
    | null;
  if (!row?.save_result || row.saved_revision == null) return null;
  if (row.save_result !== "saved" && row.save_result !== "unchanged" && row.save_result !== "conflict") {
    return null;
  }
  return { result: row.save_result, revision: row.saved_revision };
}

export const setDocumentStatus = async (documentId: string, status: "active" | "archived") =>
  ok(await call("set_collaboration_document_status", { p_document_id: documentId, p_status: status }));

export interface TaskInput {
  title: string;
  description: string | null;
  dueOn: string | null;
  relatedChannelId: string | null;
  relatedDocumentId: string | null;
  relatedEventId: string | null;
}

export const createTask = async (collaborationId: string, input: TaskInput, assigneeIds: string[]) =>
  id(await call("create_collaboration_task", {
    p_collaboration_id: collaborationId,
    p_title: input.title,
    p_description: input.description,
    p_due_on: input.dueOn,
    p_related_channel_id: input.relatedChannelId,
    p_related_document_id: input.relatedDocumentId,
    p_related_event_id: input.relatedEventId,
    p_assignee_ids: assigneeIds,
  }));

export const updateTask = async (taskId: string, input: TaskInput) =>
  ok(await call("update_collaboration_task", {
    p_task_id: taskId,
    p_title: input.title,
    p_description: input.description,
    p_due_on: input.dueOn,
    p_related_channel_id: input.relatedChannelId,
    p_related_document_id: input.relatedDocumentId,
    p_related_event_id: input.relatedEventId,
  }));

export const setTaskStatus = async (taskId: string, status: WorkspaceTaskStatus) =>
  ok(await call("set_collaboration_task_status", { p_task_id: taskId, p_status: status }));

export const setTaskAssignees = async (taskId: string, assigneeIds: string[]) =>
  ok(await call("set_collaboration_task_assignees", { p_task_id: taskId, p_assignee_ids: assigneeIds }));

/**
 * Upload with the caller's session — the storage policy decides — then
 * register it. A refused registration removes the caller's own orphan.
 */
export async function uploadFile(input: {
  collaborationId: string;
  fileId: string;
  extension: string;
  mimeType: string;
  displayName: string;
  bytes: Uint8Array;
}): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const path = `${input.collaborationId}/${input.fileId}.${input.extension}`;
  const { error } = await supabase.storage
    .from("collaboration-files")
    .upload(path, input.bytes, { contentType: input.mimeType, upsert: false });
  if (error) return null;

  const registered = id(await call("register_collaboration_file", {
    p_collaboration_id: input.collaborationId,
    p_file_id: input.fileId,
    p_display_name: input.displayName,
    p_mime_type: input.mimeType,
  }));
  if (!registered) {
    await supabase.storage.from("collaboration-files").remove([path]);
    return null;
  }
  return registered;
}

export const removeFile = async (fileId: string) =>
  ok(await call("remove_collaboration_file", { p_file_id: fileId }));

export interface EventInput {
  title: string;
  description: string | null;
  internalNotes: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  audience: WorkspaceEventAudience;
  registrationUrl: string | null;
  status: WorkspaceEventStatus;
}

function eventArgs(input: EventInput) {
  return {
    p_title: input.title,
    p_description: input.description,
    p_internal_notes: input.internalNotes,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_location: input.location,
    p_audience: input.audience,
    p_registration_url: input.registrationUrl,
    p_status: input.status,
  };
}

export const createEvent = async (collaborationId: string, input: EventInput) =>
  id(await call("create_collaboration_event", { p_collaboration_id: collaborationId, ...eventArgs(input) }));

export const updateEvent = async (eventId: string, input: EventInput) =>
  ok(await call("update_collaboration_event", { p_event_id: eventId, ...eventArgs(input) }));

export const setEventOrganizers = async (eventId: string, participantIds: string[]) =>
  ok(await call("set_collaboration_event_organizers", { p_event_id: eventId, p_participant_ids: participantIds }));

/** A unit's own answer; only its representative is accepted by the database. */
export const setOrganizerConsent = async (eventId: string, participantId: string, consent: boolean) =>
  ok(await call("set_collaboration_event_organizer_consent", {
    p_event_id: eventId,
    p_participant_id: participantId,
    p_consent: consent,
  }));

export const setEventImage = async (eventId: string, fileId: string | null) =>
  ok(await call("set_collaboration_event_image", { p_event_id: eventId, p_file_id: fileId }));

/**
 * Copy the chosen image into the publication bucket, as the signed-in
 * manager: the private object is read under the collaboration-files policy
 * (access, not removed) and the copy written under the published-images
 * policy (workspace manager of this event). The folder is the event's random
 * public asset key, so the public address names no private row. Returns the
 * new object's path.
 */
export async function copyImageForPublication(
  publicAssetKey: string,
  file: { bytes: Uint8Array; extension: string; mimeType: string },
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const path = `${publicAssetKey}/${crypto.randomUUID()}.${file.extension}`;
  const { error } = await supabase.storage
    .from("published-event-images")
    .upload(path, file.bytes, { contentType: file.mimeType, upsert: false });
  return error ? null : path;
}

export const publishEvent = async (eventId: string, imagePath: string | null) =>
  id(await call("publish_collaboration_event", { p_event_id: eventId, p_image_path: imagePath }));

export const unpublishEvent = async (eventId: string) =>
  ok(await call("unpublish_collaboration_event", { p_event_id: eventId }));
