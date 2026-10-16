import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attachmentKind, attachmentUrl } from "@/lib/attachment-types";
import {
  RESOURCE_PAGE_SIZE,
  isUuid,
  linkHostname,
  type ChannelResource,
  type ResourceFolder,
  type ResourceQuery,
  type ResourceSummary,
} from "@/lib/channel-resources";
import type { Database } from "@/lib/supabase/database.types";
import type { MessageKey } from "@/lib/i18n";

/**
 * A channel's Ressurser, read and changed as the signed-in person.
 *
 * Like the rest of the data layer, nothing here decides who may do what.
 * Every call runs with the caller's own session: the functions in
 * 20261031100000 answer only for a channel the caller can read now, and every
 * change asks the channel's rules again (channel_resource_rights). A refusal
 * comes back as one of a few reasons the interface can explain; a resource or
 * channel the caller cannot see is the same "not found" as one that does not
 * exist.
 */

type ResourceRow = Database["public"]["Functions"]["channel_resources"]["Returns"][number];

/** A row without the contributor's name; the route adds names from the community. */
type WithoutName<T> = T extends unknown ? Omit<T, "contributorName"> & { contributorName?: string } : never;
export type ChannelResourceRow = WithoutName<ChannelResource>;

function toResource(row: ResourceRow): ChannelResourceRow {
  const base = {
    id: row.id,
    name: row.name,
    contributorId: row.contributor_id ?? undefined,
    createdAt: row.created_at,
    folderId: row.folder_id ?? undefined,
    pinned: Boolean(row.pinned_at),
  };
  if (row.resource_type === "link") {
    return {
      ...base,
      type: "link",
      href: row.url,
      hostname: linkHostname(row.url),
      description: row.description ?? "",
    };
  }
  return {
    ...base,
    type: "file",
    messageId: row.message_id,
    attachment: {
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      kind: attachmentKind(row.mime_type),
      sizeBytes: row.size_bytes,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      url: attachmentUrl(row.community_id, row.id),
      hasThumbnail: row.has_thumbnail,
    },
  };
}

/** The last row's sort key and id, opaque to the browser. */
function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id]), "utf8").toString("base64url");
}

/** A malformed or foreign cursor is no cursor: the list starts from the top. */
function decodeCursor(cursor: string | undefined): { key: string; id: string } | undefined {
  if (!cursor || cursor.length > 600) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && value[0].length <= 400 && isUuid(value[1])) {
      return { key: value[0], id: value[1] };
    }
  } catch {
    // Falls through.
  }
  return undefined;
}

// Generated RPC argument types are non-null; these functions take null for "none".
const none = null as unknown as string;

/** One page of a channel's resources. Fetches one more row than it returns to know whether there is more. */
export async function listChannelResources(
  channelId: string,
  query: ResourceQuery,
  pageSize = RESOURCE_PAGE_SIZE,
): Promise<{ resources: ChannelResourceRow[]; nextCursor?: string }> {
  const supabase = await createSupabaseServerClient();
  const after = decodeCursor(query.cursor);
  const { data, error } = await supabase.rpc("channel_resources", {
    p_channel_id: channelId,
    p_search: query.search.trim() || none,
    p_kind: query.kind === "all" ? none : query.kind,
    p_contributor: query.contributorId ?? none,
    p_folder: query.location === "all" ? none : query.location,
    p_pinned: false,
    p_sort: query.sort,
    p_after_key: after?.key ?? none,
    p_after_id: after?.id ?? none,
    p_limit: pageSize + 1,
  });
  if (error || !data) return { resources: [] };
  const page = data.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    resources: page.map(toResource),
    nextCursor: data.length > pageSize && last ? encodeCursor(last.sort_key, last.id) : undefined,
  };
}

/** Pinned resources, most recently pinned first. */
export async function getPinnedChannelResources(channelId: string): Promise<ChannelResourceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("channel_resources", { p_channel_id: channelId, p_pinned: true });
  return (data ?? []).map(toResource);
}

export async function getChannelResourceFolders(channelId: string): Promise<ResourceFolder[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("channel_resource_folders", { p_channel_id: channelId });
  return (data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    depth: row.depth,
    createdBy: row.created_by ?? undefined,
    resourceCount: row.resource_count,
  }));
}

export async function getChannelResourceContributors(channelId: string): Promise<{ id: string; count: number }[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("channel_resource_contributors", { p_channel_id: channelId });
  return (data ?? []).map((row) => ({ id: row.contributor_id, count: row.resource_count }));
}

export interface ChannelResourcePermissions {
  canRead: boolean;
  /** Add links, create folders, file resources. */
  canContribute: boolean;
  /** Pin, and change every link and folder (not in an archived channel). */
  canManage: boolean;
  /** Switch file sharing on or off here (set_channel_file_sharing). */
  canConfigureUploads: boolean;
}

