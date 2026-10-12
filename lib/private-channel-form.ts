/**
 * Shared shapes for the private lokallag channel actions.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions, so the initial-state constants cannot live there.
 */

/**
 * Creating a channel. Success never comes back as a state: the action
 * redirects to the new conversation.
 */
export type PrivateChannelCreateFormState =
  | { status: "idle" }
  | { status: "error"; error: string };

export const emptyPrivateChannelCreateFormState: PrivateChannelCreateFormState = { status: "idle" };

/** Adding or removing a participant, the manager mark, archiving and reopening. */
export type PrivateChannelFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptyPrivateChannelFormState: PrivateChannelFormState = { status: "idle" };

/** One match from the participant search: an id and a community display name. */
export type PrivateChannelCandidate = { userId: string; displayName: string };

/**
 * How many participants one create form may carry. Far above any real
 * working group; create_private_channel() has its own, higher ceiling.
 */
export const PRIVATE_CHANNEL_PARTICIPANTS_MAX = 100;
