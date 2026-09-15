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
export const SELECTION_REFUSED =
  "Lokallaget kunne ikke velges. Det kan være avviklet, eller høre til et annet fellesskap.";

/** Shown when the database declines an administrator's change. */
export const ADMIN_REFUSED =
  "Endringen ble ikke utført. Bare administratorer i dette fellesskapet kan endre lokallag.";
