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
export const FIXTURE_TODAY = "2026-09-17T18:10:00+02:00";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The zone every fixture is written in and every screen renders in.
 *
 * `lib/format.ts` formats each date with `timeZone: "Europe/Oslo"`, so that is
 * the clock the invariant below has to hold against — not UTC, and not
 * whatever zone the machine running the seed happens to be in.
 */
const FIXTURE_ZONE = "Europe/Oslo";

/**
 * Milliseconds to add to every fixture timestamp, computed once per seed run.
 *
 * Rounded down to a whole number of weeks, and that is the whole point. The
 * first version of this used the raw difference, which carried the hour,
 * minute and second the seed happened to run at: an event written as Wednesday
 * 18:00 came out as Saturday 03:19, and every date on the public portal looked
 * like nonsense. A whole number of weeks moves the set forward while leaving
 * both the weekday and the time of day where the author put them.
 *
 * Rounding *down* rather than to the nearest week is deliberate. Rounding up
 * would push content written in the past into the future, and a post dated
 * "om 3 dager" is worse than one dated "for 5 dager siden". The cost is that
 * the newest fixture content is between zero and seven days old rather than
 * always today.
 */
export function fixtureTimeOffset(reference: Date = new Date()): number {
  const raw = reference.getTime() - Date.parse(FIXTURE_TODAY);
  return Math.floor(raw / WEEK_MS) * WEEK_MS;
}

/**
 * How far `timeZone` is from UTC at a given instant, in milliseconds.
 *
 * There is no built-in for this, so the instant is formatted into the zone's
 * own calendar fields and read back as if they were UTC. The difference is the
 * offset that applied at that moment — +02:00 in Norwegian summer, +01:00 in
 * winter.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: string) => Number(parts.find((part) => part.type === type)!.value);

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    // Some implementations render midnight as hour 24 under hour12: false.
    field("hour") % 24,
    field("minute"),
    field("second"),
  );

  return asIfUtc - instant;
}

/**
 * Shifts one ISO timestamp by the offset, keeping the Oslo wall clock.
 *
 * A whole number of weeks is a fixed number of milliseconds, but Norway's
 * clocks are not: adding seven days' worth of milliseconds across the October
 * transition lands an 18:00 event at 17:00. So the difference between the
 * zone's offset before and after the shift is added back, which restores the
 * hour the fixture was written with. Outside a transition the correction is
 * zero and this is a plain addition.
 *
 * Returns ISO 8601 in UTC. Postgres stores `timestamptz` as an instant, so the
 * zone the fixture was written in does not survive the round trip anyway.
 */
export function shiftTimestamp(iso: string, offsetMs: number): string {
  const original = Date.parse(iso);
  const shifted = original + offsetMs;
  const correction =
    zoneOffsetMs(original, FIXTURE_ZONE) - zoneOffsetMs(shifted, FIXTURE_ZONE);
  return new Date(shifted + correction).toISOString();
}

/**
 * Date-only columns (`joined_at`) want `YYYY-MM-DD`, not an instant.
 *
 * Deliberately *not* wall-clock corrected. A bare date has no time and no
 * zone; it parses as UTC midnight, and a whole number of weeks added to UTC
 * midnight is still UTC midnight. Applying the correction here would move some
 * of these an hour back and roll them onto the previous day.
 */
export function shiftDate(iso: string, offsetMs: number): string {
  return new Date(Date.parse(iso) + offsetMs).toISOString().slice(0, 10);
}
