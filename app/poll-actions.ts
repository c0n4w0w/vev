"use server";

import { getRequestTranslator } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import { getCommunityById } from "@/lib/data";
import {
  closeChannelPoll,
  createChannelPoll,
  getChannelPolls,
  getPollVoters,
  voteChannelPoll,
  withdrawChannelPollVote,
} from "@/lib/poll-data";
import { shapePoll } from "@/lib/poll-form";
import { isUuid } from "@/lib/channel-resources";
import { type MessageKey } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { ChannelPoll, Message, PollVoters } from "@/lib/types";

/**
 * Polls in channel conversations: creating, voting, closing, and reading the
 * current state for the live view.
 *
 * Each action confirms there is a session and shapes its input; none decides
 * who may do what. create_channel_poll(), vote_channel_poll() and
 * close_channel_poll() find the channel or poll by id and ask its own rules
 * (20261111100000). `communityId` only chooses the reply's language and the
 * pages to refresh — a wrong one refreshes a page, it grants nothing.
 */

type Scope = { communityId: string; channelId: string };

export type PollActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function refuse(scope: Scope, key: MessageKey) {
  const community = typeof scope?.communityId === "string" ? await getCommunityById(scope.communityId) : undefined;
  return { ok: false, error: (await getRequestTranslator(community))(key) } as const;
}

function validScope(scope: Scope): boolean {
  return Boolean(scope) && typeof scope.communityId === "string" && typeof scope.channelId === "string" && scope.channelId.length <= 200;
}

function revalidate(scope: Scope) {
  const community = encodeURIComponent(scope.communityId);
  revalidatePath(`/community/${community}/channel/${encodeURIComponent(scope.channelId)}`);
  revalidatePath(`/community/${community}`);
}

/** Posts a poll as a message. Returns the stored message with its poll. */
export async function createPollAction(
  scope: Scope,
  input: { question: unknown; options: unknown; visibility?: unknown },
): Promise<PollActionResult<Message>> {
  if (!(await getSessionUser()) || !validScope(scope)) return refuse(scope, "poll.err.notAllowed");
  const shaped = shapePoll(input ?? {});
  if (!shaped.ok) return refuse(scope, shaped.error);

  const result = await createChannelPoll({ channelId: scope.channelId, ...shaped.poll });
  if (!result.ok) return refuse(scope, result.error);

  const poll = (await getChannelPolls(scope.channelId, [result.value.messageId])).get(result.value.messageId);
  revalidate(scope);
  return {
    ok: true,
    value: {
      id: result.value.messageId,
      channelId: scope.channelId,
      authorId: result.value.authorId,
      body: result.value.body,
      createdAt: result.value.createdAt,
      poll,
    },
  };
}

/** Casts or moves the caller's vote. Returns the poll as they now see it. */
export async function votePollAction(
  scope: Scope,
  messageId: string,
  optionId: string,
): Promise<PollActionResult<ChannelPoll>> {
  if (!(await getSessionUser()) || !validScope(scope)) return refuse(scope, "poll.err.notFound");
  if (typeof messageId !== "string" || !isUuid(messageId) || typeof optionId !== "string" || !isUuid(optionId)) {
    return refuse(scope, "poll.err.invalidOption");
  }
  const result = await voteChannelPoll(messageId, optionId);
  if (!result.ok) return refuse(scope, result.error);
  revalidate(scope);
  return result;
}

/** Takes back the caller's vote while the poll is open. Returns the poll as they now see it. */
export async function withdrawVoteAction(scope: Scope, messageId: string): Promise<PollActionResult<ChannelPoll>> {
  if (!(await getSessionUser()) || !validScope(scope)) return refuse(scope, "poll.err.notFound");
  if (typeof messageId !== "string" || !isUuid(messageId)) return refuse(scope, "poll.err.notFound");
  const result = await withdrawChannelPollVote(messageId);
  if (!result.ok) return refuse(scope, result.error === "poll.err.closed" ? "poll.err.withdrawClosed" : result.error);
  revalidate(scope);
  return result;
}

/** Closes the poll for good. */
export async function closePollAction(scope: Scope, messageId: string): Promise<PollActionResult<ChannelPoll>> {
  if (!(await getSessionUser()) || !validScope(scope)) return refuse(scope, "poll.err.notFound");
  if (typeof messageId !== "string" || !isUuid(messageId)) return refuse(scope, "poll.err.notFound");
  const result = await closeChannelPoll(messageId);
  if (!result.ok) return refuse(scope, result.error === "poll.err.notAllowed" ? "poll.err.closeDenied" : result.error);
  revalidate(scope);
  return result;
}

/**
 * The current state of some polls in one channel, for the open page to keep
 * its counts fresh. Polls the caller cannot read are simply missing.
 */
export async function pollStatesAction(scope: Scope, messageIds: string[]): Promise<ChannelPoll[]> {
  if (!(await getSessionUser()) || !validScope(scope) || !Array.isArray(messageIds)) return [];
  const ids = messageIds.filter((id) => typeof id === "string" && isUuid(id)).slice(0, 200);
  if (ids.length === 0) return [];
  return [...(await getChannelPolls(scope.channelId, ids)).values()];
}

/**
 * Who chose one option of a visible poll, as far as the caller may know.
 * Undefined whenever channel_poll_voters() gives nothing.
 */
export async function pollVotersAction(
  communityId: string,
  messageId: string,
  optionId: string,
): Promise<PollVoters | undefined> {
  if (!(await getSessionUser()) || typeof communityId !== "string") return undefined;
  if (typeof messageId !== "string" || !isUuid(messageId) || typeof optionId !== "string" || !isUuid(optionId)) {
    return undefined;
  }
  return getPollVoters(communityId, messageId, optionId);
}
