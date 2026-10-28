/**
 * Checks editing, cancelling, restoring and deleting events
 * (20261012100000_event_lifecycle).
 *
 *   edit            can_manage_event — an active admin of the community, or an
 *                   effective lokallagsleder for that lokallag
 *   cancel/restore  cancel_event() / restore_event() — can_manage_event
 *   delete          admins of the event's community only
 *
 * A cancelled event keeps every detail and RSVP, accepts no RSVP changes, is
 * left out of upcoming lists and the public portal, and its attendees are
 * notified. Restoring re-checks capacity against the RSVPs that are still
 * current. Being the host grants nothing by itself.
 *
 * Every access check runs as a fixture account through the anon key, so a
 * passing run means the database refuses, not the page. The service role sets
 * up events and moves memberships temporarily, and restores everything.
 *
 * Run with `npm run check:event-lifecycle` against the local stack after
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
const MARK = "CHECK livssyklus";

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

// ── The calls the app makes ─────────────────────────────────────────────

async function create(client: Client, scope: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() + 18 * 24 * 3600 * 1000);
  const { data, error } = await client
    .from("events")
    .insert({
      community_id: FTR,
      title: `${MARK} arrangement`,
      description: "Opprettet av check:event-lifecycle",
      location: "Trondheim",
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString(),
      ...scope,
      ...extra,
    } as never)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(`kunne ikke opprette testarrangement: ${error?.message}`);
  return data.id;
}
async function edit(client: Client, eventId: string, patch: Record<string, unknown>) {
  const { data, error } = await client.from("events").update(patch as never).eq("id", eventId).select("id");
  if (error) return error.message.includes("capacity_below_attendees") ? "under kapasitet" : "avvist";
  return (data ?? []).length === 1 ? "endret" : "avvist";
}
async function remove(client: Client, eventId: string) {
  const { data, error } = await client.from("events").delete().eq("id", eventId).select("id");
  return error ? "avvist" : (data ?? []).length === 1 ? "slettet" : "avvist";
}
async function cancel(client: Client, eventId: string) {
  const { data, error } = await client.rpc("cancel_event", { p_event_id: eventId });
  return error ? `error:${error.code}` : data;
}
async function restore(client: Client, eventId: string) {
  const { data, error } = await client.rpc("restore_event", { p_event_id: eventId });
  return error ? `error:${error.code}` : data;
}
async function rsvp(client: Client, eventId: string) {
  const { error } = await client.from("event_attendees").insert({ event_id: eventId });
  return error ? (error.message.includes("event_full") ? "full" : "refused") : "ok";
}
async function withdraw(client: Client, eventId: string) {
  const { data, error } = await client.from("event_attendees").delete().eq("event_id", eventId).select("event_id");
  return error ? "refused" : (data ?? []).length === 1 ? "ok" : "refused";
}
async function roster(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendee_roster", { p_event_id: eventId });
  return data ?? [];
}
async function stored(eventId: string) {
  const { data } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
  return data;
}
async function rsvpRows(eventId: string) {
  const { count } = await admin.from("event_attendees").select("user_id", { count: "exact", head: true }).eq("event_id", eventId);
  return count ?? 0;
}
async function notificationsFor(client: Client, eventId: string) {
  const { data } = await client.from("notifications").select("title, body, event_id").eq("event_id", eventId);
  return data ?? [];
}
/** The upcoming-event query behind Home, /events and the profile count. */
async function upcomingIds(client: Client) {
  const { data } = await client
    .from("events")
    .select("id")
    .is("cancelled_at", null)
    .gte("ends_at", new Date().toISOString());
  return (data ?? []).map((row) => row.id);
}

async function cleanup() {
  await admin.from("events").delete().like("title", `${MARK}%`);
}

