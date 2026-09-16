/**
 * Shared shape for the notification form action.
 *
 * This lives outside `app/actions.ts` because a `"use server"` module may only
 * export async functions — exporting the initial-state constant from there
 * fails at module evaluation, not at type-check time.
 */
export type NotificationFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyNotificationFormState: NotificationFormState = { status: "idle" };
