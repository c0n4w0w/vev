import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageKey } from "@/lib/i18n";
import type { ChannelPoll, ChannelPollOption, PollVisibility, PollVoters } from "@/lib/types";

/**
 * Channel polls, read and written as the signed-in person.
 *
 * Nothing here decides who may do what (20261111100000_channel_polls): the
 * functions behind each call find the channel or poll by id and ask its own
 * rules — channel access, the caller's role in that community, a
 * gruppeansvarlig mark for exactly that group, open or closed. What comes
 * back holds counts, never who voted.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPollOption(value: unknown): ChannelPollOption | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") return undefined;
  return {
    id: value.id,
    label: value.label,
    count: typeof value.count === "number" ? value.count : undefined,
  };
}

export function toChannelPoll(value: unknown): ChannelPoll | undefined {
  if (!isRecord(value) || typeof value.messageId !== "string" || typeof value.question !== "string") {
    return undefined;
  }
  const options = (Array.isArray(value.options) ? value.options : [])
    .map(toPollOption)
    .filter((option): option is ChannelPollOption => Boolean(option));
  return {
    messageId: value.messageId,
    question: value.question,
    visibility: value.visibility === "visible" ? "visible" : "anonymous",
    closedAt: typeof value.closedAt === "string" ? value.closedAt : undefined,
    total: typeof value.total === "number" ? value.total : 0,
    myOptionId: typeof value.myOptionId === "string" ? value.myOptionId : undefined,
    resultsVisible: value.resultsVisible === true,
    canVote: value.canVote === true,
    canClose: value.canClose === true,
    options,
  };
}

/**
 * The polls in one channel as the caller sees them, by message id — all of
 * them, or only the given ones. Empty for a channel the caller cannot read.
 */
export async function getChannelPolls(channelId: string, messageIds?: string[]): Promise<Map<string, ChannelPoll>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("channel_poll_states", {
    p_channel_id: channelId,
    // Null asks for every poll in the channel.
    p_message_ids: (messageIds ?? null) as string[],
  });
  const polls = new Map<string, ChannelPoll>();
  if (error || !Array.isArray(data)) return polls;
  for (const entry of data) {
    const poll = toChannelPoll(entry);
    if (poll) polls.set(poll.messageId, poll);
  }
  return polls;
}

/** Presentation only: whether "Avstemning" is offered. create_channel_poll() asks again. */
export async function canCreateChannelPoll(channelId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_create_channel_poll", { p_channel_id: channelId });
  return !error && data === true;
}

function pollError(message: string): MessageKey {
  if (message.includes("poll_error:not_allowed")) return "poll.err.notAllowed";
  if (message.includes("poll_error:not_found")) return "poll.err.notFound";
  if (message.includes("poll_error:archived")) return "poll.err.archived";
  if (message.includes("poll_error:closed")) return "poll.err.closed";
  if (message.includes("poll_error:invalid_option")) return "poll.err.invalidOption";
  if (message.includes("poll_error:question")) return "poll.err.questionTooLong";
  if (message.includes("poll_error:option_count")) return "poll.err.tooFewOptions";
  if (message.includes("poll_error:option")) return "poll.err.optionTooLong";
  if (message.includes("poll_error:duplicate")) return "poll.err.duplicate";
  if (message.includes("poll_error:visibility")) return "poll.err.invalid";
  return "poll.err.saveFailed";
}

export type PollWriteResult<T> = { ok: true; value: T } | { ok: false; error: MessageKey };

/** Posts a poll as a message from the caller. Returns the stored message's id. */
export async function createChannelPoll(input: {
  channelId: string;
  question: string;
  options: string[];
  visibility: PollVisibility;
}): Promise<PollWriteResult<{ messageId: string; createdAt: string; body: string; authorId: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_channel_poll", {
    p_channel_id: input.channelId,
    p_question: input.question,
    p_options: input.options,
    p_visibility: input.visibility,
  });
  if (error || !data) return { ok: false, error: pollError(error?.message ?? "") };
  return {
    ok: true,
    value: { messageId: data.id, createdAt: data.created_at, body: data.body, authorId: data.author_id },
  };
}

export async function voteChannelPoll(messageId: string, optionId: string): Promise<PollWriteResult<ChannelPoll>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("vote_channel_poll", { p_message_id: messageId, p_option_id: optionId });
  const poll = error ? undefined : toChannelPoll(data);
  return poll ? { ok: true, value: poll } : { ok: false, error: pollError(error?.message ?? "") };
}

/** Takes back the caller's own vote on an open poll. */
export async function withdrawChannelPollVote(messageId: string): Promise<PollWriteResult<ChannelPoll>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("withdraw_channel_poll_vote", { p_message_id: messageId });
  const poll = error ? undefined : toChannelPoll(data);
  return poll ? { ok: true, value: poll } : { ok: false, error: pollError(error?.message ?? "") };
}

export async function closeChannelPoll(messageId: string): Promise<PollWriteResult<ChannelPoll>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("close_channel_poll", { p_message_id: messageId });
  const poll = error ? undefined : toChannelPoll(data);
  return poll ? { ok: true, value: poll } : { ok: false, error: pollError(error?.message ?? "") };
}

/**
 * Who chose one option of a visible poll — community names and photos of the
 * voters still in the channel, anyone who left only counted. Undefined for an anonymous
 * poll, before the caller has voted on an open one, or anything unreadable.
 */
export async function getPollVoters(
  communityId: string,
  messageId: string,
  optionId: string,
): Promise<PollVoters | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("channel_poll_voters", { p_message_id: messageId, p_option_id: optionId });
  if (error || !isRecord(data)) return undefined;
  const people: PollVoters["people"] = [];
  for (const entry of Array.isArray(data.people) ? (data.people as unknown[]) : []) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.ref !== "string") continue;
    people.push({
      ref: entry.ref,
      name: entry.name,
      me: entry.me === true,
      // The photo's version only; the route asks the database again.
      avatarUrl:
        typeof entry.avatar === "string"
          ? `/community/${encodeURIComponent(communityId)}/poll-voter-avatar/${messageId}/${entry.ref}?v=${encodeURIComponent(entry.avatar)}`
          : undefined,
    });
  }
  return {
    total: typeof data.total === "number" ? data.total : 0,
    people,
    unnamed: typeof data.unnamed === "number" ? data.unnamed : 0,
  };
}
