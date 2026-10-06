/**
 * Checks cross-organisation collaborations, Step 1A: schema and authorisation.
 *
 * Run with `npm run check:collaborations` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients signed in as fixture accounts and calls exactly the RPCs a future
 * server action would, so a passing run means the *database* refuses.
 *
 * The service role is used to read state back, to stage a few adversarial
 * rows no client could write (a stale manager row, a forged participant), to
 * change a role or membership status the way an administrator's own tools
 * would, to archive (there is deliberately no client path for that), and to
 * put everything back. The catalogue checks (grants, search_path, SECURITY
 * DEFINER, function signatures) run through psql inside the local database
 * container, because no API role can — or should be able to — read pg_proc.
 *
 * The scenario is a real one: a seminar organised jointly by Tryggere Ungdom
 * and Tryggere Ruspolitikk, which takes part through its Oslo lokallag. No
 * third organisation is invented; Under The Rug stands in as the unrelated
 * organisation.
 *
 * The numbered comments follow the checklist the feature was specified with;
 * "R1"–"R5" mark the five architectural corrections made before commit
 * (representation ≠ membership, manager provenance, no client archive,
 * community-level invitations, retired local groups).
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

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
type Tables = Database["public"]["Tables"];
type MembershipRow = Tables["memberships"]["Row"];
type CommunityProfileRow = Tables["community_profiles"]["Row"];

const COLLABORATION_TABLES = [
  "collaborations",
  "collaboration_participants",
  "collaboration_manager_participants",
  "collaboration_member_sponsorships",
  "collaboration_members",
  "collaboration_profiles",
  "collaboration_audit_log",
] as const;

// ── Catalogue access (local stack only) ─────────────────────────────────

function sql(query: string): string {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  if (!projectId) throw new Error("fant ikke project_id i supabase/config.toml");
  return execFileSync(
    "docker",
    ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-tAX", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

// ── Clients ─────────────────────────────────────────────────────────────

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`ukjent handle ${handle}: ${error.message}`);
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user!.email!,
  });
  if (linkError || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${linkError?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

// ── RPC wrappers: the exact calls a server action would make ────────────

const nullable = <T>(value: T | null) => value as T;

async function create(
  client: Client,
  communityId: string,
  localGroupId: string | null,
  name: string,
  slug: string | null = null,
) {
  const { data, error } = await client.rpc("create_collaboration", {
    p_source_community_id: communityId,
    p_source_local_group_id: nullable(localGroupId),
    p_name: name,
    p_slug: nullable(slug),
    p_description: "Intern arbeidsflate for arrangørene. Ikke publikum.",
  });
  if (!error && data) created.add(data);
  return error ? null : (data ?? null);
}

async function inviteOrg(client: Client, collaborationId: string, communityId: string) {
  const { data, error } = await client.rpc("invite_collaboration_participant", {
    p_collaboration_id: collaborationId,
    p_community_id: communityId,
  });
  return error ? null : (data ?? null);
}

async function acceptAs(client: Client, participantId: string, localGroupId: string | null) {
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

async function withdrawUnit(client: Client, participantId: string) {
  const { data, error } = await client.rpc("leave_collaboration_as_participant", {
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

async function answerSponsorship(client: Client, sponsorshipId: string, accept: boolean) {
  const { data, error } = await client.rpc("respond_to_collaboration_sponsorship", {
    p_sponsorship_id: sponsorshipId,
    p_accept: accept,
  });
  return !error && data === true;
}

async function revoke(client: Client, sponsorshipId: string) {
  const { data, error } = await client.rpc("revoke_collaboration_sponsorship", {
    p_sponsorship_id: sponsorshipId,
  });
  return !error && data === true;
}

async function join(client: Client, collaborationId: string) {
  const { data, error } = await client.rpc("join_collaboration", { p_collaboration_id: collaborationId });
  return !error && data === true;
}

async function leave(client: Client, collaborationId: string) {
  const { data, error } = await client.rpc("leave_collaboration", { p_collaboration_id: collaborationId });
  return !error && data === true;
}

async function hasAccess(client: Client, collaborationId: string) {
  const { data, error } = await client.rpc("has_collaboration_access", { p_collaboration_id: collaborationId });
  return !error && data === true;
}

async function isManager(client: Client, collaborationId: string) {
  const { data, error } = await client.rpc("is_collaboration_manager", { p_collaboration_id: collaborationId });
  return !error && data === true;
}

async function setMyLocalGroup(client: Client, localGroupId: string | null) {
  const { data } = await client.rpc("set_my_local_group", {
    p_community_id: FTR,
    p_local_group_id: nullable(localGroupId),
  });
  return data === true;
}

// ── What a client can see ───────────────────────────────────────────────

/**
 * Row count of a client read. An error is reported as such rather than as
 * zero, so an isolation check can never pass because the query itself was
 * malformed or refused for an unrelated reason.
 */
function seen(result: { data: unknown[] | null; error: { message: string } | null }): number | string {
  return result.error ? `feil: ${result.error.message}` : (result.data ?? []).length;
}

async function visibleCount(
  client: Client,
  table: (typeof COLLABORATION_TABLES)[number],
  filter: Record<string, string> = {},
) {
  let query = client.from(table).select("*");
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  return seen(await query);
}

async function visibleMemberIds(client: Client, collaborationId: string) {
  const { data, error } = await client
    .from("collaboration_members")
    .select("user_id")
    .eq("collaboration_id", collaborationId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.user_id));
}

