"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  createChannelSection,
  createCommunityChannel,
  deleteChannelSection,
  deleteCommunityChannel,
  getChannel,
  getCommunityById,
  moveChannelSection,
  moveCommunityChannel,
  renameChannelSection,
  setCommunityChannelArchived,
  updateCommunityChannel,
} from "@/lib/data";
import { purgeAttachmentObjects } from "@/lib/attachment-storage";
import {
  CREATION_KEY,
  normalizeChannelDetails,
  normalizeSectionName,
  type ChannelManageFormState,
} from "@/lib/channel-management-form";
import { communityTranslator, type Translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

/**
 * Server actions for a community's own channels and sections.
 *
 * Each one confirms there is a session, shapes the form into what one database
 * function takes, and turns a refusal into words. None of them decides who may
 * do what: every function in 20261028100000 checks from auth.uid() that the
 * caller is an active administrator of the community the channel or section
 * belongs to, so a tampered id reaches a function that refuses it. The
 * `communityId` a form carries is used only to choose the language of the
 * reply and the pages to refresh.
 */

type State = ChannelManageFormState;

async function session(formData: FormData): Promise<{ communityId: string; t: Translator }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const communityId = field(formData, "communityId");
  const community = communityId ? await getCommunityById(communityId) : undefined;
  return { communityId: community?.id ?? "", t: communityTranslator(community) };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/** An empty value means "none", never an empty id. */
function optional(formData: FormData, name: string): string | null {
  const value = field(formData, name).trim();
  return value ? value : null;
}

function position(formData: FormData): number | null {
  const raw = field(formData, "position").trim();
  if (!/^\d{1,4}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * "Hvem kan skrive i kanalen?". Anything but the explicit restricted choice
 * is "Alle medlemmer", the default.
 */
function readOnly(formData: FormData): boolean {
  return field(formData, "writeAccess") === "staff";
}

/**
 * "Tillat filvedlegg". Only the checked box turns it on; a missing or altered
 * value leaves the channel without files, the default.
 */
function fileSharing(formData: FormData): boolean {
  return field(formData, "fileSharing") === "on";
}

function creationKey(formData: FormData): string | null {
  const value = field(formData, "creationKey").toLowerCase();
  return CREATION_KEY.test(value) ? value : null;
}

/**
 * The sidebar sits in the community's layout, so every channel and section
 * change refreshes the whole community; the management page is under it.
 */
function revalidateCommunity(communityId: string) {
  if (communityId) revalidatePath(`/community/${communityId}`, "layout");
}

/**
 * Removes the stored files of attachments whose rows a deletion just took with
 * it. Runs after the response; anything that fails stays queued for the next
 * purge or the scheduled sweep (`npm run attachments:sweep`).
 */
function purgeAttachmentsAfterResponse() {
  after(async () => {
    try {
      await purgeAttachmentObjects();
    } catch (error) {
      console.error("[attachments] purge after channel deletion failed", error);
    }
  });
}

// ── Channels ────────────────────────────────────────────────────────────

/**
 * Creates a channel and opens it. A repeated submission with the same
 * creation key — a double click, a retry after a dropped response — lands on
 * the channel the first one created.
 */
export async function createCommunityChannelAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  if (!communityId) return { status: "error", error: t("err.channelCreateRefused") };

  const input = normalizeChannelDetails(field(formData, "name"), field(formData, "purpose"), t);
  if (!input.ok) return { status: "error", error: input.message };

  const result = await createCommunityChannel({
    communityId,
    name: input.name,
    purpose: input.purpose,
    sectionId: optional(formData, "sectionId"),
    creationKey: creationKey(formData),
    readOnly: readOnly(formData),
    fileSharing: fileSharing(formData),
  });
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidateCommunity(communityId);
  redirect(`/community/${communityId}/channel/${result.value}`);
}

/**
 * Name, description, who may write and file sharing. The address stays the
 * same, and so does every file already sent: switching file sharing off only
 * stops new ones.
 */
export async function updateCommunityChannelAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const input = normalizeChannelDetails(field(formData, "name"), field(formData, "purpose"), t);
  if (!input.ok) return { status: "error", error: input.message };

  const result = await updateCommunityChannel({
    channelId: field(formData, "channelId"),
    name: input.name,
    purpose: input.purpose,
    readOnly: readOnly(formData),
    fileSharing: fileSharing(formData),
  });
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidateCommunity(communityId);
  return { status: "ok" };
}

/** Moves a channel to a section (empty: none) and a place in it, or reorders it. */
export async function moveCommunityChannelAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const ok = await moveCommunityChannel(field(formData, "channelId"), optional(formData, "sectionId"), position(formData));
  if (!ok) return { status: "error", error: t("err.channelManageRefused") };
  revalidateCommunity(communityId);
  return { status: "ok" };
}

export async function setCommunityChannelArchivedAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const ok = await setCommunityChannelArchived(field(formData, "channelId"), field(formData, "archived") === "true");
  if (!ok) return { status: "error", error: t("err.channelManageRefused") };
  revalidateCommunity(communityId);
  return { status: "ok" };
}

/**
 * Permanently deletes a channel and lands on the community's Overview, or back
 * on the channel administration page when it was deleted from there.
 *
 * The channel is read first only to know its community for the redirect; a
 * channel the caller cannot read gives no destination and no deletion either.
 * `delete_community_channel()` decides everything else, including that a
 * channel with messages needs its name typed as confirmation.
 */
export async function deleteCommunityChannelAction(_prev: State, formData: FormData): Promise<State> {
  const { t } = await session(formData);
  const channel = await getChannel(field(formData, "channelId"));
  if (!channel) return { status: "error", error: t("err.channelDeleteRefused") };

  const result = await deleteCommunityChannel(channel.id, field(formData, "confirmName"));
  if (!result.ok) return { status: "error", error: t(result.error) };

  purgeAttachmentsAfterResponse();
  revalidateCommunity(channel.communityId);
  redirect(
    field(formData, "returnTo") === "manage"
      ? `/community/${channel.communityId}/kanaler`
      : `/community/${channel.communityId}`,
  );
}

// ── Sections ────────────────────────────────────────────────────────────

export async function createChannelSectionAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  if (!communityId) return { status: "error", error: t("err.sectionRefused") };

  const name = normalizeSectionName(field(formData, "name"), t);
  if (!name.ok) return { status: "error", error: name.message };

  const result = await createChannelSection(communityId, name.name, creationKey(formData));
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidateCommunity(communityId);
  return { status: "ok" };
}

export async function renameChannelSectionAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const name = normalizeSectionName(field(formData, "name"), t);
  if (!name.ok) return { status: "error", error: name.message };

  const result = await renameChannelSection(field(formData, "sectionId"), name.name);
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidateCommunity(communityId);
  return { status: "ok" };
}

export async function moveChannelSectionAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const target = position(formData);
  const ok = target !== null && (await moveChannelSection(field(formData, "sectionId"), target));
  if (!ok) return { status: "error", error: t("err.sectionRefused") };
  revalidateCommunity(communityId);
  return { status: "ok" };
}

/**
 * Deletes a section. `channelsTo` must be given when it has channels: "none"
 * or another section's id. The channels are moved, never deleted.
 */
export async function deleteChannelSectionAction(_prev: State, formData: FormData): Promise<State> {
  const { communityId, t } = await session(formData);
  const result = await deleteChannelSection(field(formData, "sectionId"), optional(formData, "channelsTo"));
  if (!result.ok) return { status: "error", error: t(result.error) };
  revalidateCommunity(communityId);
  return { status: "ok" };
}
