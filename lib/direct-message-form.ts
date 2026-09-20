/**
 * Shared shape for direct-message actions.
 *
 * Kept outside `app/actions.ts` because a `"use server"` module may only
 * export async functions.
 */
import type { DirectMessage } from "@/lib/types";

export type DirectMessageFormState =
  | { status: "idle" }
  | { status: "ok"; message: DirectMessage }
  | { status: "error"; error: string };

export const emptyDirectMessageFormState: DirectMessageFormState = { status: "idle" };