async function main() {
  await cleanup();

  const handles = [
    "miaminge", "petter", "karimoen", "elironning", "kristoffer", "elise", "amina",
    "erlendthonstad", "emmamortensen", "octavio",
  ] as const;
  const c = Object.fromEntries(
    await Promise.all(handles.map(async (h) => [h, await signIn(h)] as const)),
  ) as Record<(typeof handles)[number], Client>;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  const oslo = await groupId("FTR Oslo");
  const trondelag = await groupId("FTR Trøndelag");
  const { data: ss } = await admin.from("community_subgroups").select("id").eq("community_id", FTR).eq("slug", "safe-space-frivillige").single();

  const wide = await create(c.miaminge, {}, { is_public: true, capacity: 30 });
  const adminOslo = await create(c.miaminge, { local_group_id: oslo });
  const adminSs = await create(c.miaminge, { subgroup_id: ss!.id });
  const adminTrondelag = await create(c.miaminge, { local_group_id: trondelag });
  const leaderOwn = await create(c.petter, { local_group_id: trondelag }, { capacity: 10 });

  // ── 1–4. Who may edit ─────────────────────────────────────────────────
  expect("1. admin endrer fellesskapsarrangement", await edit(c.miaminge, wide, { title: `${MARK} nytt navn`, location: "Bergen", capacity: 40 }), "endret");
  const afterWide = await stored(wide);
  expect("1. endringen er lagret", `${afterWide?.title}|${afterWide?.location}|${afterWide?.capacity}`, `${MARK} nytt navn|Bergen|40`);
  expect("2. admin endrer Oslo-arrangement", await edit(c.miaminge, adminOslo, { location: "Oslo sentrum" }), "endret");
  expect("2. admin endrer Safe-Space-arrangement", await edit(c.miaminge, adminSs, { location: "Kontoret" }), "endret");
  expect("3. lokallagsleder endrer eget arrangement", await edit(c.petter, leaderOwn, { title: `${MARK} leders`, location: "Frivilligsentralen" }), "endret");
  expect("4. lokallagsleder endrer admin-opprettet arrangement i eget lokallag", await edit(c.petter, adminTrondelag, { location: "Biblioteket" }), "endret");

  // ── 5–7. Who may not, and what nobody may ─────────────────────────────
  expect("5. leder kan ikke endre Oslo-arrangement", await edit(c.petter, adminOslo, { location: "x" }), "avvist");
  expect("5. leder kan ikke endre fellesskapsarrangement", await edit(c.petter, wide, { location: "x" }), "avvist");
  expect("5. leder kan ikke endre Safe-Space-arrangement", await edit(c.petter, adminSs, { location: "x" }), "avvist");
  expect("6. moderator i samme lokallag kan ikke endre", await edit(c.karimoen, leaderOwn, { location: "x" }), "avvist");
  expect("6. vanlig medlem kan ikke endre", await edit(c.elironning, leaderOwn, { location: "x" }), "avvist");
  expect("6. moderator kan ikke endre fellesskapsarrangement", await edit(c.amina, wide, { location: "x" }), "avvist");
  expect("7. fellesskapet kan ikke endres", await edit(c.miaminge, wide, { community_id: "under-the-rug" }), "avvist");
  expect("7. verten kan ikke endres", await edit(c.miaminge, leaderOwn, { host_id: ids.miaminge }), "avvist");
  expect("7. status kan ikke settes direkte", await edit(c.miaminge, wide, { cancelled_at: new Date().toISOString() }), "avvist");
  expect("7. leder kan ikke utvide til hele fellesskapet", await edit(c.petter, leaderOwn, { local_group_id: null }), "avvist");
  expect("7. leder kan ikke flytte til Oslo", await edit(c.petter, leaderOwn, { local_group_id: oslo }), "avvist");
  expect("7. lokallagsarrangement kan ikke gjøres åpent", await edit(c.miaminge, adminTrondelag, { is_public: true }), "avvist");
  expect("7. slutt før start avvises", await edit(c.miaminge, wide, { ends_at: new Date(Date.now() + 1000).toISOString() }), "avvist");
  expect("7. tom tittel avvises", await edit(c.miaminge, wide, { title: "  " }), "avvist");
  expect("7. kapasitet 0 avvises", await edit(c.miaminge, wide, { capacity: 0 }), "avvist");
  expect("7. anonym kan ikke endre", await edit(anon, wide, { location: "x" }), "avvist");

  // ── Audience is fixed at creation — for admins too ────────────────────
  //
  // Direct writes through the API as FTR's own admin, who could have created
  // the event in any of these scopes. None may widen, narrow or switch an
  // existing event's audience.
  const scopeOf = async (eventId: string) => {
    const row = await stored(eventId);
    return `${row?.local_group_id ?? "-"}|${row?.subgroup_id ?? "-"}|${row?.is_public}`;
  };
  const ssScope = await scopeOf(adminSs);
  const trondelagScope = await scopeOf(adminTrondelag);
  const wideScope = await scopeOf(wide);
  const raw = await c.miaminge.from("events").update({ subgroup_id: null, is_public: true } as never).eq("id", adminSs).select("id");
  expect("S. avvisningen kommer fra databasen (42501)", raw.error?.code ?? "ingen feil", "42501");
  expect("S. admin kan ikke gjøre Safe-Space-arrangement fellesskapsbredt", await edit(c.miaminge, adminSs, { subgroup_id: null }), "avvist");
  expect("S. admin kan ikke gjøre Safe-Space-arrangement åpent", await edit(c.miaminge, adminSs, { subgroup_id: null, is_public: true }), "avvist");
  expect("S. admin kan ikke flytte Safe-Space-arrangement til et lokallag", await edit(c.miaminge, adminSs, { subgroup_id: null, local_group_id: trondelag }), "avvist");
  expect("S. admin kan ikke gjøre lokallagsarrangement fellesskapsbredt", await edit(c.miaminge, adminTrondelag, { local_group_id: null }), "avvist");
  expect("S. admin kan ikke gjøre lokallagsarrangement åpent", await edit(c.miaminge, adminTrondelag, { local_group_id: null, is_public: true }), "avvist");
  expect("S. admin kan ikke flytte lokallagsarrangement til Oslo", await edit(c.miaminge, adminTrondelag, { local_group_id: oslo }), "avvist");
  expect("S. admin kan ikke flytte lokallagsarrangement til Safe-Space", await edit(c.miaminge, adminTrondelag, { local_group_id: null, subgroup_id: ss!.id }), "avvist");
  expect("S. admin kan ikke gjøre åpent arrangement lukket", await edit(c.miaminge, wide, { is_public: false }), "avvist");
  expect("S. admin kan ikke snevre fellesskapsarrangement inn til et lokallag", await edit(c.miaminge, wide, { local_group_id: trondelag, is_public: false }), "avvist");
  expect("S. lokallagsleder kan ikke gjøre eget arrangement åpent", await edit(c.petter, leaderOwn, { local_group_id: null, is_public: true }), "avvist");
  expect("S. Safe-Space-arrangementets omfang er uendret", await scopeOf(adminSs), ssScope);
  expect("S. lokallagsarrangementets omfang er uendret", await scopeOf(adminTrondelag), trondelagScope);
  expect("S. fellesskapsarrangementets omfang er uendret", await scopeOf(wide), wideScope);
  const { data: portalNow } = await anon.rpc("portal_events", { p_slug: FTR });
  expect("S. portalen viser fortsatt ikke Safe-Space- eller lokallagsarrangementet", (portalNow ?? []).some((e) => e.id === adminSs || e.id === adminTrondelag), false);
  expect("S. FTR-medlem utenfor Safe-Space ser det fortsatt ikke", Boolean((await c.elise.from("events").select("id").eq("id", adminSs).maybeSingle()).data), false);
  // Ordinary edits still work. The scope columns are not writable at all
  // since 20261114100000, so sending them along — even unchanged — is refused
  // on privilege; the app's edit form never sends them.
  expect("S. admin endrer fortsatt tittel på Safe-Space-arrangement", await edit(c.miaminge, adminSs, { title: `${MARK} Safe-Space` }), "endret");
  expect("S. admin endrer fortsatt sted på lokallagsarrangement", await edit(c.miaminge, adminTrondelag, { location: "Trondheim" }), "endret");
  expect("S. uendret omfang sendt med en endring avvises", await edit(c.miaminge, adminTrondelag, { local_group_id: trondelag, location: "Trondheim" }), "avvist");
  // Creation keeps every authorized scope.
  const createdSs = await create(c.miaminge, { subgroup_id: ss!.id });
  expect("S. admin kan fortsatt opprette Safe-Space-arrangement", Boolean(createdSs), true);
  const createdOwn = await create(c.petter, { local_group_id: trondelag });
  expect("S. lokallagsleder kan fortsatt opprette i eget lokallag", Boolean(createdOwn), true);
  expect("S. lokallagsleder kan fortsatt ikke opprette fellesskapsbredt", await c.petter.from("events").insert({ community_id: FTR, title: `${MARK} x`, description: "", location: "x", starts_at: new Date(Date.now() + 9e8).toISOString(), ends_at: new Date(Date.now() + 9.1e8).toISOString() } as never).select("id").then((r) => (r.error ? "avvist" : "opprettet")), "avvist");

  // ── 8. A description change persists ──────────────────────────────────
  expect("8. leder endrer beskrivelsen", await edit(c.petter, leaderOwn, { description: "Ny beskrivelse\nmed to linjer." }), "endret");
  const { data: asMember } = await c.elironning.from("events").select("description, title").eq("id", leaderOwn).single();
  expect("8. medlemmet leser den nye beskrivelsen", asMember?.description, "Ny beskrivelse\nmed to linjer.");
  expect("8. resten er uendret", asMember?.title, `${MARK} leders`);

  // Capacity cannot go below current RSVPs.
  expect("Eli melder seg på lederens arrangement", await rsvp(c.elironning, leaderOwn), "ok");
  expect("Kari melder seg på lederens arrangement", await rsvp(c.karimoen, leaderOwn), "ok");
  expect("kapasitet under antall påmeldte avvises", await edit(c.petter, leaderOwn, { capacity: 1 }), "under kapasitet");
  expect("kapasitet lik antall påmeldte godtas", await edit(c.petter, leaderOwn, { capacity: 2 }), "endret");

  // ── 9–10. Cancellation keeps everything and freezes RSVPs ─────────────
  const before = await stored(leaderOwn);
  expect("9. medlem kan ikke avlyse", await cancel(c.elironning, leaderOwn), "refused");
  expect("9. moderator kan ikke avlyse", await cancel(c.karimoen, leaderOwn), "refused");
  expect("9. lokallagsleder avlyser", await cancel(c.petter, leaderOwn), "ok");
  const after = await stored(leaderOwn);
  expect("9. arrangementet finnes fortsatt", Boolean(after), true);
  expect("9. markert som avlyst av lederen", `${Boolean(after?.cancelled_at)}|${after?.cancelled_by === ids.petter}`, "true|true");
  expect(
    "9. tittel, beskrivelse, tid, sted, vert og omfang er uendret",
    JSON.stringify([after?.title, after?.description, after?.starts_at, after?.ends_at, after?.location, after?.host_id, after?.local_group_id]),
    JSON.stringify([before?.title, before?.description, before?.starts_at, before?.ends_at, before?.location, before?.host_id, before?.local_group_id]),
  );
  expect("9. påmeldingene er beholdt", await rsvpRows(leaderOwn), 2);
  expect("9. lederen ser fortsatt påmeldtlisten (historikk)", (await roster(c.petter, leaderOwn)).length, 2);
  expect("9. å avlyse igjen gir beskjed", await cancel(c.petter, leaderOwn), "already_cancelled");
  const eliNotice = await notificationsFor(c.elironning, leaderOwn);
  expect("9. påmeldte får varsel", eliNotice.length, 1);
  expect("9. varselet nevner avlysningen og tittelen", (eliNotice[0]?.title ?? "").startsWith("Avlyst: ") && (eliNotice[0]?.title ?? "").includes(`${MARK} leders`), true);
  expect("9. Kari får også varsel", (await notificationsFor(c.karimoen, leaderOwn)).length, 1);
  expect("9. den som avlyste får ikke varsel", (await notificationsFor(c.petter, leaderOwn)).length, 0);
  expect("9. varselet navngir ingen andre påmeldte", JSON.stringify(eliNotice).includes("Kari"), false);
  expect("10. ny påmelding avvises", await rsvp(c.petter, leaderOwn), "refused");
  expect("10. avmelding avvises (historikken står)", await withdraw(c.elironning, leaderOwn), "refused");
  expect("10. påmeldingene er fortsatt to", await rsvpRows(leaderOwn), 2);

  // Editing a cancelled event does not restore it.
  expect("6b. leder kan rette beskrivelsen på avlyst arrangement", await edit(c.petter, leaderOwn, { description: "Avlyst på grunn av vær." }), "endret");
  expect("6b. arrangementet er fortsatt avlyst etter endring", Boolean((await stored(leaderOwn))?.cancelled_at), true);

  // ── 11. Out of every upcoming list, and off the portal ────────────────
  expect("11. borte fra kommende for medlem", (await upcomingIds(c.elironning)).includes(leaderOwn), false);
  expect("11. borte fra kommende for leder", (await upcomingIds(c.petter)).includes(leaderOwn), false);
  const { data: portalBefore } = await anon.rpc("portal_events", { p_slug: FTR });
  expect("11. åpent arrangement står på portalen før avlysning", (portalBefore ?? []).some((e) => e.id === wide), true);
  expect("11. admin avlyser det åpne arrangementet", await cancel(c.miaminge, wide), "ok");
  const { data: portalAfter } = await anon.rpc("portal_events", { p_slug: FTR });
  expect("11. avlyst arrangement vises ikke på portalen", (portalAfter ?? []).some((e) => e.id === wide), false);
  expect("11. og ikke i kommende for medlemmer", (await upcomingIds(c.elise)).includes(wide), false);
  const { data: stillReadable } = await c.elise.from("events").select("id, cancelled_at").eq("id", wide).maybeSingle();
  expect("11. men kan fortsatt leses (historikk)", Boolean(stillReadable?.cancelled_at), true);

  // ── 20. Restoring re-checks capacity ──────────────────────────────────
  const tight = await create(c.petter, { local_group_id: trondelag }, { capacity: 1 });
  expect("20. Eli tar den ene plassen", await rsvp(c.elironning, tight), "ok");
  await admin.from("memberships").update({ local_group_id: oslo }).eq("community_id", FTR).eq("user_id", ids.elironning);
  try {
    expect("20. Elis plass er frigjort når hun flytter: Kari får plass", await rsvp(c.karimoen, tight), "ok");
    expect("20. lederen avlyser", await cancel(c.petter, tight), "ok");
  } finally {
    await admin.from("memberships").update({ local_group_id: trondelag }).eq("community_id", FTR).eq("user_id", ids.elironning);
  }
  expect("20. Eli er tilbake: to gjeldende påmeldinger, én plass", (await roster(c.petter, tight)).length, 2);
  expect("20. gjenoppretting avvises over kapasitet", await restore(c.petter, tight), "over_capacity");
  expect("20. arrangementet er fortsatt avlyst", Boolean((await stored(tight))?.cancelled_at), true);
  expect("20. medlem kan ikke gjenopprette", await restore(c.elironning, tight), "refused");
  expect("20. kapasitet kan økes på avlyst arrangement", await edit(c.petter, tight, { capacity: 2 }), "endret");
  expect("20. gjenoppretting etter økt kapasitet", await restore(c.petter, tight), "ok");
  expect("20. arrangementet er aktivt igjen", (await stored(tight))?.cancelled_at, null);
  expect("20. påmeldte får varsel om gjenoppretting", (await notificationsFor(c.elironning, tight)).some((n) => n.title.startsWith("Gjennomføres likevel: ")), true);
  expect("20. fullt igjen: ny påmelding avvises på kapasitet", await rsvp(c.petter, tight), "full");
  expect("20. gjenoppretting av aktivt arrangement gir beskjed", await restore(c.petter, tight), "not_cancelled");

  // ── 12–14. Permanent deletion ─────────────────────────────────────────
  expect("13. lokallagsleder kan ikke slette", await remove(c.petter, leaderOwn), "avvist");
  expect("13. can_delete_event er falsk for lederen", (await c.petter.rpc("can_delete_event", { p_event_id: leaderOwn })).data, false);
  expect("14. vanlig medlem kan ikke slette", await remove(c.elironning, leaderOwn), "avvist");
  expect("14. moderator kan ikke slette", await remove(c.karimoen, leaderOwn), "avvist");
  expect("14. anonym kan ikke slette", await remove(anon, leaderOwn), "avvist");
  expect("12. can_delete_event er sann for admin", (await c.miaminge.rpc("can_delete_event", { p_event_id: leaderOwn })).data, true);
  expect("12. admin sletter permanent", await remove(c.miaminge, leaderOwn), "slettet");
  expect("12. arrangementet er borte", await stored(leaderOwn), null);
  expect("12. påmeldingene er borte", await rsvpRows(leaderOwn), 0);
  const { count: orphanNotices } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("event_id", leaderOwn);
  expect("12. varslene om arrangementet er borte (ingen brutte referanser)", orphanNotices, 0);

  // ── 15. Revoking leadership ───────────────────────────────────────────
  const leaderTwo = await create(c.petter, { local_group_id: trondelag });
  try {
    expect("15. admin fjerner Petter som leder", (await c.miaminge.rpc("remove_local_group_manager", { p_local_group_id: trondelag, p_user_id: ids.petter })).data, true);
    expect("15. kan ikke lenger endre sitt arrangement", await edit(c.petter, leaderTwo, { location: "x" }), "avvist");
    expect("15. kan ikke lenger avlyse", await cancel(c.petter, leaderTwo), "refused");
    expect("15. kan ikke slette", await remove(c.petter, leaderTwo), "avvist");
  } finally {
    await c.miaminge.rpc("add_local_group_manager", { p_local_group_id: trondelag, p_user_id: ids.petter });
  }
  expect("15. etter ny utnevnelse kan han endre igjen", await edit(c.petter, leaderTwo, { location: "Trondheim" }), "endret");

  // ── 16. Revoking the admin role ───────────────────────────────────────
  try {
    await admin.from("memberships").update({ role: "member" }).eq("community_id", FTR).eq("user_id", ids.miaminge);
    expect("16. tidligere admin kan ikke endre", await edit(c.miaminge, adminOslo, { location: "x" }), "avvist");
    expect("16. tidligere admin kan ikke avlyse", await cancel(c.miaminge, adminOslo), "refused");
    expect("16. tidligere admin kan ikke slette", await remove(c.miaminge, adminOslo), "avvist");
    expect("16. tidligere admin kan ikke gjenopprette", await restore(c.miaminge, wide), "refused");
  } finally {
    await admin.from("memberships").update({ role: "admin" }).eq("community_id", FTR).eq("user_id", ids.miaminge);
  }
  expect("16. admin igjen: kan endre", await edit(c.miaminge, adminOslo, { location: "Oslo" }), "endret");

  // ── 17. No cross-community shortcut ───────────────────────────────────
  for (const [who, client] of [["TU-admin", c.emmamortensen], ["UTR-admin", c.octavio]] as const) {
    expect(`17. ${who} kan ikke endre FTR-arrangement`, await edit(client, adminTrondelag, { location: "x" }), "avvist");
    expect(`17. ${who} kan ikke avlyse FTR-arrangement`, await cancel(client, adminTrondelag), "refused");
    expect(`17. ${who} kan ikke gjenopprette FTR-arrangement`, await restore(client, wide), "refused");
    expect(`17. ${who} kan ikke slette FTR-arrangement`, await remove(client, adminTrondelag), "avvist");
    expect(`17. ${who} får ikke can_manage_event`, (await client.rpc("can_manage_event", { p_event_id: adminTrondelag })).data, false);
  }

  // ── 18–19. Scope boundaries and roster privacy hold through cancellation
  expect("Kristoffer (Safe-Space) melder seg på", await rsvp(c.kristoffer, adminSs), "ok");
  expect("18. moderator som kan lese Safe-Space kan ikke avlyse det", await cancel(c.amina, adminSs), "refused");
  expect("18. gruppemedlem og moderator kan ikke endre det", await edit(c.erlendthonstad, adminSs, { location: "x" }), "avvist");
  expect("18. lokallagsleder ser ikke Safe-Space-arrangementet", Boolean((await c.petter.from("events").select("id").eq("id", adminSs).maybeSingle()).data), false);
  expect("18. admin avlyser Safe-Space-arrangementet", await cancel(c.miaminge, adminSs), "ok");
  expect("18. Kristoffer får varsel", (await notificationsFor(c.kristoffer, adminSs)).length, 1);
  expect("18. FTR-medlem utenfor gruppen ser verken arrangement eller varsel", `${Boolean((await c.elise.from("events").select("id").eq("id", adminSs).maybeSingle()).data)}|${(await notificationsFor(c.elise, adminSs)).length}`, "false|0");
  const { data: ssRow } = await admin.from("community_subgroup_members").select("*").eq("subgroup_id", ss!.id).eq("user_id", ids.kristoffer).single();
  try {
    await admin.from("community_subgroup_members").delete().eq("subgroup_id", ss!.id).eq("user_id", ids.kristoffer);
    expect("18. fjernet fra gruppen: varselet om det private arrangementet kan ikke lenger leses", (await notificationsFor(c.kristoffer, adminSs)).length, 0);
  } finally {
    await admin.from("community_subgroup_members").insert(ssRow!);
  }
  expect("18. Oslo-arrangementet er fortsatt usynlig for Trøndelag-lederen", Boolean((await c.petter.from("events").select("id").eq("id", adminOslo).maybeSingle()).data), false);
  expect("19. påmeldt medlem ser ingen påmeldtliste på avlyst arrangement", (await roster(c.kristoffer, adminSs)).length, 0);
  expect("19. moderator ser ingen påmeldtliste", (await roster(c.amina, adminSs)).length, 0);
  expect("19. admin ser påmeldtlisten (historikk)", (await roster(c.miaminge, adminSs)).length, 1);
  const { data: directRows } = await c.amina.from("event_attendees").select("user_id").eq("event_id", adminSs);
  expect("19. direkte tabellesing gir moderatoren ingen rader", (directRows ?? []).length, 0);

  // ── An ended event cannot be cancelled or restored ────────────────────
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
  expect("gjennomført arrangement kan ikke avlyses", await cancel(c.miaminge, pastEvent!.id), "ended");
  expect("gjennomført arrangement kan fortsatt rettes", await edit(c.miaminge, pastEvent!.id, { description: "Referat kommer." }), "endret");

  await cleanup();
  const { count: leftovers } = await admin.from("events").select("id", { count: "exact", head: true }).like("title", `${MARK}%`);
  expect("opprydding: ingen testarrangementer igjen", leftovers, 0);
  const { data: miaRole } = await admin.from("memberships").select("role").eq("community_id", FTR).eq("user_id", ids.miaminge).single();
  expect("opprydding: Mia er admin", miaRole?.role, "admin");
  const { data: eliGroup } = await admin.from("memberships").select("local_group_id").eq("community_id", FTR).eq("user_id", ids.elironning).single();
  expect("opprydding: Eli er i Trøndelag", eliGroup?.local_group_id, trondelag);
  const { data: grant } = await admin.from("community_local_group_managers").select("user_id").eq("local_group_id", trondelag).eq("user_id", ids.petter).maybeSingle();
  expect("opprydding: Petter er lokallagsleder", Boolean(grant), true);
  const { data: ssBack } = await admin.from("community_subgroup_members").select("user_id").eq("subgroup_id", ss!.id).eq("user_id", ids.kristoffer).maybeSingle();
  expect("opprydding: Kristoffer er i Safe-Space", Boolean(ssBack), true);
}

main()
  .catch(async (error) => {
    console.error(error);
    failures += 1;
    await cleanup();
    await admin.from("memberships").update({ role: "admin" }).eq("community_id", FTR).eq("user_id", await profileId("miaminge"));
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av endring, avlysning og sletting passerte`);
    console.log("  admin: alt i eget fellesskap; lokallagsleder: endre/avlyse eget lokallag; ingen andre");
  });
