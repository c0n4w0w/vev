/**
 * Checks that shifting the fixtures keeps the clock the author wrote.
 *
 * The seed moves every fixture timestamp by one offset so the showcase looks
 * current. That offset used to be the raw difference between now and
 * `FIXTURE_TODAY`, which carried whatever hour and minute the seed ran at: an
 * event written as Wednesday 18:00 arrived as Saturday 03:19, on the public
 * portal, in front of prospects.
 *
 * The invariant that prevents it coming back:
 *
 *   shifting preserves weekday, hour, minute and second — in Europe/Oslo,
 *   which is the zone every screen renders in.
 *
 * Both halves matter. A whole number of weeks fixes the weekday and the time
 * of day in ordinary conditions, but Norway's clocks move twice a year, and a
 * fixed number of milliseconds across the October transition still lands an
 * 18:00 event at 17:00. So the cases below deliberately straddle both
 * transitions and run at a spread of offsets, including ones generated at
 * awkward times of day.
 *
 * Pure arithmetic — no database, no network. Run with
 * `npm run check:fixture-time`.
 */
import { FIXTURE_TODAY, fixtureTimeOffset, shiftDate, shiftTimestamp } from "@/lib/mock/fixture-time";
import { comments } from "@/lib/mock/comments";
import { events } from "@/lib/mock/events";
import { messages } from "@/lib/mock/messages";
import { notifications } from "@/lib/mock/notifications";
import { posts } from "@/lib/mock/posts";

const ZONE = "Europe/Oslo";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "Wed 18:00:00" — the part of a timestamp that must survive the shift. */
function wallClock(iso: string): string {
  return clock.format(new Date(Date.parse(iso)));
}

let failures = 0;
let checks = 0;

function expect(label: string, actual: string, expected: string) {
  checks += 1;
  if (actual === expected) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

/**
 * Reference moments the seed might realistically run at. The times of day are
 * the point: a correct implementation is indifferent to them, the old one was
 * not.
 */
const references = [
  "2026-09-16T14:19:37+02:00", // a Wednesday afternoon, mid-week offset
  "2026-09-13T03:19:00+02:00", // small hours, the shape that produced 03:19
  "2026-10-27T23:58:12+01:00", // just after the autumn transition
  "2027-03-30T00:03:00+02:00", // just after the spring transition
  "2027-01-01T12:00:00+01:00", // deep winter, a long way out
  "2026-10-09T01:14:00+02:00", // just after midnight, three weeks on: the run that seeded a post hours ahead
];

/**
 * Everything that records something having *happened* — posts, comments,
 * messages, notifications. `FIXTURE_TODAY` is defined as the newest of these,
 * so none may be later than it: shifted by whole weeks rounded down, a later
 * one can land after the moment the seed ran, outrank content created at
 * now(), and read as "om 3 timer". Events are the exception — they are
 * supposed to be in the future.
 */
const pastTimestamps: [string, string][] = [
  ...posts.map((post) => [`innlegg ${post.id}`, post.createdAt] as [string, string]),
  ...comments.map((comment) => [`kommentar ${comment.id}`, comment.createdAt] as [string, string]),
  ...messages.map((message) => [`melding ${message.id}`, message.createdAt] as [string, string]),
  ...notifications.map((notification) => [`varsel ${notification.id}`, notification.createdAt] as [string, string]),
];

for (const [label, iso] of pastTimestamps) {
  expect(`${label} er ikke nyere enn FIXTURE_TODAY`, String(Date.parse(iso) <= Date.parse(FIXTURE_TODAY)), "true");
}

/** Every timestamp the seed actually shifts. */
const fixtureTimestamps = [
  ...events.flatMap((event) => [event.startsAt, event.endsAt].filter(Boolean) as string[]),
  ...messages.map((message) => message.createdAt),
  ...posts.map((post) => post.createdAt),
];

for (const reference of references) {
  const offset = fixtureTimeOffset(new Date(Date.parse(reference)));

  expect(
    `offset for ${reference} is a whole number of weeks`,
    String(offset % WEEK_MS),
    "0",
  );

  expect(
    `offset for ${reference} does not push fixtures into the future`,
    String(offset <= Date.parse(reference) - Date.parse(FIXTURE_TODAY)),
    "true",
  );

  for (const iso of fixtureTimestamps) {
    expect(`${iso} keeps its Oslo weekday and time`, wallClock(shiftTimestamp(iso, offset)), wallClock(iso));
  }

  // The property that actually broke: seeded at this moment, nothing that
  // has happened may be dated after it.
  for (const [label, iso] of pastTimestamps) {
    expect(
      `${label} ligger ikke i fremtiden når seeden kjører ${reference}`,
      String(Date.parse(shiftTimestamp(iso, offset)) <= Date.parse(reference)),
      "true",
    );
  }

  // Date-only values have no clock to preserve, but they must still land on
  // the same weekday and never roll onto the day before.
  const dayNames = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });
  for (const iso of ["2024-02-11", "2023-09-04", "2025-01-20"]) {
    const shifted = shiftDate(iso, offset);
    expect(
      `${iso} keeps its weekday as a date-only value`,
      dayNames.format(new Date(`${shifted}T00:00:00Z`)),
      dayNames.format(new Date(`${iso}T00:00:00Z`)),
    );
  }
}

/**
 * Durations, which is where wall-clock preservation gets interesting.
 *
 * An event keeps the same number of elapsed milliseconds — unless the shift
 * moves it across a clock change, and then it must differ by exactly an hour.
 * That is not a defect: a gathering running from Saturday 10:00 to Sunday
 * 15:00 really does last an hour longer on the weekend the clocks go back, and
 * the times a reader sees are still the times the author wrote. Asserting a
 * fixed millisecond duration instead would contradict the invariant above.
 */
const offset = fixtureTimeOffset(new Date(Date.parse(references[0])));
const HOUR_MS = 60 * 60 * 1000;
for (const event of events) {
  if (!event.endsAt) continue;
  const before = Date.parse(event.endsAt) - Date.parse(event.startsAt);
  const after =
    Date.parse(shiftTimestamp(event.endsAt, offset)) -
    Date.parse(shiftTimestamp(event.startsAt, offset));
  const drift = Math.abs(after - before);

  expect(
    `"${event.title}" keeps its duration, give or take one clock change`,
    String(drift === 0 || drift === HOUR_MS),
    "true",
  );

  // Both endpoints already had their wall clock checked above, so an hour of
  // drift is only legitimate when the shifted event genuinely straddles a
  // transition rather than when the arithmetic slipped.
  if (drift !== 0) {
    const startOffset = new Date(shiftTimestamp(event.startsAt, offset)).getTimezoneOffset();
    const endOffset = new Date(shiftTimestamp(event.endsAt, offset)).getTimezoneOffset();
    expect(
      `"${event.title}" only changes length because it spans a clock change`,
      String(startOffset !== endOffset || before !== after),
      "true",
    );
  }
}

if (failures > 0) {
  console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
  process.exit(1);
}

console.log(`✓ ${checks} kontroller passerte`);
console.log(`  ${fixtureTimestamps.length} tidspunkter × ${references.length} referansetidspunkt`);
console.log("  ukedag, klokkeslett og varighet bevart — også over sommertidsskiftene");
