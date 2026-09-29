/**
 * Shared shape for the channel message action.
 *
 * Lives outside `app/actions.ts` for the same reason as `post-form.ts`: a
 * `"use server"` module may only export async functions, so the initial-state
 * constant cannot live there.
 */
import type { MessageKey } from "@/lib/i18n";
import type { Message } from "@/lib/types";

export type MessageFormState =
  | { status: "idle" }
  | { status: "ok"; message: Message }
  | { status: "error"; error: string };

export const emptyMessageFormState: MessageFormState = { status: "idle" };

/** The longest message body, channel or direct, counted in characters. */
export const MESSAGE_BODY_MAX = 4000;

/**
 * The one server-side rule for a message body, shared by channels and direct
 * messages. `body` is already trimmed. A custom emoji is ordinary text here
 * (`:name:`), so it counts like any other characters and cannot be used to
 * get past the limit.
 */
export function messageBodyError(body: string): MessageKey | undefined {
  if (!body) return "err.messageEmpty";
  if (body.length > MESSAGE_BODY_MAX) return "err.messageTooLong";
  return undefined;
}
