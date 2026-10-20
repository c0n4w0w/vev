/**
 * Shared shape for the comment actions.
 *
 * Lives outside `app/actions.ts` for the same reason `lib/post-form.ts` does:
 * a `"use server"` module may only export async functions, so an initial-state
 * constant exported from there fails at module evaluation.
 */
export type CommentFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyCommentFormState: CommentFormState = { status: "idle" };
