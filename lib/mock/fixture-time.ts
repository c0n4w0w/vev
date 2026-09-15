/**
 * Keeps the showcase looking like today, whenever today is.
 *
 * The fixtures carry absolute timestamps, written around a particular
 * afternoon. Left alone they age: the newest post drifts weeks into the past,
 * `portal_events` quietly drops events as they expire, and a prospect opens a
 * community that looks abandoned.
 *
 * Rather than rewrite every fixture into relative offsets — which would mean
 * editing files that hold the organisations' own content — the seed shifts the
 * whole set by one constant when it writes. Every timestamp moves together, so
 * the spacing a fixture author chose is preserved exactly: a comment posted
 * twenty minutes after its parent is still twenty minutes after it, and an
 * event three weeks out is still three weeks out.
 *
 * `FIXTURE_TODAY` is the day the fixtures treat as "now" — the date of the
 * newest post, comment and notification in the set. Move the fixtures forward
 * and this moves with them; the arithmetic takes care of itself.
 */
export const FIXTURE_TODAY = "2026-09-06T12:00:00+02:00";

/** Milliseconds to add to every fixture timestamp, computed once per seed run. */
export function fixtureTimeOffset(reference: Date = new Date()): number {
  return reference.getTime() - Date.parse(FIXTURE_TODAY);
}

/**
 * Shifts one ISO timestamp by the offset.
 *
 * Returns ISO 8601 in UTC. Postgres stores `timestamptz` as an instant, so the
 * zone the fixture was written in does not survive the round trip anyway.
 */
export function shiftTimestamp(iso: string, offsetMs: number): string {
  return new Date(Date.parse(iso) + offsetMs).toISOString();
}

/** Date-only columns (`joined_at`) want `YYYY-MM-DD`, not an instant. */
export function shiftDate(iso: string, offsetMs: number): string {
  return shiftTimestamp(iso, offsetMs).slice(0, 10);
}
