import { INTL_TAG, PLATFORM_LOCALE, t, tn, type Locale } from "@/lib/i18n";

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

/**
 * The display formatters, built once per locale and shape.
 *
 * Every function below takes a `locale` that defaults to the platform one, so
 * existing Norwegian callers are unchanged. The zone is always Oslo; only the
 * words, the order and the clock convention follow the locale.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: Locale, shape: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}:${shape}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_TAG[locale], { ...options, timeZone: COMMUNITY_ZONE });
    formatters.set(key, formatter);
  }
  return formatter;
}

const shapes = {
  time: { hour: "2-digit", minute: "2-digit" },
  dayMonth: { day: "numeric", month: "long" },
  dayMonthYear: { day: "numeric", month: "long", year: "numeric" },
  weekdayLong: { weekday: "long", day: "numeric", month: "long" },
  shortMonth: { month: "short" },
  dayNumber: { day: "numeric" },
  weekdayOnly: { weekday: "long" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

function format(locale: Locale, shape: keyof typeof shapes, iso: string | Date) {
  return formatterFor(locale, shape, shapes[shape]).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

/** Norwegian clock time uses a period: 19.30, not 19:30. English keeps the colon. */
export function formatTime(iso: string, locale: Locale = PLATFORM_LOCALE) {
  const value = format(locale, "time", iso);
  return locale === "nb" ? value.replace(":", ".") : value;
}

export function formatDate(iso: string, locale: Locale = PLATFORM_LOCALE) {
  return format(locale, "dayMonth", iso);
}

export function formatFullDate(iso: string, locale: Locale = PLATFORM_LOCALE) {
  return format(locale, "dayMonthYear", iso);
}

export function formatWeekday(iso: string, locale: Locale = PLATFORM_LOCALE) {
  return format(locale, "weekdayLong", iso);
}

/** `{ day: "26", month: "sep", weekday: "lørdag" }` for the date blocks on event cards. */
export function formatDateParts(iso: string, locale: Locale = PLATFORM_LOCALE) {
  return {
    day: format(locale, "dayNumber", iso),
    month: format(locale, "shortMonth", iso).replace(".", ""),
    weekday: format(locale, "weekdayOnly", iso),
  };
}

/** "26. september, 19.00–01.00" — collapses same-day ranges. */
export function formatEventRange(startsAt: string, endsAt: string, locale: Locale = PLATFORM_LOCALE) {
  const head = `${formatWeekday(startsAt, locale)}, ${formatTime(startsAt, locale)}`;
  return isSameDay(startsAt, endsAt)
    ? `${head}–${formatTime(endsAt, locale)}`
    : `${head} – ${formatDate(endsAt, locale)} ${formatTime(endsAt, locale)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative time, past tense: "for 3 timer siden" / "3 hours ago". */
export function timeAgo(iso: string, locale: Locale = PLATFORM_LOCALE) {
  const diff = now() - Date.parse(iso);
  if (diff < MINUTE) return t(locale, "time.justNow");
  if (diff < HOUR) return tn(locale, "time.minutesAgo", Math.round(diff / MINUTE));
  if (diff < DAY) return tn(locale, "time.hoursAgo", Math.round(diff / HOUR));
  const days = Math.round(diff / DAY);
  if (days === 1) return t(locale, "time.yesterday");
  if (days < 7) return tn(locale, "time.daysAgo", days);
  if (days < 30) return tn(locale, "time.weeksAgo", Math.round(days / 7));
  return formatFullDate(iso, locale);
}

/** Future-facing counterpart: "om 3 dager" / "in 3 days". */
export function timeUntil(iso: string, locale: Locale = PLATFORM_LOCALE) {
  const diff = Date.parse(iso) - now();
  if (diff < 0) return t(locale, "time.ongoing");
  if (diff < HOUR) return tn(locale, "time.inMinutes", Math.max(1, Math.round(diff / MINUTE)));
  if (diff < DAY) return tn(locale, "time.inHours", Math.round(diff / HOUR));
  const days = Math.round(diff / DAY);
  if (days === 1) return t(locale, "time.tomorrow");
  if (days < 14) return tn(locale, "time.inDays", days);
  return tn(locale, "time.inWeeks", Math.round(days / 7));
}

/** Date heading used to separate days in a channel. */
export function dayHeading(iso: string, locale: Locale = PLATFORM_LOCALE) {
  const days = Math.round(
    (Date.parse(`${dayKey(new Date(now()))}T00:00:00Z`) -
      Date.parse(`${dayKey(iso)}T00:00:00Z`)) /
      DAY,
  );
  if (days === 0) return t(locale, "time.today");
  if (days === 1) return t(locale, "time.yesterdayHeading");
  return formatFullDate(iso, locale);
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

/** Up to two letters for a monogram, from the first two words of a name. */
export function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
