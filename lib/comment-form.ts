/**
 * Shared shape for the comment and reaction actions.
 *
 * Lives outside `app/actions.ts` for the same reason `lib/post-form.ts` does:
 * a `"use server"` module may only export async functions, so an initial-state
 * constant exported from there fails at module evaluation.
 */
export type CommentFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyCommentFormState: CommentFormState = { status: "idle" };

/**
 * The built-in reactions, always available in every community.
 *
 * This is a UI palette, not a database allowlist: the reaction column accepts
 * any short Unicode string, so the seeded content keeps its wider set and this
 * list can grow without a migration. What the database *does* constrain is
 * custom emojis, which must belong to the post's own community.
 */
export const reactionPalette = ["❤️", "👍", "😂", "🎉", "😮", "😢"] as const;
