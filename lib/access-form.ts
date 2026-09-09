/**
 * Shared shapes for the access-request and invitation forms.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions.
 */
export type AccessFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyAccessFormState: AccessFormState = { status: "idle" };

/**
 * The single answer the public request form ever gives.
 *
 * Deliberately identical whether the address was new, already pending, already
 * a member, or rate-limited — anything more specific would let someone test
 * addresses against a community's membership.
 */
export const REQUEST_SENT_MESSAGE = "Takk. Forespørselen din er sendt til en administrator.";
