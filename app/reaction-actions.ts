"use server";

import { getRequestTranslator } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import {
  getCommunityById,
  getReactionAuthors,
  setCommunityReactionVisibility,
  setReaction,
} from "@/lib/data";
import { isUuid } from "@/lib/channel-resources";
import { knownEmoji } from "@/lib/emoji/catalog";
import { type MessageKey } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { Reaction, ReactionAuthors, ReactionAuthorVisibility, ReactionKind } from "@/lib/types";

/**
 * Reactions on posts, channel messages and direct messages, and the
 * community setting for who may see who reacted.
 *
 * Each action confirms there is a session and shapes its input; none decides
 * who may do what. set_reaction() and reaction_authors() find the parent by id
 * and ask its own conversation (20261108100000). `scope` only chooses the
 * reply's language and the pages to refresh — a wrong one refreshes a page,
 * it grants nothing.
 *
 * A built-in emoji must be one in the Unicode list and is stored in one
 * canonical spelling, so 👍 and 👍️ are one chip. A custom emoji is an id the
 * database checks against the parent's own community.
 */

type Scope = { communityId: string; channelId?: string; conversationId?: string };

export type ReactionTarget = { kind: ReactionKind; id: string };
export type ReactionChoice = { emoji: string } | { emojiId: string };

export type SetReactionActionResult = { ok: true; reactions: Reaction[] } | { ok: false; error: string };

const KINDS: readonly ReactionKind[] = ["message", "direct", "post"];

async function words(scope: Scope, key: MessageKey) {
  const community = typeof scope?.communityId === "string" ? await getCommunityById(scope.communityId) : undefined;
  return (await getRequestTranslator(community))(key);
}

function shape(target: ReactionTarget, choice: ReactionChoice): { target: ReactionTarget; choice: ReactionChoice } | undefined {
  if (!target || !KINDS.includes(target.kind) || typeof target.id !== "string" || !isUuid(target.id)) return undefined;
  if (!choice || typeof choice !== "object") return undefined;
  if ("emojiId" in choice) {
    return typeof choice.emojiId === "string" && isUuid(choice.emojiId) && !("emoji" in choice)
      ? { target, choice: { emojiId: choice.emojiId } }
      : undefined;
  }
  if (typeof choice.emoji !== "string") return undefined;
  const emoji = knownEmoji(choice.emoji);
  return emoji ? { target, choice: { emoji } } : undefined;
}

function revalidate(scope: Scope, kind: ReactionKind) {
  if (typeof scope?.communityId !== "string") return;
  const community = encodeURIComponent(scope.communityId);
  if (kind === "post") {
    revalidatePath(`/community/${community}/feed`);
    revalidatePath(`/community/${community}/lokallag`);
    revalidatePath(`/community/${community}`);
    revalidatePath("/home");
  } else if (kind === "message" && typeof scope.channelId === "string") {
    revalidatePath(`/community/${community}/channel/${encodeURIComponent(scope.channelId)}`);
  } else if (kind === "direct" && typeof scope.conversationId === "string") {
    revalidatePath(`/community/${community}/messages/${encodeURIComponent(scope.conversationId)}`);
  }
}

/**
 * Sets the caller's reaction to `on` (not a toggle: repeating a request lands
 * on the same state). Returns the parent's counts afterwards.
 */
export async function setReactionAction(
  scope: Scope,
  target: ReactionTarget,
  choice: ReactionChoice,
  on: boolean,
): Promise<SetReactionActionResult> {
  if (!(await getSessionUser())) return { ok: false, error: await words(scope, "err.reactionDenied") };
  const shaped = shape(target, choice);
  if (!shaped || typeof on !== "boolean") return { ok: false, error: await words(scope, "err.reactionInvalid") };

  const result = await setReaction(shaped.target.kind, shaped.target.id, shaped.choice, on);
  if (!result.ok) return { ok: false, error: await words(scope, result.error) };
  revalidate(scope, shaped.target.kind);
  return { ok: true, reactions: result.reactions };
}

/**
 * Who reacted with one emoji, as far as the caller may know: names, or only
 * a count. Undefined for anything the caller cannot read.
 */
export async function reactionAuthorsAction(
  target: ReactionTarget,
  choice: ReactionChoice,
): Promise<ReactionAuthors | undefined> {
  if (!(await getSessionUser())) return undefined;
  const shaped = shape(target, choice);
  if (!shaped) return undefined;
  return getReactionAuthors(shaped.target.kind, shaped.target.id, shaped.choice);
}

export type ReactionVisibilityFormState =
  | { status: "idle" }
  | { status: "ok"; value: ReactionAuthorVisibility }
  | { status: "error"; error: string };

/** A community admin chooses who may see who reacted in its own channels. */
export async function setReactionVisibilityAction(
  _prev: ReactionVisibilityFormState,
  formData: FormData,
): Promise<ReactionVisibilityFormState> {
  const communityId = String(formData.get("communityId") ?? "");
  const value = formData.get("value");
  const scope = { communityId };
  if (!(await getSessionUser())) return { status: "error", error: await words(scope, "settings.reactions.failed") };
  if (value !== "moderators" && value !== "channel") {
    return { status: "error", error: await words(scope, "settings.reactions.failed") };
  }

  const stored = await setCommunityReactionVisibility(communityId, value);
  if (stored !== value) return { status: "error", error: await words(scope, "settings.reactions.failed") };

  const community = encodeURIComponent(communityId);
  revalidatePath(`/community/${community}/settings`);
  revalidatePath(`/community/${community}`, "layout");
  return { status: "ok", value: stored };
}
