/**
 * The vocabulary of a channel's Ressurser, shared by the server and the
 * browser: the files already sent in the channel, external links its members
 * added, optional folders, and pins.
 *
 * Nothing here decides who may see or change anything. Which rows come back
 * is the database's answer for the caller (channel_resources() and its
 * siblings, 20261031100000), and every change goes through a function there
 * that asks again. This module names the filters, sorts, views and shapes so
 * the dialog, the route and the actions agree, and checks a link's address
 * before the round trip.
 */
import type { MessageAttachment } from "@/lib/attachment-types";
import type { Channel } from "@/lib/types";

export const RESOURCE_KINDS = ["all", "document", "image", "other", "link"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_SORTS = ["newest", "oldest", "name_asc", "name_desc"] as const;
export type ResourceSort = (typeof RESOURCE_SORTS)[number];

/** Resources per page. The database caps it at 100. */
export const RESOURCE_PAGE_SIZE = 30;
export const RESOURCE_SEARCH_MAX = 100;
export const RESOURCE_FOLDER_MAX_DEPTH = 3;
export const RESOURCE_FOLDER_NAME_MAX = 60;
export const LINK_TITLE_MAX = 120;
export const LINK_DESCRIPTION_MAX = 300;
export const LINK_URL_MAX = 2000;

/**
 * Which part of the library a list shows: everything, what is in no folder,
 * or what sits directly in one folder.
 */
export type ResourceLocation = "all" | "none" | string;

export interface ResourceQuery {
  search: string;
  kind: ResourceKind;
  contributorId?: string;
  sort: ResourceSort;
  location: ResourceLocation;
  /** Where the previous page ended; absent for the first page. */
  cursor?: string;
}

interface ResourceBase {
  id: string;
  name: string;
  contributorId?: string;
  /** The contributor's name in this community, never their account identity. */
  contributorName: string;
  createdAt: string;
  folderId?: string;
  pinned: boolean;
}

/** A file sent in the channel, as its message shows it. */
export interface FileResource extends ResourceBase {
  type: "file";
  messageId: string;
  attachment: MessageAttachment;
}

/** An external link. Opened by the browser, never fetched by TING. */
export interface LinkResource extends ResourceBase {
  type: "link";
  href: string;
  hostname: string;
  description: string;
}

export type ChannelResource = FileResource | LinkResource;

export interface ResourceFolder {
  id: string;
  parentId?: string;
  name: string;
  depth: number;
  createdBy?: string;
  /** Files and links directly in this folder. */
  resourceCount: number;
}

export interface ResourceContributor {
  id: string;
  name: string;
  count: number;
}

export interface ResourceSummary {
  files: number;
  links: number;
  folders: number;
  pins: number;
}

export interface ResourcePage {
  resources: ChannelResource[];
  nextCursor?: string;
  /** With `meta=1`: what the library needs besides one page. */
  meta?: {
    pins: ChannelResource[];
    folders: ResourceFolder[];
    contributors: ResourceContributor[];
    summary: ResourceSummary;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The library's query from a URL's search parameters, every value checked. */
export function parseResourceQuery(params: URLSearchParams): ResourceQuery {
  const kind = params.get("kind");
  const sort = params.get("sort");
  const contributor = params.get("contributor");
  const folder = params.get("folder");
  return {
    search: (params.get("q") ?? "").slice(0, RESOURCE_SEARCH_MAX),
    kind: RESOURCE_KINDS.includes(kind as ResourceKind) ? (kind as ResourceKind) : "all",
    contributorId: isUuid(contributor) ? contributor : undefined,
    sort: RESOURCE_SORTS.includes(sort as ResourceSort) ? (sort as ResourceSort) : "newest",
    location: folder === "none" ? "none" : isUuid(folder) ? folder : "all",
    cursor: params.get("cursor") ?? undefined,
  };
}

/** The same query as search parameters, leaving defaults out. */
export function resourceQueryString(query: ResourceQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (query.search.trim()) params.set("q", query.search.trim());
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.contributorId) params.set("contributor", query.contributorId);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.location !== "all") params.set("folder", query.location);
  if (query.cursor) params.set("cursor", query.cursor);
  for (const [name, value] of Object.entries(extra)) params.set(name, value);
  return params.toString();
}

/**
 * A link's address as the database accepts it, or undefined: an absolute
 * http(s) URL with a host and no user name or password, normalised by the
 * browser's own parser (lowercased host, international names in ASCII). The
 * database checks the same shape again (channel_link_url_valid).
 */
export function normalizeLinkUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.length > LINK_URL_MAX || /[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  let url: URL;
  try {
    // A bare "example.org/side" is meant as a web address.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!url.hostname || url.username || url.password) return undefined;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(url.hostname)) return undefined;
  const href = url.href;
  return href.length >= 10 && href.length <= LINK_URL_MAX ? href : undefined;
}

/** What a link row shows instead of the whole address. */
export function linkHostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Whether new files can be shared in this channel at all, for somebody: a
 * private lokallag channel or a group chat, or a community channel or
 * lokallag main chat whose file sharing is switched on — and not archived.
 * Presentation only; who may upload is message_attachment_policy() at every
 * upload and send.
 */
export function channelTakesFiles(
  channel: Pick<Channel, "isPrivate" | "subgroupId" | "fileSharing" | "archived">,
): boolean {
  if (channel.archived) return false;
  if (channel.isPrivate || channel.subgroupId) return true;
  return Boolean(channel.fileSharing);
}
