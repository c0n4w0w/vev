/**
 * Shared shape for the channel message action.
 *
 * Lives outside `app/actions.ts` for the same reason as `post-form.ts`: a
 * `"use server"` module may only export async functions, so the initial-state
 * constant cannot live there.
 */
import type { Message } from "@/lib/types";

export type MessageFormState =
  | { status: "idle" }
  | { status: "ok"; message: Message }
  | { status: "error"; error: string };

export const emptyMessageFormState: MessageFormState = { status: "idle" };
