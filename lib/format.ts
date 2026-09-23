const nb = "nb-NO";

/**
 * Reference point for relative times.
 *
 * Deliberately local to this module: it is imported by Client Components, so
 * it must not reach for anything server-only.
 */
function now(): number {
  return Date.now();
}

/**
 * The zone this product thinks in.
 *
 * Every formatter below renders in it, and `osloInstant` reads back into it,
 * so a time means the same thing whether it is being written or displayed —
 * and regardless of where the server happens to be running.
 */
export const COMMUNITY_ZONE = "Europe/Oslo";

/** How far `COMMUNITY_ZONE` is from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMMUNITY_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: string) => Number(parts.find((part) => part.type === type)!.value);

  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour") % 24,
      field("minute"),
      field("second"),
    ) - instant
  );
}

/**
 * Turns a date and a time a person typed into the instant they meant.
 *
 * `new Date("2026-10-08T18:00")` is interpreted in whatever zone the process
 * runs in, so an administrator in Oslo entering 18:00 got 15:00 back from a
 * server running in Karachi. The times in this product belong to the
 * community, not to the machine, so they are resolved against
 * `COMMUNITY_ZONE` explicitly.
 *
 * Returns null when the input is not a date and a time.
 */
export function osloInstant(date: string, time: string): Date | null {
  const asIfUtc = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(asIfUtc)) return null;

  // The offset depends on the instant, and the instant depends on the offset.
  // One correction settles it everywhere except inside a transition, where the
  // second pass picks the offset that actually applies.
  const firstPass = asIfUtc - zoneOffsetMs(asIfUtc);
  const settled = asIfUtc - zoneOffsetMs(firstPass);
  return new Date(settled);
}

const time = new Intl.DateTimeFormat(nb, {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

/**
 * Day key in Oslo time — `2026-10-24`.
 *
 * Everything user-facing is rendered in Europe/Oslo regardless of where the
 * server runs, so day comparisons have to use the same clock. Comparing with
 * `Date.toDateString()` reads the host's timezone instead, which silently
 * splits a Norwegian evening across two days on a server further east.
 */
const osloDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Oslo",
});

function dayKey(value: string | Date) {
  return osloDay.format(typeof value === "string" ? new Date(value) : value);
}

const dayMonth = new Intl.DateTimeFormat(nb, {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Oslo",
});

const dayMonthYear = new Intl.DateTimeFormat(nb, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Oslo",
});

const weekdayLong = new Intl.DateTimeFormat(nb, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Oslo",
});

const shortMonth = new Intl.DateTimeFormat(nb, {
  month: "short",
  timeZone: "Europe/Oslo",
});

const dayNumber = new Intl.DateTimeFormat(nb, {
  day: "numeric",
  timeZone: "Europe/Oslo",
});

/** Norwegian clock time uses a period: 19.30, not 19:30. */
export function formatTime(iso: string) {
  return time.format(new Date(iso)).replace(":", ".");
}

export function formatDate(iso: string) {
  return dayMonth.format(new Date(iso));
}

export function formatFullDate(iso: string) {
  return dayMonthYear.format(new Date(iso));
}

export function formatWeekday(iso: string) {
  return weekdayLong.format(new Date(iso));
}

const weekdayOnly = new Intl.DateTimeFormat(nb, {
  weekday: "long",
  timeZone: "Europe/Oslo",
});

/** `{ day: "26", month: "sep", weekday: "lørdag" }` for the date blocks on event cards. */
export function formatDateParts(iso: string) {
  const date = new Date(iso);
  return {
    day: dayNumber.format(date),
    month: shortMonth.format(date).replace(".", ""),
    weekday: weekdayOnly.format(date),
  };
}

/** "26. september, 19.00–01.00" — collapses same-day ranges. */
export function formatEventRange(startsAt: string, endsAt: string) {
  const head = `${formatWeekday(startsAt)}, ${formatTime(startsAt)}`;
  return isSameDay(startsAt, endsAt)
    ? `${head}–${formatTime(endsAt)}`
    : `${head} – ${formatDate(endsAt)} ${formatTime(endsAt)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Norwegian relative time, past tense: "for 3 timer siden". */
export function timeAgo(iso: string) {
  const diff = now() - Date.parse(iso);
  if (diff < MINUTE) return "nå nettopp";
  if (diff < HOUR) {
    const minutes = Math.round(diff / MINUTE);
    return `for ${minutes} ${minutes === 1 ? "minutt" : "minutter"} siden`;
  }
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `for ${hours} ${hours === 1 ? "time" : "timer"} siden`;
  }
  const days = Math.round(diff / DAY);
  if (days === 1) return "i går";
  if (days < 7) return `for ${days} dager siden`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `for ${weeks} ${weeks === 1 ? "uke" : "uker"} siden`;
  }
  return formatFullDate(iso);
}

/** Future-facing counterpart: "om 3 dager". */
export function timeUntil(iso: string) {
  const diff = Date.parse(iso) - now();
  if (diff < 0) return "pågår nå";
  if (diff < HOUR) return `om ${Math.max(1, Math.round(diff / MINUTE))} minutter`;
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `om ${hours} ${hours === 1 ? "time" : "timer"}`;
  }
  const days = Math.round(diff / DAY);
  if (days === 1) return "i morgen";
  if (days < 14) return `om ${days} dager`;
  const weeks = Math.round(days / 7);
  return `om ${weeks} uker`;
}

/** Date heading used to separate days in a channel. */
export function dayHeading(iso: string) {
  const days = Math.round(
    (Date.parse(`${dayKey(new Date(now()))}T00:00:00Z`) -
      Date.parse(`${dayKey(iso)}T00:00:00Z`)) /
      DAY,
  );
  if (days === 0) return "I dag";
  if (days === 1) return "I går";
  return formatFullDate(iso);
}

export function isSameDay(a: string, b: string) {
  return dayKey(a) === dayKey(b);
}

/** "Ingrid H." — used where full names crowd the layout. */
export function shortName(name: string) {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : first;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
