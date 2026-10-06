/**
 * Checks public organisation people under real authenticated sessions.
 *
 * These rows are intentionally not memberships and not profiles. The tests use
 * normal anon-key clients for reads and writes so row level security is what
 * answers, while the service role only prepares ids and verifies database
 * invariants a browser client must not be able to inspect.
 *
 * Run with `npm run check:organization-people` against the local stack after
 * `npm run seed`.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { underTheRugCrew } from "@/lib/mock/community-people";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
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

async function profileId(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  return data!.id;
}

async function emailFor(handle: string): Promise<string> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  return user.user!.email!;
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) {
    throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  }

  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function groupId(communityId: string, name: string): Promise<string> {
  const { data } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", communityId)
    .eq("name", name)
    .single();
  return data!.id;
}

async function communityPeople(client: SupabaseClient<Database>, communityId?: string) {
  let query = client
    .from("community_people")
    .select("id, community_id, section, local_group_id, name, role, email, description, sort_order")
    .order("sort_order", { ascending: true });
  if (communityId) query = query.eq("community_id", communityId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function main() {
  const kristoffer = await signIn(await emailFor("kristoffer")); // ordinary FTR member
  const nadia = await signIn(await emailFor("nadia")); // FTR moderator
  const mia = await signIn(await emailFor("miaminge")); // FTR admin
  const adrian = await signIn(await emailFor("adrian")); // ordinary TU member
  const robin = await signIn(await emailFor("robinsaether")); // UTR moderator
  const mina = await signIn(await emailFor("minasolberg")); // ordinary UTR member
  const anon = anonymous();

  const ftrPeople = await communityPeople(kristoffer, "tryggere-ruspolitikk");
  expect("FTR-medlem kan lese FTR organisasjonspersoner", ftrPeople.length > 0, true);
  expect("FTR har Bent som lokallagsleder", ftrPeople.some((p) => p.name === "Bent Heier Johansen"), true);
  expect("organisasjonspersoner har ingen profil-id", "user_id" in (ftrPeople[0] ?? {}), false);

  const { data: ftrMemberRows } = await kristoffer
    .from("memberships")
    .select("user_id, community_id, role")
    .eq("community_id", "tryggere-ruspolitikk");
  expect("FTR-medlem får ikke privat medlemskatalog", (ftrMemberRows ?? []).length, 1);

  const { data: moderatorRows } = await nadia
    .from("memberships")
    .select("user_id, community_id, role")
    .eq("community_id", "tryggere-ruspolitikk");
  expect("FTR-moderator får ikke privat medlemskatalog", (moderatorRows ?? []).length, 1);

  const { data: adminRows } = await mia
    .from("memberships")
    .select("user_id, community_id, role")
    .eq("community_id", "tryggere-ruspolitikk");
  expect("FTR-admin beholder privat medlemsadministrasjon", (adminRows ?? []).length > 1, true);

  const tuPeople = await communityPeople(adrian, "tryggere-ungdom");
  expect("TU-medlem kan lese TU organisasjonspersoner", tuPeople.length > 0, true);
  expect("TU har ingen seedede lokallagsledere", tuPeople.some((p) => p.section === "local_group_leader"), false);
  expect("TU ser ikke FTR-personer", tuPeople.some((p) => p.community_id === "tryggere-ruspolitikk"), false);
  expect("FTR ser ikke TU-personer", ftrPeople.some((p) => p.community_id === "tryggere-ungdom"), false);

  const utrPeople = await communityPeople(robin, "under-the-rug");
  const expectedCrewByName = new Map(underTheRugCrew.map((person) => [person.name, person]));
  expect("UTR har 24 Crew-personer", utrPeople.length, 24);
  expect("UTR Crew-navn er unike", new Set(utrPeople.map((p) => p.name)).size, 24);
  expect("UTR Crew bruker crew-seksjonen", utrPeople.every((p) => p.section === "crew"), true);
  expect(
    "UTR Crew-roller matcher seed",
    utrPeople.every((person) => expectedCrewByName.get(person.name)?.role === person.role),
    true,
  );
  expect(
    "UTR Crew har ikke medlemsmetadata i organisasjonsrader",
    utrPeople.every((p) => !p.local_group_id && !p.email && !p.description),
    true,
  );
  expect("UTR organisasjonspersoner har ingen profil-id", "user_id" in (utrPeople[0] ?? {}), false);

  const utrPeopleForMina = await communityPeople(mina, "under-the-rug");
  expect("ordinært UTR-medlem kan lese UTR Crew", utrPeopleForMina.length, 24);

  const { data: utrRawPeople } = await admin
    .from("community_people")
    .select("id, user_id, name")
    .eq("community_id", "under-the-rug")
    .eq("section", "crew");
  expect(
    "bare Octavio-raden er eksplisitt koblet til TING-konto",
    (utrRawPeople ?? []).filter((person) => person.user_id).map((person) => person.name).join(","),
    "Octavio Esperanto",
  );

  const { data: utrMemberships } = await admin
    .from("memberships")
    .select("user_id")
    .eq("community_id", "under-the-rug")
    .eq("status", "active");
  const { data: utrProfiles } = await admin
    .from("profiles")
    .select("id, name")
    .in("id", (utrMemberships ?? []).map((membership) => membership.user_id));
  const crewNames = new Set(underTheRugCrew.map((person) => person.name));
  expect(
    "Crew seed oppretter bare eksplisitt Octavio-medlemskap",
    (utrProfiles ?? [])
      .filter((profile) => crewNames.has(profile.name))
      .map((profile) => profile.name)
      .join(","),
    "Octavio Esperanto",
  );

  const { data: utrDmActions } = await mina.rpc("organization_person_dm_actions", {
    p_community_id: "under-the-rug",
  });
  expect("bare eksplisitt koblet UTR Crew-rad får DM-handling", (utrDmActions ?? []).length, 1);

  // ── community_people_linked_member_details: Crew-card enrichment ────────
  //
  // Never exposes user_id, a membership id, an email or a role — only what a
  // Crew card is allowed to add to its own already-public row: bio, location,
  // and membership title.
  const octavioPerson = (utrRawPeople ?? []).find((person) => person.name === "Octavio Esperanto");
  const unlinkedCrewPerson = (utrRawPeople ?? []).find((person) => person.name !== "Octavio Esperanto");
  if (!octavioPerson || !unlinkedCrewPerson) {
    throw new Error("forventet UTR Crew-fixture (koblet og ukoblet) mangler");
  }

  const { data: minaLinkedDetails, error: minaLinkedDetailsError } = await mina.rpc(
    "community_people_linked_member_details",
    { p_community_id: "under-the-rug" },
  );
  expect("aktivt UTR-medlem kan hente Crew-berikelse uten feil", minaLinkedDetailsError, null);
  expect(
    "berikelsen dekker akkurat den eksplisitt koblede Crew-raden",
    (minaLinkedDetails ?? []).map((row) => row.person_id).join(","),
    octavioPerson.id,
  );
  expect(
    "ukoblet Crew-person får ingen oppdiktet berikelse",
    (minaLinkedDetails ?? []).some((row) => row.person_id === unlinkedCrewPerson.id),
    false,
  );
  const octavioDetails = (minaLinkedDetails ?? []).find((row) => row.person_id === octavioPerson.id);
  expect("Octavios berikelse har bio", Boolean(octavioDetails?.bio), true);
  expect("Octavios berikelse har sted", Boolean(octavioDetails?.location), true);
  expect(
    "berikelses-raden eksponerer aldri user_id",
    Object.prototype.hasOwnProperty.call(octavioDetails ?? {}, "user_id"),
    false,
  );

  const { data: kristofferLinkedDetails } = await kristoffer.rpc(
    "community_people_linked_member_details",
    { p_community_id: "under-the-rug" },
  );
  expect(
    "medlem av annet fellesskap får ingen UTR Crew-berikelse (kryss-fellesskap)",
    (kristofferLinkedDetails ?? []).length,
    0,
  );

  const { data: anonLinkedDetails } = await anon.rpc("community_people_linked_member_details", {
    p_community_id: "under-the-rug",
  });
  expect("anonym får ingen Crew-berikelse", (anonLinkedDetails ?? []).length, 0);

  // An inactive linked membership must drop out of the enrichment immediately
  // — restored exactly afterwards, same pattern as check-role-management.ts.
  const { data: octavioMembership } = await admin
    .from("memberships")
    .select("*")
    .eq("user_id", await profileId("octavio"))
    .eq("community_id", "under-the-rug")
    .single();
  if (!octavioMembership) throw new Error("fant ikke Octavios UTR-medlemskap");
  await admin.from("memberships").update({ status: "requested" }).eq("id", octavioMembership.id);
  const { data: minaLinkedDetailsInactive } = await mina.rpc(
    "community_people_linked_member_details",
    { p_community_id: "under-the-rug" },
  );
  expect(
    "inaktivt koblet medlemskap gir ikke lenger berikelse",
    (minaLinkedDetailsInactive ?? []).length,
    0,
  );
  await admin
    .from("memberships")
    .update({ status: octavioMembership.status })
    .eq("id", octavioMembership.id);
  const { data: minaLinkedDetailsRestored } = await mina.rpc(
    "community_people_linked_member_details",
    { p_community_id: "under-the-rug" },
  );
  expect(
    "berikelse er tilbake etter gjenoppretting av medlemskapet",
    (minaLinkedDetailsRestored ?? []).map((row) => row.person_id).join(","),
    octavioPerson.id,
  );

  const anonPeople = await anon.from("community_people").select("id").limit(1);
  expect("anonym tilgang er ikke utvidet", (anonPeople.data ?? []).length, 0);

  const firstFtrPerson = ftrPeople[0]!;
  const ordinaryInsert = await kristoffer.from("community_people").insert({
    community_id: "tryggere-ruspolitikk",
    section: "staff",
    name: "CHECK medlem",
  });
  expect("ordinært medlem kan ikke opprette organisasjonsperson", ordinaryInsert.error !== null, true);

  const moderatorUpdate = await nadia
    .from("community_people")
    .update({ active: false })
    .eq("id", firstFtrPerson.id)
    .select("id");
  expect("moderator kan ikke deaktivere organisasjonsperson", (moderatorUpdate.data ?? []).length, 0);

  const ftrTrondelag = await groupId("tryggere-ruspolitikk", "FTR Trøndelag");
  const tuOslo = await groupId("tryggere-ungdom", "TU Oslo");

  const ftrWithTuGroup = await admin.from("community_people").insert({
    community_id: "tryggere-ruspolitikk",
    section: "local_group_leader",
    local_group_id: tuOslo,
    name: "CHECK feil lokallag",
  });
  expect("FTR-leder kan ikke peke på TU-lokallag", ftrWithTuGroup.error !== null, true);

  const tuWithFtrGroup = await admin.from("community_people").insert({
    community_id: "tryggere-ungdom",
    section: "local_group_leader",
    local_group_id: ftrTrondelag,
    name: "CHECK feil lokallag",
  });
  expect("TU-leder kan ikke peke på FTR-lokallag", tuWithFtrGroup.error !== null, true);

  const { data: omarProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("name", "Omar Nawaz")
    .maybeSingle();
  expect("sentralstyre-rad lager ikke falsk TING-profil", omarProfile?.id ?? null, null);

  const kristofferId = await profileId("kristoffer");
  const petterId = await profileId("petter");
  const { data: canDm } = await kristoffer.rpc("can_send_dm", {
    cid: "tryggere-ruspolitikk",
    recipient: petterId,
  });
  expect("DM-policy er fortsatt staff_only for vanlige FTR-medlemmer", canDm, false);

  const { data: localChoice } = await admin
    .from("memberships")
    .select("local_group_id")
    .eq("user_id", await profileId("karimoen"))
    .eq("community_id", "tryggere-ruspolitikk")
    .single();
  expect("eksisterende lokallagsvalg er uendret", localChoice?.local_group_id, ftrTrondelag);

  const roleUpdate = await kristoffer
    .from("memberships")
    .update({ role: "admin" })
    .eq("user_id", kristofferId)
    .eq("community_id", "tryggere-ruspolitikk")
    .select("id");
  expect("ingen bred memberships update-policy er introdusert", (roleUpdate.data ?? []).length, 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }

  console.log(`✓ ${checks} organisasjonsperson-kontroller passerte`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
