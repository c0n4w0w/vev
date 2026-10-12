/**
 * Checks private, invitation-only lokallag channels under real authenticated
 * sessions.
 *
 * The rule (20261020100000_private_lokallag_channels): a channel with
 * `is_private` set sits under one lokallag and is readable and writable by
 *
 *   * the community's active admins, and
 *   * active members of exactly that lokallag who have a participant row.
 *
 * Moderators get nothing from their role, a lokallagsleder reads only the
 * channels they are a participant of, and nothing reaches across communities.
 * Creating is for admins (any lokallag of their community) and lokallagsledere
 * (their own); managing is for admins and for a participating lokallagsleder
 * marked as manager. Managing includes deleting the channel permanently
 * (20261021100000_private_channel_delete_and_participants), which takes its
 * messages and participant rows with it and nothing else. Everyone who can
 * read a private channel can see who its participants are; nobody else can.
 *
 * Every access check goes through ordinary anon-key clients signed in as
 * fixture accounts — the queries the app runs (`loadChannels`, `getChannel`,
 * `getMessages`, `createMessage`) plus direct table and RPC calls a curious
 * member could make by hand — so a passing run means the *database* refuses,
 * not that a page hides a link. Membership changes go through
 * `set_my_local_group()` and leadership through `add_local_group_manager()`,
 * the paths the app uses. The service role is used only to read state back, to
 * probe the structural guards, to simulate a lapsed membership, and to clean up.
 *
 * Run with `npm run check:private-channels` against the local stack after
 * `npm run seed`. Creates only disposable channels (names start with
 * "check-privat"), leaves fixture state as it found it, and clears leftovers
 * from an interrupted earlier run first.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { channels as fixtureChannels } from "@/lib/mock/communities";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const NAME = "check-privat";
const BODY = "CHECK privat kanal";
const GROUP_PREFIX = "CHECK privatlag";

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

async function mainChannelId(localGroupId: string): Promise<string> {
  const { data, error } = await admin
    .from("channels")
    .select("id")
    .eq("local_group_id", localGroupId)
    .eq("is_private", false)
    .single();
  if (error) throw error;
  return data.id;
}

async function membershipGroup(handle: string, communityId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("memberships")
    .select("local_group_id")
    .eq("community_id", communityId)
    .eq("user_id", await profileId(handle))
    .single();
  if (error) throw error;
  return data.local_group_id;
}

async function setMyGroup(client: Client, communityId: string, localGroupId: string | null) {
  const { data, error } = await client.rpc("set_my_local_group", {
    p_community_id: communityId,
    // Postgres accepts null here to clear; generated RPC argument types do not
    // record argument nullability.
    p_local_group_id: localGroupId as unknown as string,
  });
  return !error && data === true;
}

// ── What the app asks ──────────────────────────────────────────────────

/** `loadChannels()` — the sidebar, Overview and home page read. */
async function visibleChannelIds(client: Client, communityId: string) {
  const { data, error } = await client
    .from("channels")
    .select("id")
    .eq("community_id", communityId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data.map((row) => row.id);
}

/** `getChannel()` — the direct channel route. */
async function directChannel(client: Client, channelId: string) {
  const { data } = await client.from("channels").select("*").eq("id", channelId).maybeSingle();
  return data;
}

/** `getMessages()`. */
async function readMessages(client: Client, channelId: string) {
  const { data } = await client
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** `createMessage()`: author comes from the column default. */
async function send(client: Client, channelId: string, note: string) {
  const { data, error } = await client
    .from("messages")
    .insert({ channel_id: channelId, body: `${BODY}: ${note}` })
    .select("id")
    .maybeSingle();
  return { id: data?.id ?? null, error };
}

/** `createPrivateChannel()`. Returns the id, or the reason it was refused. */
async function create(client: Client, localGroupId: string, name: string, participants: string[], purpose = "") {
  const { data, error } = await client.rpc("create_private_channel", {
    p_local_group_id: localGroupId,
    p_name: `${NAME} ${name}`,
    p_purpose: purpose,
    p_participant_ids: participants,
  });
  return { id: data ?? null, error: error?.message ?? null };
}

async function add(client: Client, channelId: string, userId: string) {
  const { data, error } = await client.rpc("add_private_channel_participant", { p_channel_id: channelId, p_user_id: userId });
  return !error && data === true;
}

async function remove(client: Client, channelId: string, userId: string) {
  const { data, error } = await client.rpc("remove_private_channel_participant", { p_channel_id: channelId, p_user_id: userId });
  return !error && data === true;
}

async function setManager(client: Client, channelId: string, userId: string, isManager: boolean) {
  const { data, error } = await client.rpc("set_private_channel_manager", {
    p_channel_id: channelId,
    p_user_id: userId,
    p_is_manager: isManager,
  });
  return !error && data === true;
}

async function setArchived(client: Client, channelId: string, archived: boolean) {
  const { data, error } = await client.rpc("set_private_channel_archived", { p_channel_id: channelId, p_archived: archived });
  return !error && data === true;
}

async function rename(client: Client, communityId: string, channelId: string, name: string, purpose = "") {
  const { data, error } = await client.rpc("set_channel_details", {
    p_community_id: communityId,
    p_channel_id: channelId,
    p_name: name,
    p_purpose: purpose,
  });
  return { rows: (data ?? []).length, error: error?.message ?? null };
}

/** `deletePrivateChannel()`. */
async function destroy(client: Client, channelId: string) {
  const { data, error } = await client.rpc("delete_private_channel", { p_channel_id: channelId });
  return !error && data === true;
}

async function channelExists(channelId: string) {
  const { count, error } = await admin.from("channels").select("id", { count: "exact", head: true }).eq("id", channelId);
  if (error) throw error;
  return (count ?? 0) === 1;
}

async function messageCount(channelId: string) {
  const { count, error } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channelId);
  if (error) throw error;
  return count ?? 0;
}

async function roster(client: Client, channelId: string) {
  const { data } = await client.rpc("private_channel_roster", { p_channel_id: channelId });
  return data ?? [];
}

async function search(client: Client, localGroupId: string, query: string, channelId: string | null = null) {
  const { data } = await client.rpc("search_private_channel_candidates", {
    p_local_group_id: localGroupId,
    p_channel_id: channelId as unknown as string,
    p_query: query,
  });
  return data ?? [];
}

async function canManage(client: Client, channelId: string) {
  const { data } = await client.rpc("can_manage_private_channel", { p_channel_id: channelId });
  return data === true;
}

async function canCreate(client: Client, localGroupId: string) {
  const { data } = await client.rpc("can_create_private_channel", { p_local_group_id: localGroupId });
  return data === true;
}

async function participantRows(channelId: string) {
  const { data, error } = await admin.from("channel_participants").select("user_id, is_manager").eq("channel_id", channelId);
  if (error) throw error;
  return data;
}

async function isParticipant(channelId: string, handle: string) {
  const id = await profileId(handle);
  return (await participantRows(channelId)).some((row) => row.user_id === id);
}

async function managerFlag(channelId: string, handle: string) {
  const id = await profileId(handle);
  return (await participantRows(channelId)).find((row) => row.user_id === id)?.is_manager ?? null;
}

/**
 * Everything an unauthorised caller could try against one private channel.
 * Each line is a separate way in; all of them must come back empty or refused.
 */
async function expectNoAccess(label: string, client: Client, channel: { id: string; community: string; group: string; name: string }, selfId: string) {
  expect(`${label}: kanalen er ikke i kanallisten`, (await visibleChannelIds(client, channel.community)).includes(channel.id), false);
  expect(`${label}: direkte oppslag på id gir ingenting`, await directChannel(client, channel.id), null);
  const { data: byName } = await client.from("channels").select("id, name, purpose").ilike("name", `%${channel.name}%`);
  expect(`${label}: oppslag på navn gir ingenting`, (byName ?? []).length, 0);
  const { data: byPrivate } = await client.from("channels").select("id").eq("is_private", true).eq("local_group_id", channel.group);
  expect(`${label}: oppslag på private kanaler i lokallaget gir ingenting`, (byPrivate ?? []).some((row) => row.id === channel.id), false);
  const { data: canRead } = await client.rpc("can_read_channel", { chid: channel.id });
  expect(`${label}: can_read_channel er false`, canRead, false);
  expect(`${label}: leser ingen meldinger`, (await readMessages(client, channel.id)).length, 0);
  const { count } = await client.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channel.id);
  expect(`${label}: meldingsantallet er 0`, count ?? 0, 0);
  const denied = await send(client, channel.id, "skal ikke lagres");
  expect(`${label}: kan ikke skrive`, denied.id === null && Boolean(denied.error), true);
  const { data: participants } = await client.from("channel_participants").select("user_id").eq("channel_id", channel.id);
  expect(`${label}: ser ingen deltakerrader`, (participants ?? []).length, 0);
  expect(`${label}: deltakerlisten er tom`, (await roster(client, channel.id)).length, 0);
  expect(`${label}: kan ikke administrere`, await canManage(client, channel.id), false);
  expect(`${label}: søk etter deltakere i kanalen gir ingenting`, (await search(client, channel.group, "an", channel.id)).length, 0);
  expect(`${label}: kan ikke legge seg selv til`, await add(client, channel.id, selfId), false);
  const selfInsert = await client.from("channel_participants").insert({
    channel_id: channel.id,
    community_id: channel.community,
    local_group_id: channel.group,
    user_id: selfId,
  });
  expect(`${label}: kan ikke sette inn egen deltakerrad direkte`, Boolean(selfInsert.error), true);
  expect(`${label}: kan ikke endre navn`, (await rename(client, channel.community, channel.id, "kapret")).rows, 0);
  expect(`${label}: kan ikke arkivere`, await setArchived(client, channel.id, true), false);
  expect(`${label}: kan ikke slette permanent`, await destroy(client, channel.id), false);
  expect(`${label}: kanalen finnes fortsatt etter sletteforsøket`, await channelExists(channel.id), true);
  const upd = await client.from("channels").update({ name: "kapret" }).eq("id", channel.id).select("id");
  expect(`${label}: direkte oppdatering treffer ingen rad`, (upd.data ?? []).length, 0);
  const del = await client.from("channels").delete().eq("id", channel.id).select("id");
  expect(`${label}: direkte sletting treffer ingen rad`, (del.data ?? []).length, 0);
}

