/**
 * Checks direct-message security under real authenticated sessions.
 *
 * Run with `npm run check:direct-messages` against the local stack after
 * `npm run seed`. Service role is used only to look up fixture ids, set up
 * temporary CHECK rows, and clean up afterwards; behaviour checks use normal
 * anon-key clients under RLS.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

let failures = 0;
let checks = 0;

const createdConversationIds = new Set<string>();
const createdPersonIds = new Set<string>();
const touchedDmSettings: { userId: string; communityId: string; value: boolean }[] = [];
const touchedMembershipStatuses: {
  userId: string;
  communityId: string;
  status: Database["public"]["Enums"]["membership_status"];
}[] = [];

const TR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function emailFor(handle: string): Promise<string> {
  const { data: user, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  return user.user!.email!;
}

async function signIn(handle: string): Promise<SupabaseClient<Database>> {
  const email = await emailFor(handle);
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

async function acceptsMemberDms(userId: string, communityId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("memberships")
    .select("accepts_member_dms")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .single();
  if (error) throw error;
  return data.accepts_member_dms;
}

async function membershipStatus(
  userId: string,
  communityId: string,
): Promise<Database["public"]["Enums"]["membership_status"]> {
  const { data, error } = await admin
    .from("memberships")
    .select("status")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .single();
  if (error) throw error;
  return data.status;
}

async function setAcceptsMemberDms(
  userId: string,
  communityId: string,
  value: boolean,
) {
  touchedDmSettings.push({
    userId,
    communityId,
    value: await acceptsMemberDms(userId, communityId),
  });
  const { error } = await admin
    .from("memberships")
    .update({ accepts_member_dms: value })
    .eq("user_id", userId)
    .eq("community_id", communityId);
  if (error) throw error;
}

async function setMembershipStatus(
  userId: string,
  communityId: string,
  status: Database["public"]["Enums"]["membership_status"],
) {
  if (!touchedMembershipStatuses.some((row) => row.userId === userId && row.communityId === communityId)) {
    touchedMembershipStatuses.push({
      userId,
      communityId,
      status: await membershipStatus(userId, communityId),
    });
  }
  const { error } = await admin
    .from("memberships")
    .update({ status })
    .eq("user_id", userId)
    .eq("community_id", communityId);
  if (error) throw error;
}

async function start(
  client: SupabaseClient<Database>,
  communityId: string,
  recipientId: string,
) {
  const { data, error } = await client.rpc("start_direct_conversation", {
    p_community_id: communityId,
    p_recipient_id: recipientId,
  });
  if (data) createdConversationIds.add(data);
  return { id: data, error };
}

async function send(
  client: SupabaseClient<Database>,
  conversationId: string,
  body: string,
) {
  const { data, error } = await client
    .from("direct_messages")
    .insert({ conversation_id: conversationId, body })
    .select("id, author_id, body")
    .maybeSingle();
  return { row: data, error };
}

async function cleanup() {
  for (const membership of touchedMembershipStatuses.reverse()) {
    await admin
      .from("memberships")
      .update({ status: membership.status })
      .eq("user_id", membership.userId)
      .eq("community_id", membership.communityId);
  }

  for (const setting of touchedDmSettings.reverse()) {
    await admin
      .from("memberships")
      .update({ accepts_member_dms: setting.value })
      .eq("user_id", setting.userId)
      .eq("community_id", setting.communityId);
  }

  if (createdPersonIds.size > 0) {
    await admin.from("community_people").delete().in("id", [...createdPersonIds]);
  }

  if (createdConversationIds.size > 0) {
    await admin
      .from("notifications")
      .delete()
      .in(
        "href",
        [...createdConversationIds].map((id) => `/community/${TR}/messages/${id}`),
      );
    await admin
      .from("notifications")
      .delete()
      .in(
        "href",
        [...createdConversationIds].map((id) => `/community/${TU}/messages/${id}`),
      );
    await admin
      .from("notifications")
      .delete()
      .in(
        "href",
        [...createdConversationIds].map((id) => `/community/${UTR}/messages/${id}`),
      );
    await admin.from("direct_conversations").delete().in("id", [...createdConversationIds]);
  }
}

async function main() {
  const [
    kristofferId,
    petterId,
    nadiaId,
    ingridId,
    jonasId,
    oskarId,
    tobiasId,
    sofieId,
  ] = await Promise.all([
    profileId("kristoffer"),
    profileId("petter"),
    profileId("nadia"),
    profileId("ingrid"),
    profileId("jonas"),
    profileId("oskar"),
    profileId("tobias"),
    profileId("sofie"),
  ]);

  const kristoffer = await signIn("kristoffer");
  const petter = await signIn("petter");
  const nadia = await signIn("nadia");
  const ingrid = await signIn("ingrid");
  const jonas = await signIn("jonas");
  const _oskar = await signIn("oskar");
  const tobias = await signIn("tobias");
  const mia = await signIn("miaminge");
  const emma = await signIn("emmamortensen");
  const anon = anonymous();

  try {
    const anonConversations = await anon.from("direct_conversations").select("id");
    expect("anonym kan ikke liste samtaler", (anonConversations.data ?? []).length, 0);

    const anonMessages = await anon.from("direct_messages").select("id");
    expect("anonym kan ikke lese meldinger", (anonMessages.data ?? []).length, 0);

    const anonStart = await anon.rpc("start_direct_conversation", {
      p_community_id: TR,
      p_recipient_id: nadiaId,
    });
    expect("anonym kan ikke starte samtale", anonStart.error !== null, true);

    const self = await start(kristoffer, TR, kristofferId);
    expect("samtale med seg selv avvises", self.error !== null, true);

    const nonMember = await start(kristoffer, TR, sofieId);
    expect("samtale med ikke-medlem avvises", nonMember.error !== null, true);

    const crossSender = await start(kristoffer, UTR, jonasId);
    expect("samtale på tvers av fellesskap avvises", crossSender.error !== null, true);

    const denied = await start(kristoffer, TR, petterId);
    expect("can_send_dm-avslag blokkerer ny samtale", denied.error !== null, true);

    const { data: staffCan } = await ingrid.rpc("can_send_dm", {
      cid: TR,
      recipient: nadiaId,
    });
    expect("Tryggere staff-til-staff følger eksisterende policy", staffCan, true);
    const staffConversation = await start(ingrid, TR, nadiaId);
    expect("Tryggere staff-til-staff kan starte samtale", staffConversation.error?.message ?? "ok", "ok");

    const { data: utrCan } = await jonas.rpc("can_send_dm", {
      cid: UTR,
      recipient: oskarId,
    });
    expect("UTR medlem-til-medlem følger eksisterende policy", utrCan, true);
    const [first, second] = await Promise.all([
      start(jonas, UTR, oskarId),
      start(jonas, UTR, oskarId),
    ]);
    expect("første UTR-start lykkes", first.error?.message ?? "ok", "ok");
    expect("samtidig UTR-start returnerer samme tråd", second.id, first.id);

    const { count: duplicateCount } = await admin
      .from("direct_conversations")
      .select("id", { count: "exact", head: true })
      .eq("community_id", UTR)
      .eq("participant_one_id", jonasId < oskarId ? jonasId : oskarId)
      .eq("participant_two_id", jonasId < oskarId ? oskarId : jonasId);
    expect("unik community/pair hindrer duplikater", duplicateCount, 1);

    const unreadByThirdParty = await tobias
      .from("direct_conversations")
      .select("id")
      .eq("id", first.id!);
    expect("annet medlem kan ikke lese andres samtale", (unreadByThirdParty.data ?? []).length, 0);

    const forgedConversation = await jonas
      .from("direct_conversations")
      .insert({
        community_id: UTR,
        participant_one_id: jonasId,
        participant_two_id: tobiasId,
        created_by: tobiasId,
      } as never)
      .select("id");
    expect("klient kan ikke sette created_by/opprette samtale direkte", forgedConversation.error !== null, true);

    const forgedMessage = await jonas
      .from("direct_messages")
      .insert({
        conversation_id: first.id!,
        author_id: oskarId,
        body: "CHECK DM: forfalsket forfatter",
      } as never)
      .select("id");
    expect("klient kan ikke forfalske author_id", forgedMessage.error !== null, true);

    const normalMessage = await send(jonas, first.id!, "CHECK DM: første melding");
    expect("melding kan sendes av deltaker", normalMessage.error?.message ?? "ok", "ok");
    expect("author_id kommer fra auth.uid()", normalMessage.row?.author_id, jonasId);

    const otherPairMessages = await tobias
      .from("direct_messages")
      .select("id")
      .eq("conversation_id", first.id!);
    expect("annet medlem kan ikke lese andres meldinger", (otherPairMessages.data ?? []).length, 0);

    const wrongConversationInsert = await tobias
      .from("direct_messages")
      .insert({ conversation_id: first.id!, body: "CHECK DM: inntrenger" })
      .select("id");
    expect("annet medlem kan ikke skrive i andres samtale", wrongConversationInsert.error !== null, true);

    const anonSend = await anon
      .from("direct_messages")
      .insert({ conversation_id: first.id!, body: "CHECK DM: anonym" })
      .select("id");
    expect("anonym kan ikke sende melding", anonSend.error !== null, true);

    const empty = await jonas
      .from("direct_messages")
      .insert({ conversation_id: first.id!, body: "   " })
      .select("id");
    expect("tom melding avvises", empty.error !== null, true);

    await setAcceptsMemberDms(nadiaId, TR, true);
    const memberToOptedStaff = await start(kristoffer, TR, nadiaId);
    expect("medlem kan starte til staff som har åpnet for DMer", memberToOptedStaff.error?.message ?? "ok", "ok");

    await setAcceptsMemberDms(nadiaId, TR, false);
    const existingReply = await send(kristoffer, memberToOptedStaff.id!, "CHECK DM: eksisterende samtale lever");
    expect("eksisterende samtale lever etter at nye DMer er slått av", existingReply.error?.message ?? "ok", "ok");

    const newMemberAfterToggle = await start(petter, TR, nadiaId);
    expect("ny medlemstråd stoppes etter at staff slår av nye DMer", newMemberAfterToggle.error !== null, true);

    await setAcceptsMemberDms(ingridId, TU, true);
    const tuPair = await start(nadia, TU, ingridId);
    expect("samme par kan ha egen samtale i TU", tuPair.error?.message ?? "ok", "ok");
    const trPair = await start(nadia, TR, ingridId);
    expect("samme par kan ha egen samtale i FTR", trPair.error?.message ?? "ok", "ok");
    expect("samme par i ulike fellesskap får ulike samtaler", tuPair.id === trPair.id, false);

    const { data: ftrMemberRows } = await kristoffer
      .from("memberships")
      .select("user_id, community_id, role")
      .eq("community_id", TR);
    expect("privat medlemsliste er fortsatt privat for medlem", (ftrMemberRows ?? []).length, 1);

    const roleUpdate = await kristoffer
      .from("memberships")
      .update({ role: "admin" })
      .eq("user_id", kristofferId)
      .eq("community_id", TR)
      .select("id");
    expect("membership update-policy er ikke bredet ut", (roleUpdate.data ?? []).length, 0);

    const { data: localChoice } = await admin
      .from("memberships")
      .select("local_group_id")
      .eq("user_id", await profileId("karimoen"))
      .eq("community_id", TR)
      .single();
    expect("lokallagsvalg er fortsatt lesbart kun via eksisterende regler", Boolean(localChoice), true);

    const linkedAuthorized = await admin
      .from("community_people")
      .insert({
        community_id: TR,
        section: "staff",
        name: "CHECK DM linked staff",
        role: "Testkontakt",
        sort_order: 999,
      })
      .select("id")
      .single();
    if (linkedAuthorized.data?.id) createdPersonIds.add(linkedAuthorized.data.id);

    const linkedUnauthorized = await admin
      .from("community_people")
      .insert({
        community_id: TR,
        section: "staff",
        name: "CHECK DM linked member",
        role: "Testkontakt",
        sort_order: 1000,
      })
      .select("id")
      .single();
    if (linkedUnauthorized.data?.id) createdPersonIds.add(linkedUnauthorized.data.id);

    const unlinked = await admin
      .from("community_people")
      .insert({
        community_id: TR,
        section: "staff",
        name: "CHECK DM unlinked",
        role: "Testkontakt",
        sort_order: 1001,
      })
      .select("id")
      .single();
    if (unlinked.data?.id) createdPersonIds.add(unlinked.data.id);

    const tuPerson = await admin
      .from("community_people")
      .insert({
        community_id: TU,
        section: "staff",
        name: "CHECK DM TU person",
        role: "Testkontakt",
        sort_order: 1002,
      })
      .select("id")
      .single();
    if (tuPerson.data?.id) createdPersonIds.add(tuPerson.data.id);

    const anonLink = await anon.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: nadiaId,
    });
    expect("anonym kan ikke koble organisasjonsperson", anonLink.error !== null, true);

    const ordinaryLink = await kristoffer.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: nadiaId,
    });
    expect("ordinært medlem kan ikke koble organisasjonsperson", ordinaryLink.error !== null, true);

    const moderatorLink = await nadia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: nadiaId,
    });
    expect("moderator kan ikke koble organisasjonsperson", moderatorLink.error !== null, true);

    const broadAdminUpdate = await mia
      .from("community_people")
      .update({ user_id: petterId } as never)
      .eq("id", linkedAuthorized.data!.id)
      .select("id");
    expect("administrator har ikke bred community_people update", broadAdminUpdate.error !== null, true);

    const trAdminTuPerson = await mia.rpc("set_community_person_user", {
      p_person_id: tuPerson.data!.id,
      p_user_id: nadiaId,
    });
    expect("administrator kan ikke koble person i annet fellesskap", trAdminTuPerson.error !== null, true);

    const tuAdminFtrOnlyMember = await emma.rpc("set_community_person_user", {
      p_person_id: tuPerson.data!.id,
      p_user_id: kristofferId,
    });
    expect("TU-admin kan ikke koble TU-person til FTR-medlem", tuAdminFtrOnlyMember.error !== null, true);

    const outsideMember = await mia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: oskarId,
    });
    expect("FTR-person kan ikke kobles til UTR-medlem", outsideMember.error !== null, true);

    await setMembershipStatus(petterId, TR, "requested");
    const inactiveMember = await mia.rpc("set_community_person_user", {
      p_person_id: linkedUnauthorized.data!.id,
      p_user_id: petterId,
    });
    expect("administrator kan ikke koble til ikke-aktivt medlemskap", inactiveMember.error !== null, true);
    await setMembershipStatus(petterId, TR, "active");

    const adminLink = await mia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: nadiaId,
    });
    expect("administrator kan koble organisasjonsperson", adminLink.error?.message ?? "ok", "ok");

    const adminLinkList = await mia.rpc("community_person_account_links", {
      p_community_id: TR,
    });
    expect(
      "administrator kan se koblet tilstand i eget fellesskap",
      (adminLinkList.data ?? []).some((row) => row.person_id === linkedAuthorized.data!.id && row.user_id === nadiaId),
      true,
    );

    const adminUnlink = await mia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: null as unknown as string,
    });
    expect("administrator kan fjerne kobling", adminUnlink.error?.message ?? "ok", "ok");

    const adminRelink = await mia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: nadiaId,
    });
    expect("administrator kan koble på nytt", adminRelink.error?.message ?? "ok", "ok");

    const unauthorizedLink = await mia.rpc("set_community_person_user", {
      p_person_id: linkedUnauthorized.data!.id,
      p_user_id: petterId,
    });
    expect("administrator kan koble aktivt medlem selv om DM-policy senere avslår", unauthorizedLink.error?.message ?? "ok", "ok");

    const publicPeople = await kristoffer
      .from("community_people")
      .select("id, community_id, section, local_group_id, name, role, email, description, sort_order")
      .eq("community_id", TR)
      .like("name", "CHECK DM%");
    expect(
      "normal organisasjonsperson-query eksponerer ikke user_id",
      "user_id" in (publicPeople.data?.[0] ?? {}),
      false,
    );

    const userIdProbe = await kristoffer
      .from("community_people")
      .select("id, user_id")
      .eq("id", linkedAuthorized.data!.id);
    expect("community_people.user_id kan ikke velges av klient", userIdProbe.error !== null, true);

    const { data: actions } = await kristoffer.rpc("organization_person_dm_actions", {
      p_community_id: TR,
    });
    const actionIds = new Map((actions ?? []).map((row) => [row.person_id, row.conversation_id]));
    expect("ulinket organisasjonsperson får ingen DM-handling", actionIds.has(unlinked.data!.id), false);
    expect("linket men uautorisert organisasjonsperson får ingen DM-handling", actionIds.has(linkedUnauthorized.data!.id), false);
    expect("linket og autorisert organisasjonsperson får DM-handling", actionIds.has(linkedAuthorized.data!.id), true);
    expect(
      "eksisterende samtale åpnes selv etter at nye DMer er slått av",
      actionIds.get(linkedAuthorized.data!.id),
      memberToOptedStaff.id,
    );

    const orgStart = await kristoffer.rpc("start_direct_conversation_with_organization_person", {
      p_person_id: linkedAuthorized.data!.id,
    });
    const orgConversationId = orgStart.data?.[0]?.conversation_id;
    if (orgConversationId) createdConversationIds.add(orgConversationId);
    expect("organisasjonsperson-handling åpner ekte samtale", orgStart.error?.message ?? "ok", "ok");

    const finalUnlink = await mia.rpc("set_community_person_user", {
      p_person_id: linkedAuthorized.data!.id,
      p_user_id: null as unknown as string,
    });
    expect("fjerning skjuler DM-handling", finalUnlink.error?.message ?? "ok", "ok");
    const { data: actionsAfterUnlink } = await kristoffer.rpc("organization_person_dm_actions", {
      p_community_id: TR,
    });
    expect(
      "fjernet kobling har ingen Send melding-handling",
      (actionsAfterUnlink ?? []).some((row) => row.person_id === linkedAuthorized.data!.id),
      false,
    );
  } finally {
    await cleanup();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }

  console.log(`✓ ${checks} DM-kontroller passerte`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
