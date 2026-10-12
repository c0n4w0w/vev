/**
 * Checks creating and running private organisation-wide groups ("grupper")
 * under real authenticated sessions.
 *
 * Rules (20261022100000_community_group_management, on the model of
 * 20261005100000_community_subgroups):
 *
 *   create   the community's active admins and moderators
 *   read     the group's explicit members and the community's admins — and
 *            its moderators only where the group has `moderators_read`
 *            (Safe-Space frivillige; never a group created in the product)
 *   manage   the community's admins, or an explicit manager: name and
 *            description, members, archive/reopen, delete
 *   manager  a job in one group, not a community role: given and taken by
 *            admins only, to any member of the group — ordinary member,
 *            moderator or admin. Kept through a change of community role;
 *            lost with an active membership or membership of the group
 *            (20261023100000_group_managers_any_member)
 *   delete   refused while a post or event is scoped to the group
 *
 * Every access check runs as a fixture account through the anon key, so a
 * passing run means the database refuses. The service role only reads state
 * back, seeds one notification and cleans up. Every group this suite creates
 * is named `CHECK grupper …` and is removed again; Safe-Space frivillige is
 * snapshotted first and compared afterwards, and is never written to.
 *
 * Run with `npm run check:community-groups` against the local stack after
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
const MARK = "CHECK grupper";

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

// ── The same calls the app makes ────────────────────────────────────────

async function create(client: Client, communityId: string, name: string, memberIds: string[], description = "") {
  const { data, error } = await client.rpc("create_subgroup", {
    p_community_id: communityId,
    p_name: name,
    p_description: description,
    p_member_ids: memberIds,
  });
  return { id: data ?? null, error: error?.message ?? null };
}
async function seesGroup(client: Client, subgroupId: string) {
  const { data } = await client.from("community_subgroups").select("id").eq("id", subgroupId).maybeSingle();
  return Boolean(data);
}
async function seesChannel(client: Client, channelId: string) {
  const { data } = await client.from("channels").select("id").eq("id", channelId).maybeSingle();
  return Boolean(data);
}
async function messagesIn(client: Client, channelId: string) {
  const { data } = await client.from("messages").select("id").eq("channel_id", channelId);
  return (data ?? []).length;
}
async function write(client: Client, channelId: string, body: string) {
  const { error } = await client.from("messages").insert({ channel_id: channelId, body: `${MARK}: ${body}` });
  return !error;
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
async function setManager(client: Client, subgroupId: string, userId: string, isManager: boolean) {
  const { data } = await client.rpc("set_subgroup_manager", {
    p_subgroup_id: subgroupId,
    p_user_id: userId,
    p_is_manager: isManager,
  });
  return data === true;
}
async function setDetails(client: Client, subgroupId: string, name: string, description = "") {
  const { data } = await client.rpc("set_subgroup_details", {
    p_subgroup_id: subgroupId,
    p_name: name,
    p_description: description,
  });
  return data === true;
}
async function setArchived(client: Client, subgroupId: string, archived: boolean) {
  const { data } = await client.rpc("set_subgroup_archived", { p_subgroup_id: subgroupId, p_archived: archived });
  return data === true;
}
async function remove(client: Client, subgroupId: string) {
  const { data, error } = await client.rpc("delete_subgroup", { p_subgroup_id: subgroupId });
  if (error) return error.message.includes("subgroup_has_content") ? "has_content" : "error";
  return data === true ? "deleted" : "refused";
}
async function rosterNames(client: Client, subgroupId: string) {
  const { data } = await client.rpc("subgroup_roster", { p_subgroup_id: subgroupId });
  return (data ?? []).map((row) => row.display_name).sort().join(",");
}

// ── Reading state back (service role) ───────────────────────────────────

async function memberIdsOf(subgroupId: string) {
  const { data } = await admin.from("community_subgroup_members").select("user_id").eq("subgroup_id", subgroupId);
  return (data ?? []).map((row) => row.user_id).sort();
}
async function managerIdsOf(subgroupId: string) {
  const { data } = await admin.from("community_subgroup_managers").select("user_id").eq("subgroup_id", subgroupId);
  return (data ?? []).map((row) => row.user_id).sort();
}
async function channelOf(subgroupId: string) {
  const { data } = await admin.from("channels").select("*").eq("subgroup_id", subgroupId).maybeSingle();
  return data;
}
async function groupRow(subgroupId: string) {
  const { data } = await admin.from("community_subgroups").select("*").eq("id", subgroupId).maybeSingle();
  return data;
}
async function checkGroupCount() {
  const { count } = await admin
    .from("community_subgroups")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARK}%`);
  return count ?? 0;
}

/** Everything about Safe-Space this suite must leave exactly as it found it. */
async function safeSpaceSnapshot() {
  const { data: group } = await admin
    .from("community_subgroups")
    .select("*")
    .eq("community_id", FTR)
    .eq("slug", "safe-space-frivillige")
    .single();
  if (!group) throw new Error("Safe-Space finnes ikke — kjør migrasjonene og `npm run seed` først");
  const channel = await channelOf(group.id);
  const [{ count: messages }, { count: posts }, { count: events }] = await Promise.all([
    admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channel!.id),
    admin.from("posts").select("id", { count: "exact", head: true }).eq("subgroup_id", group.id),
    admin.from("events").select("id", { count: "exact", head: true }).eq("subgroup_id", group.id),
  ]);
  return {
    id: group.id,
    channelId: channel!.id,
    json: JSON.stringify({
      group,
      channel,
      members: await memberIdsOf(group.id),
      managers: await managerIdsOf(group.id),
      messages,
      posts,
      events,
    }),
  };
}

async function cleanup() {
  const { data: groups } = await admin.from("community_subgroups").select("id").like("name", `${MARK}%`);
  const ids = (groups ?? []).map((group) => group.id);
  await admin.from("notifications").delete().like("title", `%${MARK}%`);
  if (ids.length === 0) return;
  await admin.from("posts").delete().in("subgroup_id", ids);
  await admin.from("events").delete().in("subgroup_id", ids);
  await admin.from("channels").delete().in("subgroup_id", ids);
  await admin.from("community_subgroups").delete().in("id", ids);
}

