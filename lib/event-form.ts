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
export const EVENT_FULL = "Arrangementet er fullt. Ingen flere plasser akkurat nå.";

/** Anything else the database declines — wrong community, no longer a member. */
export const RSVP_REFUSED = "Påmeldingen kunne ikke lagres. Prøv igjen.";

export const EVENT_CREATE_REFUSED =
  "Arrangementet ble ikke opprettet. Bare administratorer i dette fellesskapet kan legge inn arrangementer.";