async function visibleSponsorshipsOf(client: Client, collaborationId: string, userId: string) {
  const { data, error } = await client
    .from("collaboration_member_sponsorships")
    .select("id, participant_id")
    .eq("collaboration_id", collaborationId)
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

// ── Service-role state (reads, plus restore bookkeeping) ────────────────

async function sponsorshipStatus(id: string) {
  const { data } = await admin.from("collaboration_member_sponsorships").select("status").eq("id", id).single();
  return data?.status;
}

async function participant(id: string) {
  const { data } = await admin.from("collaboration_participants").select("*").eq("id", id).single();
  return data!;
}

async function memberRows(collaborationId: string) {
  const { data } = await admin.from("collaboration_members").select("*").eq("collaboration_id", collaborationId);
  return data ?? [];
}

async function sponsorshipRows(filter: Record<string, string>) {
  let query = admin.from("collaboration_member_sponsorships").select("*");
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  return (await query).data ?? [];
}

async function seatRows(collaborationId: string) {
  const { data } = await admin
    .from("collaboration_manager_participants")
    .select("*")
    .eq("collaboration_id", collaborationId)
    .order("participant_id");
  return data ?? [];
}

async function membershipOf(userId: string, communityId: string): Promise<MembershipRow> {
  const { data, error } = await admin
    .from("memberships")
    .select("*")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .single();
  if (error) throw error;
  return data;
}

async function communityProfilesOf(userIds: string[]): Promise<CommunityProfileRow[]> {
  const { data } = await admin
    .from("community_profiles")
    .select("*")
    .in("user_id", userIds)
    .order("user_id")
    .order("community_id");
  return data ?? [];
}

async function membershipsOf(userIds: string[]): Promise<MembershipRow[]> {
  const { data } = await admin
    .from("memberships")
    .select("*")
    .in("user_id", userIds)
    .order("user_id")
    .order("community_id");
  return data ?? [];
}

const created = new Set<string>();
const touchedMemberships = new Map<string, MembershipRow>();
const touchedGroups = new Map<string, boolean>();

async function rememberMembership(userId: string, communityId: string) {
  const row = await membershipOf(userId, communityId);
  if (!touchedMemberships.has(row.id)) touchedMemberships.set(row.id, row);
}

async function rememberGroup(groupId: string) {
  if (touchedGroups.has(groupId)) return;
  const { data } = await admin.from("community_local_groups").select("active").eq("id", groupId).single();
  touchedGroups.set(groupId, data!.active);
}

async function restore() {
  // Reverse order: an admin demoted first and a stand-in promoted after must
  // be undone stand-in first, or the one-active-admin index refuses.
  for (const row of [...touchedMemberships.values()].reverse()) {
    await admin
      .from("memberships")
      .update({ status: row.status, role: row.role, local_group_id: row.local_group_id, joined_at: row.joined_at })
      .eq("id", row.id);
  }
  for (const [groupId, active] of touchedGroups) {
    await admin.from("community_local_groups").update({ active }).eq("id", groupId);
  }
  if (created.size > 0) {
    // Cascades to every collaboration_* table.
    await admin.from("collaborations").delete().in("id", [...created]);
  }
}

// ── Checks ──────────────────────────────────────────────────────────────

async function main() {
  const ids = {
    emma: await profileId("emmamortensen"), // TU admin
    hanne: await profileId("hanne"), // TU moderator, TU Oslo
    adrian: await profileId("adrian"), // TU member
    petter: await profileId("petter"), // TU member; FTR member, FTR Trøndelag
    ingrid: await profileId("ingrid"), // FTR moderator, TU moderator, UTR member
    miaminge: await profileId("miaminge"), // FTR admin, no local group
    amina: await profileId("amina"), // FTR moderator, FTR Oslo
    kristoffer: await profileId("kristoffer"), // FTR member, FTR Oslo
    linn: await profileId("linn"), // FTR member, no local group
    kari: await profileId("karimoen"), // FTR moderator (Trøndelag), TU moderator
    octavio: await profileId("octavio"), // UTR admin — unrelated organisation
  };

  const groups = (await admin.from("community_local_groups").select("id, name, community_id")).data ?? [];
  const groupId = (name: string) => groups.find((g) => g.name === name)!.id;
  const OSLO = groupId("FTR Oslo");
  const TRONDELAG = groupId("FTR Trøndelag");
  const AKERSHUS = groupId("FTR Akershus");
  const TU_OSLO = groupId("TU Oslo");

  // Fixture assumptions the scenario depends on. If the seed changes these,
  // the checks below would pass or fail for the wrong reason.
  expect("fixtur: Mia er FTR-admin", (await membershipOf(ids.miaminge, FTR)).role, "admin");
  expect("fixtur: Mia er ikke selv i FTR Oslo", (await membershipOf(ids.miaminge, FTR)).local_group_id, null);
  expect("fixtur: Emma er TU-admin", (await membershipOf(ids.emma, TU)).role, "admin");
  expect("fixtur: Hanne er TU-moderator", (await membershipOf(ids.hanne, TU)).role, "moderator");
  expect("fixtur: Kristoffer er i FTR Oslo", (await membershipOf(ids.kristoffer, FTR)).local_group_id, OSLO);
  expect("fixtur: Amina er FTR-moderator i FTR Oslo", (await membershipOf(ids.amina, FTR)).local_group_id, OSLO);
  expect("fixtur: Petter er i FTR Trøndelag", (await membershipOf(ids.petter, FTR)).local_group_id, TRONDELAG);

  const everyone = Object.values(ids);
  const profilesBefore = await communityProfilesOf(everyone);
  const membershipsBefore = await membershipsOf(everyone);

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const emma = await signIn("emmamortensen");
  const hanne = await signIn("hanne");
  const adrian = await signIn("adrian");
  const petter = await signIn("petter");
  const ingrid = await signIn("ingrid");
  const miaminge = await signIn("miaminge");
  const amina = await signIn("amina");
  const kristoffer = await signIn("kristoffer");
  const linn = await signIn("linn");
  const kari = await signIn("karimoen");
  const octavio = await signIn("octavio");

  // ══ CREATION ══════════════════════════════════════════════════════════

  // 1. TU admin creates from TU. Emma is a TU member, so she is also seated.
  const C = await create(emma, TU, null, "Seminar – cannabismarkedet", "Seminar Cannabis-markedet!");
  expect("1: TU-admin kan opprette samarbeid fra TU", typeof C, "string");
  if (!C) throw new Error("kan ikke fortsette uten samarbeid");

  const collab = (await admin.from("collaborations").select("*").eq("id", C).single()).data!;
  expect("1: status er aktiv", collab.status, "active");
  expect("1: slug er normalisert", collab.slug, "seminar-cannabis-markedet");
  expect("1: navn er lagret", collab.name, "Seminar – cannabismarkedet");

  const tuParticipants = (await admin.from("collaboration_participants").select("*").eq("collaboration_id", C)).data!;
  expect("1: nøyaktig én deltakerenhet ved opprettelse", tuParticipants.length, 1);
  const P_TU = tuParticipants[0].id;
  expect("1: kildeenheten er hele TU", `${tuParticipants[0].community_id}|${tuParticipants[0].local_group_id}`, `${TU}|null`);
  expect("1: kildeenheten er aktiv", tuParticipants[0].status, "active");
  const emmaSponsorships = await sponsorshipRows({ collaboration_id: C });
  expect("1: skaperen har én sponsing", emmaSponsorships.length, 1);
  expect("1: skaperens sponsing er akseptert via TU", `${emmaSponsorships[0].user_id}|${emmaSponsorships[0].participant_id}|${emmaSponsorships[0].status}`, `${ids.emma}|${P_TU}|accepted`);
  expect("1: skaperen er aktivt teammedlem", (await memberRows(C)).map((m) => `${m.user_id}|${m.status}`).join(), `${ids.emma}|active`);
  expect("S: TU-deltakeren fikk forvalterplassen ved opprettelse", (await seatRows(C)).map((r) => r.participant_id).join(), P_TU);
  expect("S: plassen er ikke bundet til en person (bare proveniens)", (await seatRows(C))[0]?.granted_by_user_id, ids.emma);
  expect(
    "S: plasstabellen har ingen bruker-kolonne for autorisasjon",
    sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'collaboration_manager_participants'"),
    "collaboration_id,participant_id,created_at,granted_by_user_id",
  );
  expect("S: den personbundne forvaltertabellen finnes ikke", sql("select to_regclass('public.collaboration_managers') is null"), "t");
  expect("1: skaperen har effektiv tilgang", await hasAccess(emma, C), true);
  expect("1: skaperen er effektiv forvalter", await isManager(emma, C), true);

  // Slug handling: taken slug gets a suffix, blank name is refused.
  const C_dup = await create(emma, TU, null, "Seminar igjen", "seminar-cannabis-markedet");
  const dupSlug = C_dup ? (await admin.from("collaborations").select("slug").eq("id", C_dup).single()).data?.slug : null;
  expect("1: opptatt slug får et tilfeldig suffiks", /^seminar-cannabis-markedet-[0-9a-f]{6}$/.test(dupSlug ?? ""), true);
  expect("1: tomt navn avvises", await create(emma, TU, null, "   "), null);
  expect("1: ugyldig slug avvises", await create(emma, TU, null, "Et navn", "!!"), null);

  // 2–4.
  expect("2: TU-moderator kan ikke opprette", await create(hanne, TU, null, "Hannes samarbeid"), null);
  expect("3: TU-medlem kan ikke opprette", await create(adrian, TU, null, "Adrians samarbeid"), null);
  const anonCreate = await anon.rpc("create_collaboration", {
    p_source_community_id: TU,
    p_source_local_group_id: nullable<string>(null),
    p_name: "Anonymt",
    p_slug: nullable<string>(null),
    p_description: nullable<string>(null),
  });
  expect("4: anonym kan ikke opprette", anonCreate.error !== null, true);

  // 5. The actor cannot be named by the client.
  expect("5: created_by er den innloggede", collab.created_by_user_id, ids.emma);
  const forgedArg = await emma.rpc("create_collaboration" as never, {
    p_source_community_id: TU,
    p_source_local_group_id: null,
    p_name: "Forfalsket",
    p_slug: null,
    p_description: null,
    p_created_by_user_id: ids.miaminge,
  } as never);
  expect("5: det finnes ingen aktør-parameter å forfalske", forgedArg.error !== null, true);
  const directInsert = await emma
    .from("collaborations")
    .insert({ slug: "direkte-innsatt", name: "Direkte", created_by_user_id: ids.miaminge })
    .select("id");
  expect("5: direkte INSERT i collaborations avvises", directInsert.error !== null, true);

  // ══ LOCAL-GROUP CREATION — representation ≠ membership (R1) ══════════

  // 6. Parent-admin authority is the v1 rule. Mia is not in Oslo, so she
  // manages FTR Oslo's participation without being put on the team through it.
  const C_oslo = await create(miaminge, FTR, OSLO, "FTR Oslo-internt samarbeid");
  expect("6: FTR-admin kan opprette fra FTR Oslo", typeof C_oslo, "string");
  if (C_oslo) {
    const p = (await admin.from("collaboration_participants").select("*").eq("collaboration_id", C_oslo).single()).data!;
    expect("6: kildeenheten er FTR Oslo", `${p.community_id}|${p.local_group_id}|${p.status}`, `${FTR}|${OSLO}|active`);
    expect("R1: representant uten Oslo-medlemskap får ingen fabrikkert Oslo-sponsing", (await sponsorshipRows({ collaboration_id: C_oslo })).length, 0);
    expect("R1: …og ingen teamplass", (await memberRows(C_oslo)).length, 0);
    expect("R1: …og har derfor ingen arbeidsflate-tilgang", await hasAccess(miaminge, C_oslo), false);
    expect("R1: …men forvalter FTR Oslos deltakelse", await isManager(miaminge, C_oslo), true);
    expect("S: forvalterplassen tilhører FTR Oslo-deltakeren", (await seatRows(C_oslo)).map((r) => r.participant_id).join(), p.id);
    expect("R1: representanten kan ikke sponse seg selv via Oslo", await sponsor(miaminge, C_oslo, p.id, ids.miaminge), null);
    expect("R1: representanten kan sponse et faktisk Oslo-medlem", typeof (await sponsor(miaminge, C_oslo, p.id, ids.kristoffer)), "string");
  }

  // 7–8.
  expect("7: TU-admin kan ikke representere FTR Oslo", await create(emma, FTR, OSLO, "Kapret"), null);
  expect("7: UTR-admin kan ikke representere FTR Oslo", await create(octavio, FTR, OSLO, "Kapret"), null);
  expect("7: UTR-admin kan ikke representere FTR", await create(octavio, FTR, null, "Kapret"), null);
  expect("8: FTR-moderator i Oslo kan ikke representere FTR Oslo", await create(amina, FTR, OSLO, "Moderator"), null);
  expect("8: FTR-moderator kan ikke representere FTR", await create(kari, FTR, null, "Moderator"), null);
  expect("8: vanlig Oslo-medlem kan ikke representere FTR Oslo", await create(kristoffer, FTR, OSLO, "Medlem"), null);

  // 78. A local group paired with the wrong community.
  expect("78: TU + FTR Oslo-id avvises ved opprettelse", await create(emma, TU, OSLO, "Forfalsket par"), null);
  expect("78: tilfeldig lokallag-id avvises", await create(emma, TU, randomUUID(), "Ukjent lag"), null);

  // ══ FIRST TU TEAM MEMBER (needed as the "ordinary member") ═══════════

  const S_adrian = await sponsor(emma, C, P_TU, ids.adrian);
  expect("19: TU-representant kan sponse aktivt TU-medlem", typeof S_adrian, "string");
  expect("26: sponset bruker kan akseptere egen invitasjon", await answerSponsorship(adrian, S_adrian!, true), true);
  expect("30: akseptert sponsing gir rett til å bli med", await join(adrian, C), true);
  expect("35: med + gyldig sponsing → tilgang", await hasAccess(adrian, C), true);

  // ══ ORGANISATION INVITATION — community level only (R4) ══════════════

  // 10. Ordinary collaboration members and outsiders cannot invite.
  expect("10: vanlig samarbeidsmedlem kan ikke invitere", await inviteOrg(adrian, C, FTR), null);
  expect("10: TU-moderator utenfor samarbeidet kan ikke invitere", await inviteOrg(hanne, C, FTR), null);
  expect("10: FTR-admin (ikke forvalter her) kan ikke invitere seg selv inn", await inviteOrg(miaminge, C, FTR), null);

  // R4: the inviter cannot enumerate or name the target's local groups.
  expect("R4: inviterende admin ser ingen av FTRs lokallag", seen(await emma.from("community_local_groups").select("id").eq("community_id", FTR)), 0);
  expect("R4: inviterende admin får ingen FTR-lokallagstall", seen(await emma.rpc("local_group_member_counts", { p_community_id: FTR })), 0);
  expect("kontroll: FTR-admin ser FTRs lokallag", Number(seen(await miaminge.from("community_local_groups").select("id").eq("community_id", FTR))) > 1, true);
  expect(
    "R4: invitasjonsfunksjonen tar bare samarbeid og fellesskap",
    sql("select pg_get_function_identity_arguments('public.invite_collaboration_participant'::regproc)"),
    "p_collaboration_id uuid, p_community_id text",
  );
  const withGroup = await emma.rpc("invite_collaboration_participant" as never, {
    p_collaboration_id: C,
    p_community_id: FTR,
    p_local_group_id: OSLO,
  } as never);
  expect("R4: inviterende kan ikke velge målets lokallag", withGroup.error !== null, true);
  // The only set-returning collaboration function is collaboration_units()
  // (Step 1B), named here on purpose rather than allowed by pattern: labels of
  // the units in one collaboration the caller is related to, plus the one
  // documented pending-invitee exception (active units, labels only, no ids),
  // pinned in check:collaboration-flow P1–P12. Anything else that returns
  // rows would be a new lookup surface and must be looked at.
  expect(
    "R4: ingen samarbeidsfunksjon returnerer rader utenom collaboration_units",
    sql("select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%collaboration%' and p.proretset"),
    "collaboration_units",
  );

  // 9.
  const P_FTR = await inviteOrg(emma, C, FTR);
  expect("9: forvalter kan invitere FTR", typeof P_FTR, "string");
  if (!P_FTR) throw new Error("kan ikke fortsette uten FTR-invitasjon");
  const invited = await participant(P_FTR);
  expect("R4: invitasjonen gjelder fellesskapet, ingen enhet er valgt", `${invited.community_id}|${invited.local_group_id}|${invited.status}`, `${FTR}|null|invited`);

  // 11.
  expect("11: dobbel invitasjon av samme fellesskap avvises", await inviteOrg(emma, C, FTR), null);
  expect("11: fortsatt bare én ventende FTR-invitasjon", (await admin.from("collaboration_participants").select("id").eq("collaboration_id", C).eq("community_id", FTR)).data?.length, 1);
  const forgedDuplicate = await admin.from("collaboration_participants").insert({ collaboration_id: C, community_id: FTR, status: "invited" });
  expect("11: unik indeks stopper en andre ventende FTR-invitasjon", forgedDuplicate.error !== null, true);
  const forgedDeclinedWithGroup = await admin.from("collaboration_participants").insert({
    collaboration_id: C,
    community_id: FTR,
    local_group_id: AKERSHUS,
    status: "declined",
    responded_at: new Date().toISOString(),
  });
  expect("R4: en invitasjon/avslag kan ikke bære et lokallag (constraint)", forgedDeclinedWithGroup.error !== null, true);

  expect("78: ukjent fellesskap avvises", await inviteOrg(emma, C, "finnes-ikke"), null);

  // 13. Invited is not active.
  expect("13: FTR-admin har ikke tilgang før aksept", await hasAccess(miaminge, C), false);
  expect("13: FTR-admin er ikke forvalter før aksept", await isManager(miaminge, C), false);
  expect("13: Oslo-medlem har ikke tilgang", await hasAccess(kristoffer, C), false);

  // 12. The invitation exposes no member of FTR.
  expect("12: ingen sponsinger opprettet for FTR", (await sponsorshipRows({ participant_id: P_FTR })).length, 0);
  expect("12: TU-admin ser ingen FTR-medlemskap", seen(await emma.from("memberships").select("id").eq("community_id", FTR)), 0);
  expect("12: TU-admin ser ingen FTR Oslo-medlemskap", seen(await emma.from("memberships").select("id").eq("local_group_id", OSLO)), 0);

  // Visibility of the pending invitation.
  expect("vis: forvalter ser ventende invitasjon", await visibleCount(emma, "collaboration_participants", { id: P_FTR }), 1);
  expect("vis: vanlig medlem ser ikke ventende invitasjon", await visibleCount(adrian, "collaboration_participants", { id: P_FTR }), 0);
  expect("vis: FTR-admin ser samarbeidet hun er invitert til", await visibleCount(miaminge, "collaborations", { id: C }), 1);
  expect("vis: FTR-admin ser sin egen invitasjon", await visibleCount(miaminge, "collaboration_participants", { id: P_FTR }), 1);
  expect("vis: FTR-admin ser ikke TU-deltakerraden før aksept", await visibleCount(miaminge, "collaboration_participants", { id: P_TU }), 0);
  expect("vis: FTR-admin ser ikke teamet", await visibleCount(miaminge, "collaboration_members", { collaboration_id: C }), 0);
  expect("vis: FTR-moderator ser ikke samarbeidet", await visibleCount(amina, "collaborations", { id: C }), 0);
  expect("vis: Oslo-medlem ser ikke samarbeidet", await visibleCount(kristoffer, "collaborations", { id: C }), 0);
  expect("vis: utenforstående admin ser ikke samarbeidet", await visibleCount(octavio, "collaborations", { id: C }), 0);

  // ══ ACCEPTANCE — the invited community chooses its own unit (R4) ═════

  expect("15: FTR-moderator kan ikke akseptere som FTR Oslo", await acceptAs(amina, P_FTR, OSLO), false);
  expect("15: FTR-moderator kan ikke akseptere som hele FTR", await acceptAs(kari, P_FTR, null), false);
  expect("15: FTR-moderator kan ikke avslå", await decline(kari, P_FTR), false);
  expect("16: TU-admin kan ikke akseptere på vegne av FTR", await acceptAs(emma, P_FTR, null), false);
  expect("R4: TU-admin kan ikke velge FTRs lokallag ved aksept", await acceptAs(emma, P_FTR, OSLO), false);
  expect("16: Oslo-medlem kan ikke akseptere", await acceptAs(kristoffer, P_FTR, OSLO), false);
  expect("R4: FTR kan ikke velge et TU-lokallag", await acceptAs(miaminge, P_FTR, TU_OSLO), false);
  expect("R4: FTR kan ikke velge et oppdiktet lokallag", await acceptAs(miaminge, P_FTR, randomUUID()), false);

  await rememberGroup(AKERSHUS);
  await miaminge.rpc("set_local_group_active", { p_local_group_id: AKERSHUS, p_active: false });
  expect("R5: FTR kan ikke akseptere som et avviklet lokallag", await acceptAs(miaminge, P_FTR, AKERSHUS), false);
  await miaminge.rpc("set_local_group_active", { p_local_group_id: AKERSHUS, p_active: true });

  const stillInvited = await participant(P_FTR);
  expect("16: fortsatt invitert uten valgt enhet etter forsøkene", `${stillInvited.status}|${stillInvited.local_group_id}`, "invited|null");

  const beforeAccept = (await admin.from("collaboration_participants").select("id, status").eq("collaboration_id", C)).data!;
  expect("14/R4: FTR-representant aksepterer som FTR Oslo", await acceptAs(miaminge, P_FTR, OSLO), true);
  const P_OSLO = P_FTR;
  const accepted = await participant(P_OSLO);
  expect("R4: deltakeren er community=FTR, local_group=Oslo", `${accepted.community_id}|${accepted.local_group_id}|${accepted.status}`, `${FTR}|${OSLO}|active`);
  expect("14: svaret er registrert på Mia", accepted.responded_by_user_id, ids.miaminge);
  expect("14: samme aksept igjen er idempotent", await acceptAs(miaminge, P_OSLO, OSLO), true);
  expect("R4: kan ikke akseptere på nytt som en annen enhet", await acceptAs(miaminge, P_OSLO, null), false);
  expect("14: aksept kan ikke snus til avslag", await decline(miaminge, P_OSLO), false);
  expect("R4: enheten er uendret", (await participant(P_OSLO)).local_group_id, OSLO);
  const afterAccept = (await admin.from("collaboration_participants").select("id, status").eq("collaboration_id", C)).data!;
  expect(
    "17: bare FTR-deltakeren endret status",
    afterAccept.filter((p) => p.id !== P_OSLO && beforeAccept.find((b) => b.id === p.id)?.status !== p.status).length,
    0,
  );

  // 18 / R1 / R2. The accepting representative gets exactly a manager row
  // derived from FTR Oslo — no Oslo sponsorship, because he is not in Oslo.
  expect("R1: ingen Oslo-sponsing fabrikkert for representanten", (await sponsorshipRows({ participant_id: P_OSLO })).length, 0);
  expect("S1: FTR Oslo fikk en forvalterplass ved aksept", (await seatRows(C)).some((r) => r.participant_id === P_OSLO), true);
  expect("S1: plassen er deltakerens, med Mia bare som proveniens", (await seatRows(C)).find((r) => r.participant_id === P_OSLO)?.granted_by_user_id, ids.miaminge);
  expect("18: representanten er forvalter", await isManager(miaminge, C), true);
  expect("R1: representanten har ikke arbeidsflate-tilgang", await hasAccess(miaminge, C), false);
  expect("R1: representanten kan ikke bli med uten egen gyldig sponsing", await join(miaminge, C), false);
  expect("R1: representanten kan ikke sponse seg selv via Oslo", await sponsor(miaminge, C, P_OSLO, ids.miaminge), null);
  expect("18: representanten ser ikke TUs sponsinger", (await visibleSponsorshipsOf(miaminge, C, ids.adrian)).length, 0);
  expect("18: representanten kan ikke trekke TUs sponsing", await revoke(miaminge, S_adrian!), false);
  expect("18: representanten kan ikke sponse via TU", await sponsor(miaminge, C, P_TU, ids.petter), null);
  expect("18: ingen FTR-personer ble med", (await memberRows(C)).map((m) => m.user_id).sort().join(), [ids.emma, ids.adrian].sort().join());
  expect("vis: forvalter uten teamplass ser ikke teamet", (await visibleMemberIds(miaminge, C)).size, 0);
  expect("vis: forvalter ser begge deltakerenhetene", await visibleCount(miaminge, "collaboration_participants", { collaboration_id: C }), 2);

  // Decline path, on a separate invitation.
  if (C_oslo) {
    const P_TU_in_oslo = await inviteOrg(miaminge, C_oslo, TU);
    expect("R4: TU kan avslå en invitasjon", await decline(emma, P_TU_in_oslo!), true);
    expect("R4: avslag er idempotent", await decline(emma, P_TU_in_oslo!), true);
    expect("R4: avslått invitasjon kan ikke aksepteres etterpå", await acceptAs(emma, P_TU_in_oslo!, null), false);
    expect("R4: avslaget har intet lokallag", (await participant(P_TU_in_oslo!)).local_group_id, null);
  }

  // ══ MEMBER SPONSORSHIP ═══════════════════════════════════════════════

  const S_ingrid = await sponsor(emma, C, P_TU, ids.ingrid);
  expect("19: TU-representant kan sponse TU-moderator som medlem", typeof S_ingrid, "string");
  expect("19: gjentatt sponsing gir samme rad", await sponsor(emma, C, P_TU, ids.ingrid), S_ingrid);

  expect("20: TU-representant kan ikke sponse FTR-medlem via TU", await sponsor(emma, C, P_TU, ids.kristoffer), null);
  expect("20: TU-representant kan ikke sponse Linn (bare FTR) via TU", await sponsor(emma, C, P_TU, ids.linn), null);

  expect("29: sponsor kan ikke akseptere på målets vegne", await answerSponsorship(emma, S_ingrid!, true), false);
  expect("29: sponsingen er fortsatt invitert", await sponsorshipStatus(S_ingrid!), "invited");

  const S_kristoffer = await sponsor(miaminge, C, P_OSLO, ids.kristoffer);
  expect("21: FTR-representant kan sponse aktivt FTR Oslo-medlem", typeof S_kristoffer, "string");
  expect("29: FTR-admin kan ikke akseptere for Kristoffer", await answerSponsorship(miaminge, S_kristoffer!, true), false);

  expect("22: FTR-medlem uten lokallag kan ikke sponses via FTR Oslo", await sponsor(miaminge, C, P_OSLO, ids.linn), null);
  expect("22: FTR Trøndelag-medlem kan ikke sponses via FTR Oslo", await sponsor(miaminge, C, P_OSLO, ids.petter), null);

  expect("23: TU-forvalter kan ikke sponse via FTR Oslo", await sponsor(emma, C, P_OSLO, ids.kristoffer), null);
  expect("23: TU-forvalter kan ikke sponse TU-folk via FTR Oslo", await sponsor(emma, C, P_OSLO, ids.adrian), null);
  expect("23: vanlig medlem kan ikke sponse", await sponsor(adrian, C, P_TU, ids.hanne), null);

  expect("24: oppdiktet bruker-id avvises (FTR Oslo)", await sponsor(miaminge, C, P_OSLO, randomUUID()), null);
  expect("24: oppdiktet bruker-id avvises (TU)", await sponsor(emma, C, P_TU, randomUUID()), null);
  if (C_oslo) {
    expect("24: deltaker fra et annet samarbeid avvises", await sponsor(miaminge, C_oslo, P_OSLO, ids.kristoffer), null);
    const crossCollab = await admin.from("collaboration_member_sponsorships").insert({ collaboration_id: C_oslo, participant_id: P_OSLO, user_id: ids.kristoffer });
    expect("24: FK stopper sponsing som peker på annet samarbeids deltaker", crossCollab.error !== null, true);
  }

  // 25. Sponsoring exposes nothing around the target.
  expect("25: TU-admin ser ikke Kristoffers sponsing", (await visibleSponsorshipsOf(emma, C, ids.kristoffer)).length, 0);
  expect("25: TU-admin ser ikke Kristoffer i teamet før han blir med", (await visibleMemberIds(emma, C)).has(ids.kristoffer), false);
  expect("25: TU-admin ser fortsatt ingen FTR-medlemskap", seen(await emma.from("memberships").select("id").eq("community_id", FTR)), 0);
  expect("25: Kristoffer ser bare sine egne sponsinger", (await visibleSponsorshipsOf(kristoffer, C, ids.kristoffer)).length, 1);

  // ══ USER CONSENT ═════════════════════════════════════════════════════

  expect("27: andre kan ikke akseptere Kristoffers sponsing", await answerSponsorship(adrian, S_kristoffer!, true), false);
  expect("27: Ingrid kan ikke akseptere Kristoffers sponsing", await answerSponsorship(ingrid, S_kristoffer!, true), false);
  expect("27: fortsatt invitert", await sponsorshipStatus(S_kristoffer!), "invited");

  expect("vis: sponset person ser samarbeidet", await visibleCount(kristoffer, "collaborations", { id: C }), 1);
  expect("vis: sponset person ser sin sponsorenhet", await visibleCount(kristoffer, "collaboration_participants", { id: P_OSLO }), 1);
  expect("vis: sponset person ser ikke andre enheter", await visibleCount(kristoffer, "collaboration_participants", { id: P_TU }), 0);
  expect("vis: sponset person ser ikke teamet", await visibleCount(kristoffer, "collaboration_members", { collaboration_id: C }), 0);

  expect("26: Kristoffer aksepterer selv", await answerSponsorship(kristoffer, S_kristoffer!, true), true);
  expect("26: status akseptert", await sponsorshipStatus(S_kristoffer!), "accepted");

  const S_petter_tu_1 = await sponsor(emma, C, P_TU, ids.petter);
  expect("28: Petter kan avslå", await answerSponsorship(petter, S_petter_tu_1!, false), true);
  expect("28: status avslått", await sponsorshipStatus(S_petter_tu_1!), "declined");
  expect("28: avslag kan ikke snus til aksept", await answerSponsorship(petter, S_petter_tu_1!, true), false);
  expect("28: avslått sponsing gir ikke rett til å bli med", await join(petter, C), false);

  // ══ JOINED TEAM / EFFECTIVE ACCESS ═══════════════════════════════════

  expect("36: akseptert sponsing uten å bli med → ingen tilgang", await hasAccess(kristoffer, C), false);

  expect("30: Kristoffer kan bli med", await join(kristoffer, C), true);
  const joinedAt = (await memberRows(C)).find((m) => m.user_id === ids.kristoffer)?.joined_at;
  expect("34: gjentatt «bli med» er idempotent", await join(kristoffer, C), true);
  expect("34: joined_at uendret ved gjentak", (await memberRows(C)).find((m) => m.user_id === ids.kristoffer)?.joined_at, joinedAt);
  expect("35: Kristoffer har tilgang", await hasAccess(kristoffer, C), true);

  expect("26: Ingrid aksepterer", await answerSponsorship(ingrid, S_ingrid!, true), true);
  expect("30: Ingrid blir med", await join(ingrid, C), true);

  // 31–33.
  const team = (await memberRows(C)).map((m) => m.user_id).sort();
  expect("31: teamet består bare av de som ble med", team.join(), [ids.emma, ids.adrian, ids.kristoffer, ids.ingrid].sort().join());
  expect("32: usponset FTR Oslo-medlem (Amina) er ikke i teamet", team.includes(ids.amina), false);
  expect("32: usponset FTR Oslo-medlem kan ikke bli med", await join(amina, C), false);
  expect("32: usponset FTR Oslo-medlem har ikke tilgang", await hasAccess(amina, C), false);
  const tuActive = (await admin.from("memberships").select("user_id").eq("community_id", TU).eq("status", "active")).data!.length;
  expect("33: deltakelse gir ikke alle medlemmer adgang", team.length < tuActive, true);
  expect("33: TU-moderator Hanne er ikke med", team.includes(ids.hanne), false);
  expect("33: Hanne kan ikke bli med uten sponsing", await join(hanne, C), false);

  expect("35: medlem ser begge aktive enheter", await visibleCount(kristoffer, "collaboration_participants", { collaboration_id: C }), 2);
  expect("35: medlem ser hele teamet", (await visibleMemberIds(kristoffer, C)).size, 4);
  expect("R2: vanlig medlem ser ikke plassradene (autorisasjonsmetadata)", await visibleCount(adrian, "collaboration_manager_participants", { collaboration_id: C }), 0);
  expect("R2: forvalter ser plassradene", await visibleCount(emma, "collaboration_manager_participants", { collaboration_id: C }), 2);

  // 37. Joined without a valid sponsorship.
  const staged = await admin.from("collaboration_members").insert({ collaboration_id: C, user_id: ids.linn, status: "active" });
  expect("37: (oppsett) tvunget medlemsrad for Linn", staged.error, null);
  expect("37: medlem uten gyldig sponsing har ingen tilgang", await hasAccess(linn, C), false);
  expect("37: …og ser bare sin egen rad", (await visibleMemberIds(linn, C)).size, 1);
  expect("37: …og vises ikke for teamet", (await visibleMemberIds(adrian, C)).has(ids.linn), false);

  // ══ R1: REPRESENTATION DOES NOT IMPLY MEMBERSHIP — until it is real ═══

  await rememberMembership(ids.miaminge, FTR);
  expect("R1: (oppsett) Mia melder seg selv inn i FTR Oslo", await setMyLocalGroup(miaminge, OSLO), true);
  const S_lars = await sponsor(miaminge, C, P_OSLO, ids.miaminge);
  expect("R1: som faktisk Oslo-medlem kan han sponses via Oslo", typeof S_lars, "string");
  expect("R1: …aksepterer selv", await answerSponsorship(miaminge, S_lars!, true), true);
  expect("R1: …blir med", await join(miaminge, C), true);
  expect("R1: …og har tilgang", await hasAccess(miaminge, C), true);
  expect("R1: (oppsett) Mia forlater FTR Oslo igjen", await setMyLocalGroup(miaminge, null), true);
  expect("R1: tilgangen via Oslo faller bort når hun ikke lenger er Oslo-medlem", await hasAccess(miaminge, C), false);
  expect("R1: forvalterretten består — representasjon avhenger ikke av lokallag", await isManager(miaminge, C), true);

  // ══ IDENTITY ISOLATION ═══════════════════════════════════════════════

  const profilesAfterJoin = await communityProfilesOf(everyone);
  expect("54–56: ingen fellesskapsprofil (FTR/TU/UTR) endret ved å bli med", JSON.stringify(profilesAfterJoin), JSON.stringify(profilesBefore));
  expect("57: ingen fellesskapsprofil kopiert inn i collaboration_profiles", ((await admin.from("collaboration_profiles").select("user_id").eq("collaboration_id", C)).data ?? []).length, 0);
  expect("58: medlemmer uten samarbeidsprofil har likevel tilgang", await hasAccess(ingrid, C), true);
  const forgedProfile = await admin.from("collaboration_profiles").insert({ collaboration_id: C, user_id: ids.hanne, display_name: "Hanne" });
  expect("58: samarbeidsprofil krever medlemsrad (FK)", forgedProfile.error !== null, true);

  // ══ ORGANISATION ISOLATION ═══════════════════════════════════════════

  // Selects a column each role is actually granted (memberships has
  // column-level grants), so zero means "no rows", never "query failed".
  const count = async (client: Client, table: "memberships" | "community_profiles" | "profiles", column: string, value: string) =>
    seen(await client.from(table).select(table === "community_profiles" ? "user_id" : "id").eq(column, value));

  // Positive controls: the very same queries do return rows for the
  // organisation's own administrator, so the zeros below are refusals.
  expect("kontroll: FTR-admin ser FTR-medlemskap", Number(await count(miaminge, "memberships", "community_id", FTR)) > 0, true);
  expect("kontroll: FTR-admin ser FTR Oslo-medlemskap", Number(await count(miaminge, "memberships", "local_group_id", OSLO)) >= 2, true);
  expect("kontroll: TU-admin ser TU-medlemskap", Number(await count(emma, "memberships", "community_id", TU)) > 0, true);
  expect("kontroll: FTR-admin ser Kristoffers FTR-profil", await count(miaminge, "community_profiles", "user_id", ids.kristoffer), 1);

  expect("46: TU-admin ser ingen FTR-medlemskap", await count(emma, "memberships", "community_id", FTR), 0);
  expect("47: TU-admin ser ingen FTR Oslo-medlemskap", await count(emma, "memberships", "local_group_id", OSLO), 0);
  expect("48: FTR-admin ser ingen TU-medlemskap", await count(miaminge, "memberships", "community_id", TU), 0);
  expect("49: TU-forvalter får ingen FTR-lokallagstall", seen(await emma.rpc("local_group_member_counts", { p_community_id: FTR })), 0);
  expect("50: samarbeidsmedlem (TU) ser ingen FTR-medlemskap", await count(adrian, "memberships", "community_id", FTR), 0);
  expect("50: samarbeidsmedlem (FTR Oslo) ser ingen TU-medlemskap", await count(kristoffer, "memberships", "community_id", TU), 0);
  expect("51: TU-medlem ser ikke Kristoffers FTR-profil", await count(adrian, "community_profiles", "user_id", ids.kristoffer), 0);
  expect("51: FTR Oslo-medlem ser ikke Adrians TU-profil", await count(kristoffer, "community_profiles", "user_id", ids.adrian), 0);
  expect("51: TU-admin ser ikke Kristoffers FTR-profil", await count(emma, "community_profiles", "user_id", ids.kristoffer), 0);
  expect("51: FTR-admin ser ikke Adrians TU-profil", await count(miaminge, "community_profiles", "user_id", ids.adrian), 0);
  expect("51: FTR-admin ser ikke Emmas TU-profil", await count(miaminge, "community_profiles", "user_id", ids.emma), 0);
  expect("52: TU-medlem ser ikke Kristoffers konto", await count(adrian, "profiles", "id", ids.kristoffer), 0);
  expect("52: TU-admin ser ikke Mias konto", await count(emma, "profiles", "id", ids.miaminge), 0);
  expect("53: Oslo-medlem ser bare sin egen FTR Oslo-rad", await count(kristoffer, "memberships", "local_group_id", OSLO), 1);

  const pickerFunctions = sql(
    "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and (p.proname ilike '%eligible%' or (p.proname ilike '%collaboration%' and (p.proname ilike '%list%' or p.proname ilike '%candidate%' or p.proname ilike '%local_group%')))",
  );
  expect("49: ingen liste-/kandidat-/lokallagsfunksjon for samarbeid finnes", pickerFunctions, "0");
  const picker = await emma.rpc("list_eligible_members" as never, { p_collaboration_id: C } as never);
  expect("49: list_eligible_members finnes ikke", picker.error !== null, true);

  // ══ MULTIPLE SPONSORS ═══════════════════════════════════════════════

  await rememberMembership(ids.petter, FTR);
  expect("43: (oppsett) Petter flytter selv til FTR Oslo", await setMyLocalGroup(petter, OSLO), true);
  const S_petter_oslo = await sponsor(miaminge, C, P_OSLO, ids.petter);
  const S_petter_tu = await sponsor(emma, C, P_TU, ids.petter);
  expect("43: ny TU-sponsing etter avslag gir ny rad", S_petter_tu !== S_petter_tu_1 && typeof S_petter_tu === "string", true);
  expect("43: Petter aksepterer Oslo-sponsing", await answerSponsorship(petter, S_petter_oslo!, true), true);
  expect("43: Petter aksepterer TU-sponsing", await answerSponsorship(petter, S_petter_tu!, true), true);
  expect("43: Petter blir med", await join(petter, C), true);
  expect("43: Petter har tilgang", await hasAccess(petter, C), true);

  // 44. Provenance.
  expect("44: vanlig medlem ser ikke Petters sponsinger", (await visibleSponsorshipsOf(adrian, C, ids.petter)).length, 0);
  expect("44: FTR Oslo-medlem ser ikke Petters sponsinger", (await visibleSponsorshipsOf(kristoffer, C, ids.petter)).length, 0);
  expect("44: TU-representant ser bare TUs sponsinger av Petter", (await visibleSponsorshipsOf(emma, C, ids.petter)).every((s) => s.participant_id === P_TU), true);
  expect("44: FTR-representant ser bare FTR Oslos sponsing av Petter", (await visibleSponsorshipsOf(miaminge, C, ids.petter)).map((s) => s.participant_id).join(), P_OSLO);
  expect("44: Petter ser begge sine egne", (await visibleSponsorshipsOf(petter, C, ids.petter)).filter((s) => s.id !== S_petter_tu_1).length, 2);

  expect("43: TU trekker sin sponsing av Petter", await revoke(emma, S_petter_tu!), true);
  expect("43: Petter beholder tilgang via FTR Oslo", await hasAccess(petter, C), true);
  await setMyLocalGroup(petter, TRONDELAG);
  expect("45: uten noen gyldig sponsing forsvinner tilgangen", await hasAccess(petter, C), false);
  expect("45: …og Petter forsvinner fra teamet andre ser", (await visibleMemberIds(adrian, C)).has(ids.petter), false);
  expect("45: …men medlemsraden står (ingen synkronisering)", (await memberRows(C)).find((m) => m.user_id === ids.petter)?.status, "active");

  // ══ MEMBERSHIP REVOCATION ═══════════════════════════════════════════

  await rememberMembership(ids.adrian, TU);
  await admin.from("memberships").update({ status: "requested" }).eq("user_id", ids.adrian).eq("community_id", TU);
  expect("39: TU-medlemskap borte → TU-sponsing gir ikke tilgang", await hasAccess(adrian, C), false);
  expect("39: …og kan ikke bli med på nytt", await join(adrian, C), false);
  await admin.from("memberships").update({ status: "active" }).eq("user_id", ids.adrian).eq("community_id", TU);
  expect("39: gjenopprettet medlemskap gjenoppretter tilgang uten synk", await hasAccess(adrian, C), true);

  await rememberMembership(ids.kristoffer, FTR);
  await setMyLocalGroup(kristoffer, TRONDELAG);
  expect("40: flytter ut av Oslo → Oslo-sponsing gir ikke tilgang", await hasAccess(kristoffer, C), false);
  await setMyLocalGroup(kristoffer, null);
  expect("40: forlater lokallag → ingen tilgang", await hasAccess(kristoffer, C), false);
  await setMyLocalGroup(kristoffer, OSLO);
  expect("40: tilbake i Oslo → tilgang igjen", await hasAccess(kristoffer, C), true);

  // ══ R5: A RETIRED LOCAL GROUP STOPS COUNTING ════════════════════════

  await rememberGroup(OSLO);
  const retired = await miaminge.rpc("set_local_group_active", { p_local_group_id: OSLO, p_active: false });
  expect("R5: (oppsett) FTR-admin avvikler FTR Oslo", retired.data, true);
  expect("R5: Oslo-sponsing gir ikke lenger tilgang", await hasAccess(kristoffer, C), false);
  expect("R5: forvalterrett utledet fra Oslo-deltakeren faller bort", await isManager(miaminge, C), false);
  expect("R5: deltakerraden står uendret", (await participant(P_OSLO)).status, "active");
  expect("R5: sponsingsraden står uendret", await sponsorshipStatus(S_kristoffer!), "accepted");
  expect("R5: medlemsraden står uendret", (await memberRows(C)).find((m) => m.user_id === ids.kristoffer)?.status, "active");
  expect("R5: kan ikke sponse nye via avviklet lokallag", await sponsor(miaminge, C, P_OSLO, ids.amina), null);
  expect("R5: kan ikke opprette samarbeid fra avviklet lokallag", await create(miaminge, FTR, OSLO, "Fra avviklet lag"), null);
  expect("R5: Kristoffer vises ikke for teamet", (await visibleMemberIds(adrian, C)).has(ids.kristoffer), false);
  await miaminge.rpc("set_local_group_active", { p_local_group_id: OSLO, p_active: true });
  expect("R5: gjenopprettet lokallag gjenoppretter tilgang uten synk", await hasAccess(kristoffer, C), true);
  expect("R5: …og forvalterretten", await isManager(miaminge, C), true);

  // ══ R2 / SUCCESSION: THE SEAT BELONGS TO THE UNIT ═══════════════════

  expect("59: effektivt medlem uten representasjon er ikke forvalter", await isManager(adrian, C), false);
  expect("59: …og kan ikke invitere", await inviteOrg(adrian, C, UTR), null);

  // 14. Forged or stale historical actor data grants nothing: the seat's
  // provenance and the audit log may name Linn, and she is still no manager.
  await admin.from("collaboration_manager_participants").update({ granted_by_user_id: ids.linn }).eq("participant_id", P_OSLO);
  await admin.from("collaboration_audit_log").insert({
    collaboration_id: C,
    actor_user_id: ids.linn,
    action: "participant_accepted",
    participant_id: P_OSLO,
    community_id: FTR,
    local_group_id: OSLO,
  });
  expect("S14: forfalsket granted_by/revisjonsrad gir ingen forvalterrett", await isManager(linn, C), false);
  expect("S14: …kan ikke invitere", await inviteOrg(linn, C, UTR), null);
  expect("S14: den faktiske representanten er upåvirket av proveniensen", await isManager(miaminge, C), true);
  const duplicateSeat = await admin.from("collaboration_manager_participants").insert({ collaboration_id: C, participant_id: P_OSLO });
  expect("S: én plass per deltaker (unik)", duplicateSeat.error !== null, true);
  if (C_oslo) {
    const crossSeat = await admin.from("collaboration_manager_participants").insert({ collaboration_id: C_oslo, participant_id: P_TU });
    expect("S: plass kan ikke peke på et annet samarbeids deltaker (FK)", crossSeat.error !== null, true);
  }

  // Management is institutional: leaving the team does not remove it.
  expect("R2: Emma forlater teamet", await leave(emma, C), true);
  expect("R2: …mister arbeidsflate-tilgang", await hasAccess(emma, C), false);
  expect("R2: …men er fortsatt forvalter som TU-representant", await isManager(emma, C), true);
  expect("R2: Emma blir med igjen", await join(emma, C), true);

  // ── FTR succession (S1–S13) ──
  //
  // Mia is made a real, validly sponsored FTR Oslo team member first, so
  // that the demotion below shows a team seat does not carry management. Kari
  // (an FTR moderator on no team here) then becomes FTR's administrator.
  await rememberMembership(ids.kari, FTR);
  expect("S1: FTR Oslo har en forvalterplass", (await seatRows(C)).map((r) => r.participant_id).sort().join(), [P_TU, P_OSLO].sort().join());
  expect("S2: nåværende FTR-admin utøver den", await isManager(miaminge, C), true);
  expect("S9: (oppsett) Mia i FTR Oslo igjen", await setMyLocalGroup(miaminge, OSLO), true);
  expect("S9: Mia har gyldig teamplass", await hasAccess(miaminge, C), true);
  expect("S9: Kari har ingen teamplass", `${await hasAccess(kari, C)}|${(await memberRows(C)).some((m) => m.user_id === ids.kari)}`, "false|false");
  expect("S13: Kari kan ikke utøve plassen før hun er admin", await isManager(kari, C), false);

  const seatsBefore = JSON.stringify(await seatRows(C));
  const auditBefore = (await admin.from("collaboration_audit_log").select("id").eq("collaboration_id", C)).data!.length;

  await admin.from("memberships").update({ role: "member" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.kari).eq("community_id", FTR);

  expect("S4: tidligere FTR-admin mister forvalterretten umiddelbart", await isManager(miaminge, C), false);
  expect("S5: ny FTR-admin får forvalterretten umiddelbart", await isManager(kari, C), true);
  expect("S6: ingen plass-rad endret ved skiftet", JSON.stringify(await seatRows(C)), seatsBefore);
  expect("S6: ingen revisjonsrad/synk skrevet ved skiftet", (await admin.from("collaboration_audit_log").select("id").eq("collaboration_id", C)).data!.length, auditBefore);
  expect("S9: tidligere admin beholder teamplassen, men ikke forvalterretten", `${await hasAccess(miaminge, C)}|${await isManager(miaminge, C)}`, "true|false");
  expect("S9: ny admin forvalter uten teamplass", `${await hasAccess(kari, C)}|${await isManager(kari, C)}`, "false|true");
  expect("S8: tidligere admin kan ikke invitere organisasjoner", await inviteOrg(miaminge, C, UTR), null);
  expect("S8: tidligere admin kan ikke sponse via FTR Oslo", await sponsor(miaminge, C, P_OSLO, ids.amina), null);
  expect("S8: tidligere admin ser ikke lenger plassradene", await visibleCount(miaminge, "collaboration_manager_participants", { collaboration_id: C }), 0);
  const P_UTR_by_kari = await inviteOrg(kari, C, UTR);
  expect("S7: ny admin kan invitere en annen organisasjon", typeof P_UTR_by_kari, "string");
  expect("S7: (opprydding) UTR avslår", await decline(octavio, P_UTR_by_kari!), true);
  expect("S5: ny admin representerer FTR Oslo også for sponsing", typeof (await sponsor(kari, C, P_OSLO, ids.amina)), "string");
  expect("S5: ny admin ser plassradene", await visibleCount(kari, "collaboration_manager_participants", { collaboration_id: C }), 2);
  if (C_oslo) {
    expect("S5: arven gjelder også samarbeidet Mia opprettet", await isManager(kari, C_oslo), true);
    expect("S4: …og der mister Mia den", await isManager(miaminge, C_oslo), false);
    expect("S13: TU-admin kan ikke utøve FTR Oslos plass", await isManager(emma, C_oslo), false);
    expect("S13: UTR-admin kan ikke utøve FTR Oslos plass", await isManager(octavio, C_oslo), false);
    expect("S13: FTR-moderator i Oslo kan ikke utøve plassen", await isManager(amina, C_oslo), false);
  }

  // S11–S12 under the new administrator: retiring the group disables the
  // seat for her too; reinstating it restores it.
  await kari.rpc("set_local_group_active", { p_local_group_id: OSLO, p_active: false });
  expect("S11: avviklet lokallag fjerner bruken av plassen", C_oslo ? await isManager(kari, C_oslo) : false, false);
  await kari.rpc("set_local_group_active", { p_local_group_id: OSLO, p_active: true });
  expect("S12: gjenopprettet lokallag gir ny admin plassen tilbake", C_oslo ? await isManager(kari, C_oslo) : true, true);

  // Back to the seeded administrator, who regains it just as automatically.
  await admin.from("memberships").update({ role: "moderator" }).eq("user_id", ids.kari).eq("community_id", FTR);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.miaminge).eq("community_id", FTR);
  expect("S5: gjeninnsatt admin får plassen tilbake uten synk", `${await isManager(miaminge, C)}|${await isManager(kari, C)}`, "true|false");
  expect("S9: (opprydding) Mia ut av FTR Oslo", await setMyLocalGroup(miaminge, null), true);
  expect("S9: uten teamplass er hun fortsatt forvalter", `${await hasAccess(miaminge, C)}|${await isManager(miaminge, C)}`, "false|true");

  // ── TU succession, same rule ──
  await rememberMembership(ids.emma, TU);
  await rememberMembership(ids.hanne, TU);
  await admin.from("memberships").update({ role: "member" }).eq("user_id", ids.emma).eq("community_id", TU);
  expect("R2: tidligere TU-admin er ikke lenger forvalter", await isManager(emma, C), false);
  expect("R2: tidligere TU-admin kan ikke invitere organisasjoner", await inviteOrg(emma, C, UTR), null);
  expect("R2: tidligere TU-admin kan ikke sponse via TU", await sponsor(emma, C, P_TU, ids.hanne), null);
  expect("R2: tidligere TU-admin kan ikke trekke TU-sponsinger", await revoke(emma, S_ingrid!), false);
  expect("R2: tidligere TU-admin kan ikke trekke TU ut", await withdrawUnit(emma, P_TU), false);
  expect("R2: tidligere TU-admin ser ikke lenger TUs sponsinger av andre", (await visibleSponsorshipsOf(emma, C, ids.ingrid)).length, 0);
  expect("R2: teamplassen består (TU-medlem med gyldig sponsing)", await hasAccess(emma, C), true);

  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.hanne).eq("community_id", TU);
  expect("S5: ny TU-admin er forvalter umiddelbart, uten egen rad", await isManager(hanne, C), true);
  const P_UTR_by_hanne = await inviteOrg(hanne, C, UTR);
  expect("S7: ny TU-admin kan invitere en annen organisasjon", typeof P_UTR_by_hanne, "string");
  expect("S7: (opprydding) UTR avslår", await decline(octavio, P_UTR_by_hanne!), true);
  expect("S: ny TU-admin kan sponse via TU", typeof (await sponsor(hanne, C, P_TU, ids.hanne)), "string");
  await admin.from("memberships").update({ role: "moderator" }).eq("user_id", ids.hanne).eq("community_id", TU);
  await admin.from("memberships").update({ role: "admin" }).eq("user_id", ids.emma).eq("community_id", TU);
  expect("S5: gjeninnsatt TU-admin er forvalter igjen", `${await isManager(emma, C)}|${await isManager(hanne, C)}`, "true|false");

  expect("61: forvalter kan ikke sponse via annen deltaker", await sponsor(emma, C, P_OSLO, ids.amina), null);
  expect("62: forvalter kan ikke trekke annen deltakers sponsing", await revoke(emma, S_kristoffer!), false);
  expect("62: Kristoffers sponsing er uendret", await sponsorshipStatus(S_kristoffer!), "accepted");
  expect("62: vanlig medlem kan ikke trekke sponsing", await revoke(adrian, S_ingrid!), false);

  // ══ LEAVING ═════════════════════════════════════════════════════════

  expect("63: Ingrid kan forlate", await leave(ingrid, C), true);
  expect("63: Ingrid har ikke tilgang etter å ha forlatt", await hasAccess(ingrid, C), false);
  expect("63: sponsingshistorikk uendret", await sponsorshipStatus(S_ingrid!), "accepted");
  expect("63: gjentatt forlat er idempotent", await leave(ingrid, C), true);
  const leaveOther = await adrian.rpc("leave_collaboration" as never, { p_collaboration_id: C, p_user_id: ids.kristoffer } as never);
  expect("64: det finnes ingen måte å angi en annen bruker", leaveOther.error !== null, true);
  const updateOther = await adrian
    .from("collaboration_members")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("user_id", ids.kristoffer)
    .select("user_id");
  expect("64: direkte UPDATE på andres medlemsrad avvises", updateOther.error !== null || (updateOther.data ?? []).length === 0, true);
  expect("64: Kristoffer er fortsatt med", await hasAccess(kristoffer, C), true);

  // 42. Explicit revocation.
  expect("42: TU trekker Adrians sponsing", await revoke(emma, S_adrian!), true);
  expect("42: Adrian mister tilgang", await hasAccess(adrian, C), false);
  expect("42: Adrian kan ikke bli med igjen", await join(adrian, C), false);
  expect("42: Adrian kan ikke akseptere en trukket sponsing", await answerSponsorship(adrian, S_adrian!, true), false);

  // 66, 65, 41.
  expect("66: TU-admin kan ikke trekke FTR Oslo", await withdrawUnit(emma, P_OSLO), false);
  expect("66: FTR-moderator kan ikke trekke FTR Oslo", await withdrawUnit(amina, P_OSLO), false);
  expect("66: Oslo-medlem kan ikke trekke FTR Oslo", await withdrawUnit(kristoffer, P_OSLO), false);
  expect("65: FTR-representant kan trekke FTR Oslo", await withdrawUnit(miaminge, P_OSLO), true);
  const left = await participant(P_OSLO);
  expect("65: FTR Oslo har status left og beholder enheten", `${left.status}|${left.local_group_id}`, `left|${OSLO}`);
  expect("41: Kristoffer mister tilgang når enheten trekker seg", await hasAccess(kristoffer, C), false);
  expect("S10: tilbaketrekking fjerner bruken av FTR Oslos plass", await isManager(miaminge, C), false);
  expect("S10: plassraden står som historikk", (await seatRows(C)).some((r) => r.participant_id === P_OSLO), true);
  expect("41: Kristoffers sponsing er beholdt som historikk", await sponsorshipStatus(S_kristoffer!), "accepted");
  expect("41: Emma (TU) har fortsatt tilgang", await hasAccess(emma, C), true);
  expect("41: ny sponsing via trukket enhet avvises", await sponsor(miaminge, C, P_OSLO, ids.amina), null);

  const P_FTR_again = await inviteOrg(emma, C, FTR);
  expect("R4: FTR kan inviteres på nytt etter å ha trukket seg (ny rad)", typeof P_FTR_again === "string" && P_FTR_again !== P_OSLO, true);
  expect("R4: gjeninvitasjonen har ingen enhet valgt", (await participant(P_FTR_again!)).local_group_id, null);

  // Petter, Kristoffer, Adrian, Mia, Emma and Hanne were moved by the
  // checks above and have already been put back; nothing the collaboration
  // did may show here.
  expect("67: medlemskap uendret", JSON.stringify(await membershipsOf(everyone)), JSON.stringify(membershipsBefore));
  expect("67: fellesskapsprofiler uendret", JSON.stringify(await communityProfilesOf(everyone)), JSON.stringify(profilesBefore));

  // ══ AUDIT ═══════════════════════════════════════════════════════════

  const log = (await admin.from("collaboration_audit_log").select("*").eq("collaboration_id", C).order("id")).data ?? [];
  const logged = (action: string, actor: string, subject?: string) =>
    log.some((e) => e.action === action && e.actor_user_id === actor && (subject === undefined || e.subject_user_id === subject));
  expect("revisjon: opprettelse logget med Emma som aktør", logged("collaboration_created", ids.emma), true);
  expect(
    "revisjon: invitasjonen logget på fellesskapsnivå",
    log.some((e) => e.action === "participant_invited" && e.participant_id === P_FTR && e.community_id === FTR && e.local_group_id === null && e.actor_user_id === ids.emma),
    true,
  );
  expect(
    "revisjon: aksepten logget med valgt enhet og Mia som aktør",
    log.some((e) => e.action === "participant_accepted" && e.participant_id === P_FTR && e.local_group_id === OSLO && e.actor_user_id === ids.miaminge),
    true,
  );
  expect(
    "revisjon: forvalterplass logget for deltakeren, med Mia som aktør",
    log.some((e) => e.action === "manager_seat_granted" && e.participant_id === P_OSLO && e.actor_user_id === ids.miaminge && e.subject_user_id === null),
    true,
  );
  expect("revisjon: sponsing logget med sponsor og mål", logged("sponsorship_invited", ids.miaminge, ids.kristoffer), true);
  expect("revisjon: aksept av sponsing logget av personen selv", logged("sponsorship_accepted", ids.kristoffer, ids.kristoffer), true);
  expect("revisjon: avslag logget", logged("sponsorship_declined", ids.petter, ids.petter), true);
  expect("revisjon: tilbaketrekking logget", logged("sponsorship_revoked", ids.emma, ids.adrian), true);
  expect("revisjon: forlate logget", logged("member_left", ids.ingrid), true);
  expect("revisjon: enhet trukket logget", logged("participant_left", ids.miaminge), true);
  expect("revisjon: Emma ble med to ganger (historikk bevart)", log.filter((e) => e.action === "member_joined" && e.subject_user_id === ids.emma).length, 2);

  // ══ ARCHIVE (R3) ════════════════════════════════════════════════════

  expect(
    "R3: ingen arkiveringsfunksjon finnes",
    sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%archive%'"),
    "0",
  );
  const archiveRpc = await emma.rpc("archive_collaboration" as never, { p_collaboration_id: C } as never);
  expect("R3: forvalter kan ikke arkivere via RPC", archiveRpc.error !== null, true);
  const now = () => new Date().toISOString();
  const directArchive = await emma.from("collaborations").update({ status: "archived", archived_at: now() }).eq("id", C).select("id");
  expect("R3: forvalter kan ikke arkivere direkte", directArchive.error !== null || (directArchive.data ?? []).length === 0, true);
  const adrianArchive = await adrian.from("collaborations").update({ status: "archived", archived_at: now() }).eq("id", C).select("id");
  expect("R3: vanlig bruker kan ikke arkivere", adrianArchive.error !== null || (adrianArchive.data ?? []).length === 0, true);
  expect("R3: samarbeidet er fortsatt aktivt", (await admin.from("collaborations").select("status").eq("id", C).single()).data?.status, "active");

  // Behaviour of the archived state, set by maintenance.
  const S_hanne = await sponsor(emma, C, P_TU, ids.hanne); // left unanswered on purpose
  expect("69: (oppsett) Hanne sponset og FTR invitert før arkivering", typeof S_hanne === "string" && typeof P_FTR_again === "string", true);
  const archived = await admin.from("collaborations").update({ status: "archived", archived_at: now() }).eq("id", C);
  expect("R3: (oppsett) vedlikehold arkiverer med service role", archived.error, null);
  expect("68: arkivert samarbeid gir ingen tilgang", await hasAccess(emma, C), false);
  expect("68: arkivert samarbeid gir ingen forvalterrett", await isManager(emma, C), false);
  expect("68: arkivert samarbeid er ikke synlig", await visibleCount(emma, "collaborations", { id: C }), 0);
  expect("68: raden er beholdt", (await admin.from("collaborations").select("status").eq("id", C).single()).data?.status, "archived");
  expect("69: arkivert samarbeid kan ikke invitere organisasjoner", await inviteOrg(emma, C, UTR), null);
  expect("69: invitert organisasjon kan ikke akseptere", await acceptAs(miaminge, P_FTR_again!, null), false);
  expect("70: arkivert samarbeid kan ikke sponse", await sponsor(emma, C, P_TU, ids.adrian), null);
  expect("70: ventende sponsing kan ikke aksepteres", await answerSponsorship(hanne, S_hanne!, true), false);
  expect("71: arkivert samarbeid tar ikke inn nye", await join(ingrid, C), false);

  // ══ RLS / SQL ═══════════════════════════════════════════════════════

  for (const table of COLLABORATION_TABLES) {
    const { data, error } = await anon.from(table).select("*");
    expect(`72: anonym kan ikke lese ${table}`, error !== null || (data ?? []).length === 0, true);
  }
  expect("72: bruker uten relasjon ser ingen samarbeid", await visibleCount(octavio, "collaborations"), 0);
  expect("72: revisjonsloggen er lukket for innloggede", (await emma.from("collaboration_audit_log").select("id")).error !== null, true);

  const clientWrites = sql(
    "select count(*) from information_schema.role_table_grants " +
      "where table_schema = 'public' and table_name like 'collaboration%' " +
      "and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT'",
  );
  expect("73: ingen INSERT/UPDATE/DELETE-rettigheter for klientroller", clientWrites, "0");
  const anonSelect = sql(
    "select count(*) from information_schema.role_table_grants " +
      "where table_schema = 'public' and table_name like 'collaboration%' and grantee in ('anon', 'PUBLIC')",
  );
  expect("73: anon har ingen tabellrettigheter", anonSelect, "0");
  const rlsOff = sql(
    "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
      "where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'collaboration%' and not c.relrowsecurity",
  );
  expect("73: RLS er på for alle samarbeidstabeller", rlsOff, "0");
  const writePolicies = sql(
    "select count(*) from pg_policies where schemaname = 'public' and tablename like 'collaboration%' and cmd <> 'SELECT'",
  );
  expect("73: ingen skrivepolicyer finnes", writePolicies, "0");

  for (const [typed, label] of [[emma, "admin"], [adrian, "medlem"]] as const) {
    // Untyped on purpose: the loop spans tables whose columns differ.
    const client = typed as unknown as SupabaseClient;
    for (const table of COLLABORATION_TABLES) {
      const insert = await client.from(table).insert({});
      expect(`73: ${label} kan ikke INSERT i ${table}`, insert.error !== null, true);
      const del = await client
        .from(table)
        .delete()
        .neq(table === "collaborations" ? "id" : "collaboration_id", randomUUID())
        .select("*");
      expect(`73: ${label} kan ikke DELETE fra ${table}`, del.error !== null || (del.data ?? []).length === 0, true);
    }
  }

  const functions =
    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
    "where n.nspname = 'public' and (p.proname like '%collaboration%')";
  expect("74: samarbeidsfunksjoner finnes", Number(sql(`select count(*) ${functions}`)) >= 24, true);
  expect("74: alle er SECURITY DEFINER", sql(`select count(*) ${functions} and not p.prosecdef`), "0");
  expect(
    "74: alle har låst search_path",
    sql(`select count(*) ${functions} and not coalesce('search_path=public' = any(p.proconfig), false)`),
    "0",
  );
  expect("75: PUBLIC kan ikke kjøre noen", sql(`select count(*) ${functions} and has_function_privilege('public', p.oid, 'execute')`), "0");
  expect("75: anon kan ikke kjøre noen", sql(`select count(*) ${functions} and has_function_privilege('anon', p.oid, 'execute')`), "0");
  const internal = [
    "collaboration_unit_is_valid",
    "can_represent_collaboration_unit",
    "collaboration_unit_includes",
    "collaboration_participant_in_force",
    "collaboration_has_valid_sponsorship",
    "collaboration_user_has_access",
    "collaboration_log",
    "collaboration_enrol_representative",
  ];
  const internalList = internal.map((f) => `'${f}'`).join(",");
  expect("76: alle interne hjelpere finnes", sql(`select count(*) ${functions} and p.proname in (${internalList})`), internal.length);
  expect(
    "76: interne hjelpere er ikke kjørbare for authenticated",
    sql(`select count(*) ${functions} and p.proname in (${internalList}) and has_function_privilege('authenticated', p.oid, 'execute')`),
    "0",
  );
  const oracle = await octavio.rpc("collaboration_unit_includes" as never, {
    p_community_id: FTR,
    p_local_group_id: OSLO,
    p_user_id: ids.kristoffer,
  } as never);
  expect("76: medlemskaps-orakel kan ikke kalles", oracle.error !== null, true);
  const repOracle = await octavio.rpc("can_represent_collaboration_unit" as never, {
    p_community_id: FTR,
    p_local_group_id: null,
    p_user_id: ids.miaminge,
  } as never);
  expect("76: representasjons-orakel kan ikke kalles", repOracle.error !== null, true);
  const accessOracle = await octavio.rpc("collaboration_user_has_access" as never, { p_collaboration_id: C, p_user_id: ids.emma } as never);
  expect("76: tilgangs-orakel kan ikke kalles", accessOracle.error !== null, true);
  const enrol = await amina.rpc("collaboration_enrol_representative" as never, { p_collaboration_id: C, p_participant_id: P_OSLO } as never);
  expect("76: selv-innmelding kan ikke kalles direkte", enrol.error !== null, true);
  const viewMember = await octavio.rpc("can_view_collaboration_member", { p_collaboration_id: C, p_user_id: ids.emma });
  expect("76: can_view_collaboration_member svarer nei utenfra", viewMember.data, false);

  // 77. The composite FK.
  const forgedPair = await admin.from("collaboration_participants").insert({
    collaboration_id: C,
    community_id: TU,
    local_group_id: OSLO,
    status: "active",
    responded_at: now(),
    joined_at: now(),
  });
  expect("77: FK avviser TU + FTR Oslo", forgedPair.error !== null, true);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} samarbeidskontroller feilet.\n`);
    return;
  }
  console.log(`✓ ${checks} samarbeidskontroller passerte`);
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
