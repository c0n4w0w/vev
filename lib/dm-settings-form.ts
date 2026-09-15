/**
 * Shared shape for the direct-message settings action.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions, so the initial-state constant cannot live there.
 */
export type DmSettingFormState =
  | { status: "idle" }
  | { status: "ok"; acceptsMemberDms: boolean }
  | { status: "error"; error: string };

export const emptyDmSettingFormState: DmSettingFormState = { status: "idle" };
