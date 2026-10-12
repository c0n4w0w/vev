/**
 * Checks the Step 1B collaboration flow: the product surfaces built on the
 * Step 1A trust model (`check:collaborations`, which stays the contract).
 *
 * Run with `npm run check:collaboration-flow` against the local stack after
 * `npm run seed`. Every permission check runs as a signed-in fixture account
 * through the anon key, issuing the SAME reads and RPCs the pages and server
 * actions issue (`lib/collaboration-data.ts`, `getCommunityMembers()`,
 * `getLocalGroups()`), so a pass means the database — not a hidden button —
 * holds the line. The invite-target parser is imported and exercised directly.
 *
 * The scenario is the one Step 1B was specified with: Tryggere Ungdom starts a
 * collaboration, invites Tryggere Ruspolitikk by its exact TING address, FTR
 * takes part through its Oslo lokallag, picks an Oslo organiser from its own
 * people, and the organiser joins under a collaboration-only name. Nothing is
 * seeded permanently; every collaboration made here is deleted afterwards and
 * every membership, local group and profile touched is put back.
 *
 * Numbers follow the Step 1B checklist.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { parseCollaborationTarget } from "@/lib/collaboration-target";
import { decodeUnit, encodeUnit, slugFromName } from "@/lib/collaboration-form";
import { PLATFORM_LOCALE } from "@/lib/i18n/locales";
import { nb } from "@/lib/i18n/nb";
import { en } from "@/lib/i18n/en";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
const nullable = <T>(value: T | null) => value as T;

function sql(query: string): string {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  return execFileSync(
    "docker",
    ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-tAX", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`ukjent handle ${handle}: ${error.message}`);
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties!.hashed_token });
  if (error) throw error;
  return client;
}

function seen(result: { data: unknown[] | null; error: { message: string } | null }): number | string {
  return result.error ? `feil: ${result.error.message}` : (result.data ?? []).length;
}

// ── The page/action data paths, verbatim in shape ───────────────────────

async function create(client: Client, communityId: string, localGroupId: string | null, name: string) {
  const { data, error } = await client.rpc("create_collaboration", {
    p_source_community_id: communityId,
    p_source_local_group_id: nullable(localGroupId),
    p_name: name,
    p_slug: slugFromName(name) ?? "samarbeid",
    p_description: nullable<string>(null),
  });
  if (!error && data) created.add(data);
  return error ? null : (data ?? null);
}

async function inviteBySlug(client: Client, collaborationId: string, slug: string) {
  const { data, error } = await client.rpc("invite_collaboration_participant_by_slug", {
    p_collaboration_id: collaborationId,
    p_slug: slug,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return { error, participantId: row?.participant_id ?? null, name: row?.community_name ?? null, raw: row };
}

async function units(client: Client, collaborationId: string) {
  const { data, error } = await client.rpc("collaboration_units", { p_collaboration_id: collaborationId });
  return error ? [] : (data ?? []);
}

async function accept(client: Client, participantId: string, localGroupId: string | null) {
  const { data, error } = await client.rpc("accept_collaboration_participant_invite", {
    p_participant_id: participantId,
    p_local_group_id: nullable(localGroupId),
  });
  return !error && data === true;
}

async function decline(client: Client, participantId: string) {
  const { data, error } = await client.rpc("decline_collaboration_participant_invite", {
    p_participant_id: participantId,
  });
  return !error && data === true;
}

async function sponsor(client: Client, collaborationId: string, participantId: string, userId: string) {
  const { data, error } = await client.rpc("invite_collaboration_member", {
    p_collaboration_id: collaborationId,
    p_participant_id: participantId,
    p_target_user_id: userId,
  });
  return error ? null : (data ?? null);
}

async function acceptAndJoin(client: Client, sponsorshipId: string) {
  const { data, error } = await client.rpc("accept_collaboration_sponsorship_and_join", {
    p_sponsorship_id: sponsorshipId,
  });
  return !error && data === true;
}

async function upsertProfile(client: Client, collaborationId: string, name: string, bio: string) {
  const { data, error } = await client.rpc("upsert_my_collaboration_profile", {
    p_collaboration_id: collaborationId,
    p_display_name: name,
    p_bio: bio,
  });
  return !error && data === true;
}

async function rpcBool(client: Client, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name as never, args as never);
  return !error && data === true;
}

const hasAccess = (c: Client, id: string) => rpcBool(c, "has_collaboration_access", { p_collaboration_id: id });
const isManager = (c: Client, id: string) => rpcBool(c, "is_collaboration_manager", { p_collaboration_id: id });

/** `getCommunitiesForUser` + role filter + `getLocalGroups`: what /collaborations/new offers. */
async function representableUnits(client: Client, userId: string) {
  const { data: memberships } = await client
    .from("memberships")
    .select("community_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "admin");
  const result: string[] = [];
  for (const membership of memberships ?? []) {
    result.push(encodeUnit(membership.community_id));
    const { data: groups } = await client
      .from("community_local_groups")
      .select("id, active")
      .eq("community_id", membership.community_id);
    for (const group of groups ?? []) if (group.active) result.push(encodeUnit(membership.community_id, group.id));
  }
  return result;
}

/** `getOrganizerCandidates()`: the representative's own registry, narrowed to the unit. */
async function organizerCandidates(client: Client, communityId: string, localGroupId: string | null) {
  const { data, error } = await client
    .from("memberships")
    .select("user_id, status, local_group_id")
    .eq("community_id", communityId)
    .eq("status", "active");
  if (error) return `feil: ${error.message}`;
  return (data ?? [])
    .filter((row) => !localGroupId || row.local_group_id === localGroupId)
    .map((row) => row.user_id)
    .sort();
}

/** `getCollaborationTeam()`: members joined with collaboration profiles, nothing else. */
async function team(client: Client, collaborationId: string) {
  const [{ data: members }, { data: profiles }] = await Promise.all([
    client.from("collaboration_members").select("user_id").eq("collaboration_id", collaborationId).eq("status", "active"),
    client.from("collaboration_profiles").select("user_id, display_name, bio").eq("collaboration_id", collaborationId),
  ]);
  const joined = new Set((members ?? []).map((row) => row.user_id));
  return (profiles ?? []).filter((row) => joined.has(row.user_id) && row.display_name);
}

/** `getPersonaStartingPoints()`: own accepted sponsorships → active units → own community profiles. */
async function startingPoints(client: Client, collaborationId: string, userId: string) {
  const { data: sponsorships } = await client
    .from("collaboration_member_sponsorships")
    .select("participant_id, status")
    .eq("user_id", userId)
    .eq("collaboration_id", collaborationId);
  const visible = await units(client, collaborationId);
  const communities = new Set<string>();
  for (const s of sponsorships ?? []) {
    if (s.status !== "accepted") continue;
    const unit = visible.find((u) => u.participant_id === s.participant_id && u.status === "active");
    if (unit) communities.add(unit.community_id);
  }
  const { data: profiles } = await client.from("community_profiles").select("community_id").eq("user_id", userId);
  return (profiles ?? []).map((p) => p.community_id).filter((id) => communities.has(id)).sort();
}

// ── Restore bookkeeping ─────────────────────────────────────────────────

const created = new Set<string>();
const memberships = new Map<string, { role: string; status: string; local_group_id: string | null }>();
const groups = new Map<string, boolean>();
const communityProfiles = new Map<string, { display_name: string; bio: string }>();

async function remember(userId: string, communityId: string) {
  const { data } = await admin
    .from("memberships")
    .select("id, role, status, local_group_id")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .single();
  if (data && !memberships.has(data.id)) memberships.set(data.id, data);
}

async function rememberGroup(id: string) {
  if (groups.has(id)) return;
  const { data } = await admin.from("community_local_groups").select("active").eq("id", id).single();
  groups.set(id, data!.active);
}

async function rememberProfile(userId: string, communityId: string) {
  const key = `${communityId}|${userId}`;
  if (communityProfiles.has(key)) return;
  const { data } = await admin
    .from("community_profiles")
    .select("display_name, bio")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .single();
  communityProfiles.set(key, data!);
}

async function restore() {
  for (const [id, row] of [...memberships].reverse()) {
    await admin
      .from("memberships")
      .update({ role: row.role as never, status: row.status as never, local_group_id: row.local_group_id })
      .eq("id", id);
  }
  for (const [id, active] of groups) await admin.from("community_local_groups").update({ active }).eq("id", id);
  for (const [key, row] of communityProfiles) {
    const [communityId, userId] = key.split("|");
    await admin.from("community_profiles").update(row).eq("community_id", communityId).eq("user_id", userId);
  }
  if (created.size > 0) await admin.from("collaborations").delete().in("id", [...created]);
}

// ── Source scan for the service-role check ──────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

// ── Checks ──────────────────────────────────────────────────────────────

async function main() {
  const ids = {
    emma: await profileId("emmamortensen"),
    hanne: await profileId("hanne"),
    adrian: await profileId("adrian"),
    petter: await profileId("petter"),
    ingrid: await profileId("ingrid"),
    miaminge: await profileId("miaminge"),
    amina: await profileId("amina"),
    kristoffer: await profileId("kristoffer"),
    kari: await profileId("karimoen"),
    octavio: await profileId("octavio"),
  };
  const allGroups = (await admin.from("community_local_groups").select("id, name, community_id")).data ?? [];
  const group = (name: string) => allGroups.find((g) => g.name === name)!.id;
  const OSLO = group("FTR Oslo");
  const TRONDELAG = group("FTR Trøndelag");
  const AKERSHUS = group("FTR Akershus");
  const TU_OSLO = group("TU Oslo");

  const everyone = Object.values(ids);
  const snapshot = async () =>
    JSON.stringify([
      (await admin.from("community_profiles").select("community_id, user_id, display_name, bio, avatar_path").in("user_id", everyone).order("user_id").order("community_id")).data,
      (await admin.from("profiles").select("*").in("id", everyone).order("id")).data,
    ]);
  const before = await snapshot();

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const emma = await signIn("emmamortensen");
  const hanne = await signIn("hanne");
  const adrian = await signIn("adrian");
  const petter = await signIn("petter");
  const ingrid = await signIn("ingrid");
  const miaminge = await signIn("miaminge");
  const amina = await signIn("amina");
  const kristoffer = await signIn("kristoffer");
  const kari = await signIn("karimoen");
  const octavio = await signIn("octavio");

  // ══ CREATE (1–4) ══════════════════════════════════════════════════════

  const emmaUnits = await representableUnits(emma, ids.emma);
  expect("1: TU-admin tilbys bare TU-enheter", emmaUnits.every((u) => decodeUnit(u)?.communityId === TU), true);
  expect("1: TU-admin tilbys hele TU pluss TUs aktive lokallag", emmaUnits.includes(encodeUnit(TU)) && emmaUnits.includes(encodeUnit(TU, TU_OSLO)), true);
  const miaUnits = await representableUnits(miaminge, ids.miaminge);
  expect("1: FTR-admin tilbys FTR Oslo selv uten å være Oslo-medlem", miaUnits.includes(encodeUnit(FTR, OSLO)), true);
  expect("2: FTR-admin tilbys ingen TU-enheter", miaUnits.some((u) => decodeUnit(u)?.communityId !== FTR), false);
  expect("2: moderator tilbys ingen enheter", (await representableUnits(hanne, ids.hanne)).length, 0);
  expect("2: TU-admin kan ikke lese FTRs lokallag", seen(await emma.from("community_local_groups").select("id").eq("community_id", FTR)), 0);

  const C_ftr = await create(miaminge, FTR, OSLO, "FTR Oslo planlegger");
  expect("3: opprettet fra FTR Oslo", typeof C_ftr, "string");
  expect("3: representasjon av lokallag gir forvalterrett", await isManager(miaminge, C_ftr!), true);
  expect("3: …men ikke arrangørtilgang", await hasAccess(miaminge, C_ftr!), false);

  expect("4: slug fra navn", slugFromName("Seminar – Cannabismarkedet"), "seminar-cannabismarkedet");
  expect("4: slug med æøå", slugFromName("Kulturnatt på Grünerløkka"), "kulturnatt-pa-grunerlokka");
  expect("4: navn uten brukbar slug gir ingen slug", slugFromName("!!"), "undefined");
  const C = await create(emma, TU, null, "Seminar – cannabismarkedet");
  const C_again = await create(emma, TU, null, "Seminar – cannabismarkedet");
  const slugs = (await admin.from("collaborations").select("id, slug").in("id", [C!, C_again!])).data ?? [];
  expect("4: generert slug", slugs.find((r) => r.id === C)?.slug, "seminar-cannabismarkedet");
  expect("4: kollisjon får suffiks, ikke feil", /^seminar-cannabismarkedet-[0-9a-f]{6}$/.test(slugs.find((r) => r.id === C_again)?.slug ?? ""), true);
  const C_bang = await create(emma, TU, null, "!!!");
  expect("4: navn uten slug får nøytral slug", (await admin.from("collaborations").select("slug").eq("id", C_bang!).single()).data?.slug.startsWith("samarbeid"), true);

  // ══ EXACT ORGANISATION INVITE (5–10) ═════════════════════════════════

  const hosts = ["join-ting.no", "www.join-ting.no", "localhost:3000"];
  const parse = (value: string) => {
    const result = parseCollaborationTarget(value, hosts);
    return result.ok ? result.slug : "avvist";
  };
  expect("5: bar slug", parse("tryggere-ruspolitikk"), "tryggere-ruspolitikk");
  expect("5: store bokstaver og mellomrom normaliseres", parse("  Tryggere-Ruspolitikk "), "tryggere-ruspolitikk");
  expect("5: portal-URL uten skjema", parse("join-ting.no/tryggere-ruspolitikk"), "tryggere-ruspolitikk");
  expect("5: portal-URL med https", parse("https://join-ting.no/tryggere-ruspolitikk"), "tryggere-ruspolitikk");
  expect("5: portal-URL med avsluttende skråstrek og spørring", parse("https://www.join-ting.no/tryggere-ruspolitikk/?ref=x"), "tryggere-ruspolitikk");
  expect("5: denne installasjonens egen vert", parse("http://localhost:3000/tryggere-ruspolitikk"), "tryggere-ruspolitikk");
  expect("8: ekstern vert avvises", parse("https://evil.example/tryggere-ruspolitikk"), "avvist");
  expect("8: liknende vertsnavn avvises", parse("https://join-ting.no.evil.example/tryggere-ruspolitikk"), "avvist");
  expect("8: brukernavn-triks avvises", parse("https://join-ting.no@evil.example/tryggere-ruspolitikk"), "avvist");
  expect("8: annet skjema avvises", parse("javascript://join-ting.no/tryggere-ruspolitikk"), "avvist");
  expect("8: dypere sti avvises", parse("https://join-ting.no/tryggere-ruspolitikk/feed"), "avvist");
  expect("8: sti-traversering avvises", parse("https://join-ting.no/../tryggere-ruspolitikk/x"), "avvist");
  expect("8: kodet skråstrek avvises", parse("https://join-ting.no/tryggere%2Fruspolitikk"), "avvist");
  expect("8: mellomrom i slug avvises", parse("tryggere ruspolitikk"), "avvist");
  expect("8: tomt avvises", parse("   "), "avvist");
  expect("8: bare vert avvises", parse("https://join-ting.no/"), "avvist");
  expect("8: jokertegn avvises", parse("tryggere%"), "avvist");

  const partial = await inviteBySlug(emma, C!, "tryggere");
  expect("6: delvis slug gir ingen treff og intet navn", `${partial.participantId}|${partial.name}`, "null|null");
  const prefix = await inviteBySlug(emma, C!, "tryggere-rus");
  expect("6: prefiks gir ingen treff", `${prefix.participantId}|${prefix.name}`, "null|null");
  const wildcard = await inviteBySlug(emma, C!, "tryggere-%");
  expect("6/70: jokertegn søker ikke", `${wildcard.participantId}|${wildcard.name}`, "null|null");
  const unknown = await inviteBySlug(emma, C!, "finnes-ikke");
  expect("7: ukjent slug gir samme generiske svar", `${unknown.participantId}|${unknown.name}|${unknown.error}`, "null|null|null");
  const outsider = await inviteBySlug(adrian, C!, FTR);
  expect("7: ikke-forvalter får samme svar for eksisterende slug (intet orakel)", `${outsider.participantId}|${outsider.name}`, "null|null");
  const stranger = await inviteBySlug(octavio, C!, FTR);
  expect("7: utenforstående får samme svar", `${stranger.participantId}|${stranger.name}`, "null|null");
  const anonInvite = await anon.rpc("invite_collaboration_participant_by_slug", { p_collaboration_id: C!, p_slug: FTR });
  expect("7: anonym kan ikke kalle", anonInvite.error !== null, true);

  const invited = await inviteBySlug(emma, C!, "  TRYGGERE-RUSPOLITIKK ");
  expect("5: eksakt mål (normalisert) virker", typeof invited.participantId, "string");
  expect("5: navnet vises etter vellykket invitasjon", invited.name, "Tryggere Ruspolitikk");
  expect(
    "9/10: svaret har bare deltaker-id og navn",
    Object.keys(invited.raw ?? {}).sort().join(),
    "community_name,participant_id",
  );
  expect(
    "9/10: funksjonens resultat har ingen andre felt (katalog)",
    sql("select pg_get_function_arguments('public.invite_collaboration_participant_by_slug(uuid,text)'::regprocedure)"),
    "p_collaboration_id uuid, p_slug text, OUT participant_id uuid, OUT community_name text",
  );
  const P_FTR = invited.participantId!;
  const dup = await inviteBySlug(emma, C!, FTR);
  expect("7: dobbel invitasjon gir samme generiske svar", `${dup.participantId}|${dup.name}`, "null|null");
  const emmaView = (await units(emma, C!)).find((u) => u.participant_id === P_FTR);
  expect("9: inviterende ser ventende FTR uten lokallag", `${emmaView?.status}|${emmaView?.local_group_id}|${emmaView?.local_group_name}`, "invited|null|null");
  expect("9: inviterende kan fortsatt ikke lese FTRs lokallag", seen(await emma.from("community_local_groups").select("id").eq("community_id", FTR)), 0);
  expect("10: inviterende ser ingen FTR-medlemmer", seen(await emma.from("memberships").select("id").eq("community_id", FTR)), 0);

  // A second pending invitation the FTR representative must not see.
  const utrInvite = await inviteBySlug(emma, C!, UTR);
  expect("oppsett: UTR invitert også", typeof utrInvite.participantId, "string");

  // ══ ORGANISATION INBOX (11–14) ════════════════════════════════════════

  const inbox = async (client: Client) =>
    (await units(client, C!)).filter((u) => u.status === "invited" && u.represented).map((u) => u.participant_id);
  expect("11: nåværende FTR-admin ser invitasjonen", (await inbox(miaminge)).join(), P_FTR);
  expect("11: FTR-admin ser aktive deltakere (TU) mens hun vurderer", (await units(miaminge, C!)).some((u) => u.community_name === "Tryggere Ungdom" && u.status === "active"), true);
  expect("11: FTR-admin ser ikke UTRs ventende invitasjon", (await units(miaminge, C!)).some((u) => u.participant_id === utrInvite.participantId), false);
  expect("11: FTR-admin får ikke TUs lokallag-id", (await units(miaminge, C!)).every((u) => u.community_id === FTR || u.local_group_id === null), true);
  expect("12: FTR-moderator ser den ikke", (await inbox(kari)).length, 0);
  expect("12: FTR-moderator ser ikke samarbeidet", seen(await kari.from("collaborations").select("id").eq("id", C!)), 0);
  await remember(ids.miaminge, FTR);
  await remember(ids.kari, FTR);
  await admin.from("memberships").update({ role: "member" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.kari).eq("community_id", FTR);
  expect("13: tidligere admin ser ikke invitasjonen etter skifte", (await inbox(miaminge)).length, 0);
  expect("14: ny admin ser den uten synkronisering", (await inbox(kari)).join(), P_FTR);
  await admin.from("memberships").update({ role: "moderator" }).eq("user_id", ids.kari).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.miaminge).eq("community_id", FTR);

  // ══ PENDING-INVITEE EXCEPTION (P1–P12) ═══════════════════════════════
  //
  // `collaboration_units()` deliberately lets the representative of an
  // organisation with a PENDING invitation see the labels of units ALREADY
  // taking part — an organisation must know who it would be working with
  // before it says yes. This pins how narrow that is: active units only,
  // labels only, no ids, and nothing else of the collaboration.
  //
  // Setup: TU starts it through its own local group TU Oslo; UTR joins and
  // withdraws (left), is invited again and declines (declined), and is invited
  // a third time (pending); FTR is invited (pending); TU sponsors one person.
  const C_vis = await create(emma, TU, TU_OSLO, "Synlighet for inviterte");
  const P_utr1 = (await inviteBySlug(emma, C_vis!, UTR)).participantId!;
  await accept(octavio, P_utr1, null);
  await rpcBool(octavio, "leave_collaboration_as_participant", { p_participant_id: P_utr1 });
  const P_utr2 = (await inviteBySlug(emma, C_vis!, UTR)).participantId!;
  await decline(octavio, P_utr2);
  const P_utr3 = (await inviteBySlug(emma, C_vis!, UTR)).participantId!;
  const P_ftrVis = (await inviteBySlug(emma, C_vis!, FTR)).participantId!;
  const P_tuOslo = (await units(emma, C_vis!)).find((u) => u.community_id === TU)!.participant_id;
  await sponsor(emma, C_vis!, P_tuOslo, ids.hanne);
  const statuses = ((await admin.from("collaboration_participants").select("status").eq("collaboration_id", C_vis!)).data ?? []).map((r) => r.status).sort().join();
  expect("P: (oppsett) aktiv, forlatt, avslått og to ventende rader finnes", statuses, "active,declined,invited,invited,left");

  const pendingView = await units(miaminge, C_vis!);
  const own = pendingView.filter((u) => u.represented);
  const labels = pendingView.filter((u) => !u.represented);
  expect("P1: ventende invitert ser nøyaktig egen invitasjon + aktive enheter", pendingView.length, 2);
  expect("P2: egen invitasjon har id og er representert", `${own[0]?.participant_id}|${own[0]?.status}`, `${P_ftrVis}|invited`);
  expect("P3: aktiv enhet vises som etikett «Tryggere Ungdom – TU Oslo»", `${labels[0]?.community_name} – ${labels[0]?.local_group_name}|${labels[0]?.status}`, "Tryggere Ungdom – TU Oslo|active");
  expect("P3: etiketten har ingen deltaker-, fellesskaps- eller lokallag-id", `${labels[0]?.participant_id}|${labels[0]?.community_id}|${labels[0]?.local_group_id}`, "null|null|null");
  expect("P4: ingen andre ventende invitasjoner vises", pendingView.filter((u) => u.status === "invited" && !u.represented).length, 0);
  expect("P4: ingen avslåtte eller forlatte enheter vises", pendingView.some((u) => u.status === "declined" || u.status === "left"), false);
  expect("P5: ingen UTR-rad av noe slag", pendingView.some((u) => u.community_name === "Under The Rug"), false);
  expect("P5: ingen av UTRs deltaker-id-er lekker", pendingView.some((u) => [P_utr1, P_utr2, P_utr3].includes(u.participant_id)), false);
  expect("P6: tabellen viser fortsatt bare egen rad", seen(await miaminge.from("collaboration_participants").select("id").eq("collaboration_id", C_vis!)), 1);
  expect("P7: ingen sponsinger", seen(await miaminge.from("collaboration_member_sponsorships").select("id").eq("collaboration_id", C_vis!)), 0);
  expect("P7: ingen forvalterplass-proveniens", seen(await miaminge.from("collaboration_manager_participants").select("participant_id").eq("collaboration_id", C_vis!)), 0);
  expect("P7: ingen teammedlemmer eller profiler", `${seen(await miaminge.from("collaboration_members").select("user_id").eq("collaboration_id", C_vis!))}|${seen(await miaminge.from("collaboration_profiles").select("user_id").eq("collaboration_id", C_vis!))}`, "0|0");
  expect("P8: ingen av TUs lokallag", seen(await miaminge.from("community_local_groups").select("id").eq("community_id", TU)), 0);
  expect("P8: ingen TU-medlemskap eller -tall", `${seen(await miaminge.from("memberships").select("id").eq("community_id", TU))}|${seen(await miaminge.rpc("local_group_member_counts", { p_community_id: TU }))}`, "0|0");
  expect("P9: etikett-raden har bare navn og offentlig merke", Object.entries(labels[0] ?? {}).filter(([, v]) => v !== null).map(([k]) => k).sort().join(), "accent,community_name,local_group_name,mark_style,monogram,represented,status");
  expect("P11: FTR-moderator uten representasjon får ingenting", (await units(kari, C_vis!)).length, 0);
  await admin.from("memberships").update({ role: "member" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.kari).eq("community_id", FTR);
  expect("P12: tidligere admin mister unntaket umiddelbart", (await units(miaminge, C_vis!)).length, 0);
  expect("P12: ny admin får det uten synkronisering", (await units(kari, C_vis!)).filter((u) => !u.represented).length, 1);
  await admin.from("memberships").update({ role: "moderator" }).eq("user_id", ids.kari).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  expect("P10: etter aksept gjelder ordinære regler (ingen etikett-rader)", await accept(miaminge, P_ftrVis, null) && (await units(miaminge, C_vis!)).every((u) => u.participant_id !== null), true);

  // ══ ACCEPTANCE (15–20) ════════════════════════════════════════════════

  const larsGroups = (await miaminge.from("community_local_groups").select("id, community_id")).data ?? [];
  expect("15: mottaker ser bare egne lokallag i valget", larsGroups.every((g) => g.community_id === FTR) && larsGroups.length > 0, true);
  expect("20: inviterende kan ikke velge for FTR", await accept(emma, P_FTR, OSLO), false);
  expect("18: et annet fellesskaps lokallag avvises", await accept(miaminge, P_FTR, TU_OSLO), false);
  await rememberGroup(AKERSHUS);
  await miaminge.rpc("set_local_group_active", { p_local_group_id: AKERSHUS, p_active: false });
  expect("19: avviklet lokallag avvises", await accept(miaminge, P_FTR, AKERSHUS), false);
  await miaminge.rpc("set_local_group_active", { p_local_group_id: AKERSHUS, p_active: true });
  expect("17: FTR deltar som FTR Oslo", await accept(miaminge, P_FTR, OSLO), true);
  const P_OSLO = P_FTR;
  const osloRow = (await admin.from("collaboration_participants").select("community_id, local_group_id, status").eq("id", P_OSLO).single()).data;
  expect("17: enheten er FTR / FTR Oslo", `${osloRow?.community_id}|${osloRow?.local_group_id}|${osloRow?.status}`, `${FTR}|${OSLO}|active`);
  expect("17: representanten forvalter, men er ikke arrangør", `${await isManager(miaminge, C!)}|${await hasAccess(miaminge, C!)}`, "true|false");
  const emmaSeesOslo = (await units(emma, C!)).find((u) => u.participant_id === P_OSLO);
  expect("17: TU ser navnet «FTR Oslo», men ikke lokallag-id", `${emmaSeesOslo?.local_group_name}|${emmaSeesOslo?.local_group_id}`, "FTR Oslo|null");

  const C_whole = await create(emma, TU, null, "Helorganisasjon-test");
  const P_whole = (await inviteBySlug(emma, C_whole!, FTR)).participantId!;
  expect("16: FTR deltar som hele organisasjonen", await accept(miaminge, P_whole, null), true);
  const wholeRow = (await admin.from("collaboration_participants").select("local_group_id").eq("id", P_whole).single()).data;
  expect("16: helorganisasjon har intet lokallag", wholeRow?.local_group_id, null);
  const P_decl = (await inviteBySlug(emma, C_whole!, UTR)).participantId!;
  expect("16: UTR kan takke nei", await decline(octavio, P_decl), true);

  // ══ ORGANIZER PICKER (21–25) ══════════════════════════════════════════

  const truthOslo = ((await admin.from("memberships").select("user_id").eq("community_id", FTR).eq("status", "active").eq("local_group_id", OSLO)).data ?? []).map((r) => r.user_id).sort();
  expect("21/22: representanten ser nøyaktig FTR Oslos aktive medlemmer", JSON.stringify(await organizerCandidates(miaminge, FTR, OSLO)), JSON.stringify(truthOslo));
  expect("22: Oslo-listen inneholder Kristoffer og Amina", truthOslo.includes(ids.kristoffer) && truthOslo.includes(ids.amina), true);
  expect("23: TU-forvalter får ingen FTR Oslo-kandidater", JSON.stringify(await organizerCandidates(emma, FTR, OSLO)), "[]");
  expect("23: FTR-representant får ingen TU-kandidater", JSON.stringify(await organizerCandidates(miaminge, TU, null)), "[]");
  expect("24: forvalterrett gir ingen FTR-medlemsliste", seen(await emma.from("memberships").select("id").eq("local_group_id", OSLO)), 0);
  expect("24: forvalterrett gir ingen FTR-profiler", seen(await emma.from("community_profiles").select("user_id").eq("community_id", FTR)), 0);
  expect("24: TU kan ikke sponse via FTR Oslo selv med forvalterrett", await sponsor(emma, C!, P_OSLO, ids.kristoffer), null);
  await remember(ids.kristoffer, FTR);
  await kristoffer.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: TRONDELAG });
  expect("25: medlemsdata er kilden — flyttet medlem forsvinner fra listen", (await organizerCandidates(miaminge, FTR, OSLO) as string[]).includes(ids.kristoffer), false);
  await kristoffer.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: OSLO });
  expect("25: …og kommer tilbake", (await organizerCandidates(miaminge, FTR, OSLO) as string[]).includes(ids.kristoffer), true);

  // ══ PERSON INVITE (26–32) ═════════════════════════════════════════════

  const S_k = await sponsor(miaminge, C!, P_OSLO, ids.kristoffer);
  expect("26: sponset person ser egen invitasjon", seen(await kristoffer.from("collaboration_member_sponsorships").select("id").eq("id", S_k!)), 1);
  expect("26: …og enheten som valgte ham", (await units(kristoffer, C!)).map((u) => u.participant_id).join(), P_OSLO);
  expect("27: andre ser den ikke", seen(await amina.from("collaboration_member_sponsorships").select("id").eq("id", S_k!)), 0);
  expect("27: TU-admin ser den ikke", seen(await emma.from("collaboration_member_sponsorships").select("id").eq("id", S_k!)), 0);
  expect("27: andre kan ikke akseptere den", await acceptAndJoin(amina, S_k!), false);
  expect("27: sponsor kan ikke akseptere den", await acceptAndJoin(miaminge, S_k!), false);
  expect("28: takk ja og bli med virker", await acceptAndJoin(kristoffer, S_k!), true);
  expect("28: tilgang etterpå", await hasAccess(kristoffer, C!), true);
  expect("30: nytt forsøk er trygt", await acceptAndJoin(kristoffer, S_k!), true);
  expect("30: ingen doble rader", seen(await admin.from("collaboration_members").select("user_id").eq("collaboration_id", C!).eq("user_id", ids.kristoffer)), 1);

  const P_TU = (await units(emma, C!)).find((u) => u.community_id === TU)!.participant_id;
  const S_p = await sponsor(emma, C!, P_TU, ids.petter);
  expect("29: avslag virker", await rpcBool(petter, "respond_to_collaboration_sponsorship", { p_sponsorship_id: S_p, p_accept: false }), true);
  expect("29: kan ikke bli med etter avslag", await acceptAndJoin(petter, S_p!), false);

  const S_a = await sponsor(emma, C!, P_TU, ids.adrian);
  await rpcBool(emma, "revoke_collaboration_sponsorship", { p_sponsorship_id: S_a });
  expect("31: trukket invitasjon kan ikke aksepteres", await acceptAndJoin(adrian, S_a!), false);
  expect("31: ingen teamrad", seen(await admin.from("collaboration_members").select("user_id").eq("collaboration_id", C!).eq("user_id", ids.adrian)), 0);

  const S_am = await sponsor(miaminge, C!, P_OSLO, ids.amina);
  await remember(ids.amina, FTR);
  await amina.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: nullable<string>(null) });
  expect("32: tapt organisatorisk tilknytning kan ikke aksepteres", await acceptAndJoin(amina, S_am!), false);
  expect("32: atomisk — sponsingen er ikke halvveis akseptert", (await admin.from("collaboration_member_sponsorships").select("status").eq("id", S_am!).single()).data?.status, "invited");
  expect("32: ingen teamrad", seen(await admin.from("collaboration_members").select("user_id").eq("collaboration_id", C!).eq("user_id", ids.amina)), 0);
  await amina.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: OSLO });

  // ══ PROFILE (33–40) ═══════════════════════════════════════════════════

  expect("43: ingen profil opprettes automatisk ved å bli med", seen(await admin.from("collaboration_profiles").select("user_id").eq("collaboration_id", C!).eq("user_id", ids.kristoffer)), 0);
  expect("33: medlem kan opprette egen samarbeidsprofil", await upsertProfile(kristoffer, C!, "  Kris  ", "Lyd og logistikk."), true);
  const kp = (await admin.from("collaboration_profiles").select("display_name, bio").eq("collaboration_id", C!).eq("user_id", ids.kristoffer).single()).data;
  expect("37: navnet trimmes", kp?.display_name, "Kris");
  expect("34: ikke-medlem kan ikke", await upsertProfile(amina, C!, "Amina", ""), false);
  expect("35: forvalter uten teamplass kan ikke", await upsertProfile(miaminge, C!, "Mia", ""), false);
  expect("34: utenforstående kan ikke", await upsertProfile(octavio, C!, "Octavio", ""), false);
  const forged = await kristoffer.rpc("upsert_my_collaboration_profile" as never, {
    p_collaboration_id: C!, p_display_name: "Kapret", p_bio: "", p_user_id: ids.ingrid,
  } as never);
  expect("36: det finnes ingen bruker-parameter", forged.error !== null, true);
  const direct = await kristoffer.from("collaboration_profiles").update({ display_name: "Kapret" }).eq("user_id", ids.emma).select("user_id");
  expect("36: direkte skriving avvises", direct.error !== null || (direct.data ?? []).length === 0, true);
  expect("37: tomt navn avvises", await upsertProfile(kristoffer, C!, "   ", ""), false);
  expect("37: null-bredde-tegn er ikke et navn", await upsertProfile(kristoffer, C!, "​‍﻿", ""), false);
  expect("37: 81 tegn avvises", await upsertProfile(kristoffer, C!, "x".repeat(81), ""), false);
  expect("37: 80 tegn godtas", await upsertProfile(kristoffer, C!, "x".repeat(80), ""), true);
  expect("38: bio på 501 tegn avvises", await upsertProfile(kristoffer, C!, "Kris", "b".repeat(501)), false);
  expect("38: bio på 500 tegn godtas", await upsertProfile(kristoffer, C!, "Kris", "b".repeat(500)), true);
  await upsertProfile(kristoffer, C!, "Kris", "Lyd og logistikk.");

  // ══ PROFILE SOURCE (41–46) ════════════════════════════════════════════

  const S_i = await sponsor(emma, C!, P_TU, ids.ingrid);
  expect("oppsett: Ingrid blir med via TU", await acceptAndJoin(ingrid, S_i!), true);
  expect("41: utgangspunkt bare fra sponsende fellesskap (TU)", (await startingPoints(ingrid, C!, ids.ingrid)).join(), TU);
  expect("42: UTR- og FTR-profilen tilbys ikke", (await startingPoints(ingrid, C!, ids.ingrid)).some((c) => c !== TU), false);
  expect("41: andre kan ikke lese Ingrids sponsinger", seen(await kristoffer.from("collaboration_member_sponsorships").select("id").eq("user_id", ids.ingrid)), 0);
  expect("43: ingen samarbeidsprofil før hun velger", seen(await admin.from("collaboration_profiles").select("user_id").eq("collaboration_id", C!).eq("user_id", ids.ingrid)), 0);
  const tuProfile = (await ingrid.from("community_profiles").select("display_name, bio").eq("community_id", TU).eq("user_id", ids.ingrid).single()).data!;
  expect("44: kopiert utgangspunkt lagres", await upsertProfile(ingrid, C!, tuProfile.display_name, tuProfile.bio), true);
  await rememberProfile(ids.ingrid, TU);
  await ingrid.rpc("update_my_community_profile", { p_community_id: TU, p_display_name: "Endret i TU", p_bio: "Ny TU-bio" });
  const ip = (await admin.from("collaboration_profiles").select("display_name, bio").eq("collaboration_id", C!).eq("user_id", ids.ingrid).single()).data;
  expect("45: senere endring i TU endrer ikke samarbeidsprofilen", `${ip?.display_name}|${ip?.bio}`, `${tuProfile.display_name}|${tuProfile.bio}`);
  await upsertProfile(ingrid, C!, "Ingrid (seminar)", "Program og frivillige.");
  const tuAfter = (await admin.from("community_profiles").select("display_name").eq("community_id", TU).eq("user_id", ids.ingrid).single()).data;
  expect("46: samarbeidsendring endrer ikke TU-profilen", tuAfter?.display_name, "Endret i TU");
  await admin.from("community_profiles").update(tuProfile).eq("community_id", TU).eq("user_id", ids.ingrid);

  // ══ TEAM DIRECTORY (47–51) ════════════════════════════════════════════

  const view = await team(kristoffer, C!);
  expect("47: teamet vises med samarbeidsnavn", view.map((r) => r.display_name).sort().join("|"), ["Ingrid (seminar)", "Kris"].join("|"));
  expect("48: TU-admin (med, uten samarbeidsprofil) vises ikke under noe annet navn", view.some((r) => r.user_id === ids.emma), false);
  expect("48: kontoen til andre kan ikke leses", seen(await kristoffer.from("profiles").select("id").eq("id", ids.ingrid)), 0);
  expect("49: TU-profilen til Ingrid kan ikke leses av FTR-arrangør", seen(await kristoffer.from("community_profiles").select("user_id").eq("user_id", ids.ingrid).eq("community_id", TU)), 0);
  expect("49: FTR-profilen til Kristoffer kan ikke leses av TU-arrangør", seen(await ingrid.from("community_profiles").select("user_id").eq("user_id", ids.kristoffer).eq("community_id", FTR)), 1);
  // ^ Ingrid is also an FTR moderator: she sees FTR profiles through her OWN
  // FTR membership, which the collaboration neither grants nor widens. The
  // pure TU organiser below is the real test.
  const S_h = await sponsor(emma, C!, P_TU, ids.hanne);
  await acceptAndJoin(hanne, S_h!);
  await upsertProfile(hanne, C!, "H.", "");
  expect("49: ren TU-arrangør kan ikke lese Kristoffers FTR-profil", seen(await hanne.from("community_profiles").select("user_id").eq("user_id", ids.kristoffer)), 0);
  expect("49: …men ser ham i teamet som «Kris»", (await team(hanne, C!)).find((r) => r.user_id === ids.kristoffer)?.display_name, "Kris");
  expect("50: sponsingsopphav vises ikke for medlemmer", seen(await hanne.from("collaboration_member_sponsorships").select("id").eq("user_id", ids.kristoffer)), 0);
  expect("50: teamradene bærer ikke deltaker/enhet", Object.keys((await hanne.from("collaboration_members").select("*").eq("user_id", ids.kristoffer).single()).data ?? {}).sort().join(), "collaboration_id,joined_at,left_at,status,user_id");
  expect("51: FTR-medlemskap/rolle kan ikke leses av TU-arrangør", seen(await hanne.from("memberships").select("id").eq("community_id", FTR)), 0);
  expect("51: TU-medlemskap kan ikke leses av FTR-arrangør", seen(await kristoffer.from("memberships").select("id").eq("community_id", TU)), 0);

  // ══ MANAGER VS MEMBER (52–55) ═════════════════════════════════════════

  const larsInvite = await inviteBySlug(miaminge, C_ftr!, TU);
  expect("52: forvalter uten teamplass kan invitere organisasjon", larsInvite.name, "Tryggere Ungdom");
  expect("52: …og velge egne Oslo-folk", typeof (await sponsor(miaminge, C_ftr!, (await units(miaminge, C_ftr!)).find((u) => u.represented)!.participant_id, ids.kristoffer)), "string");
  expect("53: forvalter uten teamplass ser ikke teamet", seen(await miaminge.from("collaboration_members").select("user_id").eq("collaboration_id", C!)), 0);
  expect("53: …eller samarbeidsprofilene", seen(await miaminge.from("collaboration_profiles").select("user_id").eq("collaboration_id", C!)), 0);
  expect("54: arrangør uten representasjon kan ikke invitere", (await inviteBySlug(kristoffer, C!, "under-the-rug")).participantId, null);
  expect("54: …eller trekke enheten ut", await rpcBool(kristoffer, "leave_collaboration_as_participant", { p_participant_id: P_OSLO }), false);
  expect("54: …eller sponse", await sponsor(kristoffer, C!, P_OSLO, ids.amina), null);
  await admin.from("memberships").update({ role: "member" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.kari).eq("community_id", FTR);
  expect("55: arvtaker forvalter", `${await isManager(kari, C!)}|${await isManager(miaminge, C!)}`, "true|false");
  expect("55: arvtaker får «din enhet»-merking", (await units(kari, C!)).find((u) => u.participant_id === P_OSLO)?.represented, true);
  expect("55: tidligere admin mister den", (await units(miaminge, C!)).find((u) => u.participant_id === P_OSLO)?.represented ?? false, false);
  await admin.from("memberships").update({ role: "moderator" }).eq("user_id", ids.kari).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.miaminge).eq("community_id", FTR);

  // ══ OWN ORGANISER STATE (O1–O12) ══════════════════════════════════════
  //
  // `collaboration_sponsored_team_state()` tells the representative of the
  // ISSUING unit whether one of its own accepted people is on the team.
  const teamState = async (client: Client, sponsorshipId: string) => {
    const { data, error } = await client.rpc("collaboration_sponsored_team_state", { p_sponsorship_id: sponsorshipId });
    return error ? `feil: ${error.message}` : data;
  };
  expect("O1: FTR Oslo-representant ser «joined» for egen arrangør", await teamState(miaminge, S_k!), "joined");
  expect("O2: TU-forvalter får ikke svar", await teamState(emma, S_k!), null);
  expect("O3: utenforstående admin får ikke svar", await teamState(octavio, S_k!), null);
  expect("O4: vanlig samarbeidsmedlem får ikke svar", await teamState(hanne, S_k!), null);
  expect("O4: personen selv får ikke svar her", await teamState(kristoffer, S_k!), null);
  expect("O7: FTR-representant får ikke svar om TUs sponsing", await teamState(miaminge, S_i!), null);
  expect("O8: oppdiktet id gir intet svar", await teamState(miaminge, randomUUID()), null);
  expect("O10: ikke-akseptert sponsing gir intet svar", await teamState(miaminge, S_am!), null);
  expect("O12: anonym kan ikke kalle", (await anon.rpc("collaboration_sponsored_team_state", { p_sponsorship_id: S_k! })).error !== null, true);
  expect("O5: (oppsett) Kristoffer forlater teamet", await rpcBool(kristoffer, "leave_collaboration", { p_collaboration_id: C! }), true);
  expect("O5: joined → left", await teamState(miaminge, S_k!), "left");
  expect("O5: sponsingen er fortsatt akseptert, ikke trukket", (await admin.from("collaboration_member_sponsorships").select("status").eq("id", S_k!).single()).data?.status, "accepted");
  expect("O6: (oppsett) Kristoffer blir med igjen", await rpcBool(kristoffer, "join_collaboration", { p_collaboration_id: C! }), true);
  expect("O6: left → joined", await teamState(miaminge, S_k!), "joined");
  await kristoffer.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: TRONDELAG });
  expect("O11: intet svar om noen som ikke lenger hører til enheten", await teamState(miaminge, S_k!), null);
  await kristoffer.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: OSLO });
  expect(
    "O9: hjelperen returnerer én verdi, ikke rader",
    sql("select p.proretset::text || '|' || pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'collaboration_sponsored_team_state'"),
    "false|text",
  );
  expect(
    "O9: hjelperen er SECURITY DEFINER, låst search_path, ikke anon/PUBLIC",
    sql("select (p.prosecdef and 'search_path=public' = any(p.proconfig) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'collaboration_sponsored_team_state'"),
    "true",
  );
  expect("O9: TU-forvalter kan fortsatt ikke lese FTRs sponsinger for å finne id-er", seen(await emma.from("collaboration_member_sponsorships").select("id").eq("participant_id", P_OSLO)), 0);

  // ══ LIFECYCLE (56–61) ═════════════════════════════════════════════════

  expect("56: arrangør kan forlate", await rpcBool(ingrid, "leave_collaboration", { p_collaboration_id: C! }), true);
  expect("56: …og mister tilgang", await hasAccess(ingrid, C!), false);
  const leaveOther = await kristoffer.rpc("leave_collaboration" as never, { p_collaboration_id: C!, p_user_id: ids.hanne } as never);
  expect("57: kan ikke forlate på vegne av andre", leaveOther.error !== null, true);
  expect("59: annen deltaker kan ikke trekke FTRs sponsing", await rpcBool(emma, "revoke_collaboration_sponsorship", { p_sponsorship_id: S_k }), false);
  expect("61: annen deltaker kan ikke trekke FTR Oslo ut", await rpcBool(emma, "leave_collaboration_as_participant", { p_participant_id: P_OSLO }), false);
  expect("58: egen representant kan trekke egen sponsing", await rpcBool(miaminge, "revoke_collaboration_sponsorship", { p_sponsorship_id: S_k }), true);
  expect("58: …og tilgangen forsvinner", await hasAccess(kristoffer, C!), false);
  expect("O: trukket forblir trukket — ingen team-status gis", `${(await admin.from("collaboration_member_sponsorships").select("status").eq("id", S_k!).single()).data?.status}|${await teamState(miaminge, S_k!)}`, "revoked|null");
  expect("60: egen representant kan trekke egen enhet ut", await rpcBool(miaminge, "leave_collaboration_as_participant", { p_participant_id: P_OSLO }), true);
  expect("60: …og forvalterretten forsvinner", await isManager(miaminge, C!), false);

  // ══ LOCALE (62–65) ════════════════════════════════════════════════════

  const C_utr = await create(octavio, UTR, null, "Night Culture Forum");
  const locale = async (id: string) => (await admin.from("collaborations").select("default_locale").eq("id", id).single()).data?.default_locale;
  expect("62: UTR-opprettet samarbeid er engelsk", await locale(C_utr!), "en");
  expect("63: TU-opprettet samarbeid er norsk", await locale(C!), "nb");
  expect("63: FTR Oslo-opprettet samarbeid er norsk (lokallaget har intet eget språk)", await locale(C_ftr!), "nb");
  expect("64: hubben bruker plattformspråket", PLATFORM_LOCALE, "nb");
  expect("65: navnet lagres og vises som skrevet", (await admin.from("collaborations").select("name").eq("id", C!).single()).data?.name, "Seminar – cannabismarkedet");
  expect("65: ordbøkene har samme nøkler", JSON.stringify(Object.keys(nb).sort()) === JSON.stringify(Object.keys(en).sort()), true);
  const directLocale = await octavio.from("collaborations").update({ default_locale: "nb" }).eq("id", C_utr!).select("id");
  expect("65: språket kan ikke endres direkte", directLocale.error !== null || (directLocale.data ?? []).length === 0, true);

  // ══ RLS (66–70) ═══════════════════════════════════════════════════════

  expect(
    "66: ingen skriverettigheter for klientroller på samarbeidstabeller",
    sql("select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'collaboration%' and grantee in ('anon','authenticated','PUBLIC') and privilege_type <> 'SELECT'"),
    "0",
  );
  const newFunctions = "('collaboration_units','invite_collaboration_participant_by_slug','accept_collaboration_sponsorship_and_join','upsert_my_collaboration_profile','create_collaboration')";
  const fn = `from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ${newFunctions}`;
  expect("66: nye funksjoner er SECURITY DEFINER med låst search_path", sql(`select count(*) ${fn} and p.prosecdef and 'search_path=public' = any(p.proconfig)`), "5");
  expect("66: anon/PUBLIC kan ikke kjøre dem", sql(`select count(*) ${fn} and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`), "0");

  // The service role exists in exactly three server-only places, none of them
  // new: the key's env accessor, the admin client, and the showcase entry
  // route that mints demo sign-ins. Nothing a browser loads, and nothing on a
  // collaboration path, may reach for it.
  const serviceRole = /createSupabaseAdminClient|SERVICE_ROLE|supabaseServiceRoleKey/;
  const allSources = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")];
  const serverOnlyExceptions = [
    join("lib", "supabase", "admin.ts"),
    join("lib", "supabase", "env.ts"),
    join("lib", "demo", "entry.ts"),
  ];
  const offenders = allSources
    .filter((path) => !serverOnlyExceptions.includes(path))
    .filter((path) => serviceRole.test(readFileSync(path, "utf8")));
  expect("67: ingen service-role-sti utenom de kjente server-only-stedene", offenders.join(",") || "ingen", "ingen");
  const collaborationCode = allSources.filter((path) => /collaboration/.test(path));
  expect("67: samarbeidskoden finnes og bruker ikke service role", collaborationCode.length > 5 && collaborationCode.every((path) => !serviceRole.test(readFileSync(path, "utf8"))), true);
  const clientFiles = allSources.filter((path) => /^["']use client["']/.test(readFileSync(path, "utf8").trimStart()));
  expect("67: ingen klientkomponent importerer admin-klienten eller service-nøkkelen", clientFiles.some((path) => /supabase\/admin|supabaseServiceRoleKey/.test(readFileSync(path, "utf8"))), false);

  // collaboration_units is the one set-returning collaboration function, and
  // it is there for a stated reason (unit labels, with the pending-invitee
  // exception pinned in P1–P12). Everything else — including the Joined/Left
  // helper — returns a single value.
  //
  // The rest of the list predates collaborations, except set_channel_details
  // (admin channel editing), which came after. Like set_community_avatar it is
  // an admin-only setter that returns the one row it stored — that channel's
  // own name and purpose, matched on the primary key — and no person fields.
  //
  // subgroup_roster and search_subgroup_candidates (private teams) name people
  // by design: they exist so a team's managers can add and remove members.
  // Both answer only can_manage_subgroup() callers (community admins and
  // explicit team managers) with the person's display name in that one
  // community — never email, handle, account name or avatar. Roles are
  // returned to admins only, and the search needs two characters and returns
  // at most ten matches, so nobody is handed the roster. Pinned by
  // check:safe-space.
  //
  // event_attendance and event_attendee_roster (private attendee roster)
  // likewise. event_attendance returns counts only — no identities — for
  // events the caller can read. event_attendee_roster names attendees by
  // design, but only to can_view_event_roster() callers (the event's host and
  // the people who may manage it, inside its own community), with the
  // community display name and photo path only — never email, handle, account
  // name or role. Pinned by check:event-roster.
  //
  // own_organization_person_ids and organization_person_profile_links
  // (organisation directory) return rows about published organisation cards.
  // The first returns only the caller's own card ids and never a user id. The
  // second pairs a card with its linked account, but only where the caller may
  // already see that person's profile in that community
  // (can_view_community_profile) — nothing a member could not already read
  // from community_profiles. Neither returns email, handle, account name or
  // role, and both are empty for a non-member. Pinned by
  // check:organization-people.
  //
  // private_channel_roster and search_private_channel_candidates (private
  // lokallag channels) name the participants of one private channel to the
  // people who can read it, and find members of one lokallag for whoever may
  // create or manage a channel under it — display names only, the search at
  // most ten at a time. Pinned by check:private-channels.
  //
  // search_new_subgroup_candidates and subgroup_content_counts (community
  // groups). The first is search_subgroup_candidates for a group that does not
  // exist yet: active members of ONE community by display name, at most ten,
  // for that community's admins and moderators only — never another
  // community, never an email, handle or role. The second returns two numbers
  // (posts and events scoped to one group) to that group's managers, and no
  // row to anyone else. Pinned by check:community-groups.
  expect(
    "68/70: ingen nye mengdereturnerende funksjoner utenom collaboration_units",
    sql("select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proretset"),
    "accept_invitation_token,access_request_history,approve_access_request,collaboration_units,community_member_accounts,community_people_linked_member_details,community_people_linked_member_ids,community_person_account_links,direct_member_dm_actions,event_attendance,event_attendee_roster,invitation_preview,local_group_member_counts,organization_person_dm_actions,organization_person_profile_links,own_organization_person_ids,portal_by_slug,portal_events,private_channel_roster,resend_invitation,search_new_subgroup_candidates,search_private_channel_candidates,search_subgroup_candidates,set_channel_details,set_community_avatar,set_my_community_avatar,start_direct_conversation_with_organization_person,subgroup_content_counts,subgroup_roster",
  );
  const unitsResult = sql("select pg_get_function_result('public.collaboration_units(uuid)'::regprocedure)");
  expect("68: collaboration_units returnerer ingen personfelt", /user|email|handle|member|profile|count/.test(unitsResult), false);
  // Sofie has an account and no relationship to anything: the cold-start case.
  const sofie = await signIn("sofie");
  expect("69: bruker uten relasjon ser ingen samarbeid", seen(await sofie.from("collaborations").select("id")), 0);
  expect("69: bruker uten relasjon får ingen enheter", (await units(sofie, C!)).length, 0);
  expect("69: bruker uten relasjon får ikke slå opp via invitasjon", (await inviteBySlug(sofie, C!, FTR)).name, null);
  expect("69: anonym får ingen enheter", (await anon.rpc("collaboration_units", { p_collaboration_id: C! })).error !== null, true);
  expect("69: vilkårlig id gir ingenting", (await units(emma, randomUUID())).length, 0);
  // search_subgroup_candidates is the reviewed exception: it finds active
  // members *inside* a team's own community, for that team's managers only,
  // by display name, at most ten at a time (see the allowlist note at 68/70
  // and check:safe-space). It cannot reach another community or list
  // communities at all. Its two siblings follow the same shape and are
  // excepted with it: search_new_subgroup_candidates (the same search before
  // the team exists, for the community's admins and moderators) and
  // search_private_channel_candidates (members of one lokallag, for whoever
  // may create or manage a private channel under it). None of them searches
  // for, or returns, a community. Any other search-shaped function still
  // fails here.
  expect("70: ingen søkefunksjon for fellesskap finnes", sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname ilike '%search%' or p.proname ilike '%autocomplete%' or p.proname ilike '%suggest%') and p.proname not in ('search_subgroup_candidates','search_new_subgroup_candidates','search_private_channel_candidates')"), "0");

  // Nothing about any community profile or account changed along the way.
  expect("39/40: fellesskapsprofiler og kontoer uendret", await snapshot(), before);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} samarbeidsflyt-kontroller feilet.\n`);
    return;
  }
  console.log(`✓ ${checks} samarbeidsflyt-kontroller passerte`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await restore();
    if (failures > 0) process.exit(1);
  });
