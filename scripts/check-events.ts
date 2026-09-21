/**
 * Checks the authorisation around events and attendance.
 *
 * The events page used to show "2 påmeldte av 6" and "Du er påmeldt" with no
 * way to sign up, withdraw or create anything. Making that real means members
 * now write to `event_attendees` and administrators write to `events`, so
 * rules that were previously unreachable are now one button away from a
 * browser. This is the regression test for them.
 *
 * Every case runs as a real signed-in caller: a session is minted with
 * `admin.generateLink` and redeemed with `verifyOtp` — the same mechanism the
 * showcase entry uses — and the write then goes through PostgREST under row
 * level security, exactly as it does from the application. A check that used
 * the service role would bypass the very policies it claims to test.
 *
 * Whatever it creates, it removes again; the seeded data is left as found.
 *
 * Run with `npm run check:events` against the local stack.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { COMMUNITY_ZONE, osloInstant } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

/** A client carrying a real session for one fixture account. */
async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);

  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

/** Signed out — for the anonymous cases. */
function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function emailFor(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  const { data: user } = await admin.auth.admin.getUserById(data!.id);
  return user.user!.email!;
}

async function eventIdFor(title: string): Promise<string> {
  const { data } = await admin.from("events").select("id").eq("title", title).single();
  return data!.id;
}

async function attendeeCount(eventId: string): Promise<number> {
  const { count } = await admin
    .from("event_attendees")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);
  return count ?? 0;
}

const FUTURE = new Date(Date.now() + 40 * 24 * 3600 * 1000);
const LATER = new Date(FUTURE.getTime() + 2 * 3600 * 1000);

/** Every event this run creates, so they can be removed again. */
const createdEventIds: string[] = [];

async function createEventAs(
  client: SupabaseClient<Database>,
  communityId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from("events")
    .insert({
      community_id: communityId,
      title: "CHECK arrangement",
      description: "Opprettet av check:events",
      starts_at: FUTURE.toISOString(),
      ends_at: LATER.toISOString(),
      location: "Oslo",
      ...overrides,
    } as never)
    .select("id")
    .maybeSingle();

  if (data?.id) createdEventIds.push(data.id);
  return { id: data?.id ?? null, error };
}

