/**
 * Checks the private attendee roster (20261009100000_event_attendee_roster).
 *
 * Rule:
 *
 *   see who is attending   anyone who may manage the event right now (an
 *                          active admin of its community; for a lokallag
 *                          event, that lokallag's lokallagsleder), which
 *                          includes current read access to its scope. Being
 *                          its host grants nothing by itself.
 *   see how many           anyone who can read the event
 *   who counts             current RSVPs only (rsvp_is_current), the same
 *                          rule the capacity trigger uses
 *
 * Moderators get nothing by role. An admin of another community gets nothing.
 *
 * Every access check runs as a fixture account through the anon key — both
 * the RPCs the app calls and a direct read of `event_attendees`, so a passing
 * run means the database refuses, not the page. The service role only sets
 * up two temporary events and one temporary roster change, and restores
 * everything afterwards.
 *
 * Run with `npm run check:event-roster` against the local stack after
 * `npm run seed`.
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
const UTR = "under-the-rug";
const MARK = "CHECK roster";
const NOWHERE = "00000000-0000-4000-8000-000000000000";

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

async function eventIdFor(title: string): Promise<string> {
  const { data, error } = await admin.from("events").select("id").eq("title", title).single();
  if (error) throw new Error(`fant ikke arrangementet ${title}`);
  return data.id;
}

async function groupId(communityId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", communityId)
    .eq("name", name)
    .single();
  if (error) throw error;
  return data.id;
}

// ── The same calls the app makes ────────────────────────────────────────

async function mayView(client: Client, eventId: string) {
  return (await client.rpc("can_view_event_roster", { p_event_id: eventId })).data === true;
}
async function roster(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendee_roster", { p_event_id: eventId });
  return data ?? [];
}
async function names(client: Client, eventId: string) {
  return (await roster(client, eventId)).map((row) => row.display_name);
}
async function rosterIds(client: Client, eventId: string) {
  return (await roster(client, eventId)).map((row) => row.user_id);
}
/** What every event card renders: the count, and whether you are going. */
async function attendance(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendance", { p_event_ids: [eventId] });
  return data?.[0];
}
/** A direct read of the table, bypassing the app entirely. */
async function rawRows(client: Client, eventId: string) {
  const { data } = await client.from("event_attendees").select("user_id").eq("event_id", eventId);
  return (data ?? []).map((row) => row.user_id);
}
async function rsvp(client: Client, eventId: string) {
  const { error } = await client.from("event_attendees").insert({ event_id: eventId });
  return error ? (error.message.includes("event_full") ? "full" : "refused") : "ok";
}
async function setMyGroup(client: Client, localGroupId: string | null) {
  const { data } = await client.rpc("set_my_local_group", {
    p_community_id: FTR,
    p_local_group_id: localGroupId as unknown as string,
  });
  return data === true;
}

