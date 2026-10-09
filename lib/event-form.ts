/**
 * Shared shapes for the event actions.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions, so the initial-state constants cannot live there.
 */
export type RsvpFormState =
  | { status: "idle" }
  | { status: "ok"; attending: boolean }
  | { status: "error"; error: string };

export const emptyRsvpFormState: RsvpFormState = { status: "idle" };

export type EventFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptyEventFormState: EventFormState = { status: "idle" };

/** The event is full. Its own message, because it is not the member's mistake. */
export const EVENT_FULL = "err.eventFull" as const;

/** Anything else the database declines — wrong community, no longer a member. */
export const RSVP_REFUSED = "err.rsvpRefused" as const;

export const EVENT_CREATE_REFUSED = "err.eventCreateRefused" as const;

/** Cancel / restore / delete. */
export type EventLifecycleFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; error: string };

export const emptyEventLifecycleFormState: EventLifecycleFormState = { status: "idle" };