async function main() {
  const [lars, nadia, linn, robin] = await Promise.all([
    emailFor("larsbror").then(signIn),
    emailFor("nadia").then(signIn),
    emailFor("linn").then(signIn),
    emailFor("robinsaether").then(signIn),
  ]);
  const anon = anonymous();

  // An event in Tryggere Ruspolitikk that linn is not already attending, and
  // one in Under The Rug for the cross-community cases.
  const standvakt = await eventIdFor("Standvakt — Bergen sentrum");
  const nattrave = await eventIdFor("Nattrave");
  const before = await attendeeCount(standvakt);

  // ── RSVP ──────────────────────────────────────────────────────────────
  const join = await linn.from("event_attendees").insert({ event_id: standvakt } as never);
  expect("medlem kan melde seg på", join.error?.message ?? "ok", "ok");
  expect("påmeldingen telles", await attendeeCount(standvakt), before + 1);

  const { data: mine } = await admin
    .from("event_attendees")
    .select("user_id, profiles!inner(handle)")
    .eq("event_id", standvakt);
  const handles = (mine ?? []).map((row) => (row.profiles as unknown as { handle: string }).handle);
  expect("påmeldingen er lagret på innsenderen selv", handles.includes("linn"), true);

  const again = await linn.from("event_attendees").insert({ event_id: standvakt } as never);
  expect("dobbel påmelding avvises", again.error?.code ?? "ingen feil", "23505");
  expect("dobbel påmelding endrer ikke antallet", await attendeeCount(standvakt), before + 1);

  const forged = await linn
    .from("event_attendees")
    .insert({ event_id: standvakt, user_id: (await admin.from("profiles").select("id").eq("handle", "amina").single()).data!.id } as never);
  expect("forfalsket user_id avvises", forged.error?.code ?? "ingen feil", "42501");

  const cross = await linn.from("event_attendees").insert({ event_id: nattrave } as never);
  expect("påmelding til et annet fellesskaps arrangement avvises", cross.error?.code ?? "ingen feil", "42501");

  const anonRsvp = await anon.from("event_attendees").insert({ event_id: standvakt } as never);
  expect("anonym påmelding avvises", anonRsvp.error ? "avvist" : "tillatt", "avvist");

  // ── Capacity ──────────────────────────────────────────────────────────
  const taken = await attendeeCount(standvakt);
  await admin.from("events").update({ capacity: taken }).eq("id", standvakt);
  const full = await nadia.from("event_attendees").insert({ event_id: standvakt } as never);
  expect("påmelding til fullt arrangement avvises", full.error ? "avvist" : "tillatt", "avvist");
  await admin.from("events").update({ capacity: 6 }).eq("id", standvakt);

  // ── Withdraw ──────────────────────────────────────────────────────────
  const leave = await linn.from("event_attendees").delete().eq("event_id", standvakt);
  expect("medlem kan melde seg av", leave.error?.message ?? "ok", "ok");
  expect("avmelding gir opprinnelig antall", await attendeeCount(standvakt), before);

  const beforeOthers = await attendeeCount(standvakt);
  await linn.from("event_attendees").delete().eq("event_id", standvakt).neq("user_id", "00000000-0000-0000-0000-000000000000");
  expect("avmelding rører ikke andres påmelding", await attendeeCount(standvakt), beforeOthers);

  // ── Creating events ───────────────────────────────────────────────────
  const adminCreate = await createEventAs(lars, "tryggere-ruspolitikk");
  expect("administrator kan opprette arrangement", adminCreate.error?.message ?? "ok", "ok");

  if (adminCreate.id) {
    const { data: created } = await admin
      .from("events")
      .select("host_id, community_id, profiles!events_host_id_fkey(handle)")
      .eq("id", adminCreate.id)
      .single();
    expect(
      "vert settes fra sesjonen",
      (created!.profiles as unknown as { handle: string }).handle,
      "larsbror",
    );
    expect("arrangementet havner i riktig fellesskap", created!.community_id, "tryggere-ruspolitikk");

    const readByOutsider = await robin.from("events").select("id").eq("id", adminCreate.id);
    expect(
      "utenforstående ser ikke arrangementet",
      (readByOutsider.data ?? []).length,
      0,
    );
  }

  const modCreate = await createEventAs(nadia, "tryggere-ruspolitikk");
  expect("moderator kan ikke opprette arrangement", modCreate.error?.code ?? "ingen feil", "42501");

  const memberCreate = await createEventAs(linn, "tryggere-ruspolitikk");
  expect("medlem kan ikke opprette arrangement", memberCreate.error?.code ?? "ingen feil", "42501");

  const anonCreate = await createEventAs(anon, "tryggere-ruspolitikk");
  expect("anonym kan ikke opprette arrangement", anonCreate.error ? "avvist" : "tillatt", "avvist");

  const wrongCommunity = await createEventAs(lars, "under-the-rug");
  expect(
    "administrator kan ikke opprette i et annet fellesskap",
    wrongCommunity.error?.code ?? "ingen feil",
    "42501",
  );

  const forgedHost = await createEventAs(lars, "tryggere-ruspolitikk", {
    host_id: (await admin.from("profiles").select("id").eq("handle", "linn").single()).data!.id,
  });
  expect("forfalsket vert avvises", forgedHost.error?.code ?? "ingen feil", "42501");

  // ── Validation, enforced by the policy rather than the form ───────────
  const backwards = await createEventAs(lars, "tryggere-ruspolitikk", {
    starts_at: LATER.toISOString(),
    ends_at: FUTURE.toISOString(),
  });
  expect("slutt før start avvises", backwards.error?.code ?? "ingen feil", "42501");

  const blankTitle = await createEventAs(lars, "tryggere-ruspolitikk", { title: "   " });
  expect("tom tittel avvises", blankTitle.error?.code ?? "ingen feil", "42501");

  const longTitle = await createEventAs(lars, "tryggere-ruspolitikk", { title: "a".repeat(121) });
  expect("for lang tittel avvises", longTitle.error?.code ?? "ingen feil", "42501");

  // ── The clock an administrator types is the community's ──────────────
  //
  // `new Date("2026-10-08T18:00")` resolves in whatever zone the process runs
  // in, so a server outside Norway stored the wrong hour. These run against
  // the real formatter, so they fail on any machine where that regresses.
  const osloClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: COMMUNITY_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  for (const [date, time] of [
    ["2026-10-08", "18:00"], // summer time
    ["2026-12-03", "18:00"], // winter time
    ["2026-10-25", "18:00"], // the day the clocks go back
  ] as const) {
    const instant = osloInstant(date, time);
    expect(`${date} ${time} tolkes i ${COMMUNITY_ZONE}`, instant ? osloClock.format(instant) : "null", time);
  }

  const tzEvent = await createEventAs(lars, "tryggere-ruspolitikk", {
    title: "CHECK tidssone",
    starts_at: osloInstant("2026-10-08", "18:00")!.toISOString(),
    ends_at: osloInstant("2026-10-08", "20:00")!.toISOString(),
  });
  if (tzEvent.id) {
    const { data: stored } = await admin
      .from("events")
      .select("starts_at, ends_at")
      .eq("id", tzEvent.id)
      .single();
    expect("lagret starttid vises som 18:00 i Oslo", osloClock.format(new Date(stored!.starts_at)), "18:00");
    expect("lagret sluttid vises som 20:00 i Oslo", osloClock.format(new Date(stored!.ends_at)), "20:00");
  }

  // ── Events are not editable or deletable from a client ────────────────
  const edit = await lars.from("events").update({ title: "Endret" }).eq("id", standvakt).select("id");
  expect("arrangementer kan ikke endres fra klienten", (edit.data ?? []).length, 0);

  const remove = await lars.from("events").delete().eq("id", standvakt).select("id");
  expect("arrangementer kan ikke slettes fra klienten", (remove.data ?? []).length, 0);

  // ── Cross-community reads ─────────────────────────────────────────────
  const utrEventsAsTryggere = await linn.from("events").select("id").eq("id", nattrave);
  expect("medlem ser ikke et annet fellesskaps arrangement", (utrEventsAsTryggere.data ?? []).length, 0);

  const utrAttendeesAsTryggere = await linn.from("event_attendees").select("event_id").eq("event_id", nattrave);
  expect("medlem ser ikke et annet fellesskaps påmeldte", (utrAttendeesAsTryggere.data ?? []).length, 0);

  const anonEvents = await anon.from("events").select("id");
  expect("anonym ser ingen arrangementer", (anonEvents.data ?? []).length, 0);

  // ── Clean up ──────────────────────────────────────────────────────────
  if (createdEventIds.length > 0) {
    await admin.from("events").delete().in("id", createdEventIds);
  }
  const leftovers = await admin.from("events").select("id").like("title", "CHECK %");
  expect("ingen testarrangementer ligger igjen", (leftovers.data ?? []).length, 0);
  expect("påmeldingene er tilbake som de var", await attendeeCount(standvakt), before);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }

  console.log(`✓ ${checks} kontroller passerte`);
  console.log("  påmelding, avmelding, kapasitet, opprettelse og rollegrenser");
  console.log("  kjørt som innloggede brukere gjennom PostgREST, under radsikkerhet");
}

void main();
