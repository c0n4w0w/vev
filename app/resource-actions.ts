"use server";

import { getRequestTranslator } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import {
  addChannelLink,
  createResourceFolder,
  deleteChannelLink,
  deleteResourceFolder,
  moveChannelResource,
  renameResourceFolder,
  setChannelFileSharing,
  setChannelResourcePinned,
  updateChannelLink,
  type ResourceWriteResult,
} from "@/lib/channel-resource-data";
import {
  LINK_DESCRIPTION_MAX,
  LINK_TITLE_MAX,
  RESOURCE_FOLDER_NAME_MAX,
  isUuid,
  normalizeLinkUrl,
} from "@/lib/channel-resources";
import { getCommunityById } from "@/lib/data";
import { type MessageKey, type Translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

/**
 * Server actions for a channel's Ressurser: links, folders, filing and pins.
 *
 * Each one confirms there is a session, shapes its input and turns a refusal
 * into words. None of them decides who may do what: every function behind
 * them (20261031100000) asks the channel's own rules for auth.uid() and the
 * channel the row really belongs to, so a tampered id or channel reaches a
 * function that refuses it. The `communityId` and `channelId` sent along only
 * choose the reply's language and the page to refresh.
 */

export type ResourceActionResult = { ok: true; id?: string; moved?: number } | { ok: false; error: string };

type Scope = { communityId: string; channelId: string };

// Same set as Postgres' [[:cntrl:]].
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

async function begin(scope: Scope): Promise<Translator | undefined> {
  const user = await getSessionUser();
  if (!user) return undefined;
  const community = typeof scope.communityId === "string" ? await getCommunityById(scope.communityId) : undefined;
  return (await getRequestTranslator(community));
}

function finish<T>(scope: Scope, t: Translator, result: ResourceWriteResult<T>, extra?: (value: T) => Partial<ResourceActionResult>) {
  if (!result.ok) return { ok: false, error: t(result.error) } as const;
  if (typeof scope.channelId === "string" && typeof scope.communityId === "string") {
    revalidatePath(`/community/${scope.communityId}/channel/${scope.channelId}`);
  }
  return { ok: true, ...(extra ? extra(result.value) : {}) } as ResourceActionResult;
}

function refuse(t: Translator | undefined, key: MessageKey): ResourceActionResult {
  return { ok: false, error: t ? t(key) : "—" };
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (CONTROL.test(text) || Array.from(text).length > max) return undefined;
  return text;
}

function optionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return isUuid(String(value)) ? String(value) : undefined;
}

function checkLink(t: Translator, input: { url: unknown; title: unknown; description: unknown }) {
  const url = typeof input.url === "string" ? normalizeLinkUrl(input.url) : undefined;
  if (!url) return { error: refuse(t, "err.resourceLinkUrl") };
  const title = cleanText(input.title, LINK_TITLE_MAX);
  if (!title) return { error: refuse(t, "err.resourceLinkTitle") };
  const description = cleanText(input.description ?? "", LINK_DESCRIPTION_MAX);
  if (description === undefined) return { error: refuse(t, "err.resourceLinkDescription") };
  return { url, title, description };
}

// ── Links ───────────────────────────────────────────────────────────────

export async function addChannelLinkAction(
  scope: Scope,
  input: { folderId?: string | null; url: string; title: string; description?: string },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  const link = checkLink(t, { url: input.url, title: input.title, description: input.description ?? "" });
  if ("error" in link) return link.error!;
  const folderId = optionalId(input.folderId);
  if (folderId === undefined) return refuse(t, "err.resourceNotFound");
  const result = await addChannelLink({ channelId: String(scope.channelId), folderId, ...link });
  return finish(scope, t, result, (id) => ({ id }));
}

export async function updateChannelLinkAction(
  scope: Scope,
  input: { linkId: string; url: string; title: string; description?: string },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if (!isUuid(input.linkId)) return refuse(t, "err.resourceNotFound");
  const link = checkLink(t, { url: input.url, title: input.title, description: input.description ?? "" });
  if ("error" in link) return link.error!;
  return finish(scope, t, await updateChannelLink({ linkId: input.linkId, ...link }));
}

export async function deleteChannelLinkAction(scope: Scope, linkId: string): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if (!isUuid(linkId)) return refuse(t, "err.resourceNotFound");
  return finish(scope, t, await deleteChannelLink(linkId));
}

// ── Folders ─────────────────────────────────────────────────────────────

export async function createResourceFolderAction(
  scope: Scope,
  input: { parentId?: string | null; name: string },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  const name = cleanText(input.name, RESOURCE_FOLDER_NAME_MAX);
  if (!name) return refuse(t, "err.resourceFolderName");
  const parentId = optionalId(input.parentId);
  if (parentId === undefined) return refuse(t, "err.resourceNotFound");
  const result = await createResourceFolder({ channelId: String(scope.channelId), parentId, name });
  return finish(scope, t, result, (id) => ({ id }));
}

export async function renameResourceFolderAction(
  scope: Scope,
  input: { folderId: string; name: string },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if (!isUuid(input.folderId)) return refuse(t, "err.resourceNotFound");
  const name = cleanText(input.name, RESOURCE_FOLDER_NAME_MAX);
  if (!name) return refuse(t, "err.resourceFolderName");
  return finish(scope, t, await renameResourceFolder(input.folderId, name));
}

/** Deletes a folder and its subfolders; what was in them stays, unfiled. */
export async function deleteResourceFolderAction(scope: Scope, folderId: string): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if (!isUuid(folderId)) return refuse(t, "err.resourceNotFound");
  return finish(scope, t, await deleteResourceFolder(folderId), (moved) => ({ moved }));
}

// ── Filing and pins ─────────────────────────────────────────────────────

export async function moveChannelResourceAction(
  scope: Scope,
  input: { type: "file" | "link"; id: string; folderId?: string | null },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  const folderId = optionalId(input.folderId);
  if ((input.type !== "file" && input.type !== "link") || !isUuid(input.id) || folderId === undefined) {
    return refuse(t, "err.resourceNotFound");
  }
  return finish(scope, t, await moveChannelResource({ type: input.type, id: input.id, folderId }));
}

export async function setChannelResourcePinnedAction(
  scope: Scope,
  input: { type: "file" | "link"; id: string; pinned: boolean },
): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if ((input.type !== "file" && input.type !== "link") || !isUuid(input.id) || typeof input.pinned !== "boolean") {
    return refuse(t, "err.resourceNotFound");
  }
  return finish(scope, t, await setChannelResourcePinned(input));
}

/**
 * "Tillat filvedlegg" in a lokallag's main chat. Its community's
 * administrators and that lokallag's own leaders may change it; the database
 * refuses everyone else (set_channel_file_sharing). Files already sent stay.
 */
export async function setChannelFileSharingAction(scope: Scope, enabled: boolean): Promise<ResourceActionResult> {
  const t = await begin(scope);
  if (!t) return refuse(t, "err.resourceNotAllowed");
  if (typeof enabled !== "boolean" || typeof scope.channelId !== "string") return refuse(t, "err.resourceNotFound");
  const result = await setChannelFileSharing(scope.channelId, enabled);
  // "Not allowed" rather than a generic failure: the function answers false
  // for anyone it refuses.
  return finish(scope, t, result.ok ? result : { ok: false, error: "err.resourceNotAllowed" });
}