async function main() {
  await cleanup();

  const safeSpace = await safeSpaceSnapshot();
  const SS = safeSpace.id;

  const handles = [
    "miaminge", "erlendthonstad", "amina", "nadia", "kristoffer", "elise", "linn", "petter",
    "emmamortensen", "hanne", "mathea", "adrian", "sofie",
  ] as const;
  const ids = Object.fromEntries(
    await Promise.all(handles.map(async (handle) => [handle, await profileId(handle)] as const)),
  ) as Record<(typeof handles)[number], string>;
  const [mia, erlend, amina, nadia, kristoffer, elise, linn, petter, emma, hanne, mathea, adrian] = await Promise.all(
    handles.slice(0, 12).map(signIn),
  );
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  const { data: nadiaBefore } = await admin
    .from("memberships")
    .select("id, role, status")
    .eq("community_id", FTR)
    .eq("user_id", ids.nadia)
    .single();
  const { data: linnBefore } = await admin
    .from("memberships")
    .select("id, role, status")
    .eq("community_id", FTR)
    .eq("user_id", ids.linn)
    .single();
  const { count: channelsBefore } = await admin
    .from("channels")
    .select("id", { count: "exact", head: true })
    .is("subgroup_id", null);
  const { count: membershipsBefore } = await admin.from("memberships").select("id", { count: "exact", head: true });
  const { count: profilesBefore } = await admin.from("profiles").select("id", { count: "exact", head: true });
  const { count: localGroupsBefore } = await admin
    .from("community_local_groups")
    .select("id", { count: "exact", head: true });

  try {
    // ── Who may create ───────────────────────────────────────────────────
    expect("vanlig medlem kan ikke opprette gruppe", (await create(kristoffer, FTR, `${MARK} nei`, [])).id, null);
    expect("uautentisert kan ikke opprette gruppe", (await create(anon, FTR, `${MARK} nei`, [])).id, null);
    expect("TU-administrator kan ikke opprette gruppe i FTR", (await create(emma, FTR, `${MARK} nei`, [])).id, null);
    expect("FTR-administrator kan ikke opprette gruppe i TU", (await create(mia, TU, `${MARK} nei`, [])).id, null);
    expect("FTR-moderator som bare er medlem i TU kan ikke opprette der", (await create(nadia, TU, `${MARK} nei`, [])).id, null);
    expect("can_create_subgroup: medlem", (await kristoffer.rpc("can_create_subgroup", { p_community_id: FTR })).data, false);
    expect("can_create_subgroup: moderator", (await amina.rpc("can_create_subgroup", { p_community_id: FTR })).data, true);
    expect("can_create_subgroup: administrator", (await mia.rpc("can_create_subgroup", { p_community_id: FTR })).data, true);
    expect("can_create_subgroup: annet fellesskap", (await emma.rpc("can_create_subgroup", { p_community_id: FTR })).data, false);
    expect("ingen gruppe ble opprettet av uautoriserte", await checkGroupCount(), 0);

    // Input the function refuses even for someone who may create.
    expect("tomt navn avvises", (await create(amina, FTR, "   ", [])).id, null);
    expect("for langt navn avvises", (await create(amina, FTR, `${MARK} ${"x".repeat(40)}`, [])).id, null);
    expect("kontrolltegn i navn avvises", (await create(amina, FTR, `${MARK}\nnavn`, [])).id, null);
    expect("for lang beskrivelse avvises", (await create(amina, FTR, `${MARK} lang`, [], "x".repeat(201))).id, null);
    const foreign = await create(amina, FTR, `${MARK} fremmed`, [ids.kristoffer, ids.adrian]);
    expect("medlem fra annet fellesskap stopper hele opprettelsen", `${foreign.id}/${foreign.error?.includes("subgroup_member_ineligible")}`, "null/true");
    const stranger = await create(amina, FTR, `${MARK} fremmed`, [ids.sofie]);
    expect("person uten medlemskap stopper hele opprettelsen", `${stranger.id}/${stranger.error?.includes("subgroup_member_ineligible")}`, "null/true");
    expect("ingenting ble opprettet halvveis", await checkGroupCount(), 0);

    // ── A moderator creates a group ──────────────────────────────────────
    const createdA = await create(amina, FTR, `${MARK} A`, [ids.kristoffer, ids.linn, ids.linn, ids.amina], "Komité for testing");
    expect("moderator oppretter gruppe", Boolean(createdA.id), true);
    const A = createdA.id!;
    const rowA = (await groupRow(A))!;
    expect("gruppen hører til FTR og er aktiv", `${rowA.community_id}/${rowA.active}`, `${FTR}/true`);
    expect("moderatorer leser ikke nye grupper i kraft av rollen", rowA.moderators_read, false);
    expect("oppretteren er registrert", rowA.created_by, ids.amina);
    expect("nøkkelen sier ingenting om navnet", /^[0-9a-f]{32}$/.test(rowA.slug), true);
    expect("medlemmer: oppretteren og de valgte, uten duplikater", (await memberIdsOf(A)).join(","), [ids.amina, ids.kristoffer, ids.linn].sort().join(","));
    expect("oppretteren er gruppeansvarlig, ingen andre", (await managerIdsOf(A)).join(","), ids.amina);
    const channelA = (await channelOf(A))!;
    expect("gruppen fikk én chat under seksjonen grupper", `${channelA.group_id}/${channelA.name}/${channelA.is_private}/${channelA.archived_at}`, `grupper/${MARK} A/false/null`);
    expect("chatten har gruppens beskrivelse", channelA.purpose, "Komité for testing");
    expect("chattens adresse sier ingenting om navnet", channelA.id, `${FTR}--gruppe-${rowA.slug}`);

    // An admin's own group, which the moderator above has nothing to do with.
    const B = (await create(mia, FTR, `${MARK} B`, [ids.petter])).id!;
    expect("administrator oppretter gruppe", Boolean(B), true);
    const channelB = (await channelOf(B))!;
    expect("gruppe uten beskrivelse får standardteksten uten moderatorer", channelB.purpose.includes("moderator"), false);

    // ── Who can see it exists ────────────────────────────────────────────
    for (const [who, client, visible] of [
      ["oppretteren (Amina)", amina, true],
      ["invitert medlem (Kristoffer)", kristoffer, true],
      ["invitert medlem (Linn)", linn, true],
      ["administrator (Mia)", mia, true],
      ["urelatert moderator (Erlend)", erlend, false],
      ["urelatert moderator (Nadia)", nadia, false],
      ["ikke-invitert medlem (Elise)", elise, false],
      ["ikke-invitert medlem (Petter)", petter, false],
      ["TU-administrator (Emma)", emma, false],
      ["uautentisert", anon, false],
    ] as const) {
      expect(`gruppe A er ${visible ? "synlig" : "usynlig"} for ${who}`, await seesGroup(client, A), visible);
      expect(`chatten til A er ${visible ? "synlig" : "usynlig"} for ${who}`, await seesChannel(client, channelA.id), visible);
    }
    expect("moderator ser ikke administratorens gruppe B", await seesGroup(amina, B), false);
    expect("moderator ser ikke chatten til B", await seesChannel(amina, channelB.id), false);
    expect("invitert medlem (Petter) ser B", await seesChannel(petter, channelB.id), true);

    const listed = async (client: Client) =>
      ((await client.from("community_subgroups").select("name")).data ?? []).map((row) => row.name).sort().join(",");
    expect("oppramsing: urelatert moderator ser bare Safe-Space", await listed(erlend), "Safe-Space frivillige");
    expect("oppramsing: ikke-invitert medlem ser ingen grupper", await listed(elise), "");
    expect("oppramsing: TU-administrator ser ingen FTR-grupper", await listed(emma), "");
    expect("oppramsing: uautentisert ser ingen grupper", await listed(anon), "");
    expect("oppramsing: Kristoffer ser Safe-Space og A", await listed(kristoffer), `${MARK} A,Safe-Space frivillige`);
    const { data: byName } = await elise.from("community_subgroups").select("id").ilike("name", `%${MARK}%`);
    expect("gruppen kan ikke søkes opp på navn", (byName ?? []).length, 0);
    const { data: eliseChannels } = await elise.from("channels").select("id, subgroup_id").eq("community_id", FTR);
    expect("kanallisten viser ingen gruppekanaler for utenforstående", (eliseChannels ?? []).some((c) => c.subgroup_id), false);
    const { data: ownRows } = await kristoffer.from("community_subgroup_members").select("user_id").eq("subgroup_id", A);
    expect("medlem ser bare sin egen gruppetilhørighet", (ownRows ?? []).map((r) => r.user_id).join(","), ids.kristoffer);
    const { data: erlendRows } = await erlend.from("community_subgroup_members").select("user_id").eq("subgroup_id", A);
    expect("urelatert moderator ser ingen medlemsrader", (erlendRows ?? []).length, 0);

    // ── The chat ─────────────────────────────────────────────────────────
    expect("medlem skriver i gruppechatten", await write(kristoffer, channelA.id, "hei"), true);
    expect("oppretteren skriver i gruppechatten", await write(amina, channelA.id, "velkommen"), true);
    expect("annet medlem leser meldingene", await messagesIn(linn, channelA.id), 2);
    expect("administrator leser meldingene", await messagesIn(mia, channelA.id), 2);
    expect("urelatert moderator leser ingen meldinger", await messagesIn(erlend, channelA.id), 0);
    expect("ikke-invitert medlem leser ingen meldinger", await messagesIn(elise, channelA.id), 0);
    expect("TU-administrator leser ingen meldinger", await messagesIn(emma, channelA.id), 0);
    expect("uautentisert leser ingen meldinger", await messagesIn(anon, channelA.id), 0);
    expect("urelatert moderator kan ikke skrive", await write(erlend, channelA.id, "nei"), false);
    expect("ikke-invitert medlem kan ikke skrive", await write(elise, channelA.id, "nei"), false);
    expect("TU-administrator kan ikke skrive", await write(emma, channelA.id, "nei"), false);
    expect("can_read_channel: urelatert moderator", (await erlend.rpc("can_read_channel", { chid: channelA.id })).data, false);

    // ── Posts and events in the group's scope ────────────────────────────
    const post = await amina
      .from("posts")
      .insert({ community_id: FTR, subgroup_id: A, kind: "announcement", title: `${MARK} kunngjøring`, body: `${MARK}: innlegg` })
      .select("id")
      .maybeSingle();
    expect("moderator som er medlem publiserer til gruppen", Boolean(post.data?.id), true);
    const postId = post.data!.id;
    const sees = async (client: Client, table: "posts" | "events", id: string) =>
      Boolean((await client.from(table).select("id").eq("id", id).maybeSingle()).data);
    expect("medlem ser gruppeinnlegget", await sees(kristoffer, "posts", postId), true);
    expect("administrator ser gruppeinnlegget", await sees(mia, "posts", postId), true);
    expect("urelatert moderator ser ikke gruppeinnlegget", await sees(erlend, "posts", postId), false);
    expect("ikke-invitert medlem ser ikke gruppeinnlegget", await sees(elise, "posts", postId), false);
    const intruding = await erlend
      .from("posts")
      .insert({ community_id: FTR, subgroup_id: A, title: `${MARK} nei`, body: `${MARK}: nei` })
      .select("id")
      .maybeSingle();
    expect("urelatert moderator kan ikke publisere til gruppen", intruding.data, null);
    expect("urelatert moderator kan ikke kommentere", Boolean((await erlend.from("comments").insert({ post_id: postId, body: `${MARK}: nei` })).error), true);
    const notified = async (handle: (typeof handles)[number]) =>
      (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ids[handle]).eq("post_id", postId)).count ?? 0;
    expect("kunngjøringen varsler gruppens medlem", await notified("kristoffer"), 1);
    expect("kunngjøringen varsler ikke urelatert moderator", await notified("erlendthonstad"), 0);
    expect("kunngjøringen varsler ikke utenforstående", await notified("elise"), 0);

    const starts = new Date(Date.now() + 20 * 24 * 3600 * 1000);
    const event = await mia
      .from("events")
      .insert({
        community_id: FTR,
        subgroup_id: A,
        title: `${MARK} arrangement`,
        description: "Opprettet av check:community-groups",
        location: "Oslo",
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle();
    expect("administrator oppretter gruppearrangement", Boolean(event.data?.id), true);
    const eventId = event.data!.id;
    expect("medlem ser gruppearrangementet", await sees(linn, "events", eventId), true);
    expect("urelatert moderator ser ikke gruppearrangementet", await sees(erlend, "events", eventId), false);
    expect("ikke-invitert medlem ser ikke gruppearrangementet", await sees(elise, "events", eventId), false);
    expect("urelatert moderator kan ikke melde seg på", Boolean((await erlend.from("event_attendees").insert({ event_id: eventId })).error), true);

    // ── Who may manage ───────────────────────────────────────────────────
    expect("oppretteren kan administrere", await canManage(amina, A), true);
    expect("administrator kan administrere", await canManage(mia, A), true);
    expect("vanlig gruppemedlem kan ikke administrere", await canManage(kristoffer, A), false);
    expect("urelatert moderator kan ikke administrere", await canManage(erlend, A), false);
    expect("TU-administrator kan ikke administrere", await canManage(emma, A), false);
    expect("moderator kan ikke administrere administratorens gruppe", await canManage(amina, B), false);

    expect("medlemslisten for ansvarlig", await rosterNames(amina, A), "Amina Sørhaug,Kristoffer Berg,Linn Persen");
    expect("ingen medlemsliste for vanlig medlem", await rosterNames(kristoffer, A), "");
    expect("ingen medlemsliste for urelatert moderator", await rosterNames(erlend, A), "");
    expect("ingen medlemsliste for TU-administrator", await rosterNames(emma, A), "");
    const { data: rosterAmina } = await amina.rpc("subgroup_roster", { p_subgroup_id: A });
    expect("ansvarlig som ikke er administrator får ingen roller", (rosterAmina ?? []).every((row) => row.role === null), true);

    const newSearch = async (client: Client, communityId: string, query: string) =>
      ((await client.rpc("search_new_subgroup_candidates", { p_community_id: communityId, p_query: query })).data ?? []);
    const eli = await newSearch(amina, FTR, "Eli");
    expect("søk ved opprettelse finner aktive medlemmer", eli.map((r) => r.display_name).sort().join(","), "Eli Rønning,Elise Damsgaard");
    expect("søket gir bare id og visningsnavn", Object.keys(eli[0] ?? {}).sort().join(","), "display_name,user_id");
    expect("søket foreslår ikke den som søker", (await newSearch(amina, FTR, "Amina")).length, 0);
    expect("ingen hel medlemsliste: tomt søk", (await newSearch(amina, FTR, "")).length, 0);
    expect("ingen hel medlemsliste: ett tegn", (await newSearch(amina, FTR, "e")).length, 0);
    expect("jokertegn tolkes bokstavelig", (await newSearch(amina, FTR, "%%")).length + (await newSearch(amina, FTR, "__")).length, 0);
    expect("høyst ti treff", (await newSearch(mia, FTR, "an")).length <= 10, true);
    expect("personer fra andre fellesskap finnes ikke", (await newSearch(amina, FTR, "Adrian")).length, 0);
    expect("vanlig medlem får ingen treff", (await newSearch(kristoffer, FTR, "Eli")).length, 0);
    expect("TU-administrator får ingen FTR-treff", (await newSearch(emma, FTR, "Eli")).length, 0);
    expect("FTR-moderator får ingen TU-treff", (await newSearch(amina, TU, "Adrian")).length, 0);
    expect("uautentisert får ingen treff", (await newSearch(anon, FTR, "Eli")).length, 0);

    // ── Membership ───────────────────────────────────────────────────────
    expect("utenforstående kan ikke legge til seg selv", await addMember(elise, A, ids.elise), false);
    expect("urelatert moderator kan ikke legge til seg selv", await addMember(erlend, A, ids.erlendthonstad), false);
    expect("vanlig gruppemedlem kan ikke legge til andre", await addMember(kristoffer, A, ids.elise), false);
    expect("TU-administrator kan ikke legge til noen", await addMember(emma, A, ids.elise), false);
    const direct = await elise.from("community_subgroup_members").insert({ subgroup_id: A, community_id: FTR, user_id: ids.elise });
    expect("direkte tabellskriving er avvist", Boolean(direct.error), true);
    expect("ansvarlig kan ikke legge til medlem fra annet fellesskap", await addMember(amina, A, ids.adrian), false);
    expect("ansvarlig kan ikke legge til person uten medlemskap", await addMember(amina, A, ids.sofie), false);
    expect("Elise er ikke blitt medlem", (await memberIdsOf(A)).includes(ids.elise), false);

    expect("ansvarlig legger til Elise", await addMember(amina, A, ids.elise), true);
    expect("duplikat avvises", await addMember(mia, A, ids.elise), false);
    expect("Elise ser nå chatten", await seesChannel(elise, channelA.id), true);
    expect("Elise leser historikken", await messagesIn(elise, channelA.id), 2);
    expect("Elise kan ikke administrere", await canManage(elise, A), false);
    expect("vanlig medlem kan ikke fjerne andre", await removeMember(kristoffer, A, ids.elise), false);
    expect("ansvarlig fjerner Elise", await removeMember(amina, A, ids.elise), true);
    expect("fjernet: gruppen er borte", await seesGroup(elise, A), false);
    expect("fjernet: chatten er borte", await seesChannel(elise, channelA.id), false);
    expect("fjernet: ingen meldinger", await messagesIn(elise, channelA.id), 0);
    expect("fjernet: kan ikke skrive", await write(elise, channelA.id, "nei"), false);
    expect("fjernet: ser ikke gruppeinnlegget", await sees(elise, "posts", postId), false);
    expect("fjernet: ser ikke gruppearrangementet", await sees(elise, "events", eventId), false);
    expect("fjernet: kan ikke legge seg til igjen", await addMember(elise, A, ids.elise), false);
    const { data: eliseMembership } = await admin.from("memberships").select("status, role").eq("community_id", FTR).eq("user_id", ids.elise).single();
    expect("fjerning rører ikke medlemskapet i fellesskapet", `${eliseMembership?.status}/${eliseMembership?.role}`, "active/member");

    // ── Name and description ─────────────────────────────────────────────
    expect("vanlig medlem kan ikke endre navn", await setDetails(kristoffer, A, `${MARK} kapret`), false);
    expect("urelatert moderator kan ikke endre navn", await setDetails(erlend, A, `${MARK} kapret`), false);
    expect("TU-administrator kan ikke endre navn", await setDetails(emma, A, `${MARK} kapret`), false);
    expect("moderator kan ikke endre administratorens gruppe", await setDetails(amina, B, `${MARK} kapret`), false);
    expect("moderator som ikke er ansvarlig kan ikke endre Safe-Space", await setDetails(amina, SS, "Kapret"), false);
    expect("ansvarlig: tomt navn avvises", await setDetails(amina, A, " "), false);
    expect("ansvarlig: for langt navn avvises", await setDetails(amina, A, "x".repeat(41)), false);
    expect("navnet er uendret etter avviste forsøk", (await groupRow(A))?.name, `${MARK} A`);
    expect("ansvarlig endrer navn og beskrivelse", await setDetails(amina, A, `${MARK} A2`, "Ny beskrivelse"), true);
    const renamed = (await channelOf(A))!;
    expect("chatten følger navn og beskrivelse, med samme adresse", `${renamed.id}/${renamed.name}/${renamed.purpose}`, `${channelA.id}/${MARK} A2/Ny beskrivelse`);
    expect("meldingene overlever navnebyttet", await messagesIn(kristoffer, channelA.id), 2);
    expect("set_channel_details rører ikke gruppechatter", ((await mia.rpc("set_channel_details", { p_community_id: FTR, p_channel_id: channelA.id, p_name: "x", p_purpose: "" })).data ?? []).length, 0);
    const rawUpdate = await amina.from("community_subgroups").update({ name: `${MARK} direkte`, moderators_read: true }).eq("id", A).select("id");
    expect("direkte oppdatering av gruppen er avvist", (rawUpdate.data ?? []).length, 0);
    expect("moderators_read kan ikke slås på", (await groupRow(A))?.moderators_read, false);
    const rawDelete = await amina.from("community_subgroups").delete().eq("id", A).select("id");
    expect("direkte sletting av gruppen er avvist", (rawDelete.data ?? []).length, 0);
    const rawInsert = await amina.from("community_subgroups").insert({ community_id: FTR, slug: "check-direkte", name: `${MARK} direkte` });
    expect("direkte opprettelse av gruppe er avvist", Boolean(rawInsert.error), true);

    // ── The manager mark ─────────────────────────────────────────────────
    expect("ansvarlig (ikke admin) kan ikke utnevne ansvarlig", await setManager(amina, A, ids.kristoffer, true), false);
    expect("medlem kan ikke utnevne seg selv", await setManager(kristoffer, A, ids.kristoffer, true), false);
    expect("urelatert moderator kan ikke utnevne seg selv", await setManager(erlend, A, ids.erlendthonstad, true), false);
    expect("TU-administrator kan ikke utnevne", await setManager(emma, A, ids.kristoffer, true), false);
    expect("administrator kan ikke utnevne moderator som ikke er med i gruppen", await setManager(mia, A, ids.nadia, true), false);
    expect("administrator kan ikke utnevne medlem som ikke er med i gruppen", await setManager(mia, A, ids.elise, true), false);
    expect("administrator kan ikke utnevne person fra annet fellesskap", await setManager(mia, A, ids.adrian, true), false);
    expect("administrator kan ikke utnevne person uten medlemskap", await setManager(mia, A, ids.sofie, true), false);
    const rawManager = await amina.from("community_subgroup_managers").insert({ subgroup_id: A, community_id: FTR, user_id: ids.kristoffer });
    expect("direkte skriving til ansvarlig-tabellen er avvist", Boolean(rawManager.error), true);
    expect("fortsatt bare oppretteren som ansvarlig", (await managerIdsOf(A)).join(","), ids.amina);

    // An ordinary member of the group is appointed: a job in this group, and
    // nothing in the community.
    expect("vanlig gruppemedlem kan ikke administrere før utnevnelsen", await canManage(kristoffer, A), false);
    expect("administrator gjør vanlig medlem til ansvarlig", await setManager(mia, A, ids.kristoffer, true), true);
    expect("dobbel utnevnelse er ingen endring", await setManager(mia, A, ids.kristoffer, true), false);
    expect("utnevnelsen endrer ikke rollen i fellesskapet", (await admin.from("memberships").select("role").eq("community_id", FTR).eq("user_id", ids.kristoffer).single()).data?.role, "member");
    expect("utnevnt medlem kan administrere gruppen", await canManage(kristoffer, A), true);
    expect("utnevnt medlem får medlemslisten", await rosterNames(kristoffer, A), "Amina Sørhaug,Kristoffer Berg,Linn Persen");
    const { data: rosterKristoffer } = await kristoffer.rpc("subgroup_roster", { p_subgroup_id: A });
    expect("medlemslisten merker begge ansvarlige, uansett rolle", (rosterKristoffer ?? []).filter((row) => row.is_manager).map((row) => row.display_name).sort().join(","), "Amina Sørhaug,Kristoffer Berg");
    expect("utnevnt medlem får ingen roller i medlemslisten", (rosterKristoffer ?? []).every((row) => row.role === null), true);
    expect("utnevnt medlem endrer navn og beskrivelse", await setDetails(kristoffer, A, `${MARK} A3`, "Endret av medlem"), true);
    expect("chatten følger endringen", `${(await channelOf(A))?.name}/${(await channelOf(A))?.purpose}`, `${MARK} A3/Endret av medlem`);
    const searchA = async (client: Client, query: string) =>
      ((await client.rpc("search_subgroup_candidates", { p_subgroup_id: A, p_query: query })).data ?? []).map((row) => row.display_name).sort().join(",");
    expect("utnevnt medlem kan søke etter nye medlemmer", await searchA(kristoffer, "Eli"), "Eli Rønning,Elise Damsgaard");
    expect("vanlig deltaker uten utnevnelse får ingen treff", await searchA(linn, "Eli"), "");
    expect("utnevnt medlem legger til et medlem", await addMember(kristoffer, A, ids.elise), true);
    expect("utnevnt medlem kan ikke legge til person fra annet fellesskap", await addMember(kristoffer, A, ids.adrian), false);
    expect("utnevnt medlem fjerner et medlem", await removeMember(kristoffer, A, ids.elise), true);
    expect("utnevnt medlem kan ikke fjerne en annen ansvarlig", await removeMember(kristoffer, A, ids.amina), false);
    expect("utnevnt medlem arkiverer", await setArchived(kristoffer, A, true), true);
    expect("utnevnt medlem gjenåpner", await setArchived(kristoffer, A, false), true);
    expect("utnevnt medlem ser hva som står i veien for sletting", ((await kristoffer.rpc("subgroup_content_counts", { p_subgroup_id: A })).data ?? []).map((row) => `${row.post_count}/${row.event_count}`).join(","), "1/1");
    expect("slettevernet gjelder også utnevnt medlem", await remove(kristoffer, A), "has_content");

    // …and nothing beyond that group.
    expect("utnevnt medlem kan ikke opprette grupper", (await create(kristoffer, FTR, `${MARK} nei`, [])).id, null);
    expect("can_create_subgroup: utnevnt medlem", (await kristoffer.rpc("can_create_subgroup", { p_community_id: FTR })).data, false);
    expect("utnevnt medlem får ikke søke ved opprettelse", (await newSearch(kristoffer, FTR, "Eli")).length, 0);
    expect("utnevnt medlem kan ikke utnevne andre", await setManager(kristoffer, A, ids.linn, true), false);
    expect("utnevnt medlem kan ikke ta merket fra en annen", await setManager(kristoffer, A, ids.amina, false), false);
    expect("utnevnt medlem kan ikke administrere urelatert gruppe", await canManage(kristoffer, B), false);
    expect("utnevnt medlem ser ikke urelatert gruppe", `${await seesGroup(kristoffer, B)}/${await seesChannel(kristoffer, channelB.id)}`, "false/false");
    expect("utnevnt medlem kan ikke endre urelatert gruppe", await setDetails(kristoffer, B, `${MARK} kapret`), false);
    expect("utnevnt medlem kan ikke slette urelatert gruppe", await remove(kristoffer, B), "refused");
    expect("utnevnt medlem kan ikke administrere Safe-Space", await canManage(kristoffer, SS), false);
    expect("utnevnt medlem kan ikke endre Safe-Space", await setDetails(kristoffer, SS, "Kapret"), false);
    expect("utnevnt medlem er ikke moderator", (await kristoffer.rpc("can_moderate", { cid: FTR })).data, false);
    const memberPost = await kristoffer.from("posts").insert({ community_id: FTR, subgroup_id: A, title: `${MARK} nei`, body: `${MARK}: nei` }).select("id").maybeSingle();
    expect("utnevnt medlem kan fortsatt ikke publisere innlegg", memberPost.data, null);
    expect("utnevnt medlem kan ikke endre roller", (await kristoffer.rpc("set_membership_role", { p_membership_id: nadiaBefore!.id, p_role: "member" })).data, false);
    expect("en annen vanlig deltaker kan ikke administrere", await canManage(linn, A), false);
    expect("en annen vanlig deltaker får ingen medlemsliste", await rosterNames(linn, A), "");
    expect("en annen vanlig deltaker kan ikke endre gruppen", await setDetails(linn, A, `${MARK} kapret`), false);
    expect("en annen vanlig deltaker kan ikke fjerne noen", await removeMember(linn, A, ids.kristoffer), false);

    // Taking the appointment back, and leaving the group, end it at once.
    expect("ansvarlig (ikke admin) kan ikke ta merket fra medlemmet", await setManager(amina, A, ids.kristoffer, false), false);
    expect("administrator trekker utnevnelsen tilbake", await setManager(mia, A, ids.kristoffer, false), true);
    expect("uten utnevnelse: kan ikke administrere", await canManage(kristoffer, A), false);
    expect("uten utnevnelse: ingen medlemsliste", await rosterNames(kristoffer, A), "");
    expect("uten utnevnelse: kan ikke endre gruppen", await setDetails(kristoffer, A, `${MARK} kapret`), false);
    expect("uten utnevnelse: kan ikke legge til", await addMember(kristoffer, A, ids.elise), false);
    expect("uten utnevnelse: fortsatt vanlig deltaker", await seesChannel(kristoffer, channelA.id), true);
    expect("medlemmet utnevnes på nytt", await setManager(mia, A, ids.kristoffer, true), true);
    expect("administrator fjerner det utnevnte medlemmet fra gruppen", await removeMember(mia, A, ids.kristoffer), true);
    expect("fjernet fra gruppen: merket er borte", (await managerIdsOf(A)).includes(ids.kristoffer), false);
    expect("fjernet fra gruppen: kan ikke administrere", await canManage(kristoffer, A), false);
    expect("fjernet fra gruppen: ser den ikke", `${await seesGroup(kristoffer, A)}/${await seesChannel(kristoffer, channelA.id)}`, "false/false");
    expect("fjernet fra gruppen: kan ikke legge seg til igjen", await addMember(kristoffer, A, ids.kristoffer), false);
    expect("lagt til igjen er medlemmet ikke ansvarlig", `${await addMember(mia, A, ids.kristoffer)}/${await canManage(kristoffer, A)}`, "true/false");

    // Losing the community membership ends it too — and coming back does not
    // bring it back.
    expect("Linn utnevnes", await setManager(mia, A, ids.linn, true), true);
    expect("Linn kan administrere", await canManage(linn, A), true);
    await admin.from("memberships").update({ status: "requested" }).eq("id", linnBefore!.id);
    expect("uten aktivt medlemskap: kan ikke administrere", await canManage(linn, A), false);
    expect("uten aktivt medlemskap: merket er slettet", (await managerIdsOf(A)).includes(ids.linn), false);
    expect("uten aktivt medlemskap: ser ikke gruppen", `${await seesGroup(linn, A)}/${await seesChannel(linn, channelA.id)}/${await messagesIn(linn, channelA.id)}`, "false/false/0");
    expect("uten aktivt medlemskap: kan ikke endre gruppen", await setDetails(linn, A, `${MARK} kapret`), false);
    expect("uten aktivt medlemskap: kan ikke utnevnes", await setManager(mia, A, ids.linn, true), false);
    await admin.from("memberships").update({ status: "active" }).eq("id", linnBefore!.id);
    expect("tilbake som medlem: ikke ansvarlig uten ny utnevnelse", await canManage(linn, A), false);
    expect("tilbake som medlem: fortsatt deltaker i gruppen", await seesChannel(linn, channelA.id), true);

    // A moderator's appointment is the same kind of thing: it survives the
    // moderator role, and what the role gave does not.
    expect("administrator legger til Nadia", await addMember(mia, A, ids.nadia), true);
    expect("medlem som er moderator kan ikke administrere uten merke", await canManage(nadia, A), false);
    expect("administrator gjør Nadia til ansvarlig", await setManager(mia, A, ids.nadia, true), true);
    expect("Nadia kan nå administrere", await canManage(nadia, A), true);
    expect("ansvarlig kan ikke fjerne en annen ansvarlig fra gruppen", await removeMember(amina, A, ids.nadia), false);
    expect("ansvarlig kan ikke ta merket fra en annen", await setManager(amina, A, ids.nadia, false), false);
    expect("som moderator leser Nadia Safe-Space", await seesChannel(nadia, safeSpace.channelId), true);
    expect("administrator gjør Nadia til vanlig medlem", (await mia.rpc("set_membership_role", { p_membership_id: nadiaBefore!.id, p_role: "member" })).data, true);
    expect("degradert: utnevnelsen står", (await managerIdsOf(A)).includes(ids.nadia), true);
    expect("degradert: administrerer fortsatt gruppen", await canManage(nadia, A), true);
    expect("degradert: kan fortsatt endre gruppen", await setDetails(nadia, A, `${MARK} A2`, "Ny beskrivelse"), true);
    expect("degradert: kan ikke opprette grupper", (await create(nadia, FTR, `${MARK} nei`, [])).id, null);
    expect("degradert: er ikke lenger moderator", (await nadia.rpc("can_moderate", { cid: FTR })).data, false);
    expect("degradert: leser ikke lenger Safe-Space", await seesChannel(nadia, safeSpace.channelId), false);
    const demotedPost = await nadia.from("posts").insert({ community_id: FTR, title: `${MARK} nei`, body: `${MARK}: nei` }).select("id").maybeSingle();
    expect("degradert: kan ikke publisere i feeden", demotedPost.data, null);
    expect("degradert: kan ikke utnevne andre", await setManager(nadia, A, ids.linn, true), false);
    expect("degradert: kan ikke administrere urelatert gruppe", await canManage(nadia, B), false);
    expect("Nadia blir moderator igjen", (await mia.rpc("set_membership_role", { p_membership_id: nadiaBefore!.id, p_role: "moderator" })).data, true);
    expect("forfremmet igjen: fortsatt ansvarlig", await canManage(nadia, A), true);
    expect("administrator tar merket fra Nadia", await setManager(mia, A, ids.nadia, false), true);
    expect("uten merke kan Nadia ikke administrere", await canManage(nadia, A), false);
    expect("men er fortsatt medlem", await seesChannel(nadia, channelA.id), true);

    // Leaving the group takes the mark along.
    expect("Nadia får merket på nytt", await setManager(mia, A, ids.nadia, true), true);
    expect("administrator fjerner den ansvarlige fra gruppen", await removeMember(mia, A, ids.nadia), true);
    expect("fjernet ansvarlig: merket er borte", (await managerIdsOf(A)).includes(ids.nadia), false);
    expect("fjernet ansvarlig: kan ikke legge seg til igjen", await addMember(nadia, A, ids.nadia), false);
    expect("fjernet ansvarlig: ser ikke gruppen", await seesGroup(nadia, A), false);

    // The creator leaves; the community's admins still run the group.
    expect("oppretteren kan forlate sin egen gruppe", await removeMember(amina, A, ids.amina), true);
    expect("gruppen har ingen ansvarlige igjen", (await managerIdsOf(A)).length, 0);
    expect("oppretteren ser ikke lenger gruppen", await seesGroup(amina, A), false);
    expect("oppretteren kan ikke legge seg til igjen", await addMember(amina, A, ids.amina), false);
    expect("administrator styrer fortsatt gruppen", await canManage(mia, A), true);
    expect("administrator legger oppretteren til igjen", await addMember(mia, A, ids.amina), true);
    expect("administrator gir ansvaret tilbake", await setManager(mia, A, ids.amina, true), true);

    // ── Archiving ────────────────────────────────────────────────────────
    expect("vanlig medlem kan ikke arkivere", await setArchived(kristoffer, A, true), false);
    expect("urelatert moderator kan ikke arkivere", await setArchived(erlend, A, true), false);
    expect("TU-administrator kan ikke arkivere", await setArchived(emma, A, true), false);
    expect("moderator kan ikke arkivere Safe-Space", await setArchived(amina, SS, true), false);
    expect("ansvarlig arkiverer", await setArchived(amina, A, true), true);
    expect("gruppen er arkivert", (await groupRow(A))?.active, false);
    expect("chatten er arkivert", Boolean((await channelOf(A))?.archived_at), true);
    expect("arkivert: medlem leser fortsatt historikken", await messagesIn(kristoffer, channelA.id), 2);
    expect("arkivert: medlem ser fortsatt innlegget", await sees(kristoffer, "posts", postId), true);
    expect("arkivert: medlem kan ikke skrive", await write(kristoffer, channelA.id, "nei"), false);
    expect("arkivert: ansvarlig kan ikke skrive", await write(amina, channelA.id, "nei"), false);
    expect("arkivert: administrator kan ikke skrive", await write(mia, channelA.id, "nei"), false);
    expect("arkivert: ingen nye medlemmer", await addMember(amina, A, ids.elise), false);
    const archivedPost = await amina.from("posts").insert({ community_id: FTR, subgroup_id: A, title: `${MARK} nei`, body: `${MARK}: nei` }).select("id").maybeSingle();
    expect("arkivert: ingen nye innlegg", archivedPost.data, null);
    expect("arkivert: utenforstående ser fortsatt ingenting", `${await seesGroup(elise, A)}/${await seesChannel(elise, channelA.id)}/${await messagesIn(elise, channelA.id)}`, "false/false/0");
    expect("arkivert: urelatert moderator ser fortsatt ingenting", `${await seesGroup(erlend, A)}/${await seesChannel(erlend, channelA.id)}/${await messagesIn(erlend, channelA.id)}`, "false/false/0");
    expect("arkivert: utenforstående kan ikke gjenåpne", await setArchived(elise, A, false), false);
    expect("arkivert: medlemmer kan fortsatt fjernes", await removeMember(amina, A, ids.linn), true);
    expect("Safe-Space-chatten er ikke arkivert", (await channelOf(SS))?.archived_at, null);
    expect("ansvarlig gjenåpner", await setArchived(amina, A, false), true);
    expect("gjenåpnet: chatten er åpen", (await channelOf(A))?.archived_at, null);
    expect("gjenåpnet: medlem kan skrive", await write(kristoffer, channelA.id, "tilbake"), true);
    expect("gjenåpnet: fjernet medlem kom ikke tilbake", await seesChannel(linn, channelA.id), false);

    // ── Deleting ─────────────────────────────────────────────────────────
    expect("vanlig medlem kan ikke slette", await remove(kristoffer, A), "refused");
    expect("urelatert moderator kan ikke slette", await remove(erlend, A), "refused");
    expect("TU-administrator kan ikke slette", await remove(emma, A), "refused");
    expect("uautentisert kan ikke slette", (await remove(anon, A)) !== "deleted", true);
    expect("moderator kan ikke slette administratorens gruppe", await remove(amina, B), "refused");
    expect("moderator kan ikke slette Safe-Space", await remove(amina, SS), "refused");
    expect("gruppene finnes fortsatt", `${Boolean(await groupRow(A))}/${Boolean(await groupRow(B))}/${Boolean(await groupRow(SS))}`, "true/true/true");

    const counts = async (client: Client) => {
      const { data } = await client.rpc("subgroup_content_counts", { p_subgroup_id: A });
      return (data ?? []).map((row) => `${row.post_count}/${row.event_count}`).join(",");
    };
    expect("ansvarlig ser hva som står i veien", await counts(amina), "1/1");
    expect("vanlig medlem får ikke innholdstall", await counts(kristoffer), "");
    expect("urelatert moderator får ikke innholdstall", await counts(erlend), "");
    expect("gruppe med innlegg og arrangement kan ikke slettes", await remove(amina, A), "has_content");
    expect("heller ikke av administrator", await remove(mia, A), "has_content");
    expect("ingenting ble slettet", `${Boolean(await groupRow(A))}/${await messagesIn(kristoffer, channelA.id)}/${await sees(kristoffer, "posts", postId)}`, "true/3/true");

    // The people entitled to delete the content do so; only then the group.
    expect("forfatteren sletter innlegget", Boolean((await amina.from("posts").delete().eq("id", postId).select("id")).data?.length), true);
    expect("gruppe med arrangement kan fortsatt ikke slettes", await remove(amina, A), "has_content");
    expect("administrator sletter arrangementet", Boolean((await mia.from("events").delete().eq("id", eventId).select("id")).data?.length), true);
    await admin.from("notifications").insert({
      user_id: ids.kristoffer,
      kind: "mention",
      community_id: FTR,
      title: `${MARK} varsel`,
      body: "Peker på gruppechatten",
      href: `/community/${FTR}/channel/${channelA.id}`,
    });
    expect("ansvarlig sletter gruppen", await remove(amina, A), "deleted");
    expect("gruppen er borte", await groupRow(A), null);
    expect("chatten er borte", await channelOf(A), null);
    expect("meldingene er borte", (await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channelA.id)).count, 0);
    expect("medlemsradene er borte", (await memberIdsOf(A)).length, 0);
    expect("ansvarlig-radene er borte", (await managerIdsOf(A)).length, 0);
    expect("varsler som pekte på chatten er borte", (await admin.from("notifications").select("id", { count: "exact", head: true }).like("href", `%${channelA.id}%`)).count, 0);
    expect("slettet gruppe kan ikke slettes på nytt", await remove(amina, A), "refused");
    expect("tidligere medlem når ikke chatten via gammel adresse", await seesChannel(kristoffer, channelA.id), false);

    // An admin takes over and deletes a moderator's group, archived or not.
    const C = (await create(amina, FTR, `${MARK} C`, [ids.kristoffer])).id!;
    expect("ansvarlig arkiverer C", await setArchived(amina, C, true), true);
    expect("administrator sletter en arkivert gruppe hun ikke opprettet", await remove(mia, C), "deleted");
    expect("administrator sletter sin egen gruppe", await remove(mia, B), "deleted");

    // An appointed ordinary member deletes the group they are responsible for.
    const D = (await create(amina, FTR, `${MARK} D`, [ids.kristoffer, ids.linn])).id!;
    expect("vanlig medlem kan ikke slette D uten utnevnelse", await remove(kristoffer, D), "refused");
    expect("administrator utnevner medlemmet i D", await setManager(mia, D, ids.kristoffer, true), true);
    expect("en annen deltaker kan fortsatt ikke slette D", await remove(linn, D), "refused");
    expect("utnevnt medlem sletter gruppen sin", await remove(kristoffer, D), "deleted");
    expect("D er borte, med chat og rader", `${await groupRow(D)}/${await channelOf(D)}/${(await memberIdsOf(D)).length}/${(await managerIdsOf(D)).length}`, "null/null/0/0");

    // ── Functions that take a user id are not reachable ──────────────────
    const blocked = async (name: string, args: Record<string, unknown>) =>
      Boolean((await (amina.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)(name, args)).error);
    expect("subgroup_create_admits kan ikke kalles", await blocked("subgroup_create_admits", { p_user_id: ids.miaminge, p_community_id: FTR }), true);
    expect("subgroup_manage_admits kan ikke kalles", await blocked("subgroup_manage_admits", { p_user_id: ids.miaminge, p_subgroup_id: SS }), true);
    expect("subgroup_access_admits kan ikke kalles", await blocked("subgroup_access_admits", { p_user_id: ids.miaminge, p_subgroup_id: SS }), true);
    expect("content_scope_admits kan ikke kalles", await blocked("content_scope_admits", { p_user_id: ids.miaminge, p_community_id: FTR, p_local_group_id: null, p_subgroup_id: SS }), true);
    expect("ensure_subgroup_channel kan ikke kalles", await blocked("ensure_subgroup_channel", { p_subgroup_id: SS }), true);
    expect("create_subgroup kan ikke kalles uautentisert", Boolean((await anon.rpc("create_subgroup", { p_community_id: FTR, p_name: `${MARK} anon`, p_description: "", p_member_ids: [] })).error), true);

    // ── The same in another community ────────────────────────────────────
    const T = (await create(hanne, TU, `${MARK} TU`, [ids.adrian])).id!;
    expect("TU-moderator oppretter gruppe i TU", Boolean(T), true);
    const channelT = (await channelOf(T))!;
    expect("TU: invitert medlem ser chatten", await seesChannel(adrian, channelT.id), true);
    expect("TU: administrator ser gruppen", await seesGroup(emma, T), true);
    expect("TU: annen moderator ser den ikke", await seesGroup(mathea, T), false);
    expect("TU: ikke-invitert medlem ser den ikke", await seesChannel(petter, channelT.id), false);
    expect("TU: FTR-moderator som er TU-medlem ser den ikke", await seesChannel(nadia, channelT.id), false);
    expect("TU: FTR-administrator ser den ikke", await seesGroup(mia, T), false);
    expect("TU: FTR-administrator kan ikke administrere den", await canManage(mia, T), false);
    expect("TU: FTR-administrator kan ikke slette den", await remove(mia, T), "refused");
    expect("TU: FTR-medlem kan ikke legges til", await addMember(hanne, T, ids.kristoffer), false);
    expect("TU: annen moderator kan ikke administrere", await canManage(mathea, T), false);
    expect("TU: administrator kan administrere", await canManage(emma, T), true);
    expect("TU: medlem skriver, administrator leser", `${await write(adrian, channelT.id, "hei")}/${await messagesIn(emma, channelT.id)}`, "true/1");
    expect("TU: administrator sletter gruppen", await remove(emma, T), "deleted");

    // ── Safe-Space frivillige, as before ─────────────────────────────────
    expect("Safe-Space: Erlend administrerer fortsatt", await canManage(erlend, SS), true);
    expect("Safe-Space: moderatorer leser fortsatt chatten", await seesChannel(amina, safeSpace.channelId), true);
    expect("Safe-Space: medlem leser fortsatt chatten", await seesChannel(kristoffer, safeSpace.channelId), true);
    expect("Safe-Space: utenforstående ser den fortsatt ikke", await seesChannel(elise, safeSpace.channelId), false);
    expect("Safe-Space: medlemslisten er fortsatt bare for ansvarlige", await rosterNames(amina, SS), "");
  } finally {
    await admin.from("memberships").update({ role: nadiaBefore!.role }).eq("id", nadiaBefore!.id);
    await admin.from("memberships").update({ status: linnBefore!.status }).eq("id", linnBefore!.id);
    await cleanup();
  }

  expect("opprydding: ingen testgrupper igjen", await checkGroupCount(), 0);
  expect("opprydding: Linn er aktivt medlem", (await admin.from("memberships").select("status").eq("id", linnBefore!.id).single()).data?.status, linnBefore!.status);
  expect("opprydding: Nadia har rollen sin", (await admin.from("memberships").select("role").eq("id", nadiaBefore!.id).single()).data?.role, nadiaBefore!.role);
  expect("Safe-Space er nøyaktig som før", (await safeSpaceSnapshot()).json, safeSpace.json);
  expect("ingen andre kanaler er rørt", (await admin.from("channels").select("id", { count: "exact", head: true }).is("subgroup_id", null)).count, channelsBefore);
  expect("ingen medlemskap er rørt", (await admin.from("memberships").select("id", { count: "exact", head: true })).count, membershipsBefore);
  expect("ingen kontoer er rørt", (await admin.from("profiles").select("id", { count: "exact", head: true })).count, profilesBefore);
  expect("ingen lokallag er rørt", (await admin.from("community_local_groups").select("id", { count: "exact", head: true })).count, localGroupsBefore);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller av gruppeadministrasjon feilet`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av gruppeadministrasjon passerte`);
  });