async function notificationCount() {
  const { count, error } = await admin.from("notifications").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/** Removes every disposable channel, lokallag, message and grant this suite makes. */
async function cleanup() {
  const { data: channels } = await admin.from("channels").select("id").eq("is_private", true).like("name", `${NAME}%`);
  for (const channel of channels ?? []) {
    await admin.from("channels").delete().eq("id", channel.id);
  }
  await admin.from("messages").delete().like("body", `${BODY}%`);
  await admin.from("notifications").delete().like("title", `${BODY}%`);
  // Rows the structural-guard probes try to insert. They are refused; this is
  // for the run where a regression lets one through.
  await admin.from("channels").delete().in("id", [`${FTR}--privat-check`, `${FTR}--lokallag-check`]);

  const { data: groups } = await admin.from("community_local_groups").select("id").like("name", `${GROUP_PREFIX}%`);
  for (const group of groups ?? []) {
    await admin.from("memberships").update({ local_group_id: null }).eq("local_group_id", group.id);
    await admin.from("channels").delete().eq("local_group_id", group.id);
    await admin.from("community_local_groups").delete().eq("id", group.id);
  }

  // The fixture gives these people no lokallag, and neither Amina nor Hanne
  // leads one; an interrupted earlier run may have left them otherwise.
  for (const [handle, community] of [["elise", FTR], ["linn", FTR], ["nadia", TU]] as const) {
    await admin.from("memberships").update({ local_group_id: null, status: "active" }).eq("community_id", community).eq("user_id", await profileId(handle));
  }
  for (const handle of ["amina", "hanne"]) {
    await admin.from("community_local_group_managers").delete().eq("user_id", await profileId(handle));
  }
}

async function main() {
  await cleanup();

  const ftrOslo = await groupId(FTR, "FTR Oslo");
  const ftrTrondelag = await groupId(FTR, "FTR Trøndelag");
  const tuOslo = await groupId(TU, "TU Oslo");
  const osloMain = await mainChannelId(ftrOslo);
  const trondelagMain = await mainChannelId(ftrTrondelag);
  const tuOsloMain = await mainChannelId(tuOslo);

  const mia = await signIn("miaminge"); // FTR admin, no lokallag
  const amina = await signIn("amina"); // FTR moderator, FTR Oslo — appointed Oslo lokallagsleder below
  const kristoffer = await signIn("kristoffer"); // FTR Oslo, member
  const elise = await signIn("elise"); // FTR member — joins FTR Oslo below
  const linn = await signIn("linn"); // FTR member — joins FTR Oslo below, never invited
  const eli = await signIn("elironning"); // FTR Trøndelag, member
  const petter = await signIn("petter"); // FTR Trøndelag lokallagsleder; TU Trøndelag
  const ingrid = await signIn("ingrid"); // FTR + TU moderator, no lokallag
  const nadia = await signIn("nadia"); // FTR moderator in Vestland; TU member — joins TU Oslo below
  const lars = await signIn("larsbror"); // FTR moderator (former admin), no lokallag
  const emma = await signIn("emmamortensen"); // TU admin, no FTR membership
  const hanne = await signIn("hanne"); // TU moderator, TU Oslo
  const mathea = await signIn("mathea"); // TU moderator, TU UiO
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  const id = {
    mia: await profileId("miaminge"),
    amina: await profileId("amina"),
    kristoffer: await profileId("kristoffer"),
    elise: await profileId("elise"),
    linn: await profileId("linn"),
    eli: await profileId("elironning"),
    petter: await profileId("petter"),
    ingrid: await profileId("ingrid"),
    nadia: await profileId("nadia"),
    lars: await profileId("larsbror"),
    emma: await profileId("emmamortensen"),
    hanne: await profileId("hanne"),
    mathea: await profileId("mathea"),
  };

  // Baseline the persona affiliations this suite relies on.
  expect("grunnlag: kristoffer er i FTR Oslo", await membershipGroup("kristoffer", FTR), ftrOslo);
  expect("grunnlag: amina er i FTR Oslo", await membershipGroup("amina", FTR), ftrOslo);
  expect("grunnlag: eli er i FTR Trøndelag", await membershipGroup("elironning", FTR), ftrTrondelag);
  expect("grunnlag: petter er i FTR Trøndelag", await membershipGroup("petter", FTR), ftrTrondelag);
  expect("grunnlag: petter leder FTR Trøndelag", await canCreate(petter, ftrTrondelag), true);
  expect("grunnlag: mia har ikke lokallag", await membershipGroup("miaminge", FTR), null);
  expect("grunnlag: hanne er i TU Oslo", await membershipGroup("hanne", TU), tuOslo);

  const { data: grantsBefore } = await admin.from("community_local_group_managers").select("local_group_id, user_id");
  const { data: privateBefore } = await admin.from("channels").select("id").eq("is_private", true);
  const notificationsBefore = await notificationCount();

  try {
    // Two more Oslo members, through the path the /lokallag page uses.
    expect("oppsett: elise velger FTR Oslo", await setMyGroup(elise, FTR, ftrOslo), true);
    expect("oppsett: linn velger FTR Oslo", await setMyGroup(linn, FTR, ftrOslo), true);
    expect("oppsett: nadia velger TU Oslo", await setMyGroup(nadia, TU, tuOslo), true);

    // ── A. FTR administrator ────────────────────────────────────────────
    //
    // Creates under FTR Oslo with two eligible members, without being in the
    // lokallag herself, and reaches private channels across FTR's lokallag.
    expect("A1 admin kan opprette under FTR Oslo", await canCreate(mia, ftrOslo), true);
    expect("A1 admin kan opprette under FTR Trøndelag", await canCreate(mia, ftrTrondelag), true);
    expect("A1 admin søker blant Oslo-medlemmer", (await search(mia, ftrOslo, "kristoffer")).some((row) => row.user_id === id.kristoffer), true);
    expect("A1 søket gir ikke medlemmer av andre lokallag", (await search(mia, ftrOslo, "eli")).some((row) => row.user_id === id.eli), false);
    expect("A1 søk på ett tegn gir ingenting", (await search(mia, ftrOslo, "k")).length, 0);

    const a = await create(mia, ftrOslo, "planlegging", [id.kristoffer, id.elise], "Intern planlegging.");
    expect("A2 admin oppretter privat kanal under FTR Oslo", Boolean(a.id) && !a.error, true);
    const planning = { id: a.id!, community: FTR, group: ftrOslo, name: `${NAME} planlegging` };
    const { data: stored } = await admin.from("channels").select("*").eq("id", planning.id).single();
    expect("A2 kanalen er privat", stored?.is_private, true);
    expect("A2 kanalen ligger i FTR", stored?.community_id, FTR);
    expect("A2 kanalen ligger under FTR Oslo", stored?.local_group_id, ftrOslo);
    expect("A2 kanalen ligger i seksjonen lokallag", stored?.group_id, "lokallag");
    expect("A2 kanal-id røper ikke navnet", planning.id.includes("planlegging"), false);
    expect("A2 de to valgte er deltakere", (await participantRows(planning.id)).map((row) => row.user_id).sort().join(","), [id.kristoffer, id.elise].sort().join(","));
    expect("A2 admin utenfor lokallaget får ingen deltakerrad", await isParticipant(planning.id, "miaminge"), false);
    expect("A2 admin er fortsatt uten lokallag", await membershipGroup("miaminge", FTR), null);

    expect("A3 admin ser kanalen i kanallisten", (await visibleChannelIds(mia, FTR)).includes(planning.id), true);
    expect("A3 admin åpner kanalen direkte", (await directChannel(mia, planning.id))?.name, planning.name);
    expect("A3 admin kan skrive", (await send(mia, planning.id, "fra admin")).error, null);
    expect("A3 admin kan administrere", await canManage(mia, planning.id), true);
    expect("A3 admin ser deltakerlisten", (await roster(mia, planning.id)).length, 2);

    const t = await create(mia, ftrTrondelag, "styret", [id.eli]);
    expect("A4 admin oppretter privat kanal under FTR Trøndelag", Boolean(t.id), true);
    const board = { id: t.id!, community: FTR, group: ftrTrondelag, name: `${NAME} styret` };
    const adminList = await visibleChannelIds(mia, FTR);
    expect("A4 admin ser private kanaler på tvers av lokallag", [planning.id, board.id].every((cid) => adminList.includes(cid)), true);
    expect("A4 admin leser Trøndelag-kanalen", (await directChannel(mia, board.id))?.id, board.id);

    // Refusals with a reason: a participant from another lokallag, a name in use.
    const wrongGroup = await create(mia, ftrOslo, "feil lokallag", [id.eli]);
    expect("A5 deltaker fra annet lokallag avvises", wrongGroup.id === null && String(wrongGroup.error).includes("private_channel_participant_ineligible"), true);
    const wrongCommunity = await create(mia, ftrOslo, "feil fellesskap", [id.emma]);
    expect("A5 deltaker fra annet fellesskap avvises", wrongCommunity.id === null && String(wrongCommunity.error).includes("private_channel_participant_ineligible"), true);
    const { count: halfMade } = await admin.from("channels").select("id", { count: "exact", head: true }).like("name", `${NAME} feil%`);
    expect("A5 en avvist opprettelse etterlater ingen kanal", halfMade, 0);
    const duplicate = await create(mia, ftrOslo, "PLANLEGGING", []);
    expect("A5 samme navn i samme lokallag avvises", duplicate.id === null && String(duplicate.error).includes("private_channel_name_taken"), true);
    const sameNameElsewhere = await create(mia, ftrTrondelag, "planlegging", []);
    expect("A5 samme navn i et annet lokallag er tillatt", Boolean(sameNameElsewhere.id), true);
    expect("A5 tomt navn avvises", (await mia.rpc("create_private_channel", { p_local_group_id: ftrOslo, p_name: "  ", p_purpose: "", p_participant_ids: [] })).data, null);

    // ── B. Invited FTR Oslo member ──────────────────────────────────────
    {
      expect("B1 invitert ser kanalen i kanallisten", (await visibleChannelIds(kristoffer, FTR)).includes(planning.id), true);
      expect("B1 invitert åpner kanalen", (await directChannel(kristoffer, planning.id))?.purpose, "Intern planlegging.");
      const sent = await send(kristoffer, planning.id, "fra invitert");
      expect("B2 invitert kan skrive", sent.error, null);
      expect("B2 invitert leser meldinger", (await readMessages(kristoffer, planning.id)).length, 2);
      expect("B2 den andre inviterte leser de samme meldingene", (await readMessages(elise, planning.id)).some((m) => m.id === sent.id), true);

      expect("B3 invitert kan ikke administrere", await canManage(kristoffer, planning.id), false);
      expect("B3 invitert ser hvem som er med i kanalen", (await roster(kristoffer, planning.id)).length, 2);
      expect("B3 invitert kan ikke slette kanalen", await destroy(kristoffer, planning.id), false);
      expect("B3 kanalen finnes etter deltakerens sletteforsøk", await channelExists(planning.id), true);
      const { data: ownRows } = await kristoffer.from("channel_participants").select("user_id").eq("channel_id", planning.id);
      expect("B3 invitert ser bare sin egen deltakerrad", (ownRows ?? []).map((row) => row.user_id).join(","), id.kristoffer);
      expect("B3 invitert kan ikke legge til andre", await add(kristoffer, planning.id, id.linn), false);
      expect("B3 invitert kan ikke fjerne andre", await remove(kristoffer, planning.id, id.elise), false);
      expect("B3 invitert kan ikke gjøre seg til ansvarlig", await setManager(kristoffer, planning.id, id.kristoffer, true), false);
      const flip = await kristoffer.from("channel_participants").update({ is_manager: true }).eq("channel_id", planning.id).select("user_id");
      expect("B3 invitert kan ikke endre deltakerraden sin direkte", (flip.data ?? []).length, 0);
      expect("B3 invitert kan ikke endre navn", (await rename(kristoffer, FTR, planning.id, "mitt navn")).rows, 0);
      expect("B3 invitert kan ikke arkivere", await setArchived(kristoffer, planning.id, true), false);
      expect("B3 invitert kan ikke opprette kanaler", (await create(kristoffer, ftrOslo, "egen", [])).id, null);
      expect("B3 invitert kan ikke søke etter medlemmer", (await search(kristoffer, ftrOslo, "linn")).length, 0);
      expect("B3 invitert ser ikke Trøndelag-kanalen", await directChannel(kristoffer, board.id), null);
    }

    // ── C. Uninvited FTR Oslo member ────────────────────────────────────
    await expectNoAccess("C uinvitert Oslo-medlem", linn, planning, id.linn);
    expect("C uinvitert Oslo-medlem leser fortsatt lokallagets hovedkanal", (await directChannel(linn, osloMain))?.id, osloMain);
    expect("C uinvitert Oslo-medlem ser ingen private kanaler i noe fellesskap", ((await linn.from("channels").select("id").eq("is_private", true)).data ?? []).length, 0);

    // ── D. Members of another lokallag, and moderators ──────────────────
    await expectNoAccess("D medlem av FTR Trøndelag", eli, planning, id.eli);
    await expectNoAccess("D lokallagsleder i FTR Trøndelag", petter, planning, id.petter);
    await expectNoAccess("D moderator uten lokallag", ingrid, planning, id.ingrid);
    await expectNoAccess("D moderator i FTR Vestland", nadia, planning, id.nadia);
    await expectNoAccess("D tidligere admin (nå moderator)", lars, planning, id.lars);
    // Amina is a moderator AND in FTR Oslo, but was not invited.
    await expectNoAccess("D moderator i FTR Oslo som ikke er invitert", amina, planning, id.amina);
    expect("D eli (invitert i Trøndelag) åpner sin egen kanal", (await directChannel(eli, board.id))?.id, board.id);

    // ── E. Cross-community ──────────────────────────────────────────────
    await expectNoAccess("E TU-admin", emma, planning, id.emma);
    await expectNoAccess("E TU Oslo-medlem", hanne, planning, id.hanne);
    expect("E TU-admin kan ikke opprette under FTR Oslo", await canCreate(emma, ftrOslo), false);
    expect("E TU-admin oppretter ingenting under FTR Oslo", (await create(emma, ftrOslo, "fra tu", [])).id, null);
    expect("E TU-admin kan ikke søke blant FTR Oslo-medlemmer", (await search(emma, ftrOslo, "kristoffer")).length, 0);
    expect("E uautentisert ser ingen kanaler", ((await anon.from("channels").select("id")).data ?? []).length, 0);
    expect("E uautentisert leser ingen meldinger", (await readMessages(anon, planning.id)).length, 0);
    expect("E uautentisert ser ingen deltakere", ((await anon.from("channel_participants").select("user_id")).data ?? []).length, 0);
    expect("E uautentisert kan ikke opprette", Boolean((await anon.rpc("create_private_channel", { p_local_group_id: ftrOslo, p_name: `${NAME} anon`, p_purpose: "", p_participant_ids: [] })).error), true);

    // ── F. FTR Oslo lokallagsleder ──────────────────────────────────────
    let leaderChannel: { id: string; community: string; group: string; name: string };
    {
      expect("F1 Oslo-medlem uten lederverv kan ikke opprette", await canCreate(amina, ftrOslo), false);
      expect("F1 moderator uten lederverv oppretter ingenting", (await create(amina, ftrOslo, "for tidlig", [])).id, null);

      const { data: appointed } = await mia.rpc("add_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("F2 admin utnevner amina til lokallagsleder for FTR Oslo", appointed, true);
      expect("F2 lokallagsleder kan opprette under eget lokallag", await canCreate(amina, ftrOslo), true);
      // Leading the lokallag opens no existing private channel.
      await expectNoAccess("F2 lokallagsleder som ikke er deltaker", amina, planning, id.amina);

      const l = await create(amina, ftrOslo, "arrangementsteam", [id.kristoffer]);
      expect("F3 lokallagsleder oppretter privat kanal under FTR Oslo", Boolean(l.id) && !l.error, true);
      leaderChannel = { id: l.id!, community: FTR, group: ftrOslo, name: `${NAME} arrangementsteam` };
      expect("F3 lederen er selv deltaker", await isParticipant(leaderChannel.id, "amina"), true);
      expect("F3 lederen er kanalansvarlig", await managerFlag(leaderChannel.id, "amina"), true);
      expect("F3 lederen kan administrere kanalen sin", await canManage(amina, leaderChannel.id), true);
      expect("F3 lederen ser deltakerlisten", (await roster(amina, leaderChannel.id)).map((row) => row.user_id).sort().join(","), [id.amina, id.kristoffer].sort().join(","));
      expect("F3 lederen får ikke vite hvem som er leder (bare admin)", (await roster(amina, leaderChannel.id)).every((row) => row.is_leader === null), true);
      expect("F3 lederen kan skrive", (await send(amina, leaderChannel.id, "fra leder")).error, null);
      expect("F3 invitert leser lederens kanal", (await readMessages(kristoffer, leaderChannel.id)).length, 1);

      expect("F4 lederen legger til et Oslo-medlem", await add(amina, leaderChannel.id, id.elise), true);
      expect("F4 den nye deltakeren ser kanalen", (await directChannel(elise, leaderChannel.id))?.id, leaderChannel.id);
      expect("F4 å legge til samme person igjen er ingen endring", await add(amina, leaderChannel.id, id.elise), false);
      expect("F4 lederen fjerner deltakeren", await remove(amina, leaderChannel.id, id.elise), true);
      expect("F4 den fjernede ser ikke kanalen lenger", await directChannel(elise, leaderChannel.id), null);
      expect("F4 lederen kan ikke legge til et Trøndelag-medlem", await add(amina, leaderChannel.id, id.eli), false);
      expect("F4 lederen kan ikke legge til en admin utenfor lokallaget", await add(amina, leaderChannel.id, id.mia), false);
      expect("F4 lederen kan ikke legge til noen fra et annet fellesskap", await add(amina, leaderChannel.id, id.emma), false);
      expect("F4 lederens søk i kanalen utelater deltakere", (await search(amina, ftrOslo, "kristoffer", leaderChannel.id)).length, 0);
      expect("F4 lederens søk finner andre Oslo-medlemmer", (await search(amina, ftrOslo, "linn", leaderChannel.id)).some((row) => row.user_id === id.linn), true);

      expect("F5 lederen endrer navn og beskrivelse", (await rename(amina, FTR, leaderChannel.id, `${NAME} arrangement`, "Kommende arrangementer.")).rows, 1);
      leaderChannel.name = `${NAME} arrangement`;
      expect("F5 kanal-id er uendret etter navnebytte", (await directChannel(amina, leaderChannel.id))?.name, leaderChannel.name);
      const taken = await rename(amina, FTR, leaderChannel.id, planning.name);
      expect("F5 navnet til en annen privat kanal i lokallaget avvises", taken.rows === 0 && String(taken.error).includes("private_channel_name_taken"), true);
      expect("F5 lederen kan fortsatt ikke endre lokallagets hovedkanal", (await rename(amina, FTR, osloMain, "overstyrt")).rows, 0);
      expect("F5 lederen kan ikke endre adminens kanal", (await rename(amina, FTR, planning.id, "overstyrt")).rows, 0);
      expect("F5 lederen kan ikke velge kanalansvarlige", await setManager(amina, leaderChannel.id, id.kristoffer, true), false);

      // Not under, and not in, an unrelated lokallag.
      expect("F6 Oslo-lederen kan ikke opprette under FTR Trøndelag", await canCreate(amina, ftrTrondelag), false);
      expect("F6 Oslo-lederen oppretter ingenting under FTR Trøndelag", (await create(amina, ftrTrondelag, "fra oslo", [])).id, null);
      await expectNoAccess("F6 Oslo-lederen mot Trøndelag-kanalen", amina, board, id.amina);
      expect("F6 Trøndelag-lederen kan ikke opprette under FTR Oslo", (await create(petter, ftrOslo, "fra trøndelag", [])).id, null);
      await expectNoAccess("F6 Trøndelag-lederen mot Oslo-lederens kanal", petter, leaderChannel, id.petter);
      // Petter leads Trøndelag but was not invited to the admin's channel there.
      await expectNoAccess("F6 Trøndelag-lederen mot en Trøndelag-kanal han ikke er med i", petter, board, id.petter);

      // Admin oversight covers the leader's channel too.
      expect("F7 admin ser lederens kanal", (await directChannel(mia, leaderChannel.id))?.id, leaderChannel.id);
      expect("F7 admin kan administrere lederens kanal", await canManage(mia, leaderChannel.id), true);
      expect("F7 admin ser hvem som leder lokallaget", (await roster(mia, leaderChannel.id)).find((row) => row.user_id === id.amina)?.is_leader, true);
      expect("F7 admin kan ikke gjøre et vanlig medlem til ansvarlig", await setManager(mia, leaderChannel.id, id.kristoffer, true), false);
    }

    // ── G. Losing leadership ────────────────────────────────────────────
    {
      const { data: revoked } = await mia.rpc("remove_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("G1 admin fjerner amina som lokallagsleder", revoked, true);
      expect("G1 ansvarlig-merket er fjernet", await managerFlag(leaderChannel.id, "amina"), false);
      expect("G1 tidligere leder kan ikke administrere", await canManage(amina, leaderChannel.id), false);
      expect("G1 tidligere leder ser deltakerlisten som vanlig deltaker", (await roster(amina, leaderChannel.id)).every((row) => row.added_at === null), true);
      expect("G1 tidligere leder kan ikke slette kanalen hun opprettet", await destroy(amina, leaderChannel.id), false);
      expect("G1 kanalen finnes etter sletteforsøket", await channelExists(leaderChannel.id), true);
      expect("G1 tidligere leder kan ikke legge til", await add(amina, leaderChannel.id, id.linn), false);
      expect("G1 tidligere leder kan ikke fjerne", await remove(amina, leaderChannel.id, id.kristoffer), false);
      expect("G1 tidligere leder kan ikke endre navn", (await rename(amina, FTR, leaderChannel.id, "etterpå")).rows, 0);
      expect("G1 tidligere leder kan ikke opprette nye kanaler", (await create(amina, ftrOslo, "etterpå", [])).id, null);
      // What remains is her own participation, an independent fact.
      expect("G2 tidligere leder er fortsatt deltaker", await isParticipant(leaderChannel.id, "amina"), true);
      expect("G2 tidligere leder leser fortsatt kanalen", (await directChannel(amina, leaderChannel.id))?.id, leaderChannel.id);
      expect("G2 tidligere leder kan fortsatt skrive", (await send(amina, leaderChannel.id, "som deltaker")).error, null);

      // Re-appointing restores nothing by itself: an admin hands the mark back.
      await mia.rpc("add_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("G3 ny utnevnelse gir ikke ansvaret tilbake", await canManage(amina, leaderChannel.id), false);
      expect("G3 admin gir ansvaret tilbake til lederen", await setManager(mia, leaderChannel.id, id.amina, true), true);
      expect("G3 lederen kan administrere igjen", await canManage(amina, leaderChannel.id), true);
      expect("G3 admin tar ansvaret fra lederen", await setManager(mia, leaderChannel.id, id.amina, false), true);
      expect("G3 leder uten ansvar kan ikke administrere", await canManage(amina, leaderChannel.id), false);
      await setManager(mia, leaderChannel.id, id.amina, true);
    }

    // ── H. Removed participant ──────────────────────────────────────────
    {
      // Kristoffer's session is the one he had while he was a participant.
      expect("H1 kristoffer leser kanalen før han fjernes", (await readMessages(kristoffer, planning.id)).length > 0, true);
      expect("H1 admin fjerner kristoffer", await remove(mia, planning.id, id.kristoffer), true);
      await expectNoAccess("H2 fjernet deltaker, samme økt", kristoffer, planning, id.kristoffer);
      expect("H2 fjernet deltaker er fortsatt i lokallaget", await membershipGroup("kristoffer", FTR), ftrOslo);
      expect("H2 fjernet deltaker leser fortsatt hovedkanalen", (await directChannel(kristoffer, osloMain))?.id, osloMain);
      expect("H2 fjernet deltaker beholder den andre private kanalen", (await directChannel(kristoffer, leaderChannel.id))?.id, leaderChannel.id);
      expect("H2 meldingene hans står igjen for de andre", (await readMessages(elise, planning.id)).some((m) => m.author_id === id.kristoffer), true);
      expect("H3 admin legger kristoffer til igjen", await add(mia, planning.id, id.kristoffer), true);
      expect("H3 tilgangen er tilbake", (await directChannel(kristoffer, planning.id))?.id, planning.id);
    }

    // ── I. Leaving the lokallag, losing the membership ──────────────────
    {
      expect("I1 elise er deltaker før flyttingen", await isParticipant(planning.id, "elise"), true);
      expect("I1 elise bytter til FTR Trøndelag", await setMyGroup(elise, FTR, ftrTrondelag), true);
      await expectNoAccess("I2 flyttet til et annet lokallag", elise, planning, id.elise);
      expect("I2 deltakerraden er slettet", await isParticipant(planning.id, "elise"), false);
      expect("I2 flyttingen gir ingen tilgang til Trøndelags private kanal", await directChannel(elise, board.id), null);
      expect("I3 elise bytter tilbake til FTR Oslo", await setMyGroup(elise, FTR, ftrOslo), true);
      expect("I3 å komme tilbake gir ikke tilgangen tilbake", await directChannel(elise, planning.id), null);
      expect("I3 hun leser hovedkanalen igjen", (await directChannel(elise, osloMain))?.id, osloMain);

      expect("I4 kristoffer forlater lokallaget", await setMyGroup(kristoffer, FTR, null), true);
      await expectNoAccess("I4 uten lokallag", kristoffer, planning, id.kristoffer);
      expect("I4 også lederens kanal er borte", await directChannel(kristoffer, leaderChannel.id), null);
      expect("I4 kristoffer velger FTR Oslo igjen", await setMyGroup(kristoffer, FTR, ftrOslo), true);
      expect("I4 tilbake i lokallaget, men ikke i kanalen", await directChannel(kristoffer, planning.id), null);
      await add(mia, planning.id, id.kristoffer);

      // A membership that stops being active (service role: there is no member
      // path that does this to someone else).
      expect("I5 admin legger linn til", await add(mia, planning.id, id.linn), true);
      expect("I5 linn leser kanalen", (await directChannel(linn, planning.id))?.id, planning.id);
      await admin.from("memberships").update({ status: "requested" }).eq("community_id", FTR).eq("user_id", id.linn);
      await expectNoAccess("I5 medlemskapet er ikke lenger aktivt", linn, planning, id.linn);
      expect("I5 deltakerraden er slettet", await isParticipant(planning.id, "linn"), false);
      await admin.from("memberships").update({ status: "active" }).eq("community_id", FTR).eq("user_id", id.linn);
      expect("I5 aktivt medlemskap igjen gir ikke tilgangen tilbake", await directChannel(linn, planning.id), null);
      expect("I5 linn er fortsatt i FTR Oslo", await membershipGroup("linn", FTR), ftrOslo);

      // The leader leaves the lokallag: grant, participation and mark all go.
      expect("I6 lederen bytter til FTR Trøndelag", await setMyGroup(amina, FTR, ftrTrondelag), true);
      await expectNoAccess("I6 leder som har forlatt lokallaget", amina, leaderChannel, id.amina);
      expect("I6 lederen kan ikke opprette under FTR Oslo", await canCreate(amina, ftrOslo), false);
      expect("I6 lederen kan ikke opprette under FTR Trøndelag", await canCreate(amina, ftrTrondelag), false);
      expect("I6 lederen bytter tilbake", await setMyGroup(amina, FTR, ftrOslo), true);
      expect("I6 tilbake uten verv og uten kanal", await directChannel(amina, leaderChannel.id), null);
      expect("I6 meldingene i kanalen består", (await readMessages(mia, leaderChannel.id)).length > 0, true);
      expect("I6 admin når fortsatt kanalen", (await directChannel(mia, leaderChannel.id))?.id, leaderChannel.id);
    }

    // ── J. Admin role is the override, nothing else ─────────────────────
    {
      // Lars was FTR admin once; as a moderator he has nothing (checked in D).
      // Mia with a participant row would keep that row if she stopped being
      // admin. Simulated on the test channel with the service role.
      expect("J1 mia velger FTR Oslo", await setMyGroup(mia, FTR, ftrOslo), true);
      expect("J1 admin i lokallaget kan legges til som deltaker", await add(mia, planning.id, id.mia), true);
      await admin.from("memberships").update({ role: "moderator" }).eq("community_id", FTR).eq("user_id", id.mia);
      expect("J2 uten admin-rollen: ingen tilgang til kanaler hun ikke er med i", await directChannel(mia, board.id), null);
      expect("J2 uten admin-rollen: kan ikke administrere", await canManage(mia, planning.id), false);
      expect("J2 uten admin-rollen: kan ikke opprette", await canCreate(mia, ftrOslo), false);
      expect("J2 uten admin-rollen: deltakelsen hennes gjelder fortsatt", (await directChannel(mia, planning.id))?.id, planning.id);
      await admin.from("memberships").update({ role: "admin" }).eq("community_id", FTR).eq("user_id", id.mia);
      expect("J3 admin-rollen er tilbake", await canManage(mia, board.id), true);
      expect("J3 mia går tilbake til ingen lokallag", await setMyGroup(mia, FTR, null), true);
      expect("J3 deltakerraden hennes fulgte lokallaget", await isParticipant(planning.id, "miaminge"), false);
      expect("J3 admin når fortsatt kanalen uten rad", (await directChannel(mia, planning.id))?.id, planning.id);
    }

    // ── K. Archiving ────────────────────────────────────────────────────
    {
      expect("K1 admin arkiverer kanalen", await setArchived(mia, planning.id, true), true);
      expect("K1 deltaker leser fortsatt historikken", (await readMessages(kristoffer, planning.id)).length > 0, true);
      expect("K1 kanalen vises som arkivert", Boolean((await directChannel(kristoffer, planning.id))?.archived_at), true);
      const closed = await send(kristoffer, planning.id, "etter arkivering");
      expect("K2 deltaker kan ikke skrive i arkivert kanal", closed.id === null && Boolean(closed.error), true);
      const closedForAdmin = await send(mia, planning.id, "etter arkivering");
      expect("K2 admin kan heller ikke skrive i arkivert kanal", closedForAdmin.id === null && Boolean(closedForAdmin.error), true);
      const { data: probe } = await linn.rpc("channel_accepts_messages", { chid: planning.id });
      expect("K2 uinvitert får ikke vite at kanalen er arkivert", probe, true);
      await expectNoAccess("K2 uinvitert mot arkivert kanal", linn, planning, id.linn);
      expect("K3 admin gjenåpner kanalen", await setArchived(mia, planning.id, false), true);
      expect("K3 deltaker kan skrive igjen", (await send(kristoffer, planning.id, "etter gjenåpning")).error, null);
      const main = await mia.from("channels").update({ archived_at: new Date().toISOString() }).eq("id", osloMain).select("id");
      expect("K3 hovedkanalen kan ikke arkiveres via API", (main.data ?? []).length, 0);
      expect("K3 set_private_channel_archived avviser hovedkanalen", await setArchived(mia, osloMain, true), false);
    }

    // ── L. Indirect leaks ───────────────────────────────────────────────
    {
      // A message in a private channel must not make its author's community
      // profile visible to people outside it (FTR's member directory is
      // admin-only). Eli has no other FTR content an ordinary member can see.
      const { data: before } = await petter.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: id.eli });
      expect("L1 grunnlag: Trøndelag-lederen ser ikke Elis profil", before, false);
      expect("L1 eli skriver i den private Trøndelag-kanalen", (await send(eli, board.id, "fra eli")).error, null);
      const { data: after } = await petter.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: id.eli });
      expect("L1 privat melding åpner ikke profilen for andre i lokallaget", after, false);
      const { data: authorship } = await petter.rpc("shares_visible_authorship", { other: id.eli });
      expect("L1 shares_visible_authorship teller ikke private meldinger", authorship, false);
      const { data: byBody } = await petter.from("messages").select("id").like("body", `${BODY}: fra eli%`);
      expect("L1 søk i meldingstekst finner ikke private meldinger", (byBody ?? []).length, 0);
      expect("L2 admin legger Trøndelag-lederen til", await add(mia, board.id, id.petter), true);
      const { data: asParticipant } = await petter.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: id.eli });
      expect("L2 en deltaker ser hvem som skriver", asParticipant, true);
      expect("L2 deltakelse alene gir ikke administrasjon, selv for en leder", await canManage(petter, board.id), false);
      expect("L2 admin gjør den deltakende lederen til ansvarlig", await setManager(mia, board.id, id.petter, true), true);
      expect("L2 nå kan lederen administrere kanalen", await canManage(petter, board.id), true);

      expect("L3 private kanaler lager ingen varsler", await notificationCount(), notificationsBefore);

      // No API role may call the internal helpers, which take a user id.
      const internal = await kristoffer.rpc("private_channel_access_admits", {
        p_user_id: id.linn,
        p_community_id: FTR,
        p_local_group_id: ftrOslo,
        p_channel_id: planning.id,
      });
      expect("L4 medlem kan ikke spørre om andres tilgang", Boolean(internal.error), true);
      const internalManage = await kristoffer.rpc("private_channel_manage_admits", { p_user_id: id.amina, p_channel_id: planning.id });
      expect("L4 medlem kan ikke spørre om andres administrasjonsrett", Boolean(internalManage.error), true);
      const internalAccess = await kristoffer.rpc("channel_access_admits", {
        p_user_id: id.linn,
        p_community_id: FTR,
        p_local_group_id: ftrOslo,
        p_subgroup_id: null as unknown as string,
        p_channel_id: planning.id,
        p_is_private: true,
      });
      expect("L4 medlem kan ikke kalle channel_access_admits", Boolean(internalAccess.error), true);
    }

    // ── M. Structural guards ────────────────────────────────────────────
    {
      // Even the service role cannot move a private channel or change its kind.
      const moveGroup = await admin.from("channels").update({ local_group_id: ftrTrondelag }).eq("id", planning.id).select("id");
      expect("M1 en privat kanal kan ikke flyttes til et annet lokallag", Boolean(moveGroup.error), true);
      const moveCommunity = await admin.from("channels").update({ community_id: TU, local_group_id: tuOslo }).eq("id", planning.id).select("id");
      expect("M1 en privat kanal kan ikke flyttes til et annet fellesskap", Boolean(moveCommunity.error), true);
      const open = await admin.from("channels").update({ is_private: false }).eq("id", planning.id).select("id");
      expect("M1 en privat kanal kan ikke gjøres åpen for lokallaget", Boolean(open.error), true);
      const close = await admin.from("channels").update({ is_private: true }).eq("id", osloMain).select("id");
      expect("M1 hovedkanalen kan ikke gjøres privat", Boolean(close.error), true);
      const noParent = await admin.from("channels").insert({ id: `${FTR}--privat-check`, community_id: FTR, group_id: "generelt", name: `${NAME} uten lokallag`, purpose: "", is_private: true });
      expect("M1 en privat kanal uten lokallag kan ikke finnes", Boolean(noParent.error), true);
      const secondMain = await admin.from("channels").insert({ id: `${FTR}--lokallag-check`, community_id: FTR, group_id: "lokallag", local_group_id: ftrOslo, name: `${NAME} hoved to`, purpose: "" });
      expect("M1 et lokallag kan fortsatt bare ha én hovedkanal", Boolean(secondMain.error), true);
      const still = await admin.from("channels").select("community_id, local_group_id, is_private").eq("id", planning.id).single();
      expect("M1 kanalen er der den ble opprettet", `${still.data?.community_id}/${still.data?.local_group_id}/${still.data?.is_private}`, `${FTR}/${ftrOslo}/true`);

      const outsider = await admin.from("channel_participants").insert({ channel_id: planning.id, community_id: FTR, local_group_id: ftrOslo, user_id: id.eli });
      expect("M2 deltaker fra annet lokallag avvises også for tjenesterollen", Boolean(outsider.error), true);
      const foreign = await admin.from("channel_participants").insert({ channel_id: planning.id, community_id: TU, local_group_id: tuOslo, user_id: id.hanne });
      expect("M2 deltakerrad med annet fellesskap enn kanalens avvises", Boolean(foreign.error), true);
      const onMain = await admin.from("channel_participants").insert({ channel_id: osloMain, community_id: FTR, local_group_id: ftrOslo, user_id: id.kristoffer });
      expect("M2 hovedkanalen kan ikke få deltakerrader", Boolean(onMain.error), true);
      const fakeManager = await admin.from("channel_participants").update({ is_manager: true }).eq("channel_id", planning.id).eq("user_id", id.kristoffer).select("user_id");
      expect("M2 et vanlig medlem kan ikke merkes som ansvarlig", Boolean(fakeManager.error), true);

      // A lokallag's name follows to its main chat only.
      const { data: newGroup } = await mia.rpc("create_local_group", { p_community_id: FTR, p_name: `${GROUP_PREFIX} Nord` });
      expect("M3 admin oppretter lokallag", Boolean(newGroup), true);
      const scratch = await create(mia, newGroup!, "nord", []);
      expect("M3 admin oppretter privat kanal under det nye lokallaget", Boolean(scratch.id), true);
      await mia.rpc("rename_local_group", { p_local_group_id: newGroup!, p_name: `${GROUP_PREFIX} Nord-Norge` });
      const { data: afterRename } = await admin.from("channels").select("id, name, is_private").eq("local_group_id", newGroup!);
      expect("M3 hovedkanalen følger lokallagets nye navn", afterRename?.find((c) => !c.is_private)?.name, `${GROUP_PREFIX} Nord-Norge`);
      expect("M3 den private kanalen beholder sitt eget navn", afterRename?.find((c) => c.is_private)?.name, `${NAME} nord`);
      const { data: ensured } = await admin.rpc("ensure_local_group_channel", { p_local_group_id: newGroup! });
      expect("M3 ensure_local_group_channel gir hovedkanalen", ensured, afterRename?.find((c) => !c.is_private)?.id);
      expect("M3 lokallaget har fortsatt nøyaktig én hovedkanal", afterRename?.filter((c) => !c.is_private).length, 1);
      await mia.rpc("set_local_group_active", { p_local_group_id: newGroup!, p_active: false });
      expect("M4 avviklet lokallag får ingen nye private kanaler", (await create(mia, newGroup!, "for sent", [])).id, null);
      expect("M4 den private kanalen består etter avvikling", (await directChannel(mia, scratch.id!))?.id, scratch.id);
    }

    // ── N. Tryggere Ungdom ──────────────────────────────────────────────
    {
      expect("N1 TU-admin kan opprette under TU Oslo", await canCreate(emma, tuOslo), true);
      const u = await create(emma, tuOslo, "styremøter", [id.hanne]);
      expect("N1 TU-admin oppretter privat kanal under TU Oslo", Boolean(u.id) && !u.error, true);
      const tuChannel = { id: u.id!, community: TU, group: tuOslo, name: `${NAME} styremøter` };
      expect("N1 kanalen ligger i TU", (await directChannel(emma, tuChannel.id))?.community_id, TU);
      expect("N2 invitert TU Oslo-medlem ser kanalen", (await visibleChannelIds(hanne, TU)).includes(tuChannel.id), true);
      expect("N2 invitert kan skrive", (await send(hanne, tuChannel.id, "fra tu")).error, null);
      expect("N2 TU-admin leser meldingen", (await readMessages(emma, tuChannel.id)).length, 1);
      expect("N2 invitert moderator kan ikke administrere", await canManage(hanne, tuChannel.id), false);
      await expectNoAccess("N3 uinvitert TU Oslo-medlem", nadia, tuChannel, id.nadia);
      await expectNoAccess("N3 TU-moderator i et annet lokallag", mathea, tuChannel, id.mathea);
      await expectNoAccess("N3 TU-moderator uten lokallag", ingrid, tuChannel, id.ingrid);
      await expectNoAccess("N3 TU Trøndelag-medlem (FTR-leder)", petter, tuChannel, id.petter);
      await expectNoAccess("N3 FTR-admin", mia, tuChannel, id.mia);
      expect("N3 FTR-admin kan ikke opprette under TU Oslo", (await create(mia, tuOslo, "fra ftr", [])).id, null);
      expect("N3 TU-admin kan ikke legge til et FTR Oslo-medlem", await add(emma, tuChannel.id, id.kristoffer), false);

      const { data: tuLeader } = await emma.rpc("add_local_group_manager", { p_local_group_id: tuOslo, p_user_id: id.hanne });
      expect("N4 TU-admin utnevner hanne til lokallagsleder", tuLeader, true);
      const own = await create(hanne, tuOslo, "arrangement", [id.nadia]);
      expect("N4 TU Oslo-lederen oppretter privat kanal", Boolean(own.id), true);
      expect("N4 lederen administrerer sin kanal", await canManage(hanne, own.id!), true);
      expect("N4 lederen fjerner en deltaker", await remove(hanne, own.id!, id.nadia), true);
      expect("N4 den fjernede mister tilgangen", await directChannel(nadia, own.id!), null);
      expect("N4 lederen kan fortsatt ikke administrere adminens kanal", await canManage(hanne, tuChannel.id), false);
      expect("N4 TU-lederen kan ikke opprette under FTR Oslo", (await create(hanne, ftrOslo, "fra tu-leder", [])).id, null);
    }

    // ── P. The participant list ─────────────────────────────────────────
    //
    // Everyone who can read a private channel sees who is in it; nobody else
    // does. What a row carries is a display name and the channel's own facts.
    {
      const p = await create(mia, ftrOslo, "deltakerliste", [id.kristoffer, id.elise]);
      expect("P1 admin oppretter kanal med to deltakere", Boolean(p.id), true);
      const list = { id: p.id!, community: FTR, group: ftrOslo, name: `${NAME} deltakerliste` };

      const seen = await roster(kristoffer, list.id);
      expect("P1 deltaker ser alle deltakerne", seen.map((row) => row.user_id).sort().join(","), [id.kristoffer, id.elise].sort().join(","));
      expect("P1 deltaker ser visningsnavn i fellesskapet", seen.map((row) => row.display_name).sort().join(","), "Elise Damsgaard,Kristoffer Berg");
      expect("P1 raden inneholder bare kanalens egne opplysninger", Object.keys(seen[0] ?? {}).sort().join(","), "added_at,display_name,is_leader,is_manager,user_id");
      expect("P1 deltaker får ikke vite hvem som leder lokallaget", seen.every((row) => row.is_leader === null), true);
      expect("P1 deltaker får ikke vite når noen ble lagt til", seen.every((row) => row.added_at === null), true);
      expect("P1 den andre deltakeren ser den samme listen", (await roster(elise, list.id)).length, 2);
      const asAdmin = await roster(mia, list.id);
      expect("P1 admin ser listen", asAdmin.length, 2);
      expect("P1 admin (som administrerer) ser når noen ble lagt til", asAdmin.every((row) => row.added_at !== null), true);
      // The table keeps its narrow policy: the list is the function's answer.
      const { data: rawRows } = await kristoffer.from("channel_participants").select("user_id, added_by").eq("channel_id", list.id);
      expect("P1 deltaker leser fortsatt bare sin egen rad i tabellen", (rawRows ?? []).map((row) => row.user_id).join(","), id.kristoffer);

      expect("P2 uinvitert Oslo-medlem får ingen liste", (await roster(linn, list.id)).length, 0);
      expect("P2 moderator i Oslo som ikke er invitert får ingen liste", (await roster(amina, list.id)).length, 0);
      expect("P2 moderator uten lokallag får ingen liste", (await roster(ingrid, list.id)).length, 0);
      expect("P2 medlem av annet lokallag får ingen liste", (await roster(eli, list.id)).length, 0);
      expect("P2 leder av annet lokallag får ingen liste", (await roster(petter, list.id)).length, 0);
      expect("P2 admin i et annet fellesskap får ingen liste", (await roster(emma, list.id)).length, 0);
      expect("P2 uautentisert får ingen liste", ((await anon.rpc("private_channel_roster", { p_channel_id: list.id })).data ?? []).length, 0);
      expect("P2 ukjent kanal-id gir ingen liste", (await roster(kristoffer, `${FTR}--privat-finnesikke`)).length, 0);
      expect("P2 hovedkanalen har ingen deltakerliste", (await roster(kristoffer, osloMain)).length, 0);

      // Seeing the list changes nothing about who may change it.
      expect("P3 deltaker kan ikke legge til", await add(kristoffer, list.id, id.linn), false);
      expect("P3 deltaker kan ikke fjerne", await remove(kristoffer, list.id, id.elise), false);
      expect("P3 deltaker kan ikke gi ansvar", await setManager(kristoffer, list.id, id.elise, true), false);
      expect("P3 listen er uendret", (await roster(mia, list.id)).length, 2);

      expect("P4 admin fjerner elise", await remove(mia, list.id, id.elise), true);
      expect("P4 den fjernede får ingen liste", (await roster(elise, list.id)).length, 0);
      expect("P4 de som er igjen ser den oppdaterte listen", (await roster(kristoffer, list.id)).map((row) => row.user_id).join(","), id.kristoffer);
      expect("P4 den siste deltakeren forlater lokallaget", await setMyGroup(kristoffer, FTR, null), true);
      expect("P4 en som har forlatt lokallaget står ikke lenger på listen", (await roster(mia, list.id)).length, 0);
      expect("P4 kristoffer velger FTR Oslo igjen", await setMyGroup(kristoffer, FTR, ftrOslo), true);
      await add(mia, planning.id, id.kristoffer);
    }

    // ── Q. Permanent deletion ───────────────────────────────────────────
    {
      // Only private channels, whoever asks.
      const general = fixtureChannels.find((c) => c.communityId === FTR && c.groupId === "generelt" && !c.readOnly)!;
      const { data: team } = await admin.from("channels").select("id").eq("community_id", FTR).not("subgroup_id", "is", null).limit(1).maybeSingle();
      expect("Q1 admin kan ikke slette lokallagets hovedkanal", await destroy(mia, osloMain), false);
      expect("Q1 hovedkanalen finnes", await channelExists(osloMain), true);
      expect("Q1 admin kan ikke slette en fellesskapskanal", await destroy(mia, general.id), false);
      expect("Q1 fellesskapskanalen finnes", await channelExists(general.id), true);
      if (team) {
        expect("Q1 admin kan ikke slette en gruppekanal (Safe-Space)", await destroy(mia, team.id), false);
        expect("Q1 gruppekanalen finnes", await channelExists(team.id), true);
      }
      expect("Q1 ukjent kanal-id gir ingenting", await destroy(mia, `${FTR}--privat-finnesikke`), false);
      const rawDelete = await mia.from("channels").delete().eq("id", planning.id).select("id");
      expect("Q1 admin kan ikke slette en privat kanal med direkte DELETE", (rawDelete.data ?? []).length, 0);
      const rawMessages = await mia.from("messages").delete().eq("channel_id", planning.id).select("id");
      expect("Q1 admin kan ikke slette meldinger med direkte DELETE", (rawMessages.data ?? []).length, 0);
      expect("Q1 uautentisert kan ikke slette", Boolean((await anon.rpc("delete_private_channel", { p_channel_id: planning.id })).error), true);
      expect("Q1 kanalen finnes etter alle forsøkene", await channelExists(planning.id), true);

      // What must still be there afterwards.
      const mainBefore = await messageCount(osloMain);
      const { count: membershipsBefore } = await admin.from("memberships").select("id", { count: "exact", head: true });
      const { count: profilesBefore } = await admin.from("profiles").select("id", { count: "exact", head: true });
      const { count: channelsBefore } = await admin.from("channels").select("id", { count: "exact", head: true }).eq("is_private", false);

      // A lokallagsleder deletes a channel she manages.
      const { data: appointed } = await mia.rpc("add_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("Q2 amina er lokallagsleder for FTR Oslo igjen", appointed, true);
      const own = await create(amina, ftrOslo, "slettes av leder", [id.kristoffer, id.elise]);
      expect("Q2 lederen oppretter en kanal", Boolean(own.id), true);
      const doomed = { id: own.id!, community: FTR, group: ftrOslo, name: `${NAME} slettes av leder` };
      expect("Q2 det skrives i kanalen", (await send(kristoffer, doomed.id, "skal slettes")).error, null);
      expect("Q2 lederen skriver også", (await send(amina, doomed.id, "skal også slettes")).error, null);
      const href = `/community/${FTR}/channel/${doomed.id}`;
      const control = `/community/${FTR}/channel/${osloMain}`;
      await admin.from("notifications").insert([
        { user_id: id.kristoffer, kind: "mention", community_id: FTR, title: `${BODY} varsel om kanalen`, body: "x", href },
        { user_id: id.kristoffer, kind: "mention", community_id: FTR, title: `${BODY} varsel med anker`, body: "x", href: `${href}#melding` },
        { user_id: id.kristoffer, kind: "mention", community_id: FTR, title: `${BODY} varsel om noe annet`, body: "x", href: control },
      ]);

      expect("Q3 vanlig deltaker kan ikke slette", await destroy(kristoffer, doomed.id), false);
      expect("Q3 uinvitert Oslo-medlem kan ikke slette", await destroy(linn, doomed.id), false);
      expect("Q3 moderator uten tilknytning kan ikke slette", await destroy(ingrid, doomed.id), false);
      expect("Q3 moderator i annet lokallag kan ikke slette", await destroy(nadia, doomed.id), false);
      expect("Q3 leder av annet lokallag kan ikke slette", await destroy(petter, doomed.id), false);
      expect("Q3 admin i annet fellesskap kan ikke slette", await destroy(emma, doomed.id), false);
      expect("Q3 Oslo-lederen kan ikke slette Trøndelags kanal", await destroy(amina, board.id), false);
      expect("Q3 Oslo-lederen kan ikke slette en kanal hun ikke er med i", await destroy(amina, planning.id), false);
      expect("Q3 alle tre kanalene finnes fortsatt", (await channelExists(doomed.id)) && (await channelExists(board.id)) && (await channelExists(planning.id)), true);
      expect("Q3 meldingene finnes fortsatt", await messageCount(doomed.id), 2);

      expect("Q4 lederen sletter kanalen sin permanent", await destroy(amina, doomed.id), true);
      expect("Q4 kanalen er borte", await channelExists(doomed.id), false);
      expect("Q4 meldingene er borte", await messageCount(doomed.id), 0);
      expect("Q4 deltakerradene er borte", (await participantRows(doomed.id)).length, 0);
      const { data: notes } = await admin.from("notifications").select("title, href").like("title", `${BODY}%`);
      expect("Q4 varsler som pekte til kanalen er borte", (notes ?? []).filter((n) => n.href.startsWith(href)).length, 0);
      expect("Q4 varsel om noe annet står igjen", (notes ?? []).filter((n) => n.href === control).length, 1);
      await admin.from("notifications").delete().like("title", `${BODY}%`);

      // Gone for everyone, through every path, at once.
      for (const [who, client] of [["lederen", amina], ["en tidligere deltaker", kristoffer], ["admin", mia]] as const) {
        expect(`Q5 ${who}: kanalen er ikke i kanallisten`, (await visibleChannelIds(client, FTR)).includes(doomed.id), false);
        expect(`Q5 ${who}: direkte oppslag gir ingenting`, await directChannel(client, doomed.id), null);
        expect(`Q5 ${who}: ingen meldinger å lese`, (await readMessages(client, doomed.id)).length, 0);
        expect(`Q5 ${who}: ingen deltakerliste`, (await roster(client, doomed.id)).length, 0);
        const { data: canRead } = await client.rpc("can_read_channel", { chid: doomed.id });
        expect(`Q5 ${who}: can_read_channel er false`, canRead, false);
        const late = await send(client, doomed.id, "etter sletting");
        expect(`Q5 ${who}: kan ikke skrive til den slettede kanalen`, late.id === null && Boolean(late.error), true);
        expect(`Q5 ${who}: kan ikke slette den en gang til`, await destroy(client, doomed.id), false);
      }
      const { data: byName } = await mia.from("channels").select("id").ilike("name", `%${doomed.name}%`);
      expect("Q5 navnesøk finner ikke den slettede kanalen", (byName ?? []).length, 0);
      const { data: byBody } = await mia.from("messages").select("id").like("body", `${BODY}: skal%slettes%`);
      expect("Q5 søk i meldingstekst finner ikke de slettede meldingene", (byBody ?? []).length, 0);
      expect("Q5 gjenåpning virker ikke på en slettet kanal", await setArchived(mia, doomed.id, false), false);

      // And nothing else went with it.
      expect("Q6 hovedkanalens meldinger er urørt", await messageCount(osloMain), mainBefore);
      expect("Q6 de andre private kanalene finnes", (await channelExists(planning.id)) && (await channelExists(board.id)), true);
      const { count: membershipsAfter } = await admin.from("memberships").select("id", { count: "exact", head: true });
      const { count: profilesAfter } = await admin.from("profiles").select("id", { count: "exact", head: true });
      const { count: channelsAfter } = await admin.from("channels").select("id", { count: "exact", head: true }).eq("is_private", false);
      expect("Q6 ingen medlemskap er slettet", membershipsAfter, membershipsBefore);
      expect("Q6 ingen kontoer er slettet", profilesAfter, profilesBefore);
      expect("Q6 ingen andre kanaler er slettet", channelsAfter, channelsBefore);
      expect("Q6 deltakerne er fortsatt i lokallaget", `${await membershipGroup("kristoffer", FTR)}/${await membershipGroup("elise", FTR)}`, `${ftrOslo}/${ftrOslo}`);
      expect("Q6 lederen er fortsatt lokallagsleder", await canCreate(amina, ftrOslo), true);
      expect("Q6 navnet kan brukes på nytt", Boolean((await create(amina, ftrOslo, "slettes av leder", [])).id), true);

      // Deleting an archived channel; and a leader who only participates.
      const arch = await create(amina, ftrOslo, "arkivert og slettet", [id.kristoffer]);
      expect("Q7 lederen sender en melding", (await send(amina, arch.id!, "før arkivering")).error, null);
      expect("Q7 lederen arkiverer kanalen", await setArchived(amina, arch.id!, true), true);
      expect("Q7 deltaker kan ikke slette en arkivert kanal", await destroy(kristoffer, arch.id!), false);
      expect("Q7 lederen sletter den arkiverte kanalen", await destroy(amina, arch.id!), true);
      expect("Q7 den arkiverte kanalen og meldingene er borte", `${await channelExists(arch.id!)}/${await messageCount(arch.id!)}`, "false/0");

      const guest = await create(mia, ftrOslo, "leder som gjest", [id.amina, id.kristoffer]);
      expect("Q8 lederen er deltaker i adminens kanal", (await directChannel(amina, guest.id!))?.id, guest.id);
      expect("Q8 lederen administrerer ikke adminens kanal", await canManage(amina, guest.id!), false);
      expect("Q8 leder som bare deltar kan ikke slette", await destroy(amina, guest.id!), false);
      expect("Q8 admin gir lederen ansvaret", await setManager(mia, guest.id!, id.amina, true), true);

      // Losing leadership takes the right to delete with it — for the channel
      // she created and for the one she was assigned.
      const kept = await create(amina, ftrOslo, "overlever ledertap", [id.kristoffer]);
      expect("Q9 lederen kan administrere begge kanalene", (await canManage(amina, kept.id!)) && (await canManage(amina, guest.id!)), true);
      const { data: revoked } = await mia.rpc("remove_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("Q9 admin fjerner amina som lokallagsleder", revoked, true);
      expect("Q9 tidligere leder kan ikke slette kanalen hun opprettet", await destroy(amina, kept.id!), false);
      expect("Q9 tidligere leder kan ikke slette kanalen hun fikk ansvar for", await destroy(amina, guest.id!), false);
      expect("Q9 begge kanalene finnes", (await channelExists(kept.id!)) && (await channelExists(guest.id!)), true);
      expect("Q9 hun er fortsatt deltaker og leser", (await directChannel(amina, kept.id!))?.id, kept.id);
      await mia.rpc("add_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });
      expect("Q9 ny utnevnelse gir ikke sletteretten tilbake", await destroy(amina, kept.id!), false);
      await mia.rpc("remove_local_group_manager", { p_local_group_id: ftrOslo, p_user_id: id.amina });

      // Administrator oversight: any private channel in her own community.
      expect("Q10 admin sletter kanalen lederen opprettet", await destroy(mia, kept.id!), true);
      expect("Q10 admin sletter kanalen i et lokallag hun ikke er med i", await destroy(mia, guest.id!), true);
      expect("Q10 kanalene er borte", (await channelExists(kept.id!)) || (await channelExists(guest.id!)), false);

      // Tryggere Ungdom, and the wall between the two communities.
      const tuOwn = await create(hanne, tuOslo, "tu slettes av leder", [id.nadia]);
      const tuAdmin = await create(emma, tuOslo, "tu slettes av admin", [id.hanne]);
      expect("Q11 TU-lederen og TU-admin oppretter hver sin kanal", Boolean(tuOwn.id) && Boolean(tuAdmin.id), true);
      expect("Q11 deltaker i TU ser deltakerlisten", (await roster(nadia, tuOwn.id!)).map((row) => row.display_name).sort().join(","), "Hanne Nordbø,Nadia Rashid");
      expect("Q11 FTR-admin får ingen TU-deltakerliste", (await roster(mia, tuOwn.id!)).length, 0);
      expect("Q11 FTR-admin kan ikke slette en TU-kanal", await destroy(mia, tuOwn.id!), false);
      expect("Q11 FTR Oslo-medlem kan ikke slette en TU-kanal", await destroy(kristoffer, tuOwn.id!), false);
      expect("Q11 TU-deltaker kan ikke slette", await destroy(nadia, tuOwn.id!), false);
      expect("Q11 TU-moderator i annet lokallag kan ikke slette", await destroy(mathea, tuOwn.id!), false);
      expect("Q11 TU-lederen kan ikke slette adminens kanal (bare deltaker)", await destroy(hanne, tuAdmin.id!), false);
      expect("Q11 TU-admin kan ikke slette en FTR-kanal", await destroy(emma, planning.id), false);
      expect("Q11 TU-lederen kan ikke slette en FTR-kanal", await destroy(hanne, planning.id), false);
      expect("Q11 alle finnes fortsatt", (await channelExists(tuOwn.id!)) && (await channelExists(tuAdmin.id!)) && (await channelExists(planning.id)), true);
      expect("Q11 TU-lederen sletter sin egen kanal", await destroy(hanne, tuOwn.id!), true);
      expect("Q11 TU-admin sletter sin kanal", await destroy(emma, tuAdmin.id!), true);
      expect("Q11 TU-kanalene er borte", (await channelExists(tuOwn.id!)) || (await channelExists(tuAdmin.id!)), false);
      expect("Q11 den tidligere TU-deltakeren finner ingenting", await directChannel(nadia, tuOwn.id!), null);
      expect("Q11 FTR-kanalen er urørt av TU-slettingene", await channelExists(planning.id), true);
    }

    // ── O. Existing channels are untouched ──────────────────────────────
    {
      expect("O1 Oslo-medlem leser hovedkanalen", (await directChannel(linn, osloMain))?.is_private, false);
      const sent = await send(linn, osloMain, "hovedkanal");
      expect("O1 Oslo-medlem kan skrive i hovedkanalen", sent.error, null);
      expect("O1 admin leser hovedkanalen", (await readMessages(mia, osloMain)).some((m) => m.id === sent.id), true);
      expect("O1 Trøndelag-medlem ser ikke Oslos hovedkanal", await directChannel(eli, osloMain), null);
      expect("O1 Trøndelag-medlem ser sin egen hovedkanal", (await directChannel(eli, trondelagMain))?.id, trondelagMain);
      expect("O1 TU Oslo-medlem ser TU Oslos hovedkanal", (await directChannel(hanne, tuOsloMain))?.id, tuOsloMain);
      expect("O1 moderator uten lokallag ser fortsatt ikke Oslos hovedkanal", await directChannel(ingrid, osloMain), null);

      const { data: mains } = await admin.from("channels").select("id, local_group_id").eq("is_private", false).not("local_group_id", "is", null);
      const perGroup = new Map<string, number>();
      for (const row of mains ?? []) perGroup.set(row.local_group_id!, (perGroup.get(row.local_group_id!) ?? 0) + 1);
      expect("O2 hvert lokallag har fortsatt høyst én hovedkanal", [...perGroup.values()].every((n) => n === 1), true);

      const { data: wide } = await admin.from("channels").select("*").is("local_group_id", null).is("subgroup_id", null);
      const byId = new Map((wide ?? []).map((row) => [row.id, row]));
      expect("O3 alle fellesskapskanaler fra fixturen finnes", fixtureChannels.every((c) => byId.has(c.id)), true);
      expect("O3 ingen fellesskapskanal er blitt privat eller arkivert", (wide ?? []).every((c) => !c.is_private && !c.archived_at), true);
      const general = fixtureChannels.find((c) => c.communityId === FTR && c.groupId === "generelt" && !c.readOnly)!;
      const { count: total } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", general.id);
      for (const [who, client] of [["uinvitert Oslo-medlem", linn], ["admin", mia], ["moderator", ingrid]] as const) {
        expect(`O3 ${who} leser hele #${general.name}`, (await readMessages(client, general.id)).length, total);
      }
      expect("O3 medlem kan fortsatt skrive i fellesskapskanal", (await send(linn, general.id, "fellesskap")).error, null);
      const announcements = fixtureChannels.find((c) => c.communityId === FTR && c.readOnly)!;
      expect("O3 skrivebeskyttet kanal avviser fortsatt vanlige medlemmer", (await send(linn, announcements.id, "nei")).id, null);
      expect("O3 admin endrer fortsatt ikke lokallagets hovedkanal", (await rename(mia, FTR, osloMain, "endret")).rows, 0);
      // Saved back with the values it already has, so nothing is changed.
      const current = byId.get(general.id)!;
      const edit = await rename(mia, FTR, general.id, current.name, current.purpose);
      expect("O3 admin redigerer fortsatt fellesskapskanaler", edit.rows, 1);
      expect("O3 moderator redigerer fortsatt ikke fellesskapskanaler", (await rename(ingrid, FTR, general.id, "nei")).rows, 0);

      // Under The Rug has no lokallag, so there is nowhere to create one.
      const { count: utrGroups } = await admin.from("community_local_groups").select("id", { count: "exact", head: true }).eq("community_id", UTR);
      expect("O4 Under The Rug har ingen lokallag", utrGroups, 0);
      const { count: utrPrivate } = await admin.from("channels").select("id", { count: "exact", head: true }).eq("community_id", UTR).eq("is_private", true);
      expect("O4 Under The Rug har ingen private kanaler", utrPrivate, 0);
    }
  } finally {
    await admin.from("memberships").update({ role: "admin" }).eq("community_id", FTR).eq("user_id", id.mia);
    await setMyGroup(mia, FTR, null);
    await setMyGroup(kristoffer, FTR, ftrOslo);
    await setMyGroup(amina, FTR, ftrOslo);
    await cleanup();
    if ((grantsBefore ?? []).length > 0) {
      const { data: full } = await admin.from("community_local_group_managers").select("local_group_id, user_id");
      const present = new Set((full ?? []).map((row) => `${row.local_group_id}/${row.user_id}`));
      const missing = grantsBefore!.filter((row) => !present.has(`${row.local_group_id}/${row.user_id}`));
      expect("opprydding: ingen lokallagsleder fra før er borte", missing.length, 0);
    }
  }

  expect("opprydding: elise er tilbake uten lokallag", await membershipGroup("elise", FTR), null);
  expect("opprydding: linn er tilbake uten lokallag", await membershipGroup("linn", FTR), null);
  expect("opprydding: nadia er tilbake uten TU-lokallag", await membershipGroup("nadia", TU), null);
  expect("opprydding: kristoffer er i FTR Oslo", await membershipGroup("kristoffer", FTR), ftrOslo);
  expect("opprydding: amina er i FTR Oslo", await membershipGroup("amina", FTR), ftrOslo);
  expect("opprydding: mia er uten lokallag", await membershipGroup("miaminge", FTR), null);
  const { data: miaRole } = await admin.from("memberships").select("role").eq("community_id", FTR).eq("user_id", id.mia).single();
  expect("opprydding: mia er admin", miaRole?.role, "admin");
  const { data: grantsAfter } = await admin.from("community_local_group_managers").select("local_group_id, user_id");
  const grantKey = (rows: { local_group_id: string; user_id: string }[] | null) =>
    JSON.stringify((rows ?? []).map((r) => `${r.local_group_id}/${r.user_id}`).sort());
  expect("opprydding: lokallagsledere er som før", grantKey(grantsAfter), grantKey(grantsBefore));
  const { data: privateAfter } = await admin.from("channels").select("id").eq("is_private", true);
  expect("opprydding: ingen testkanaler igjen", (privateAfter ?? []).length, (privateBefore ?? []).length);
  const { count: leftovers } = await admin.from("messages").select("id", { count: "exact", head: true }).like("body", `${BODY}%`);
  expect("opprydding: ingen testmeldinger igjen", leftovers, 0);
  const { count: groupsLeft } = await admin.from("community_local_groups").select("id", { count: "exact", head: true }).like("name", `${GROUP_PREFIX}%`);
  expect("opprydding: ingen testlokallag igjen", groupsLeft, 0);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av private lokallagskanaler passerte`);
  });
