/**
 * Shared shape for the post form actions.
 *
 * This lives outside `app/actions.ts` because a `"use server"` module may only
 * export async functions — exporting the initial-state constant from there
 * fails at module evaluation, not at type-check time.
 */
export type PostFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyPostFormState: PostFormState = { status: "idle" };
