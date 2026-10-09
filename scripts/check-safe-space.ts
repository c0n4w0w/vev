/**
 * Checks private subgroups ("grupper") through Safe-Space frivillige, and the
 * lokallag admin override, under real authenticated sessions.
 *
 * Rules (20261005100000_community_subgroups):
 *
 *   read subgroup content    explicit subgroup member, or the community's
 *                            active moderators and admins
 *   manage subgroup members  the community's active admins, or an explicit
 *                            manager — never a moderator by role alone, and a
 *                            manager grant gives no read access
 *   lokallag content         exact lokallag members and the community's admins
 *                            (moderators: their own lokallag only)
 *
 * Every access check runs as a fixture account through the anon key, with the
 * same queries the app runs, so a passing run means the database refuses. The
 * service role reads state back, sets up one temporary manager grant and
 * restores everything afterwards — including the subgroup roster exactly as
 * the seed left it.
 *
 * Run with `npm run check:safe-space` against the local stack after
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
const TU = "tryggere-ungdom";
const SLUG = "safe-space-frivillige";
const MARK = "CHECK safe-space";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`fant ikke ${handle}: ${error.message}`);
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

async function membership(handle: string, communityId: string) {
  const { data } = await admin
    .from("memberships")
    .select("role, status, local_group_id")
    .eq("community_id", communityId)
    .eq("user_id", await profileId(handle))
    .maybeSingle();
  return data;
}

// ── The same reads the app makes ────────────────────────────────────────

async function canSeeChannel(client: Client, channelId: string) {
  const { data } = await client.from("channels").select("id").eq("id", channelId).maybeSingle();
  return Boolean(data);
}
async function messagesIn(client: Client, channelId: string) {
  const { data } = await client.from("messages").select("id, body").eq("channel_id", channelId);
  return data ?? [];
}
async function canSeePost(client: Client, postId: string) {
  const { data } = await client.from("posts").select("id").eq("id", postId).maybeSingle();
  return Boolean(data);
}
async function canSeeEvent(client: Client, eventId: string) {
  const { data } = await client.from("events").select("id").eq("id", eventId).maybeSingle();
  return Boolean(data);
}
async function attendeesOf(client: Client, eventId: string) {
  const { data } = await client.from("event_attendees").select("user_id").eq("event_id", eventId);
  return data ?? [];
}
async function rsvp(client: Client, eventId: string) {
  const { error } = await client.from("event_attendees").insert({ event_id: eventId });
  return error ? (error.message.includes("event_full") ? "full" : "refused") : "ok";
}
async function canManage(client: Client, subgroupId: string) {
  const { data } = await client.rpc("can_manage_subgroup", { p_subgroup_id: subgroupId });
  return data === true;
}
async function addMember(client: Client, subgroupId: string, userId: string) {
  const { data } = await client.rpc("add_subgroup_member", { p_subgroup_id: subgroupId, p_user_id: userId });
  return data === true;
}
async function removeMember(client: Client, subgroupId: string, userId: string) {
  const { data } = await client.rpc("remove_subgroup_member", { p_subgroup_id: subgroupId, p_user_id: userId });
  return data === true;
}
async function isListedMember(subgroupId: string, userId: string) {
  const { data } = await admin
    .from("community_subgroup_members")
    .select("user_id")
    .eq("subgroup_id", subgroupId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
async function setMyGroup(client: Client, localGroupId: string | null) {
  const { data } = await client.rpc("set_my_local_group", {
    p_community_id: FTR,
    p_local_group_id: localGroupId as unknown as string,
  });
  return data === true;
}

async function publish(client: Client, scope: { local_group_id?: string | null; subgroup_id?: string | null }, kind: "post" | "announcement" = "post") {
  const { data, error } = await client
    .from("posts")
    .insert({ community_id: FTR, body: `${MARK}: innlegg`, title: `${MARK} ${kind}`, kind, ...scope })
    .select("id")
    .maybeSingle();
  return { id: data?.id ?? null, error };
}

async function createEvent(
  client: Client,
  scope: { local_group_id?: string | null; subgroup_id?: string | null },
  isPublic = false,
  capacity: number | null = null,
) {
  const starts = new Date(Date.now() + 20 * 24 * 3600 * 1000);
  const ends = new Date(starts.getTime() + 2 * 3600 * 1000);
  const { data, error } = await client
    .from("events")
    .insert({
      community_id: FTR,
      title: `${MARK} arrangement`,
      description: "Opprettet av check:safe-space",
      location: "Oslo",
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      is_public: isPublic,
      capacity,
      ...scope,
    })
    .select("id")
    .maybeSingle();
  return { id: data?.id ?? null, error };
}

async function cleanupContent() {
  await admin.from("messages").delete().like("body", `${MARK}%`);
  await admin.from("posts").delete().like("body", `${MARK}%`);
  await admin.from("events").delete().like("title", `${MARK}%`);
  await admin.from("notifications").delete().like("title", `%${MARK}%`);
}

async function main() {
  await cleanupContent();

  const { data: subgroup, error: subgroupError } = await admin
    .from("community_subgroups")
    .select("*")
    .eq("community_id", FTR)
    .eq("slug", SLUG)
    .single();
  if (subgroupError) throw new Error("Safe-Space finnes ikke — kjør migrasjonen og `npm run seed` først");
  const SS = subgroup.id;
  const { data: ssChannel } = await admin.from("channels").select("*").eq("subgroup_id", SS).single();
  if (!ssChannel) throw new Error("Safe-Space-kanalen finnes ikke");

  // Snapshot what this suite may change, so it can be put back exactly.
  const { data: rosterBefore } = await admin.from("community_subgroup_members").select("*").eq("subgroup_id", SS);
  const { data: managersBefore } = await admin.from("community_subgroup_managers").select("*").eq("subgroup_id", SS);

  const ftrOslo = await groupId(FTR, "FTR Oslo");
  const ftrTrondelag = await groupId(FTR, "FTR Trøndelag");

  const [mia, erlend, kristoffer, amina, elise, petter, emma, hanne] = await Promise.all(
    ["miaminge", "erlendthonstad", "kristoffer", "amina", "elise", "petter", "emmamortensen", "hanne"].map(signIn),
  );
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const ids = Object.fromEntries(
    await Promise.all(
      ["miaminge", "erlendthonstad", "kristoffer", "amina", "elise", "petter", "linn", "adrian", "sofie", "larsbror"].map(
        async (handle) => [handle, await profileId(handle)] as const,
      ),
    ),
  );
  const kristofferGroup = (await membership("kristoffer", FTR))?.local_group_id ?? null;

  const { data: fixturePost } = await admin.from("posts").select("id").eq("subgroup_id", SS).not("body", "like", `${MARK}%`).limit(1).single();
  const { data: fixtureEvent } = await admin.from("events").select("id").eq("subgroup_id", SS).not("title", "like", `${MARK}%`).limit(1).single();
  const { data: trondelagPost } = await admin.from("posts").select("id").eq("local_group_id", ftrTrondelag).limit(1).single();
  const { data: trondelagEvent } = await admin.from("events").select("id").eq("local_group_id", ftrTrondelag).limit(1).single();
  const { data: osloChannel } = await admin.from("channels").select("id").eq("local_group_id", ftrOslo).single();
  const { data: trondelagChannel } = await admin.from("channels").select("id").eq("local_group_id", ftrTrondelag).single();
  const { data: tuOsloGroup } = await admin.from("community_local_groups").select("id").eq("community_id", TU).eq("name", "TU Oslo").single();

  // What the recipient themselves can read back — the same query the
  // notification list and unread badge run under RLS.
  const ownNotifications = async (client: Client) => {
    const { data } = await client.from("notifications").select("title, body, href, post_id").like("title", `%${MARK}%`);
    return data ?? [];
  };
  const notificationsFor = async (handle: string) => {
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ids[handle])
      .like("title", `%${MARK}%`);
    return count ?? 0;
  };

  try {
    // ── Fixture identities and the subgroup itself ───────────────────────
    expect("1. Mia er aktiv FTR-administrator", JSON.stringify(await membership("miaminge", FTR)), JSON.stringify({ role: "admin", status: "active", local_group_id: null }));
    expect("3. Erlend er aktiv FTR-moderator", (await membership("erlendthonstad", FTR))?.role, "moderator");
    expect("1. Mia er eksplisitt Safe-Space-medlem", await isListedMember(SS, ids.miaminge), true);
    expect("Erlend er eksplisitt Safe-Space-medlem", await isListedMember(SS, ids.erlendthonstad), true);
    const { data: erlendManager } = await admin.from("community_subgroup_managers").select("user_id").eq("subgroup_id", SS).eq("user_id", ids.erlendthonstad).maybeSingle();
    expect("4. Erlend er eksplisitt Safe-Space-ansvarlig", Boolean(erlendManager), true);
    expect("Safe-Space hører til FTR med stabil slug", `${subgroup.community_id}/${subgroup.slug}/${subgroup.name}`, `${FTR}/${SLUG}/Safe-Space frivillige`);
    expect("Safe-Space-kanalen ligger under seksjonen grupper", `${ssChannel.group_id}/${ssChannel.local_group_id}`, "grupper/null");
    expect("kanalnavnet følger gruppen", ssChannel.name, subgroup.name);
    expect("én kanal per gruppe", (await admin.from("channels").select("id").eq("subgroup_id", SS)).data?.length, 1);

    // ── Who may manage ────────────────────────────────────────────────────
    expect("2. Mia (admin) kan administrere", await canManage(mia, SS), true);
    expect("5. Erlend (ansvarlig) kan administrere", await canManage(erlend, SS), true);
    expect("6. annen moderator (Amina) kan ikke administrere", await canManage(amina, SS), false);
    expect("7. vanlig Safe-Space-medlem (Kristoffer) kan ikke administrere", await canManage(kristoffer, SS), false);
    expect("7. vanlig FTR-medlem (Elise) kan ikke administrere", await canManage(elise, SS), false);
    expect("8. TU-administrator kan ikke administrere", await canManage(emma, SS), false);
    expect("8. uautentisert kan ikke administrere", (await anon.rpc("can_manage_subgroup", { p_subgroup_id: SS })).data === true, false);

    expect("5. Erlend legger til Petter", await addMember(erlend, SS, ids.petter), true);
    expect("5. Petter er nå medlem", await isListedMember(SS, ids.petter), true);
    expect("9. duplikat medlemskap avvises", await addMember(mia, SS, ids.petter), false);
    expect("9. fortsatt én rad for Petter", (await admin.from("community_subgroup_members").select("user_id").eq("subgroup_id", SS).eq("user_id", ids.petter)).data?.length, 1);
    expect("5. Erlend fjerner Petter", await removeMember(erlend, SS, ids.petter), true);
    expect("2. Mia legger til Petter", await addMember(mia, SS, ids.petter), true);
    expect("2. Mia fjerner Petter", await removeMember(mia, SS, ids.petter), true);
    expect("6. Amina kan ikke legge til", await addMember(amina, SS, ids.linn), false);
    expect("6. Amina kan ikke fjerne Kristoffer", await removeMember(amina, SS, ids.kristoffer), false);
    expect("7. Kristoffer kan ikke legge til", await addMember(kristoffer, SS, ids.linn), false);
    expect("8. TU-admin kan ikke legge til", await addMember(emma, SS, ids.linn), false);
    expect("bare aktive FTR-medlemmer kan legges til (TU-medlem)", await addMember(mia, SS, ids.adrian), false);
    expect("bare aktive FTR-medlemmer kan legges til (uten medlemskap)", await addMember(mia, SS, ids.sofie), false);
    expect("Linn er ikke lagt til av noen uautoriserte", await isListedMember(SS, ids.linn), false);
    const direct = await mia.from("community_subgroup_members").insert({ subgroup_id: SS, community_id: FTR, user_id: ids.linn });
    expect("direkte tabellskriving er avvist selv for admin", Boolean(direct.error), true);

    // Roster and member search name people, so only managers get them — and
    // a manager who is not an admin gets names only, never roles, and never
    // the whole community: adding someone starts with a search.
    const { data: rosterErlend } = await erlend.rpc("subgroup_roster", { p_subgroup_id: SS });
    expect("Erlend får medlemslisten med navn", (rosterErlend ?? []).map((r) => r.display_name).sort().join(","), "Erlend Thonstad,Kristoffer Berg,Mia Minge");
    expect("medlemslisten merker Erlend som ansvarlig", (rosterErlend ?? []).find((r) => r.user_id === ids.erlendthonstad)?.is_manager, true);
    expect("P2. Erlend (ikke admin) får ingen roller i medlemslisten", (rosterErlend ?? []).every((r) => r.role === null), true);
    const { data: rosterMia } = await mia.rpc("subgroup_roster", { p_subgroup_id: SS });
    expect("P4. Mia (admin) får fortsatt rollene", (rosterMia ?? []).find((r) => r.user_id === ids.erlendthonstad)?.role, "moderator");
    expect("Amina (moderator, ikke ansvarlig) får ingen medlemsliste", ((await amina.rpc("subgroup_roster", { p_subgroup_id: SS })).data ?? []).length, 0);
    expect("Kristoffer får ingen medlemsliste", ((await kristoffer.rpc("subgroup_roster", { p_subgroup_id: SS })).data ?? []).length, 0);

    const search = async (client: Client, query: string) =>
      (await client.rpc("search_subgroup_candidates", { p_subgroup_id: SS, p_query: query })).data ?? [];
    const eli = await search(erlend, "Eli");
    expect("P1. Erlend finner aktive FTR-medlemmer ved søk", eli.map((r) => r.display_name).sort().join(","), "Eli Rønning,Elise Damsgaard");
    expect("P2. søket gir bare id og visningsnavn", Object.keys(eli[0] ?? {}).sort().join(","), "display_name,user_id");
    expect("P2. ingen hel medlemsliste: tomt søk gir ingenting", (await search(erlend, "")).length, 0);
    expect("P2. ingen hel medlemsliste: ett tegn gir ingenting", (await search(erlend, "e")).length, 0);
    expect("P2. jokertegn tolkes bokstavelig (ingen oppramsing med %%)", (await search(erlend, "%%")).length, 0);
    expect("P2. jokertegn tolkes bokstavelig (ingen oppramsing med __)", (await search(erlend, "__")).length, 0);
    expect("P2. høyst ti treff", (await search(mia, "an")).length <= 10, true);
    expect("P3. personer fra andre fellesskap finnes ikke i søket", (await search(erlend, "Adrian")).length, 0);
    expect("P3. heller ikke ved søk på kontonavn eller e-post", (await search(erlend, "outlook")).length, 0);
    expect("eksisterende gruppemedlemmer foreslås ikke", (await search(erlend, "Kristoffer")).length, 0);
    expect("ikke-ansvarlig moderator får ingen søkeresultater", (await search(amina, "Eli")).length, 0);
    expect("vanlig medlem får ingen søkeresultater", (await search(elise, "Eli")).length, 0);
    expect("TU-admin får ingen søkeresultater", (await search(emma, "Eli")).length, 0);
    const elise_ = eli.find((r) => r.display_name === "Elise Damsgaard")!;
    expect("P1. Erlend legger til et medlem han fant", await addMember(erlend, SS, elise_.user_id), true);
    expect("P1. og fjerner det igjen", await removeMember(erlend, SS, elise_.user_id), true);
    expect("P4. Mia (admin) kan fortsatt søke og legge til", (await search(mia, "Eli")).length, 2);
    const { data: listAsKristoffer } = await kristoffer.from("community_subgroup_members").select("user_id").eq("subgroup_id", SS);
    expect("vanlig medlem ser bare sin egen gruppetilhørighet", (listAsKristoffer ?? []).map((r) => r.user_id).join(","), ids.kristoffer);
    const { data: listAsElise } = await elise.from("community_subgroup_members").select("user_id");
    expect("utenforstående ser ingen gruppemedlemskap", (listAsElise ?? []).length, 0);
    for (const [who, client, visible] of [["Kristoffer", kristoffer, true], ["Amina", amina, true], ["Mia", mia, true], ["Elise", elise, false], ["TU-admin", emma, false]] as const) {
      const { data } = await client.from("community_subgroups").select("id").eq("id", SS).maybeSingle();
      expect(`gruppen er ${visible ? "synlig" : "usynlig"} for ${who}`, Boolean(data), visible);
    }

    // A manager grant is management only: an ordinary member who manages the
    // group still cannot read it.
    await admin.from("community_subgroup_managers").insert({ subgroup_id: SS, community_id: FTR, user_id: ids.elise });
    expect("ansvarlig uten medlemskap kan administrere", await canManage(elise, SS), true);
    expect("ansvarlig uten medlemskap kan ikke lese kanalen", await canSeeChannel(elise, ssChannel.id), false);
    expect("ansvarlig uten medlemskap kan ikke lese innlegg", await canSeePost(elise, fixturePost!.id), false);
    await admin.from("community_subgroup_managers").delete().eq("subgroup_id", SS).eq("user_id", ids.elise);
    expect("ansvarlig-rettigheten er borte igjen", await canManage(elise, SS), false);

    // ── Channel ───────────────────────────────────────────────────────────
    const ssMessage = await kristoffer.from("messages").insert({ channel_id: ssChannel.id, body: `${MARK}: hei` }).select("id").single();
    expect("26/10. medlem kan skrive i Safe-Space-kanalen", ssMessage.error, null);
    for (const [who, client] of [["10/26. Kristoffer (medlem)", kristoffer], ["27/12. Amina (moderator)", amina], ["28/13. Mia (admin)", mia], ["Erlend", erlend]] as const) {
      expect(`${who} ser kanalen`, await canSeeChannel(client, ssChannel.id), true);
      expect(`${who} leser meldingene`, (await messagesIn(client, ssChannel.id)).some((m) => m.id === ssMessage.data?.id), true);
    }
    expect("12. moderator utenfor gruppen kan skrive", (await amina.from("messages").insert({ channel_id: ssChannel.id, body: `${MARK}: moderator` }).select("id").maybeSingle()).error, null);
    for (const [who, client] of [["29/11. Elise (FTR-medlem utenfor)", elise], ["14. TU-admin", emma], ["14. TU-moderator", hanne], ["uautentisert", anon]] as const) {
      expect(`${who} ser ikke kanalen (30. direkte oppslag)`, await canSeeChannel(client, ssChannel.id), false);
      expect(`${who} leser ingen meldinger`, (await messagesIn(client, ssChannel.id)).length, 0);
      const write = await client.from("messages").insert({ channel_id: ssChannel.id, body: `${MARK}: nei` }).select("id").maybeSingle();
      expect(`${who} kan ikke skrive`, write.data, null);
    }
    const { data: edited } = await mia.rpc("set_channel_details", { p_community_id: FTR, p_channel_id: ssChannel.id, p_name: "x", p_purpose: "x" });
    expect("gruppekanalens navn kan ikke redigeres (følger gruppen)", (edited ?? []).length, 0);

    // ── Lokallag (admin override, no moderator override) ──────────────────
    expect("15. Oslo-medlem ser Oslo", await canSeeChannel(kristoffer, osloChannel!.id), true);
    expect("16. Trøndelag-medlem ser Trøndelag", await canSeeChannel(petter, trondelagChannel!.id), true);
    expect("17. Oslo-medlem ser ikke Trøndelag", await canSeeChannel(kristoffer, trondelagChannel!.id), false);
    expect("18. moderator i Oslo ser ikke Trøndelag", await canSeeChannel(amina, trondelagChannel!.id), false);
    expect("18. Erlend (moderator uten lokallag) ser ikke Oslo", await canSeeChannel(erlend, osloChannel!.id), false);
    expect("19. FTR-admin ser Oslo", await canSeeChannel(mia, osloChannel!.id), true);
    expect("20. FTR-admin ser Trøndelag", await canSeeChannel(mia, trondelagChannel!.id), true);
    const adminWrite = await mia.from("messages").insert({ channel_id: trondelagChannel!.id, body: `${MARK}: admin` }).select("id").single();
    expect("21. FTR-admin kan skrive i Trøndelag", adminWrite.error, null);
    expect("21. FTR-admin leser Trøndelag", (await messagesIn(mia, trondelagChannel!.id)).some((m) => m.id === adminWrite.data?.id), true);
    const { data: allFtrGroups } = await admin.from("community_local_groups").select("id").eq("community_id", FTR).eq("active", true);
    const { data: miaChannels } = await mia.from("channels").select("local_group_id, subgroup_id").eq("community_id", FTR);
    expect("21. FTR-admin ser alle FTRs lokallagskanaler", (allFtrGroups ?? []).every((g) => (miaChannels ?? []).some((c) => c.local_group_id === g.id)), true);
    expect("22. TU-admin ser ikke FTR Oslo", await canSeeChannel(emma, osloChannel!.id), false);
    const { data: tuOsloChannel } = await admin.from("channels").select("id").eq("local_group_id", tuOsloGroup!.id).single();
    expect("22. FTR-admin ser ikke TU Oslo", await canSeeChannel(mia, tuOsloChannel!.id), false);

    // ── Concurrent lokallag + subgroup ────────────────────────────────────
    const { data: kChannels } = await kristoffer.from("channels").select("id").eq("community_id", FTR);
    const kIds = (kChannels ?? []).map((c) => c.id);
    expect("23. Oslo + Safe-Space: begge kanaler synlige", kIds.includes(osloChannel!.id) && kIds.includes(ssChannel.id), true);
    expect("24. Kristoffer bytter Oslo → Trøndelag", await setMyGroup(kristoffer, ftrTrondelag), true);
    expect("24. Safe-Space-medlemskapet består", await isListedMember(SS, ids.kristoffer), true);
    expect("24. Safe-Space-kanalen fortsatt synlig", await canSeeChannel(kristoffer, ssChannel.id), true);
    expect("24. Trøndelag synlig, Oslo ikke", `${await canSeeChannel(kristoffer, trondelagChannel!.id)}/${await canSeeChannel(kristoffer, osloChannel!.id)}`, "true/false");
    expect("24. Kristoffer tilbake til Oslo", await setMyGroup(kristoffer, kristofferGroup), true);

    // ── Posts ─────────────────────────────────────────────────────────────
    const erlendPost = await publish(erlend, { subgroup_id: SS });
    expect("29. Erlend (moderator) kan publisere i Safe-Space", erlendPost.error, null);
    const miaPost = await publish(mia, { subgroup_id: SS });
    expect("28. Mia (admin) kan publisere i Safe-Space", miaPost.error, null);
    expect("30. vanlig Safe-Space-medlem kan ikke publisere", (await publish(kristoffer, { subgroup_id: SS })).id, null);
    expect("begge omfang samtidig avvises", (await publish(mia, { subgroup_id: SS, local_group_id: ftrOslo })).id, null);
    expect("moderator kan ikke publisere i et annet lokallag", (await publish(amina, { local_group_id: ftrTrondelag })).id, null);
    expect("moderator kan publisere i eget lokallag", (await publish(amina, { local_group_id: ftrOslo })).error, null);
    expect("admin kan publisere i hvilket som helst lokallag", (await publish(mia, { local_group_id: ftrTrondelag })).error, null);
    const crossCommunity = await emma.from("posts").insert({ community_id: TU, subgroup_id: SS, body: `${MARK}: tu` }).select("id").maybeSingle();
    expect("FTR-gruppe kan ikke brukes i TU-innlegg", crossCommunity.data, null);

    for (const [who, client, visible] of [
      ["31. medlem", kristoffer, true],
      ["32. moderator utenfor gruppen", amina, true],
      ["33. admin", mia, true],
      ["34. FTR-medlem utenfor", elise, false],
      ["34. TU-admin", emma, false],
    ] as const) {
      expect(`${who} ${visible ? "ser" : "ser ikke"} Safe-Space-innlegg`, await canSeePost(client, erlendPost.id!), visible);
      expect(`${who} ${visible ? "ser" : "ser ikke"} fixture-innlegget`, await canSeePost(client, fixturePost!.id), visible);
    }

    const comment = await kristoffer.from("comments").insert({ post_id: erlendPost.id!, body: `${MARK}: kommentar` }).select("id").single();
    expect("35. medlem kan kommentere", comment.error, null);
    expect("35. utenforstående kan ikke kommentere", (await elise.from("comments").insert({ post_id: erlendPost.id!, body: `${MARK}: nei` }).select("id").maybeSingle()).data, null);
    expect("35. utenforstående ser ingen kommentarer", ((await elise.from("comments").select("id").eq("post_id", erlendPost.id!)).data ?? []).length, 0);
    expect("35. moderator ser kommentaren", ((await amina.from("comments").select("id").eq("post_id", erlendPost.id!)).data ?? []).length, 1);
    const reaction = await kristoffer.from("post_reactions").insert({ post_id: erlendPost.id!, emoji: "👍" });
    expect("35. medlem kan reagere", reaction.error, null);
    expect("35. utenforstående kan ikke reagere", Boolean((await elise.from("post_reactions").insert({ post_id: erlendPost.id!, emoji: "👍" })).error), true);
    expect("35. utenforstående ser ingen reaksjoner", ((await elise.from("post_reactions").select("post_id").eq("post_id", erlendPost.id!)).data ?? []).length, 0);

    expect("36. admin ser Trøndelag-innlegg", await canSeePost(mia, trondelagPost!.id), true);
    expect("37. moderator i Oslo ser ikke Trøndelag-innlegg", await canSeePost(amina, trondelagPost!.id), false);
    expect("37. Erlend (moderator uten lokallag) ser ikke Trøndelag-innlegg", await canSeePost(erlend, trondelagPost!.id), false);
    expect("37. moderator kan ikke feste et innlegg den ikke kan lese", (await amina.rpc("set_post_pinned", { p_post_id: trondelagPost!.id, p_pinned: true })).data, null);

    // Announcement fan-out reaches exactly the readers.
    const announce = await publish(erlend, { subgroup_id: SS }, "announcement");
    expect("Safe-Space-kunngjøring publiseres", announce.error, null);
    expect("53. kunngjøring varsler medlem", await notificationsFor("kristoffer"), 1);
    expect("53. kunngjøring varsler admin", await notificationsFor("miaminge"), 1);
    expect("53. kunngjøring varsler moderator utenfor gruppen", await notificationsFor("amina"), 1);
    expect("53. kunngjøring varsler ikke FTR-medlem utenfor", await notificationsFor("elise"), 0);
    expect("53. kunngjøring varsler ikke vanlig medlem i et lokallag", await notificationsFor("petter"), 0);

    // ── Events ────────────────────────────────────────────────────────────
    const event = await createEvent(mia, { subgroup_id: SS });
    expect("Mia (admin) oppretter Safe-Space-arrangement", event.error, null);
    expect("Erlend (moderator) kan ikke opprette arrangementer (uendret regel)", (await createEvent(erlend, { subgroup_id: SS })).id, null);
    expect("gruppe-arrangement kan ikke være åpent", (await createEvent(mia, { subgroup_id: SS }, true)).id, null);
    expect("lokallag-arrangement kan ikke være åpent", (await createEvent(mia, { local_group_id: ftrOslo }, true)).id, null);
    for (const [who, client, visible] of [
      ["38. medlem", kristoffer, true],
      ["39. moderator utenfor gruppen", amina, true],
      ["40. admin", mia, true],
      ["41. FTR-medlem utenfor", elise, false],
      ["41. TU-admin", emma, false],
    ] as const) {
      expect(`${who} ${visible ? "ser" : "ser ikke"} Safe-Space-arrangementet`, await canSeeEvent(client, event.id!), visible);
      expect(`${who} ${visible ? "ser" : "ser ikke"} fixture-arrangementet`, await canSeeEvent(client, fixtureEvent!.id), visible);
    }
    expect("42. medlem kan melde seg på", (await kristoffer.from("event_attendees").insert({ event_id: event.id! })).error, null);
    expect("42. utenforstående kan ikke melde seg på", Boolean((await elise.from("event_attendees").insert({ event_id: event.id! })).error), true);
    expect("42. utenforstående ser ingen påmeldte", (await attendeesOf(elise, event.id!)).length, 0);
    expect("42. utenforstående ser ingen påmeldte på fixture-arrangementet", (await attendeesOf(elise, fixtureEvent!.id)).length, 0);
    expect("42. medlem ser påmeldte", (await attendeesOf(kristoffer, event.id!)).length, 1);
    const { data: portal } = await anon.rpc("portal_events", { p_slug: FTR });
    expect("51. portalen viser ikke Safe-Space-arrangement", (portal ?? []).some((e) => e.title.startsWith(MARK) || e.id === fixtureEvent!.id), false);
    expect("43. admin ser Trøndelag-arrangement", await canSeeEvent(mia, trondelagEvent!.id), true);
    expect("43. Trøndelag-medlem ser Trøndelag-arrangement", await canSeeEvent(petter, trondelagEvent!.id), true);
    expect("44. moderator i Oslo ser ikke Trøndelag-arrangement", await canSeeEvent(amina, trondelagEvent!.id), false);
    expect("44. FTR-medlem uten lokallag ser ikke Trøndelag-arrangement", await canSeeEvent(elise, trondelagEvent!.id), false);

    // ── Leaks: the queries behind Overview, Feed, Events, sidebar ─────────
    const { data: eliseFeed } = await elise.from("posts").select("id, subgroup_id, title").eq("community_id", FTR);
    expect("50. Feed viser ingen Safe-Space-innlegg for utenforstående", (eliseFeed ?? []).some((p) => p.subgroup_id), false);
    const { data: eliseHome } = await elise.from("posts").select("id, subgroup_id").order("created_at", { ascending: false }).limit(50);
    expect("49. Hjem/Oversikt viser ingen Safe-Space-innlegg", (eliseHome ?? []).some((p) => p.subgroup_id), false);
    const { data: eliseEvents } = await elise.from("events").select("id, subgroup_id, title").eq("community_id", FTR);
    expect("51. Arrangementer viser ingen Safe-Space-arrangementer", (eliseEvents ?? []).some((e) => e.subgroup_id || e.title.startsWith(MARK)), false);
    const { data: eliseChannels } = await elise.from("channels").select("id, subgroup_id, name").eq("community_id", FTR);
    expect("52. kanallisten viser ikke Safe-Space", (eliseChannels ?? []).some((c) => c.subgroup_id || c.name.includes("Safe")), false);
    const { data: latest } = await elise.from("messages").select("created_at").eq("channel_id", ssChannel.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect("52. siste aktivitet i Safe-Space er skjult", latest, null);
    const { data: byName } = await elise.from("community_subgroups").select("id").ilike("name", "%safe%");
    expect("gruppen kan ikke søkes opp", (byName ?? []).length, 0);

    // Erlend's only FTR authorship is Safe-Space content. Under FTR's
    // admin-only member directory that must not make him visible to an
    // outsider, while a member who can read it does see him. (Mia hosts
    // community-wide events as FTR's admin, so she is visible through those.)
    const seesProfile = async (client: Client, handle: string) =>
      (await client.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: ids[handle] })).data === true;
    expect("54. utenforstående ser ikke Erlend via Safe-Space-innlegg", await seesProfile(elise, "erlendthonstad"), false);
    expect("54. medlem ser Erlend via innlegget", await seesProfile(kristoffer, "erlendthonstad"), true);
    expect("54. shares_visible_authorship teller ikke Safe-Space", (await elise.rpc("shares_visible_authorship", { other: ids.erlendthonstad })).data, false);

    // Capacity counts only RSVPs that are still current: set up a full
    // Safe-Space event before Kristoffer is removed.
    const small = await createEvent(mia, { subgroup_id: SS }, false, 2);
    expect("R1. Kristoffer melder seg på (kapasitet 2)", await rsvp(kristoffer, small.id!), "ok");
    expect("R1. Erlend melder seg på", await rsvp(erlend, small.id!), "ok");
    expect("R2. arrangementet er fullt for Amina", await rsvp(amina, small.id!), "full");
    expect("R2. to påmeldte synlige for Mia", (await attendeesOf(mia, small.id!)).length, 2);
    const probe = async (client: Client, eventId: string, attendee: string) =>
      (await client.rpc("can_see_rsvp", { p_event_id: eventId, p_attendee_id: attendee })).data === true;
    expect("R2. can_see_rsvp kan ikke brukes til å spørre om noen uten påmelding", await probe(kristoffer, small.id!, ids.amina), false);
    expect("R2. can_see_rsvp svarer ikke utenforstående", await probe(elise, small.id!, ids.kristoffer), false);
    expect("R2. den interne regelen kan ikke kalles", Boolean((await kristoffer.rpc("rsvp_is_current", { p_event_id: small.id!, p_user_id: ids.amina })).error), true);

    // Notifications before revocation, as the recipient reads them.
    expect("N1. Kristoffer leser Safe-Space-varselet sitt", (await ownNotifications(kristoffer)).length, 1);
    expect("N1. varselet er knyttet til innlegget", (await ownNotifications(kristoffer))[0]?.post_id, announce.id);
    const { data: myNotification } = await kristoffer.from("notifications").select("id").like("title", `%${MARK}%`).single();
    const unlink = await kristoffer.from("notifications").update({ post_id: null }).eq("id", myNotification!.id).select("id");
    expect("N1. mottakeren kan ikke koble varselet fra innlegget", Boolean(unlink.error) || (unlink.data ?? []).length === 0, true);

    // ── Revocation ────────────────────────────────────────────────────────
    expect("11. Erlend fjerner Kristoffer", await removeMember(erlend, SS, ids.kristoffer), true);
    expect("N2. varselet kan ikke lenger leses (tittel/innhold/lenke)", (await ownNotifications(kristoffer)).length, 0);
    const { count: unreadAfter } = await kristoffer.from("notifications").select("id", { count: "exact", head: true }).like("title", `%${MARK}%`);
    expect("N2. og teller ikke i uleste", unreadAfter, 0);
    expect("N2. raden finnes fortsatt (skjult, ikke slettet)", await notificationsFor("kristoffer"), 1);
    expect("N3. moderator utenfor gruppen leser fortsatt sitt varsel", (await ownNotifications(amina)).length, 1);
    expect("N3. admin leser fortsatt sitt varsel", (await ownNotifications(mia)).length, 1);
    expect("N4. FTR-medlem utenfor ser aldri varselet", (await ownNotifications(elise)).length, 0);
    expect("N4. TU-admin ser aldri varselet", (await ownNotifications(emma)).length, 0);

    expect("R3. Kristoffers påmelding er borte for Mia", (await attendeesOf(mia, small.id!)).map((a) => a.user_id).includes(ids.kristoffer), false);
    const { data: keptRsvp } = await admin.from("event_attendees").select("user_id").eq("event_id", small.id!).eq("user_id", ids.kristoffer).maybeSingle();
    expect("R4. påmeldingsraden er beholdt som historikk", Boolean(keptRsvp), true);
    expect("R3. plassen hans er frigjort: Amina får plass", await rsvp(amina, small.id!), "ok");
    expect("R3. nå fullt igjen for andre", await rsvp(mia, small.id!), "full");
    expect("11. kanal borte", await canSeeChannel(kristoffer, ssChannel.id), false);
    expect("11. meldinger borte", (await messagesIn(kristoffer, ssChannel.id)).length, 0);
    expect("11. innlegg borte", await canSeePost(kristoffer, erlendPost.id!), false);
    expect("11. egne kommentarer ikke lenger synlige", ((await kristoffer.from("comments").select("id").eq("post_id", erlendPost.id!)).data ?? []).length, 0);
    expect("11. reaksjoner borte", ((await kristoffer.from("post_reactions").select("post_id").eq("post_id", erlendPost.id!)).data ?? []).length, 0);
    expect("11. arrangement borte", await canSeeEvent(kristoffer, event.id!), false);
    expect("11. påmelding ikke lenger synlig", (await attendeesOf(kristoffer, event.id!)).length, 0);
    expect("11. kan ikke skrive", (await kristoffer.from("messages").insert({ channel_id: ssChannel.id, body: `${MARK}: etter` }).select("id").maybeSingle()).data, null);
    expect("25. lokallaget er urørt", (await membership("kristoffer", FTR))?.local_group_id, kristofferGroup);
    expect("25. FTR-medlemskapet er urørt", (await membership("kristoffer", FTR))?.status, "active");
    expect("25. Oslo-kanalen er fortsatt synlig", await canSeeChannel(kristoffer, osloChannel!.id), true);
    const { data: stillThere } = await admin.from("messages").select("id").eq("id", ssMessage.data!.id).maybeSingle();
    expect("forfatterskap består etter fjerning", Boolean(stillThere), true);

    // Access back: the kept RSVP and notification count again, as they were.
    expect("R5. Kristoffer legges til igjen", await addMember(erlend, SS, ids.kristoffer), true);
    expect("R5. varselet er lesbart igjen", (await ownNotifications(kristoffer)).length, 1);
    expect("R5. påmeldingen hans gjelder igjen", (await attendeesOf(mia, small.id!)).map((a) => a.user_id).includes(ids.kristoffer), true);
    expect("R5. tre gjeldende påmeldinger over kapasitet 2 (forutsigbart, ingen nye slipper inn)", (await attendeesOf(mia, small.id!)).length, 3);
    expect("R5. ingen nye påmeldinger når over kapasitet", await rsvp(mia, small.id!), "full");
    expect("R5. Kristoffer fjernes igjen for resten av testen", await removeMember(erlend, SS, ids.kristoffer), true);

    // Community-wide and lokallag events: capacity unchanged for eligible
    // RSVPs; a lokallag RSVP stops counting when its owner leaves the group.
    const community = await createEvent(mia, {}, false, 1);
    expect("R6. fellesskapsarrangement: Elise får plass", await rsvp(elise, community.id!), "ok");
    expect("R6. fellesskapsarrangement: fullt for Petter", await rsvp(petter, community.id!), "full");
    const oslo = await createEvent(mia, { local_group_id: ftrOslo }, false, 1);
    expect("R7. Oslo-arrangement: Kristoffer får plass", await rsvp(kristoffer, oslo.id!), "ok");
    expect("R7. Oslo-arrangement: fullt for Amina (Oslo)", await rsvp(amina, oslo.id!), "full");
    expect("R7. Kristoffer bytter til Trøndelag", await setMyGroup(kristoffer, ftrTrondelag), true);
    expect("R7. plassen hans teller ikke lenger: Amina får plass", await rsvp(amina, oslo.id!), "ok");
    expect("R7. Kristoffer tilbake til Oslo", await setMyGroup(kristoffer, kristofferGroup), true);

    // Staff keep reading through their role even without the member row.
    expect("Mia fjernes fra Safe-Space", await removeMember(erlend, SS, ids.miaminge), true);
    expect("13. admin uten medlemskap leser fortsatt", await canSeePost(mia, erlendPost.id!), true);
    expect("13. admin uten medlemskap ser fortsatt kanalen", await canSeeChannel(mia, ssChannel.id), true);
    expect("Mia legges til igjen", await addMember(erlend, SS, ids.miaminge), true);

    // ── Directory ─────────────────────────────────────────────────────────
    const { data: staff } = await kristoffer.from("community_people").select("name, role, section").eq("community_id", FTR).eq("section", "staff");
    const staffLine = (name: string) => (staff ?? []).find((p) => p.name === name)?.role;
    expect("45. Mia Minge er Organisasjonssekretær", staffLine("Mia Minge"), "Organisasjonssekretær");
    expect("46. Erlend Thonstad er Prosjektleder Rusopplysningen", staffLine("Erlend Thonstad"), "Prosjektleder Rusopplysningen");
    expect("47. Lars' ansattkort er borte", (staff ?? []).some((p) => p.name === "Lars Bror Kristiansen"), false);
    expect("47. bare én Organisasjonssekretær i FTR Ansatte", (staff ?? []).filter((p) => p.role === "Organisasjonssekretær").length, 1);
    const { data: links } = await admin.from("community_people").select("name, user_id").eq("community_id", FTR).in("name", ["Mia Minge", "Erlend Thonstad"]);
    expect("ansattkortene er koblet til kontoene", (links ?? []).every((row) => row.user_id === ids[row.name === "Mia Minge" ? "miaminge" : "erlendthonstad"]), true);
    const lars = await membership("larsbror", FTR);
    expect("48. Lars' konto finnes", Boolean(ids.larsbror), true);
    const { data: larsRows } = await admin.from("memberships").select("title").eq("user_id", ids.larsbror);
    expect("L1. Lars har ingen tittel i noe medlemskap", (larsRows ?? []).every((m) => !m.title), true);
    const { data: larsAsAdminSees } = await mia.from("memberships").select("title").eq("community_id", FTR).eq("user_id", ids.larsbror).single();
    expect("L1. admin-medlemslisten viser ingen tittel for Lars", larsAsAdminSees?.title ?? null, null);
    const { data: larsProfile } = await admin.from("community_profiles").select("display_name, bio").eq("community_id", FTR).eq("user_id", ids.larsbror).single();
    expect("L1. Lars' FTR-profil nevner ikke Organisasjonssekretær", /organisasjonssekret/i.test(`${larsProfile?.display_name} ${larsProfile?.bio}`), false);
    const { data: ftrPeople } = await admin.from("community_people").select("name, user_id, role").eq("community_id", FTR);
    expect("L1. ingen organisasjonsperson for Lars", (ftrPeople ?? []).some((p) => p.user_id === ids.larsbror || p.name.includes("Lars Bror")), false);
    const { data: secretaries } = await admin.from("memberships").select("user_id").eq("community_id", FTR).ilike("title", "%organisasjonssekret%");
    expect("L1. bare Mia har tittelen Organisasjonssekretær i FTR", (secretaries ?? []).map((m) => m.user_id).join(","), ids.miaminge);
    expect("48. Lars er fortsatt aktivt FTR-medlem", lars?.status, "active");
    expect("Lars er moderator etter at Mia overtok som administrator", lars?.role, "moderator");
    const { count: larsNotifications } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ids.larsbror);
    expect("48. Lars' historikk (varsler) er urørt", (larsNotifications ?? 0) > 0, true);
    const { count: admins } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("community_id", FTR).eq("role", "admin").eq("status", "active");
    expect("FTR har nøyaktig én aktiv administrator", admins, 1);

    // ── Integrity ─────────────────────────────────────────────────────────
    const dup = await admin.from("community_subgroup_members").insert({ subgroup_id: SS, community_id: FTR, user_id: ids.erlendthonstad });
    expect("duplikat medlemsrad avvises av databasen", Boolean(dup.error), true);
    const dupManager = await admin.from("community_subgroup_managers").insert({ subgroup_id: SS, community_id: FTR, user_id: ids.erlendthonstad });
    expect("duplikat ansvarlig-rad avvises av databasen", Boolean(dupManager.error), true);
    const outsider = await admin.from("community_subgroup_members").insert({ subgroup_id: SS, community_id: FTR, user_id: ids.adrian });
    expect("medlemsrad krever medlemskap i fellesskapet", Boolean(outsider.error), true);
    const wrongCommunity = await admin.from("community_subgroup_members").insert({ subgroup_id: SS, community_id: TU, user_id: ids.petter });
    expect("medlemsrad kan ikke peke på gruppen fra et annet fellesskap", Boolean(wrongCommunity.error), true);
    const bothScopes = await admin.from("channels").update({ local_group_id: ftrOslo }).eq("id", ssChannel.id);
    expect("kanal kan ikke ha både lokallag og gruppe", Boolean(bothScopes.error), true);

    // Rename follows to the channel, id stays.
    await admin.from("community_subgroups").update({ name: "Safe-Space frivillige (test)" }).eq("id", SS);
    const { data: renamed } = await admin.from("channels").select("id, name").eq("subgroup_id", SS).single();
    expect("kanalnavnet følger gruppens nye navn", renamed?.name, "Safe-Space frivillige (test)");
    expect("kanal-id er uendret", renamed?.id, ssChannel.id);
  } finally {
    await admin.from("community_subgroups").update({ name: subgroup.name }).eq("id", SS);
    await admin.from("memberships").update({ local_group_id: kristofferGroup }).eq("community_id", FTR).eq("user_id", ids.kristoffer);
    await cleanupContent();
    await admin.from("community_subgroup_members").delete().eq("subgroup_id", SS);
    await admin.from("community_subgroup_members").insert(rosterBefore ?? []);
    await admin.from("community_subgroup_managers").delete().eq("subgroup_id", SS);
    await admin.from("community_subgroup_managers").insert(managersBefore ?? []);
  }

  const { data: rosterAfter } = await admin.from("community_subgroup_members").select("*").eq("subgroup_id", SS);
  const sorted = (rows: { user_id: string }[] | null) => JSON.stringify([...(rows ?? [])].sort((a, b) => a.user_id.localeCompare(b.user_id)));
  expect("opprydding: medlemslisten er som før", sorted(rosterAfter), sorted(rosterBefore));
  const { data: managersAfter } = await admin.from("community_subgroup_managers").select("*").eq("subgroup_id", SS);
  expect("opprydding: ansvarlig-listen er som før", sorted(managersAfter), sorted(managersBefore));
  expect("opprydding: Kristoffer er i sitt lokallag", (await membership("kristoffer", FTR))?.local_group_id, kristofferGroup);
  const { count: leftovers } = await admin.from("posts").select("id", { count: "exact", head: true }).like("body", `${MARK}%`);
  expect("opprydding: ingen testinnlegg igjen", leftovers, 0);
  const { count: leftoverChannels } = await admin.from("channels").select("id", { count: "exact", head: true }).eq("subgroup_id", SS);
  expect("opprydding: fortsatt én gruppekanal", leftoverChannels, 1);
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
    console.log(`✓ ${checks} kontroller av Safe-Space og grupper passerte`);
  });