/** An event with a chosen host, which `events_insert` would not allow a client to forge. */
async function fixtureEvent(scope: Record<string, unknown>, host: string, capacity: number | null) {
  const starts = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const { data, error } = await admin
    .from("events")
    .insert({
      community_id: FTR,
      title: `${MARK} arrangement`,
      description: "Opprettet av check:event-roster",
      location: "Oslo",
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

async function cleanup() {
  await admin.from("events").delete().like("title", `${MARK}%`);
}

async function main() {
  await cleanup();

  const handles = [
    "miaminge", "emmamortensen", "octavio", "amina", "ingrid", "erlendthonstad",
    "kristoffer", "petter", "elise", "hanne", "tobias", "elironning", "karimoen",
  ] as const;
  const c = Object.fromEntries(
    await Promise.all(handles.map(async (h) => [h, await signIn(h)] as const)),
  ) as Record<(typeof handles)[number], Client>;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  for (const h of ["jonas", "linn", "nadia"]) await profileId(h);

  const aarsmote = await eventIdFor("Årsmøte 2026"); //            FTR, host mia (admin)
  const hostsamling = await eventIdFor("Høstsamling for lokallagene"); // TU, host emma (admin)
  const nattrave = await eventIdFor("Nattrave"); //                 UTR, host octavio (admin)
  const trondheim = await eventIdFor("Medlemsmøte i Trondheim"); //  FTR Trøndelag, host petter (lokallagsleder)
  const kabelgata = await eventIdFor("Høståpning — Kabelgata"); //  UTR, ingrid attends as "Lavfrekvens"
  const safeSpace = await eventIdFor("Opplæring for Safe-Space-frivillige"); // FTR subgroup, host mia

  // A FTR member who is not attending the annual meeting.
  const { data: going } = await admin.from("event_attendees").select("user_id").eq("event_id", aarsmote);
  const goingIds = new Set((going ?? []).map((row) => row.user_id));
  const { data: ftrMembers } = await admin
    .from("memberships")
    .select("user_id")
    .eq("community_id", FTR)
    .eq("status", "active")
    .eq("role", "member");
  const outsiderId = (ftrMembers ?? []).map((m) => m.user_id).find((id) => !goingIds.has(id));
  if (!outsiderId) throw new Error("fant ikke et FTR-medlem som ikke er påmeldt Årsmøte 2026");
  const { data: outsiderProfile } = await admin.from("profiles").select("handle").eq("id", outsiderId).single();
  const notGoing = await signIn(outsiderProfile!.handle);

  // ── 1–2. Host and same-community admin ────────────────────────────────
  expect("1. vert (admin) kan se påmeldte", await mayView(c.miaminge, aarsmote), true);
  expect("1. vert får hele listen", (await roster(c.miaminge, aarsmote)).length, goingIds.size);
  expect("1. lokallagsleder (vanlig medlem) ser påmeldte på eget lokallagsarrangement", (await roster(c.petter, trondheim)).length, 2);
  expect("2. FTR-admin Mia ser påmeldte", (await roster(c.miaminge, aarsmote)).length, goingIds.size);
  expect("2. TU-admin Emma ser påmeldte på TU-arrangement", (await roster(c.emmamortensen, hostsamling)).length, 5);
  expect("2. UTR-admin Octavio ser påmeldte på UTR-arrangement", (await roster(c.octavio, nattrave)).length, 6);
  expect("3. TU-moderator (ikke vert) ser ingen liste", (await roster(c.hanne, hostsamling)).length, 0);
  expect("3. UTR-medlem (ikke vert) ser ingen liste", (await roster(c.tobias, nattrave)).length, 0);
  expect("1. direkte tabellesing gir verten alle radene", (await rawRows(c.miaminge, aarsmote)).length, goingIds.size);

  // ── 3. Unauthorized members, including moderators by role ─────────────
  for (const [who, client] of [
    ["3. påmeldt medlem", c.kristoffer],
    ["3. påmeldt moderator (tidligere fixture-vert)", c.amina],
    ["3. påmeldt moderator som ikke er vert", c.ingrid],
    ["3. medlem som ikke er påmeldt", notGoing],
  ] as const) {
    expect(`${who}: kan ikke se listen`, await mayView(client, aarsmote), false);
    expect(`${who}: RPC gir ingen rader`, (await roster(client, aarsmote)).length, 0);
  }
  expect("3. påmeldt medlem leser bare sin egen rad direkte", JSON.stringify(await rawRows(c.kristoffer, aarsmote)), JSON.stringify([ids.kristoffer]));
  expect("3. påmeldt moderator leser bare sin egen rad direkte", JSON.stringify(await rawRows(c.ingrid, aarsmote)), JSON.stringify([ids.ingrid]));
  expect("3. ikke-påmeldt medlem leser ingen rader direkte", (await rawRows(notGoing, aarsmote)).length, 0);
  expect("3. medlem ser fortsatt antallet", (await attendance(notGoing, aarsmote))?.attendee_count, goingIds.size);
  expect("3. medlem ser fortsatt at hen er påmeldt", (await attendance(c.kristoffer, aarsmote))?.attending, true);
  expect("3. Mia (UTR-medlem uten rolle der) ser ikke UTR-listen", (await roster(c.miaminge, nattrave)).length, 0);

  // ── 4. Other communities, and the oracle question ─────────────────────
  for (const [who, client, eventId] of [
    ["4. TU-admin på FTR-arrangement", c.emmamortensen, aarsmote],
    ["4. UTR-admin på FTR-arrangement", c.octavio, aarsmote],
    ["4. UTR-admin på TU-arrangement", c.octavio, hostsamling],
    ["4. TU-admin på Safe-Space-arrangement", c.emmamortensen, safeSpace],
  ] as const) {
    expect(`${who}: kan ikke se listen`, await mayView(client, eventId), false);
    expect(`${who}: RPC gir ingen rader`, (await roster(client, eventId)).length, 0);
    expect(`${who}: ingen rader direkte`, (await rawRows(client, eventId)).length, 0);
    expect(`${who}: ikke engang antallet`, await attendance(client, eventId), undefined);
  }
  expect("4. ukjent arrangement gir samme svar som et uautorisert", `${await mayView(c.emmamortensen, NOWHERE)}/${(await roster(c.emmamortensen, NOWHERE)).length}`, "false/0");
  const anonRoster = await anon.rpc("event_attendee_roster", { p_event_id: aarsmote });
  expect("4. anonym kan ikke kalle roster-RPC", Boolean(anonRoster.error) || (anonRoster.data ?? []).length === 0, true);
  const anonCount = await anon.rpc("event_attendance", { p_event_ids: [aarsmote] });
  expect("4. anonym får ikke antall", Boolean(anonCount.error) || (anonCount.data ?? []).length === 0, true);

  // ── 5. Minimum fields, community persona only ─────────────────────────
  const octavioView = await roster(c.octavio, kabelgata);
  expect("5. bare user_id, display_name og avatar_path", Object.keys(octavioView[0] ?? {}).sort().join(","), "avatar_path,display_name,user_id");
  const { data: ingridUser } = await admin.auth.admin.getUserById(ids.ingrid);
  const { data: ingridAccount } = await admin.from("profiles").select("name, handle").eq("id", ids.ingrid).single();
  const ingridRow = octavioView.find((row) => row.user_id === ids.ingrid);
  expect("5. personaen i UTR, ikke kontonavnet", ingridRow?.display_name, "Lavfrekvens");
  const serialized = JSON.stringify(octavioView);
  expect("5. ingen e-post i svaret", serialized.includes(ingridUser.user!.email!) || serialized.includes("@"), false);
  expect("5. intet kontonavn i svaret", serialized.includes(ingridAccount!.name), false);
  expect("5. intet brukernavn i svaret", serialized.includes(`"${ingridAccount!.handle}"`), false);
  expect("5. ingen rolle i svaret", /"role"|moderator|admin/.test(serialized), false);

  // Profile photos go through can_view_community_profile; a member host now
  // has a reason to see their own attendees there, and only there.
  const seesProfile = async (client: Client, community: string, handle: string) =>
    (await client.rpc("can_view_community_profile", { p_community_id: community, p_user_id: ids[handle] })).data === true;
  expect("5. lokallagsleder-vert kan hente persona/bilde for egne påmeldte", await seesProfile(c.petter, FTR, "karimoen"), true);
  expect("5. UTR-admin kan hente persona/bilde for påmeldte", await seesProfile(c.octavio, UTR, "jonas"), true);

  // ── Scoped: Safe-Space ────────────────────────────────────────────────
  expect("SS. Mia (vert og admin) ser listen", (await roster(c.miaminge, safeSpace)).length, (await attendance(c.miaminge, safeSpace))?.attendee_count);
  expect("SS. listen er ikke tom", (await roster(c.miaminge, safeSpace)).length > 0, true);
  for (const [who, client] of [
    ["SS. moderator som kan lese arrangementet", c.amina],
    ["SS. gruppemedlem og moderator som ikke er vert", c.erlendthonstad],
    ["SS. påmeldt gruppemedlem", c.kristoffer],
    ["SS. FTR-medlem utenfor gruppen", c.elise],
  ] as const) {
    expect(`${who}: ingen liste`, (await roster(client, safeSpace)).length, 0);
    expect(`${who}: kan ikke se listen`, await mayView(client, safeSpace), false);
  }
  expect("SS. utenforstående får ikke antall", await attendance(c.elise, safeSpace), undefined);
  expect("SS. utenforstående leser ingen rader", (await rawRows(c.elise, safeSpace)).length, 0);

  // ── 6–7. Revoked subgroup member leaves the roster and the seat ──────
  const { data: ss } = await admin.from("community_subgroups").select("id").eq("community_id", FTR).eq("slug", "safe-space-frivillige").single();
  const small = await fixtureEvent({ subgroup_id: ss!.id }, "miaminge", 2);
  expect("6. Kristoffer melder seg på (kapasitet 2)", await rsvp(c.kristoffer, small), "ok");
  expect("6. Erlend melder seg på", await rsvp(c.erlendthonstad, small), "ok");
  expect("6. fullt for Amina", await rsvp(c.amina, small), "full");
  expect("6. to på listen", (await roster(c.miaminge, small)).length, 2);

  const { data: kristofferRow } = await admin
    .from("community_subgroup_members")
    .select("*")
    .eq("subgroup_id", ss!.id)
    .eq("user_id", ids.kristoffer)
    .single();
  try {
    await admin.from("community_subgroup_members").delete().eq("subgroup_id", ss!.id).eq("user_id", ids.kristoffer);
    expect("6. fjernet medlem er borte fra listen", (await rosterIds(c.miaminge, small)).includes(ids.kristoffer), false);
    const { data: kept } = await admin.from("event_attendees").select("user_id").eq("event_id", small).eq("user_id", ids.kristoffer).maybeSingle();
    expect("6. påmeldingsraden er beholdt som historikk", Boolean(kept), true);
    expect("7. antallet følger listen (1)", (await attendance(c.miaminge, small))?.attendee_count, (await roster(c.miaminge, small)).length);
    expect("7. plassen er frigjort: Amina får plass", await rsvp(c.amina, small), "ok");
    expect("7. antall og liste er like etter ny påmelding", `${(await attendance(c.miaminge, small))?.attendee_count}/${(await roster(c.miaminge, small)).length}`, "2/2");
    expect("7. fullt igjen for nye i gruppen", await rsvp(c.miaminge, small), "full");
    expect("7. utenforstående får avvisning, ikke «fullt» (ingen orakel)", await rsvp(c.elise, small), "refused");
  } finally {
    await admin.from("community_subgroup_members").insert(kristofferRow!);
  }
  expect("6. tilbake i gruppen: påmeldingen teller igjen", (await rosterIds(c.miaminge, small)).includes(ids.kristoffer), true);

  // ── Scoped: lokallag, hosted by its lokallagsleder ────────────────────
  const oslo = await groupId(FTR, "FTR Oslo");
  const trondelag = await groupId(FTR, "FTR Trøndelag");
  const local = await fixtureEvent({ local_group_id: trondelag }, "petter", 1);
  expect("L. Eli (Trøndelag) melder seg på", await rsvp(c.elironning, local), "ok");
  expect("L. lokallagsleder ser henne", JSON.stringify(await names(c.petter, local)), JSON.stringify(["Eli Rønning"]));
  expect("L. FTR-admin ser henne", (await roster(c.miaminge, local)).length, 1);
  expect("L. moderator i samme lokallag (ikke leder) ser ingen liste", (await roster(c.karimoen, local)).length, 0);
  expect("L. Oslo-medlem ser ingen liste", (await roster(c.kristoffer, local)).length, 0);
  expect("L. moderator uten lokallag ser ingen liste", (await roster(c.ingrid, local)).length, 0);
  expect("L. TU-admin ser ingen liste", (await roster(c.emmamortensen, local)).length, 0);
  try {
    expect("L. Eli bytter til Oslo", await setMyGroup(c.elironning, oslo), true);
    expect("L. hun er borte fra listen", (await roster(c.petter, local)).length, 0);
    expect("L. og fra antallet", (await attendance(c.petter, local))?.attendee_count, 0);
    expect("L. og holder ikke plassen: Kari får plass", await rsvp(c.karimoen, local), "ok");
    await c.karimoen.from("event_attendees").delete().eq("event_id", local);
  } finally {
    await setMyGroup(c.elironning, trondelag);
  }
  expect("L. tilbake i Trøndelag: hun teller igjen", (await roster(c.petter, local)).length, 1);

  // A host who leaves the event's scope loses the roster with the event —
  // and the move ends their lokallagsleder grant, so moving back does not
  // bring the roster back until an admin grants it again.
  try {
    await admin.from("memberships").update({ local_group_id: oslo }).eq("community_id", FTR).eq("user_id", ids.petter);
    expect("L. vert som flytter ut av lokallaget mister listen", `${await mayView(c.petter, local)}/${(await roster(c.petter, local)).length}`, "false/0");
  } finally {
    await admin.from("memberships").update({ local_group_id: trondelag }).eq("community_id", FTR).eq("user_id", ids.petter);
  }
  expect("L. tilbake i Trøndelag: verten ser fortsatt ikke listen (tilgangen ble slettet)", `${await mayView(c.petter, local)}/${(await roster(c.petter, local)).length}`, "false/0");
  expect("L. admin utnevner Petter igjen", (await c.miaminge.rpc("add_local_group_manager", { p_local_group_id: trondelag, p_user_id: ids.petter })).data, true);
  expect("L. etter ny utnevnelse ser verten listen igjen", await mayView(c.petter, local), true);

  // host_id is not a standing right. An admin host who stops being admin
  // keeps reading the event (and, as a Safe-Space member, the team's event)
  // but no longer sees who is attending either.
  try {
    await admin.from("memberships").update({ role: "member" }).eq("community_id", FTR).eq("user_id", ids.miaminge);
    expect("H. tidligere admin-vert leser fortsatt Årsmøtet", Boolean((await c.miaminge.from("events").select("id").eq("id", aarsmote).maybeSingle()).data), true);
    expect("H. men ser ikke påmeldte på Årsmøtet hun er vert for", `${await mayView(c.miaminge, aarsmote)}/${(await roster(c.miaminge, aarsmote)).length}`, "false/0");
    expect("H. leser fortsatt Safe-Space-arrangementet som gruppemedlem", Boolean((await c.miaminge.from("events").select("id").eq("id", safeSpace).maybeSingle()).data), true);
    expect("H. men ser ikke påmeldte på Safe-Space-arrangementet hun er vert for", (await roster(c.miaminge, safeSpace)).length, 0);
    expect("H. direkte tabellesing gir bare egen rad", (await rawRows(c.miaminge, safeSpace)).every((id) => id === ids.miaminge), true);
  } finally {
    await admin.from("memberships").update({ role: "admin" }).eq("community_id", FTR).eq("user_id", ids.miaminge);
  }
  expect("H. admin igjen: ser listen", (await roster(c.miaminge, aarsmote)).length, goingIds.size);

  // ── 8. The count every page shows matches the roster ──────────────────
  for (const [label, host, member, eventId] of [
    ["Årsmøte", c.miaminge, notGoing, aarsmote],
    ["Høstsamling", c.emmamortensen, c.petter, hostsamling],
    ["Nattrave", c.octavio, c.tobias, nattrave],
    ["Medlemsmøte i Trondheim", c.petter, c.karimoen, trondheim],
    ["Safe-Space", c.miaminge, c.erlendthonstad, safeSpace],
  ] as const) {
    const listed = (await roster(host, eventId)).length;
    expect(`8. ${label}: vertens antall = vertens liste`, (await attendance(host, eventId))?.attendee_count, listed);
    expect(`8. ${label}: medlemmets antall = vertens liste`, (await attendance(member, eventId))?.attendee_count, listed);
  }

  await cleanup();
  const { count: leftovers } = await admin.from("events").select("id", { count: "exact", head: true }).like("title", `${MARK}%`);
  expect("opprydding: ingen testarrangementer igjen", leftovers, 0);
  const { data: back } = await admin.from("memberships").select("local_group_id").eq("community_id", FTR).in("user_id", [ids.petter, ids.elironning]);
  expect("opprydding: Petter og Eli er i Trøndelag", (back ?? []).every((m) => m.local_group_id === trondelag), true);
  const { data: ssBack } = await admin.from("community_subgroup_members").select("user_id").eq("subgroup_id", ss!.id).eq("user_id", ids.kristoffer).maybeSingle();
  expect("opprydding: Kristoffer er i Safe-Space", Boolean(ssBack), true);
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
    console.log(`✓ ${checks} kontroller av påmeldtlisten passerte`);
    console.log("  vert og admin ser listen; medlemmer, moderatorer og andre fellesskap gjør ikke");
  });