/** What the caller may do with a channel's Ressurser, as the database answers it. */
export async function getChannelResourcePermissions(channelId: string): Promise<ChannelResourcePermissions> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("channel_resource_permissions", { p_channel_id: channelId }).maybeSingle();
  return {
    canRead: data?.can_read === true,
    canContribute: data?.can_contribute === true,
    canManage: data?.can_manage === true,
    canConfigureUploads: data?.can_configure_uploads === true,
  };
}

const EMPTY_SUMMARY: ResourceSummary = { files: 0, links: 0, folders: 0, pins: 0 };

/** How much there is; all zero for a channel the caller cannot read. */
export async function getChannelResourceSummary(channelId: string): Promise<ResourceSummary> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("channel_resource_summary", { p_channel_id: channelId }).maybeSingle();
  if (!data) return EMPTY_SUMMARY;
  return { files: data.file_count, links: data.link_count, folders: data.folder_count, pins: data.pin_count };
}

// ── Changing ────────────────────────────────────────────────────────────

export type ResourceWriteResult<T = true> = { ok: true; value: T } | { ok: false; error: MessageKey };

const REFUSALS: Record<string, MessageKey> = {
  not_found: "err.resourceNotFound",
  not_allowed: "err.resourceNotAllowed",
  archived: "err.resourceArchived",
  folder_name: "err.resourceFolderName",
  folder_name_taken: "err.resourceFolderNameTaken",
  folder_depth: "err.resourceFolderDepth",
  folder_limit: "err.resourceFolderLimit",
  link_url: "err.resourceLinkUrl",
  link_title: "err.resourceLinkTitle",
  link_description: "err.resourceLinkDescription",
  link_limit: "err.resourceLinkLimit",
  pin_limit: "err.resourcePinLimit",
};

function refusal(message: string | undefined): MessageKey {
  const match = /resource_error:([a-z_]+)/.exec(message ?? "");
  return (match && REFUSALS[match[1]]) || "err.resourceFailed";
}

async function call<T>(
  run: (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  accept: (data: unknown) => T | undefined,
): Promise<ResourceWriteResult<T>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await run(supabase);
  if (error) return { ok: false, error: refusal(error.message) };
  const value = accept(data);
  return value === undefined ? { ok: false, error: "err.resourceFailed" } : { ok: true, value };
}

const uuid = (data: unknown) => (typeof data === "string" ? data : undefined);
const yes = (data: unknown) => (data === true ? (true as const) : undefined);

export function addChannelLink(input: {
  channelId: string;
  folderId: string | null;
  url: string;
  title: string;
  description: string;
}) {
  return call(
    (supabase) =>
      supabase.rpc("add_channel_link", {
        p_channel_id: input.channelId,
        p_folder_id: input.folderId ?? none,
        p_url: input.url,
        p_title: input.title,
        p_description: input.description,
      }),
    uuid,
  );
}

export function updateChannelLink(input: { linkId: string; url: string; title: string; description: string }) {
  return call(
    (supabase) =>
      supabase.rpc("update_channel_link", {
        p_link_id: input.linkId,
        p_url: input.url,
        p_title: input.title,
        p_description: input.description,
      }),
    yes,
  );
}

export function deleteChannelLink(linkId: string) {
  return call((supabase) => supabase.rpc("delete_channel_link", { p_link_id: linkId }), yes);
}

export function createResourceFolder(input: { channelId: string; parentId: string | null; name: string }) {
  return call(
    (supabase) =>
      supabase.rpc("create_channel_resource_folder", {
        p_channel_id: input.channelId,
        p_parent_id: input.parentId ?? none,
        p_name: input.name,
      }),
    uuid,
  );
}

export function renameResourceFolder(folderId: string, name: string) {
  return call((supabase) => supabase.rpc("rename_channel_resource_folder", { p_folder_id: folderId, p_name: name }), yes);
}

/** Deletes a folder and its subfolders; returns how many resources were unfiled. */
export function deleteResourceFolder(folderId: string) {
  return call(
    (supabase) => supabase.rpc("delete_channel_resource_folder", { p_folder_id: folderId }),
    (data) => (typeof data === "number" ? data : undefined),
  );
}

export function moveChannelResource(input: { type: "file" | "link"; id: string; folderId: string | null }) {
  return call(
    (supabase) =>
      supabase.rpc("move_channel_resource", { p_type: input.type, p_id: input.id, p_folder_id: input.folderId ?? none }),
    yes,
  );
}

export function setChannelResourcePinned(input: { type: "file" | "link"; id: string; pinned: boolean }) {
  return call(
    (supabase) =>
      supabase.rpc("set_channel_resource_pinned", { p_type: input.type, p_id: input.id, p_pinned: input.pinned }),
    yes,
  );
}

/** File sharing on or off in a lokallag's main chat (or a community channel). Sent files stay. */
export function setChannelFileSharing(channelId: string, enabled: boolean) {
  return call((supabase) => supabase.rpc("set_channel_file_sharing", { p_channel_id: channelId, p_enabled: enabled }), yes);
}
