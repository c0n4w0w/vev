/**
 * Checks organisers removing a registration
 * (20261013100000_event_attendee_removal).
 *
 *   remove_event_attendee(event, person)   can_manage_event — an active admin
 *                                          of the community, or the lokallag's
 *                                          current lokallagsleder — on a
 *                                          scheduled, upcoming event only
 *
 * The person is notified (readable only while they can read the event), the
 * place is freed, and they may sign up again: it is not a ban. Cancelled and
 * past events keep their RSVPs. Nobody else can delete another person's row.
 *
 * Every access check runs as a fixture account through the anon key. The
 * service role sets up events and moves memberships temporarily, and
 * restores everything.
 *
 * Run with `npm run check:event-attendee-removal` against the local stack
 * after `npm run seed`.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const MARK = "CHECK fjern påmelding";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;

const ids: Record<string, string> = {};

async function profileId(handle: string): Promise<string> {
  if (ids[handle]) return ids[handle];
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`fant ikke ${handle}: ${error.message}`);
  ids[handle] = data.id;
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw verifyError;
  return client;
}

async function groupId(name: string): Promise<string> {
  const { data, error } = await admin.from("community_local_groups").select("id").eq("community_id", FTR).eq("name", name).single();
  if (error) throw error;
  return data.id;
}

/** An event with a chosen host and scope, written by the service role. */
async function fixtureEvent(host: string, scope: Record<string, unknown>, capacity: number | null, startsInDays = 20) {
  const starts = new Date(Date.now() + startsInDays * 24 * 3600 * 1000);
  const { data, error } = await admin
    .from("events")
    .insert({
      community_id: FTR,
      title: `${MARK} arrangement`,
      description: "Opprettet av check:event-attendee-removal",
      location: "Trondheim",
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString(),
      host_id: await profileId(host),
      capacity,
      ...scope,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// ── The calls the app makes ─────────────────────────────────────────────

async function removeAttendee(client: Client, eventId: string, handle: string) {
  const { data, error } = await client.rpc("remove_event_attendee", { p_event_id: eventId, p_user_id: await profileId(handle) });
  return error ? `error:${error.code}` : data;
}
async function rsvp(client: Client, eventId: string) {
  const { error } = await client.from("event_attendees").insert({ event_id: eventId });
  return error ? (error.message.includes("event_full") ? "full" : "refused") : "ok";
}
async function hasRow(eventId: string, handle: string) {
  const { data } = await admin.from("event_attendees").select("user_id").eq("event_id", eventId).eq("user_id", await profileId(handle)).maybeSingle();
  return Boolean(data);
}
async function count(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendance", { p_event_ids: [eventId] });
  return data?.[0]?.attendee_count;
}
async function attending(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendance", { p_event_ids: [eventId] });
  return data?.[0]?.attending;
}
async function removalNotices(client: Client, eventId: string) {
  const { data } = await client.from("notifications").select("title, body").eq("event_id", eventId);
  return (data ?? []).filter((n) => n.title.startsWith("Påmelding fjernet: "));
}
async function rosterNames(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendee_roster", { p_event_id: eventId });
  return (data ?? []).map((row) => row.display_name);
}

async function cleanup() {
  await admin.from("events").delete().like("title", `${MARK}%`);
}

async function main() {
  await cleanup();

  const handles = [
    "miaminge", "petter", "karimoen", "elironning", "kristoffer", "amina", "emmamortensen", "octavio",
  ] as const;
  const c = Object.fromEntries(
    await Promise.all(handles.map(async (h) => [h, await signIn(h)] as const)),
  ) as Record<(typeof handles)[number], Client>;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  const oslo = await groupId("FTR Oslo");
  const trondelag = await groupId("FTR Trøndelag");

  // ── Community admin, community-wide event, capacity 2 ─────────────────
  const wide = await fixtureEvent("miaminge", {}, 2);
  expect("Eli melder seg på", await rsvp(c.elironning, wide), "ok");
  expect("Kristoffer melder seg på", await rsvp(c.kristoffer, wide), "ok");
  expect("fullt for Petter", await rsvp(c.petter, wide), "full");
  expect("antall før fjerning", await count(c.elironning, wide), 2);

  // Refusals come first, so nothing below is affected by them.
  expect("vanlig medlem kan ikke fjerne en annen", await removeAttendee(c.elironning, wide, "kristoffer"), "refused");
  expect("moderator kan ikke fjerne", await removeAttendee(c.amina, wide, "elironning"), "refused");
  expect("lokallagsleder kan ikke fjerne fra fellesskapsarrangement", await removeAttendee(c.petter, wide, "elironning"), "refused");
  expect("TU-admin kan ikke fjerne", await removeAttendee(c.emmamortensen, wide, "elironning"), "refused");
  expect("UTR-admin kan ikke fjerne", await removeAttendee(c.octavio, wide, "elironning"), "refused");
  expect("anonym kan ikke fjerne", String(await removeAttendee(anon, wide, "elironning")).startsWith("error") || (await removeAttendee(anon, wide, "elironning")) === "refused", true);
  const direct = await c.elironning.from("event_attendees").delete().eq("event_id", wide).eq("user_id", ids.kristoffer).select("user_id");
  expect("vanlig medlem kan ikke slette en annens rad direkte", (direct.data ?? []).length, 0);
  expect("utenforstående får samme svar for ikke-påmeldt (ingen orakel)", await removeAttendee(c.emmamortensen, wide, "karimoen"), "refused");
  expect("ingen rader er rørt av avvisningene", `${await hasRow(wide, "elironning")}|${await hasRow(wide, "kristoffer")}`, "true|true");
  expect("ingen varsler fra avvisningene", (await removalNotices(c.elironning, wide)).length, 0);

  expect("1. admin fjerner Eli", await removeAttendee(c.miaminge, wide, "elironning"), "ok");
  expect("1. raden er borte", await hasRow(wide, "elironning"), false);
  expect("1. listen oppdateres", JSON.stringify(await rosterNames(c.miaminge, wide)), JSON.stringify(["Kristoffer Berg"]));
  expect("1. antallet går ned", await count(c.kristoffer, wide), 1);
  expect("1. Eli står ikke lenger som påmeldt", await attending(c.elironning, wide), false);
  const eliNotice = await removalNotices(c.elironning, wide);
  expect("1. Eli får et privat varsel", eliNotice.length, 1);
  expect("1. varselet nevner ingen andre påmeldte", JSON.stringify(eliNotice).includes("Kristoffer"), false);
  expect("1. Kristoffer får ikke varsel", (await removalNotices(c.kristoffer, wide)).length, 0);
  expect("1. admin får ikke varsel om egen handling", (await removalNotices(c.miaminge, wide)).length, 0);
  expect("kapasitet frigjort: Petter får plass", await rsvp(c.petter, wide), "ok");
  expect("ikke-påmeldt person gir beskjed til arrangøren", await removeAttendee(c.miaminge, wide, "karimoen"), "not_attending");
  expect("å fjerne samme person igjen gir beskjed", await removeAttendee(c.miaminge, wide, "elironning"), "not_attending");

  // Not a ban: Eli may sign up again when there is room.
  expect("fullt nå for Eli", await rsvp(c.elironning, wide), "full");
  expect("admin fjerner Petter", await removeAttendee(c.miaminge, wide, "petter"), "ok");
  expect("ikke utestengt: Eli melder seg på igjen", await rsvp(c.elironning, wide), "ok");
  expect("Eli står som påmeldt igjen", await attending(c.elironning, wide), true);

  // ── Lokallagsleder, own lokallag, capacity 1 ──────────────────────────
  const local = await fixtureEvent("petter", { local_group_id: trondelag }, 1);
  expect("Eli melder seg på Trøndelag-arrangementet", await rsvp(c.elironning, local), "ok");
  expect("fullt for Kari", await rsvp(c.karimoen, local), "full");
  expect("moderator i lokallaget kan ikke fjerne", await removeAttendee(c.karimoen, local, "elironning"), "refused");
  expect("2. lokallagsleder fjerner Eli fra eget lokallag", await removeAttendee(c.petter, local, "elironning"), "ok");
  expect("2. Eli får varsel", (await removalNotices(c.elironning, local)).length, 1);
  expect("2. kapasitet frigjort: Kari får plass", await rsvp(c.karimoen, local), "ok");
  expect("2. lederens liste viser Kari", JSON.stringify(await rosterNames(c.petter, local)), JSON.stringify(["Kari Moen"]));
  expect("2. Eli ser ingen liste", (await rosterNames(c.elironning, local)).length, 0);

  // The notice follows access to the event.
  try {
    await admin.from("memberships").update({ local_group_id: oslo }).eq("community_id", FTR).eq("user_id", ids.elironning);
    expect("varselet kan ikke leses når Eli ikke lenger ser arrangementet", (await removalNotices(c.elironning, local)).length, 0);
  } finally {
    await admin.from("memberships").update({ local_group_id: trondelag }).eq("community_id", FTR).eq("user_id", ids.elironning);
  }
  expect("tilbake i Trøndelag: varselet kan leses igjen", (await removalNotices(c.elironning, local)).length, 1);

  // ── Another lokallag's event ──────────────────────────────────────────
  const osloEvent = await fixtureEvent("miaminge", { local_group_id: oslo }, null);
  expect("Kristoffer melder seg på Oslo-arrangementet", await rsvp(c.kristoffer, osloEvent), "ok");
  expect("3. Trøndelag-leder kan ikke fjerne fra Oslo-arrangement", await removeAttendee(c.petter, osloEvent, "kristoffer"), "refused");
  expect("3. Kristoffer er fortsatt påmeldt", await hasRow(osloEvent, "kristoffer"), true);
  expect("admin kan fjerne fra Oslo-arrangementet", await removeAttendee(c.miaminge, osloEvent, "kristoffer"), "ok");

  // ── Revoked leadership ────────────────────────────────────────────────
  try {
    expect("admin fjerner Petter som leder", (await c.miaminge.rpc("remove_local_group_manager", { p_local_group_id: trondelag, p_user_id: ids.petter })).data, true);
    expect("tidligere leder kan ikke fjerne påmeldte", await removeAttendee(c.petter, local, "karimoen"), "refused");
    expect("Kari er fortsatt påmeldt", await hasRow(local, "karimoen"), true);
  } finally {
    await c.miaminge.rpc("add_local_group_manager", { p_local_group_id: trondelag, p_user_id: ids.petter });
  }

  // ── History is preserved ──────────────────────────────────────────────
  const toCancel = await fixtureEvent("miaminge", {}, null);
  expect("Eli melder seg på det som skal avlyses", await rsvp(c.elironning, toCancel), "ok");
  expect("admin avlyser", await c.miaminge.rpc("cancel_event", { p_event_id: toCancel }).then((r) => r.data), "ok");
  expect("avlyst: påmelding kan ikke fjernes", await removeAttendee(c.miaminge, toCancel, "elironning"), "cancelled");
  expect("avlyst: påmeldingen står", await hasRow(toCancel, "elironning"), true);

  const { data: pastEvent } = await admin
    .from("events")
    .insert({
      community_id: FTR,
      title: `${MARK} gjennomført`,
      description: "",
      location: "Oslo",
      starts_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 3600 * 1000).toISOString(),
      host_id: ids.miaminge,
    })
    .select("id")
    .single();
  await admin.from("event_attendees").insert({ event_id: pastEvent!.id, user_id: ids.elironning });
  expect("gjennomført: påmelding kan ikke fjernes", await removeAttendee(c.miaminge, pastEvent!.id, "elironning"), "ended");
  expect("gjennomført: påmeldingen står", await hasRow(pastEvent!.id, "elironning"), true);

  await cleanup();
  const { count: leftovers } = await admin.from("events").select("id", { count: "exact", head: true }).like("title", `${MARK}%`);
  expect("opprydding: ingen testarrangementer igjen", leftovers, 0);
  const { data: eliGroup } = await admin.from("memberships").select("local_group_id").eq("community_id", FTR).eq("user_id", ids.elironning).single();
  expect("opprydding: Eli er i Trøndelag", eliGroup?.local_group_id, trondelag);
  const { data: grant } = await admin.from("community_local_group_managers").select("user_id").eq("local_group_id", trondelag).eq("user_id", ids.petter).maybeSingle();
  expect("opprydding: Petter er lokallagsleder", Boolean(grant), true);
}

main()
  .catch(async (error) => {
    console.error(error);
    failures += 1;
    await cleanup();
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av fjerning av påmeldinger passerte`);
    console.log("  arrangør fjerner, medlemmet varsles, plassen frigjøres; ingen andre kan");
  });
