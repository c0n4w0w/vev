/**
 * Checks lokallagsledere and the event-management rule
 * (20261010100000_local_group_managers).
 *
 *   create / edit / cancel an event   active admin of the community: any scope
 *                                     effective lokallagsleder: own lokallag only
 *   see its roster                    its host, or anyone who may manage it
 *   grant / revoke leadership         admins of the lokallag's community
 *
 * A leadership grant counts only while the leader is an active member of that
 * exact lokallag, and is deleted the moment that stops being true (moving
 * lokallag, leaving it, becoming inactive, the lokallag being retired) — so
 * nothing comes back silently. Being an event's host grants nothing by
 * itself. Moderators and members get nothing by role.
 *
 * Every access check runs as a fixture account through the anon key, so a
 * passing run means the database refuses, not the page. The service role only
 * reads state back, moves one membership temporarily, and removes every event
 * this run created.
 *
 * Run with `npm run check:local-group-leaders` against the local stack after
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
const MARK = "CHECK lokallagsleder";

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
  const { data, error } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", FTR)
    .eq("name", name)
    .single();
  if (error) throw error;
  return data.id;
}

// ── The same writes and reads the app makes ─────────────────────────────

async function create(
  client: Client,
  communityId: string,
  scope: { local_group_id?: string | null; subgroup_id?: string | null } = {},
  extra: Record<string, unknown> = {},
) {
  const starts = new Date(Date.now() + 25 * 24 * 3600 * 1000);
  const { data, error } = await client
    .from("events")
    .insert({
      community_id: communityId,
      title: `${MARK} arrangement`,
      description: "Opprettet av check:local-group-leaders",
      location: "Trondheim",
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString(),
      ...scope,
      ...extra,
    } as never)
    .select("id, host_id")
    .maybeSingle();
  return { id: data?.id ?? null, hostId: data?.host_id ?? null, code: error?.code ?? null };
}
const created = (r: { id: string | null }) => (r.id ? "opprettet" : "avvist");

async function update(client: Client, eventId: string, patch: Record<string, unknown>) {
  const { data, error } = await client.from("events").update(patch as never).eq("id", eventId).select("id");
  return error ? "avvist" : (data ?? []).length === 1 ? "endret" : "avvist";
}
async function cancel(client: Client, eventId: string) {
  const { data, error } = await client.from("events").delete().eq("id", eventId).select("id");
  return error ? "avvist" : (data ?? []).length === 1 ? "avlyst" : "avvist";
}
async function canLead(client: Client, localGroupId: string) {
  return (await client.rpc("can_lead_local_group", { p_local_group_id: localGroupId })).data === true;
}
async function canManage(client: Client, eventId: string) {
  return (await client.rpc("can_manage_event", { p_event_id: eventId })).data === true;
}
async function rosterNames(client: Client, eventId: string) {
  const { data } = await client.rpc("event_attendee_roster", { p_event_id: eventId });
  return (data ?? []).map((row) => row.display_name);
}
async function rsvp(client: Client, eventId: string) {
  const { error } = await client.from("event_attendees").insert({ event_id: eventId });
  return error ? "refused" : "ok";
}
async function grant(client: Client, localGroupId: string, userId: string) {
  return (await client.rpc("add_local_group_manager", { p_local_group_id: localGroupId, p_user_id: userId })).data === true;
}
async function revoke(client: Client, localGroupId: string, userId: string) {
  return (await client.rpc("remove_local_group_manager", { p_local_group_id: localGroupId, p_user_id: userId })).data === true;
}
async function isGranted(localGroupId: string, userId: string) {
  const { data } = await admin
    .from("community_local_group_managers")
    .select("user_id")
    .eq("local_group_id", localGroupId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function cleanup() {
  await admin.from("events").delete().like("title", `${MARK}%`);
}

async function main() {
  await cleanup();

  const handles = [
    "miaminge", "petter", "karimoen", "nadia", "kristoffer", "elironning", "emmamortensen", "octavio",
  ] as const;
  const c = Object.fromEntries(
    await Promise.all(handles.map(async (h) => [h, await signIn(h)] as const)),
  ) as Record<(typeof handles)[number], Client>;

  const oslo = await groupId("FTR Oslo");
  const trondelag = await groupId("FTR Trøndelag");
  const { data: ss } = await admin.from("community_subgroups").select("id").eq("community_id", FTR).eq("slug", "safe-space-frivillige").single();

  // Fixture preconditions, so a later failure means the rule, not the seed.
  expect("forutsetning: Petter er lokallagsleder for FTR Trøndelag", await isGranted(trondelag, ids.petter), true);
  expect("forutsetning: Petter er vanlig medlem, ikke moderator", (await admin.from("memberships").select("role").eq("community_id", FTR).eq("user_id", ids.petter).single()).data?.role, "member");
  expect("forutsetning: Kari er moderator i Trøndelag uten ledertilgang", await isGranted(trondelag, ids.karimoen), false);
  expect("Petter er effektiv leder i Trøndelag", await canLead(c.petter, trondelag), true);
  expect("Petter er ikke leder i Oslo", await canLead(c.petter, oslo), false);
  expect("Kari (moderator) er ikke leder", await canLead(c.karimoen, trondelag), false);

  // ── 1–2. Admin ────────────────────────────────────────────────────────
  const adminWide = await create(c.miaminge, FTR);
  expect("1. admin kan opprette fellesskapsarrangement", created(adminWide), "opprettet");
  expect("1. verten er admin selv", adminWide.hostId, ids.miaminge);
  const adminOslo = await create(c.miaminge, FTR, { local_group_id: oslo });
  expect("2. admin kan opprette for FTR Oslo", created(adminOslo), "opprettet");
  const adminTrondelag = await create(c.miaminge, FTR, { local_group_id: trondelag });
  expect("2. admin kan opprette for FTR Trøndelag", created(adminTrondelag), "opprettet");
  expect("admin kan fortsatt opprette Safe-Space-arrangement", created(await create(c.miaminge, FTR, { subgroup_id: ss!.id })), "opprettet");

  // ── 3–5. Lokallagsleder ───────────────────────────────────────────────
  const own = await create(c.petter, FTR, { local_group_id: trondelag });
  expect("3. lokallagsleder kan opprette for eget lokallag", created(own), "opprettet");
  expect("3. verten settes til lederen selv", own.hostId, ids.petter);
  expect("3. forfalsket vert avvises", created(await create(c.petter, FTR, { local_group_id: trondelag }, { host_id: ids.miaminge })), "avvist");
  expect("4. lokallagsleder kan ikke opprette for et annet lokallag", created(await create(c.petter, FTR, { local_group_id: oslo })), "avvist");
  expect("5. lokallagsleder kan ikke opprette fellesskapsarrangement", created(await create(c.petter, FTR)), "avvist");
  expect("5. lokallagsleder kan ikke opprette Safe-Space-arrangement", created(await create(c.petter, FTR, { subgroup_id: ss!.id })), "avvist");
  expect("5. lokallagsarrangement kan ikke være åpent", created(await create(c.petter, FTR, { local_group_id: trondelag }, { is_public: true })), "avvist");
  expect("lokallagsleder kan ikke opprette i et annet fellesskap", created(await create(c.petter, "tryggere-ungdom")), "avvist");

  // ── 6–8. Everyone else ────────────────────────────────────────────────
  expect("6. moderator i lokallaget uten ledertilgang kan ikke opprette der", created(await create(c.karimoen, FTR, { local_group_id: trondelag })), "avvist");
  expect("6. moderator kan ikke opprette fellesskapsarrangement", created(await create(c.nadia, FTR)), "avvist");
  expect("7. vanlig medlem kan ikke opprette i eget lokallag", created(await create(c.elironning, FTR, { local_group_id: trondelag })), "avvist");
  expect("7. vanlig medlem kan ikke opprette fellesskapsarrangement", created(await create(c.kristoffer, FTR)), "avvist");
  expect("8. TU-admin kan ikke opprette i FTR", created(await create(c.emmamortensen, FTR)), "avvist");
  expect("8. UTR-admin kan ikke opprette for et FTR-lokallag", created(await create(c.octavio, FTR, { local_group_id: trondelag })), "avvist");

  // ── 9–10. Roster ──────────────────────────────────────────────────────
  expect("Eli melder seg på lederens arrangement", await rsvp(c.elironning, own.id!), "ok");
  expect("Eli melder seg på adminens Trøndelag-arrangement", await rsvp(c.elironning, adminTrondelag.id!), "ok");
  expect("9. lokallagsleder-vert ser påmeldte", JSON.stringify(await rosterNames(c.petter, own.id!)), JSON.stringify(["Eli Rønning"]));
  expect("9. lokallagsleder ser påmeldte på lokallagets arrangement opprettet av admin", JSON.stringify(await rosterNames(c.petter, adminTrondelag.id!)), JSON.stringify(["Eli Rønning"]));
  expect("9. admin ser påmeldte på lederens arrangement", (await rosterNames(c.miaminge, own.id!)).length, 1);
  expect("10. påmeldt medlem ser ingen navn", (await rosterNames(c.elironning, own.id!)).length, 0);
  expect("10. moderator i samme lokallag ser ingen navn", (await rosterNames(c.karimoen, own.id!)).length, 0);
  expect("10. medlem i annet lokallag ser ingen navn", (await rosterNames(c.kristoffer, own.id!)).length, 0);
  expect("10. annet fellesskaps admin ser ingen navn", (await rosterNames(c.emmamortensen, own.id!)).length, 0);
  expect("lokallagsleder ser ikke Oslo-arrangementets liste", (await rosterNames(c.petter, adminOslo.id!)).length, 0);

  // ── Editing and cancelling ────────────────────────────────────────────
  expect("leder kan administrere eget arrangement", await canManage(c.petter, own.id!), true);
  expect("leder kan endre eget arrangement", await update(c.petter, own.id!, { location: "Trondheim folkebibliotek" }), "endret");
  expect("leder kan endre lokallagets arrangement opprettet av admin", await update(c.petter, adminTrondelag.id!, { capacity: 30 }), "endret");
  expect("leder kan ikke flytte arrangementet til et annet lokallag", await update(c.petter, own.id!, { local_group_id: oslo }), "avvist");
  expect("leder kan ikke gjøre det til fellesskapsarrangement", await update(c.petter, own.id!, { local_group_id: null }), "avvist");
  expect("leder kan ikke gjøre det til Safe-Space-arrangement", await update(c.petter, own.id!, { local_group_id: null, subgroup_id: ss!.id }), "avvist");
  expect("leder kan ikke endre verten", await update(c.petter, own.id!, { host_id: ids.karimoen }), "avvist");
  expect("leder kan ikke endre Oslo-arrangement", await update(c.petter, adminOslo.id!, { title: `${MARK} endret` }), "avvist");
  expect("leder kan ikke endre fellesskapsarrangement", await update(c.petter, adminWide.id!, { title: `${MARK} endret` }), "avvist");
  expect("leder kan ikke avlyse fellesskapsarrangement", await cancel(c.petter, adminWide.id!), "avvist");
  expect("moderator kan ikke endre lederens arrangement", await update(c.karimoen, own.id!, { title: `${MARK} endret` }), "avvist");
  expect("medlem kan ikke avlyse lederens arrangement", await cancel(c.elironning, own.id!), "avvist");
  expect("annet fellesskaps admin kan ikke avlyse", await cancel(c.emmamortensen, own.id!), "avvist");
  expect("admin kan endre lederens arrangement", await update(c.miaminge, own.id!, { title: `${MARK} arrangement (admin)` }), "endret");
  expect("admin kan flytte et lokallagsarrangement til et annet lokallag", await update(c.miaminge, adminOslo.id!, { local_group_id: trondelag }), "endret");
  await update(c.miaminge, adminOslo.id!, { local_group_id: oslo });

  // ── Granting ──────────────────────────────────────────────────────────
  expect("leder kan ikke utnevne andre ledere", await grant(c.petter, trondelag, ids.elironning), false);
  expect("moderator kan ikke utnevne ledere", await grant(c.karimoen, trondelag, ids.karimoen), false);
  expect("TU-admin kan ikke utnevne FTR-ledere", await grant(c.emmamortensen, trondelag, ids.elironning), false);
  expect("admin kan ikke utnevne noen utenfor lokallaget", await grant(c.miaminge, trondelag, ids.kristoffer), false);
  const direct = await c.petter.from("community_local_group_managers").insert({ local_group_id: trondelag, community_id: FTR, user_id: ids.elironning } as never);
  expect("ingen kan skrive direkte i tabellen", Boolean(direct.error), true);
  expect("TU-admin kan ikke fjerne FTR-ledere", await revoke(c.emmamortensen, trondelag, ids.petter), false);
  expect("Petter er fortsatt leder", await isGranted(trondelag, ids.petter), true);
  const { data: asKristoffer } = await c.kristoffer.from("community_local_group_managers").select("user_id");
  expect("medlem ser ingen ledertildelinger", (asKristoffer ?? []).length, 0);
  const { data: asPetter } = await c.petter.from("community_local_group_managers").select("user_id");
  expect("leder ser bare sin egen tildeling", JSON.stringify((asPetter ?? []).map((r) => r.user_id)), JSON.stringify([ids.petter]));
  const { data: asEmma } = await c.emmamortensen.from("community_local_group_managers").select("user_id").eq("community_id", FTR);
  expect("annet fellesskaps admin ser ingen FTR-tildelinger", (asEmma ?? []).length, 0);

  // ── Grants end with the situation they were given for ────────────────
  const { data: tuTrondelag } = await admin.from("community_local_groups").select("id").eq("community_id", "tryggere-ungdom").eq("name", "TU Trøndelag").single();
  const setPetter = async (patch: Record<string, unknown>) => {
    const { error } = await admin.from("memberships").update(patch as never).eq("community_id", FTR).eq("user_id", ids.petter);
    if (error) throw new Error(`kunne ikke endre Petters medlemskap: ${error.message}`);
  };
  const regrant = async () => expect("admin utnevner Petter på nytt", await grant(c.miaminge, trondelag, ids.petter), true);

  // A grant in another community must survive everything below.
  expect("TU-admin gir Petter en TU-ledertilgang (urelatert fellesskap)", await grant(c.emmamortensen, tuTrondelag!.id, ids.petter), true);
  try {
    // A role change is not a lokallag change.
    await setPetter({ role: "moderator" });
    await setPetter({ role: "member" });
    expect("rolleendring rører ikke ledertilgangen", await isGranted(trondelag, ids.petter), true);

    // Moving to another lokallag, then back.
    try {
      expect("Petter bytter selv til Oslo", (await c.petter.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: oslo })).data, true);
      expect("flytting sletter ledertilgangen i det gamle lokallaget", await isGranted(trondelag, ids.petter), false);
      expect("flyttet leder kan ikke opprette i det gamle lokallaget", created(await create(c.petter, FTR, { local_group_id: trondelag })), "avvist");
      expect("flyttet leder får ingen rettigheter i det nye lokallaget", created(await create(c.petter, FTR, { local_group_id: oslo })), "avvist");
    } finally {
      await c.petter.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: trondelag });
    }
    expect("tilbake i Trøndelag: tilgangen kommer IKKE tilbake av seg selv", await isGranted(trondelag, ids.petter), false);
    expect("tilbake i Trøndelag: ikke effektiv leder", await canLead(c.petter, trondelag), false);
    expect("tilbake i Trøndelag: kan ikke opprette", created(await create(c.petter, FTR, { local_group_id: trondelag })), "avvist");
    expect("tilbake i Trøndelag: kan ikke administrere sitt gamle arrangement", await canManage(c.petter, own.id!), false);
    await regrant();
    expect("først etter ny utnevnelse: leder igjen", await canLead(c.petter, trondelag), true);

    // Leaving the lokallag altogether.
    try {
      await setPetter({ local_group_id: null });
      expect("å forlate lokallaget sletter ledertilgangen", await isGranted(trondelag, ids.petter), false);
    } finally {
      await setPetter({ local_group_id: trondelag });
    }
    expect("tilbake: ingen stille gjenoppretting", await isGranted(trondelag, ids.petter), false);
    await regrant();

    // The membership stopping being active (membership_status has no
    // "removed"; anything but 'active' is inactive).
    try {
      await setPetter({ status: "invited" });
      expect("inaktivt medlemskap sletter ledertilgangen", await isGranted(trondelag, ids.petter), false);
    } finally {
      await setPetter({ status: "active" });
    }
    expect("aktiv igjen: ingen stille gjenoppretting", await isGranted(trondelag, ids.petter), false);
    await regrant();

    // The lokallag being retired.
    try {
      expect("admin legger ned FTR Trøndelag", (await c.miaminge.rpc("set_local_group_active", { p_local_group_id: trondelag, p_active: false })).data, true);
      expect("nedlagt lokallag: ledertilgangen er slettet", await isGranted(trondelag, ids.petter), false);
    } finally {
      await c.miaminge.rpc("set_local_group_active", { p_local_group_id: trondelag, p_active: true });
    }
    expect("gjenåpnet lokallag: ingen stille gjenoppretting", await isGranted(trondelag, ids.petter), false);
    await regrant();

    expect("TU-ledertilgangen er urørt av alt dette", await isGranted(tuTrondelag!.id, ids.petter), true);
  } finally {
    await revoke(c.emmamortensen, tuTrondelag!.id, ids.petter);
    if (!(await isGranted(trondelag, ids.petter))) await grant(c.miaminge, trondelag, ids.petter);
  }

  // ── The administration UI's flows (Lokallag → Administrer lokallag) ───
  //
  // The panel reads the grant table and the member list as the admin, and
  // writes only through add/remove_local_group_manager — the same calls below.
  {
    const { data: adminGrants } = await c.miaminge.from("community_local_group_managers").select("user_id").eq("local_group_id", trondelag);
    expect("UI: admin leser lederlisten for lokallaget", JSON.stringify((adminGrants ?? []).map((r) => r.user_id)), JSON.stringify([ids.petter]));
    const { data: adminMembers } = await c.miaminge.from("memberships").select("user_id").eq("community_id", FTR).eq("local_group_id", trondelag).eq("status", "active");
    expect("UI: admin ser hvem i lokallaget som kan utnevnes", (adminMembers ?? []).some((m) => m.user_id === ids.elironning), true);
    const { data: memberGrants } = await c.kristoffer.from("community_local_group_managers").select("user_id").eq("community_id", FTR);
    expect("UI: vanlig medlem får ingen lederliste", (memberGrants ?? []).length, 0);
    const { data: moderatorGrants } = await c.karimoen.from("community_local_group_managers").select("user_id").eq("community_id", FTR);
    expect("UI: moderator får ingen lederliste", (moderatorGrants ?? []).length, 0);

    // Multiple leaders for one lokallag.
    expect("UI: Eli har ingen rettigheter før utnevnelse", created(await create(c.elironning, FTR, { local_group_id: trondelag })), "avvist");
    expect("UI: admin utnevner Eli som andre leder i Trøndelag", await grant(c.miaminge, trondelag, ids.elironning), true);
    expect("UI: å utnevne samme person igjen er ufarlig", await grant(c.miaminge, trondelag, ids.elironning), true);
    const { data: both } = await c.miaminge.from("community_local_group_managers").select("user_id").eq("local_group_id", trondelag);
    expect("UI: lokallaget har nå to ledere", (both ?? []).length, 2);
    expect("UI: Petter er fortsatt leder", await canLead(c.petter, trondelag), true);
    expect("UI: Eli er leder", await canLead(c.elironning, trondelag), true);
    const eliEvent = await create(c.elironning, FTR, { local_group_id: trondelag });
    expect("UI: ny leder kan opprette for eget lokallag", created(eliEvent), "opprettet");
    expect("UI: ny leder er vert for sitt arrangement", eliEvent.hostId, ids.elironning);
    expect("UI: ny leder kan ikke opprette for Oslo", created(await create(c.elironning, FTR, { local_group_id: oslo })), "avvist");
    expect("UI: ny leder kan ikke opprette fellesskapsarrangement", created(await create(c.elironning, FTR)), "avvist");
    expect("UI: medleder kan administrere den andre lederens arrangement", await canManage(c.petter, eliEvent.id!), true);
    expect("UI: ny leder ser påmeldte i lokallaget", (await rosterNames(c.elironning, adminTrondelag.id!)).length, 1);

    // Refusals the panel's error message covers.
    expect("UI: lokallagsleder kan ikke utnevne", await grant(c.petter, trondelag, ids.karimoen), false);
    expect("UI: moderator kan ikke fjerne en leder", await revoke(c.karimoen, trondelag, ids.elironning), false);
    expect("UI: lokallagsleder kan ikke fjerne en annen leder", await revoke(c.petter, trondelag, ids.elironning), false);
    expect("UI: vanlig medlem kan ikke utnevne seg selv", await grant(c.kristoffer, oslo, ids.kristoffer), false);
    expect("UI: feil lokallag — Trøndelag-medlem kan ikke bli leder i Oslo", await grant(c.miaminge, oslo, ids.elironning), false);
    expect("UI: feil lokallag — Oslo-medlem kan ikke bli leder i Trøndelag", await grant(c.miaminge, trondelag, ids.kristoffer), false);
    expect("UI: FTR-admin kan ikke utnevne i TU", await grant(c.miaminge, (await admin.from("community_local_groups").select("id").eq("community_id", "tryggere-ungdom").eq("name", "TU Trøndelag").single()).data!.id, ids.petter), false);
    expect("UI: å fjerne noen som ikke er leder gir avvisning", await revoke(c.miaminge, trondelag, ids.karimoen), false);

    // Removing one leader leaves the other untouched.
    expect("UI: admin fjerner Eli som leder", await revoke(c.miaminge, trondelag, ids.elironning), true);
    expect("UI: Eli kan ikke lenger opprette", created(await create(c.elironning, FTR, { local_group_id: trondelag })), "avvist");
    expect("UI: Eli kan ikke lenger administrere sitt arrangement", await canManage(c.elironning, eliEvent.id!), false);
    expect("UI: Eli ser ikke lenger påmeldte", (await rosterNames(c.elironning, adminTrondelag.id!)).length, 0);
    expect("UI: Petter er fortsatt leder etter at Eli ble fjernet", await canLead(c.petter, trondelag), true);
    expect("UI: admin kan avlyse arrangementet Eli opprettet", await cancel(c.miaminge, eliEvent.id!), "avlyst");
  }

  // ── 11. Revocation is immediate ───────────────────────────────────────
  try {
    expect("11. admin fjerner Petter som leder", await revoke(c.miaminge, trondelag, ids.petter), true);
    expect("11. ikke lenger leder", await canLead(c.petter, trondelag), false);
    expect("11. kan ikke opprette", created(await create(c.petter, FTR, { local_group_id: trondelag })), "avvist");
    expect("11. kan ikke administrere eget arrangement", await canManage(c.petter, own.id!), false);
    expect("11. kan ikke endre eget arrangement", await update(c.petter, own.id!, { location: "Et annet sted" }), "avvist");
    expect("11. kan ikke avlyse eget arrangement", await cancel(c.petter, own.id!), "avvist");
    expect("11. ser ikke lenger listen for admin-opprettet lokallagsarrangement", (await rosterNames(c.petter, adminTrondelag.id!)).length, 0);
    // Being the host is not a standing right: he is still an ordinary
    // Trøndelag member and can read the event, but attendee identities follow
    // management, which he no longer has.
    expect("11. leser fortsatt arrangementet som vanlig medlem", Boolean((await c.petter.from("events").select("id").eq("id", own.id!).maybeSingle()).data), true);
    expect("11. ser ikke lenger påmeldte på sitt eget arrangement", (await rosterNames(c.petter, own.id!)).length, 0);
    expect("11. leser bare sin egen påmeldingsrad direkte", ((await c.petter.from("event_attendees").select("user_id").eq("event_id", own.id!)).data ?? []).length, 0);
    expect("11. får fortsatt antallet", (await c.petter.rpc("event_attendance", { p_event_ids: [own.id!] })).data?.[0]?.attendee_count, 1);
  } finally {
    expect("11. admin utnevner Petter igjen", await grant(c.miaminge, trondelag, ids.petter), true);
  }
  expect("11. leder igjen etter ny utnevnelse", await canLead(c.petter, trondelag), true);

  expect("leder kan avlyse eget arrangement", await cancel(c.petter, own.id!), "avlyst");
  const { count: rsvpsLeft } = await admin.from("event_attendees").select("user_id", { count: "exact", head: true }).eq("event_id", own.id!);
  expect("avlysning fjerner påmeldingene med arrangementet", rsvpsLeft, 0);

  await cleanup();
  const { count: leftovers } = await admin.from("events").select("id", { count: "exact", head: true }).like("title", `${MARK}%`);
  expect("opprydding: ingen testarrangementer igjen", leftovers, 0);
  expect("opprydding: Petter er leder for Trøndelag", await isGranted(trondelag, ids.petter), true);
  const { data: petterMembership } = await admin.from("memberships").select("local_group_id").eq("community_id", FTR).eq("user_id", ids.petter).single();
  expect("opprydding: Petter er i Trøndelag", petterMembership?.local_group_id, trondelag);
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
    console.log(`✓ ${checks} kontroller av lokallagsledere passerte`);
    console.log("  admin: alle omfang; lokallagsleder: eget lokallag; moderator og medlem: ingen");
  });
