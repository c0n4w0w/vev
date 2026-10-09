/**
 * Shared shapes for the local-group actions.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions, so the initial-state constants cannot live there.
 */
export type LocalGroupFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptyLocalGroupFormState: LocalGroupFormState = { status: "idle" };

/** Shown when the database declines a selection. */
export const SELECTION_REFUSED = "err.localGroupSelectionRefused" as const;

/** Shown when the database declines an administrator's change. */
export const ADMIN_REFUSED = "err.localGroupAdminRefused" as const;

/**
 * Appointing or removing a lokallagsleder. Success carries a sentence naming
 * the person, so the admin sees what changed without hunting for it.
 */
export type LocalGroupLeaderFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; error: string };

export const emptyLocalGroupLeaderFormState: LocalGroupLeaderFormState = { status: "idle" };
