"use server";

import { revalidatePath } from "next/cache";
import {
  deleteChannelMessage,
  deleteDirectMessage,
  editChannelMessage,
  editDirectMessage,
  getCommunityById,
  setChannelMessagePinned,
} from "@/lib/data";
import { isUuid } from "@/lib/channel-resources";
import { communityTranslator, type MessageKey } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { DirectMessage, Message, MessageDeletion } from "@/lib/types";

/**
 * Server actions for changing a chat message after it was sent: editing,
 * deleting, and — in channels — pinning.
 *
 * Each confirms there is a session, shapes its input and turns a refusal into
 * words. None of them decides who may do what: the functions behind them
 * (20261101100000) find the message by id and ask its own channel or
 * conversation. `communityId` and the channel or conversation id sent along
 * only choose the reply's language and the pages to refresh.
 */

type Scope = { communityId: string; channelId?: string; conversationId?: string };

export type MessageEditActionResult<T> = { ok: true; message: T } | { ok: false; error: string };
export type MessageDeleteActionResult = { ok: true; deleted: MessageDeletion } | { ok: false; error: string };
export type MessagePinActionResult = { ok: true } | { ok: false; error: string };

async function translatorFor(communityId: unknown) {
  return communityTranslator(typeof communityId === "string" ? await getCommunityById(communityId) : undefined);
}

async function refuse(scope: Scope, key: MessageKey) {
  return { ok: false, error: (await translatorFor(scope.communityId))(key) } as const;
}

function revalidate(scope: Scope) {
  if (typeof scope.communityId !== "string") return;
  const community = encodeURIComponent(scope.communityId);
  if (typeof scope.channelId === "string") {
    revalidatePath(`/community/${community}/channel/${encodeURIComponent(scope.channelId)}`);
    revalidatePath(`/community/${community}`);
  }
  if (typeof scope.conversationId === "string") {
    revalidatePath(`/community/${community}/messages`);
    revalidatePath(`/community/${community}/messages/${encodeURIComponent(scope.conversationId)}`);
    revalidatePath("/", "layout");
  }
}

export async function editMessageAction(
  scope: Scope,
  messageId: string,
  body: string,
): Promise<MessageEditActionResult<Message | DirectMessage>> {
  if (!(await getSessionUser())) return refuse(scope, "err.messageActionDenied");
  if (typeof messageId !== "string" || !isUuid(messageId) || typeof body !== "string") {
    return refuse(scope, "err.messageNotFound");
  }
  const result = scope.conversationId
    ? await editDirectMessage(messageId, body)
    : await editChannelMessage(messageId, body);
  if (!result.ok) return refuse(scope, result.error);
  revalidate(scope);
  return { ok: true, message: result.message };
}

export async function deleteMessageAction(scope: Scope, messageId: string): Promise<MessageDeleteActionResult> {
  if (!(await getSessionUser())) return refuse(scope, "err.messageActionDenied");
  if (typeof messageId !== "string" || !isUuid(messageId)) return refuse(scope, "err.messageNotFound");
  const result = scope.conversationId
    ? await deleteDirectMessage(messageId)
    : await deleteChannelMessage(messageId);
  if (!result.ok) return refuse(scope, result.error);
  revalidate(scope);
  return { ok: true, deleted: result.deleted };
}

export async function setMessagePinnedAction(
  scope: Scope,
  messageId: string,
  pinned: boolean,
): Promise<MessagePinActionResult> {
  if (!(await getSessionUser())) return refuse(scope, "err.messageActionDenied");
  if (typeof messageId !== "string" || !isUuid(messageId) || typeof pinned !== "boolean") {
    return refuse(scope, "err.messageNotFound");
  }
  const result = await setChannelMessagePinned(messageId, pinned);
  if (!result.ok) return refuse(scope, result.error);
  revalidate(scope);
  return { ok: true };
}
