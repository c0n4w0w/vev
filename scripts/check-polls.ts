/**
 * Checks polls in channel conversations (20261111100000_channel_polls) under
 * real authenticated sessions.
 *
 * What must hold:
 *
 *   creating   only an active admin or moderator of the channel's own
 *              community where they can read and write, the
 *              gruppeansvarlig of exactly that group in its chat, or a
 *              lokallagsleder of exactly that lokallag in its main chat — not
 *              in a community channel, a private channel or another group's or
 *              lokallag's chat. Never by writing the poll tables directly,
 *              never in another community, an archived channel or a DM.
 *   mode       anonymous by default or visible, chosen at creation and never
 *              changed afterwards, by any path.
 *   voting     everyone who can read the channel, once per poll, changeable
 *              while open; only an option of that poll; nothing on a closed
 *              poll or in an archived channel.
 *   privacy    nobody reads another person's vote row, and no response or
 *              page carries a voter's account id. Per-option counts — and on
 *              a visible poll, who chose what — appear only after the viewer
 *              voted or the poll closed: no exception for creators or
 *              moderators. An anonymous poll names nobody to anyone. A
 *              visible one names only voters still in the channel whom the
 *              viewer may already identify in that community (the member
 *              directory rule); everyone else is counted, not named.
 *   withdraw   one's own vote, only while the poll is open and the channel
 *              not archived; it hides the results (and voter lists) again
 *              until one votes. Only through the function.
 *   visible    voting shows one's community name, photo and choice to the
 *              other voters in that channel — also where the member
 *              directory is closed — and nothing else: no account id, no
 *              email, no wider profile or directory access.
 *   closing    the creator and whoever moderates the channel; final.
 *   history    the poll is a message in the channel's history; deleting the
 *              message takes the poll and its votes; its text is not edited.
 *
 * Exercised the way an attacker would reach it: RPCs and direct table
 * requests with anon-key clients signed in as fixture and disposable
 * accounts, plus the channel page over HTTP (the dev server must be running).
 * The service role sets up and cleans up.
 *
 * Run with `npm run check:polls` against the local stack, with the app on
 * http://localhost:3000 (or CHECK_APP_URL). Creates only disposable accounts
 * (check-poll-…@example.test), a lokallag, channels and groups marked
 * "CHECK poll", and removes them afterwards — also after an interrupted run.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const TAG = "CHECK poll";
const EMAIL = "check-poll-";
const N = null as unknown as string;

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

const sql = (statement: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "postgres", "-d", "postgres", "-AtF", "|", "-c", statement],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();

// ── Accounts ────────────────────────────────────────────────────────────

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`fant ikke profilen ${handle}: ${error.message}`);
  return data.id;
}

async function signInEmail(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${email}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  return signInEmail(user.user!.email!);
}

type Person = { id: string; name: string; client: Client };

async function disposable(key: string, name: string, community: string, localGroupId?: string): Promise<Person> {
  const email = `${EMAIL}${key}-${crypto.randomUUID().slice(0, 6)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name, handle: `check-poll-${key}-${crypto.randomUUID().slice(0, 4)}` },
  });
  if (error || !data.user) throw new Error(`kunne ikke opprette ${key}: ${error?.message}`);
  const id = data.user.id;
  sql(
    `insert into memberships (user_id, community_id, role, status, local_group_id) values ('${id}', '${community}', 'member', 'active', ${localGroupId ? `'${localGroupId}'` : "null"})`,
  );
  sql(`update community_profiles set display_name = '${name}' where user_id = '${id}' and community_id = '${community}'`);
  return { id, name, client: await signInEmail(email) };
}

async function cookiesFor(client: Client): Promise<string> {
  const { data } = await client.auth.getSession();
  const jar = new Map<string, string>();
  const ssr = createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  await ssr.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

async function page(client: Client, path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${APP}${path}`, { headers: { Cookie: await cookiesFor(client) }, redirect: "manual" });
  return { status: response.status, html: await response.text() };
}

// ── The calls the app makes ─────────────────────────────────────────────

type PollView = {
  messageId: string;
  question: string;
  visibility: "anonymous" | "visible";
  closedAt: string | null;
  total: number;
  myOptionId: string | null;
  resultsVisible: boolean;
  canVote: boolean;
  canClose: boolean;
  options: { id: string; label: string; count: number | null }[];
};

function code(error: { message?: string; code?: string } | null): string {
  if (!error) return "ok";
  const match = /(?:poll|message)_error:([a-z_]+)/.exec(error.message ?? "");
  if (match) return match[1];
  if (error.code === "42501" || /permission denied/.test(error.message ?? "")) return "denied";
  return error.message ?? "error";
}

async function create(
  client: Client,
  channelId: string,
  question = "Hvilken dag passer?",
  options = ["Mandag", "Tirsdag", "Onsdag"],
  visibility?: string,
) {
  const { data, error } = await client.rpc("create_channel_poll", {
    p_channel_id: channelId,
    p_question: `${TAG} ${question}`,
    p_options: options,
    ...(visibility === undefined ? {} : { p_visibility: visibility }),
  });
  return { code: code(error), id: data?.id as string | undefined };
}

async function mustCreate(client: Client, channelId: string, question?: string, options?: string[], visibility?: string): Promise<string> {
  const result = await create(client, channelId, question, options, visibility);
  if (!result.id) throw new Error(`kunne ikke lage avstemning i ${channelId}: ${result.code}`);
  return result.id;
}

async function states(client: Client, channelId: string, ids?: string[]): Promise<PollView[]> {
  const { data, error } = await client.rpc("channel_poll_states", { p_channel_id: channelId, p_message_ids: (ids ?? null) as string[] });
  if (error) throw new Error(`channel_poll_states: ${error.message}`);
  return (data as PollView[]) ?? [];
}

async function view(client: Client, channelId: string, id: string): Promise<PollView | undefined> {
  return (await states(client, channelId, [id]))[0];
}

async function vote(client: Client, id: string, optionId: string) {
  const { data, error } = await client.rpc("vote_channel_poll", { p_message_id: id, p_option_id: optionId });
  return { code: code(error), view: data as PollView | null };
}

async function close(client: Client, id: string) {
  const { data, error } = await client.rpc("close_channel_poll", { p_message_id: id });
  return { code: code(error), view: data as PollView | null };
}

type Voters = { total: number; people: { ref: string; name: string; me: boolean; avatar: string | null }[]; unnamed: number } | null;

async function voters(client: Client, id: string, optionId: string): Promise<Voters> {
  const { data, error } = await client.rpc("channel_poll_voters", { p_message_id: id, p_option_id: optionId });
  if (error) return { total: -1, people: [{ ref: "", name: `feil:${error.message}`, me: false, avatar: null }], unnamed: 0 };
  return data as Voters;
}

/** "Name,(Own name)+unnamed/total", names sorted; "null" when nothing is given. */
const who = (list: Voters) =>
  list === null
    ? "null"
    : `${list.people.map((person) => (person.me ? `(${person.name})` : person.name)).sort().join(",")}+${list.unnamed}/${list.total}`;

async function canCreate(client: Client, channelId: string) {
  const { data } = await client.rpc("can_create_channel_poll", { p_channel_id: channelId });
  return data === true;
}

const option = (pollId: string, position: number) =>
  sql(`select id from channel_poll_options where poll_id = '${pollId}' and position = ${position}`);
const tally = (poll?: PollView | null) =>
  poll ? poll.options.map((entry) => `${entry.label}:${entry.count ?? "-"}`).join(" ") + ` =${poll.total}` : "ingen";

async function createChannel(client: Client, community: string, name: string, readOnly = false): Promise<string> {
  const { data, error } = await client.rpc("create_community_channel", {
    p_community_id: community,
    p_name: `${TAG} ${name}`,
    p_purpose: "",
    p_section_id: N,
    p_creation_key: N,
    p_read_only: readOnly,
    p_file_sharing: false,
  });
  if (error || !data) throw new Error(`kunne ikke opprette ${name}: ${error?.message}`);
  return data;
}

async function createGroup(client: Client, name: string, memberIds: string[]): Promise<{ id: string; chat: string }> {
  const { data, error } = await client.rpc("create_subgroup", {
    p_community_id: FTR,
    p_name: `${TAG} ${name}`,
    p_description: "",
    p_member_ids: memberIds,
  });
  if (error || !data) throw new Error(`kunne ikke opprette gruppen ${name}: ${error?.message}`);
  return { id: data, chat: sql(`select id from channels where subgroup_id = '${data}'`) };
}

// ── Cleanup ─────────────────────────────────────────────────────────────

async function withdraw(client: Client, id: string) {
  const { data, error } = await client.rpc("withdraw_channel_poll_vote", { p_message_id: id });
  return { code: code(error), view: data as PollView | null };
}

async function cleanup() {
  // Profile photos uploaded for disposable accounts.
  const photos = sql(
    `select coalesce(string_agg(o.name, ','), '') from storage.objects o
      where o.bucket_id = 'member-avatars'
        and split_part(o.name, '/', 2) in (select id::text from auth.users where email like '${EMAIL}%@example.test')`,
  );
  if (photos) await admin.storage.from("member-avatars").remove(photos.split(","));
  const groups = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from community_subgroups where name like '${TAG}%'`);
  if (groups) {
    sql(`delete from message_moderation_log where channel_id in (select id from channels where subgroup_id::text in (${groups}))`);
    sql(`delete from channels where subgroup_id::text in (${groups})`);
    sql(`delete from community_subgroups where id::text in (${groups})`);
  }
  const localGroups = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from community_local_groups where name like '${TAG}%'`);
  const channels = sql(
    `select coalesce(string_agg(quote_literal(id), ','), '') from channels where name like '${TAG}%'${
      localGroups ? ` or local_group_id::text in (${localGroups})` : ""
    }`,
  );
  if (channels) {
    sql(`delete from message_moderation_log where channel_id in (${channels})`);
    sql(`delete from channel_pinned_messages where channel_id in (${channels})`);
    sql(`delete from channels where id in (${channels})`);
  }
  // Polls made in fixture channels (none should be, but an interrupted run might).
  sql(`delete from messages where id in (select message_id from channel_polls where question like '${TAG}%')`);
  sql(`delete from channel_retired_ids where id like '%check-poll%'`);
  const users = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where email like '${EMAIL}%@example.test'`);
  for (const userId of users ? users.split(",") : []) await admin.auth.admin.deleteUser(userId);
  if (localGroups) {
    sql(`delete from community_local_group_managers where local_group_id::text in (${localGroups})`);
    sql(`delete from community_local_groups where id::text in (${localGroups})`);
  }
}

// ── The checks ──────────────────────────────────────────────────────────

async function main() {
  await cleanup();
  const reachable = await fetch(`${APP}/login`, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!reachable) {
    console.error(`\n✗ Appen svarer ikke på ${APP}. Start den med \`npm run dev\` (eller sett CHECK_APP_URL).`);
    process.exit(1);
  }

  const [mia, kari, emma] = await Promise.all(["miaminge", "karimoen", "emmamortensen"].map(signIn));
  ids.mia = await profileId("miaminge");
  const loose = (client: Client) => client as unknown as Loose;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    for (const table of ["channel_polls", "channel_poll_options", "channel_poll_votes"]) {
      expect(`A1 ${table} har radsikkerhet`, sql(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`), "t");
      expect(
        `A1 ${table}: medlemmer får bare lese`,
        sql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where table_name = '${table}' and grantee = 'authenticated'`),
        "SELECT",
      );
      expect(`A1 ${table}: anonyme får ingenting`, sql(`select count(*) from information_schema.role_table_grants where table_name = '${table}' and grantee = 'anon'`), 0);
      expect(`A1 ${table} er ikke i noen realtime-publisering`, sql(`select count(*) from pg_publication_tables where tablename = '${table}'`), 0);
    }
    for (const fn of ["create_channel_poll(text, text, text[], text)", "channel_poll_voters(uuid, uuid)", "withdraw_channel_poll_vote(uuid)", "vote_channel_poll(uuid, uuid)", "close_channel_poll(uuid)", "channel_poll_states(text, uuid[])", "can_create_channel_poll(text)"]) {
      expect(`A2 innloggede kan kalle ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "t");
      expect(`A2 anonyme kan ikke kalle ${fn}`, sql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
    }
    for (const fn of ["channel_poll_create_admits(uuid, text)", "channel_poll_close_admits(uuid, uuid)", "channel_poll_view(uuid, uuid)", "channel_poll_voters_admit(uuid, uuid)"]) {
      expect(`A2 ingen API-rolle kan kalle ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') or has_function_privilege('service_role', 'public.${fn}', 'execute')`), "f");
    }

    // ════ Setup ════════════════════════════════════════════════════════
    const { data: localGroup, error: localGroupError } = await mia.rpc("create_local_group", { p_community_id: FTR, p_name: `${TAG} lag` });
    if (localGroupError || !localGroup) throw new Error(`kunne ikke opprette lokallag: ${localGroupError?.message}`);
    const lokallagChat = sql(`select id from channels where local_group_id = '${localGroup}' and not is_private`);

    const ane = await disposable("ane", "Ane Avstemning", FTR, localGroup); // gruppeansvarlig i gruppe 1
    const bo = await disposable("bo", "Bo Avstemning", FTR, localGroup); // vanlig medlem i lokallaget
    const cato = await disposable("cato", "Cato Avstemning", FTR); // medlem av gruppe 1
    const dina = await disposable("dina", "Dina Avstemning", FTR); // gruppeansvarlig i gruppe 2
    const tuva = await disposable("tuva", "Tuva Avstemning", TU);
    const lea = await disposable("lea", "Lea Avstemning", FTR, localGroup); // lokallagsleder
    const eva = await disposable("eva", "Eva Avstemning", FTR); // forlater fellesskapet
    sql(`update profiles set preferred_locale = 'en' where id = '${bo.id}'`);

    const ftrChannel = await createChannel(mia, FTR, "offentlig");
    const announce = await createChannel(mia, FTR, "kunngjøring", true);
    const tuChannel = await createChannel(emma, TU, "offentlig");
    const { data: privateChannel } = await mia.rpc("create_private_channel", {
      p_local_group_id: localGroup,
      p_name: `${TAG} privat`,
      p_purpose: "",
      p_participant_ids: [ane.id],
    });
    const group1 = await createGroup(mia, "gruppe en", [ane.id, cato.id]);
    const group2 = await createGroup(mia, "gruppe to", [ane.id, dina.id]);
    await mia.rpc("set_subgroup_manager", { p_subgroup_id: group1.id, p_user_id: ane.id, p_is_manager: true });
    await mia.rpc("set_subgroup_manager", { p_subgroup_id: group2.id, p_user_id: dina.id, p_is_manager: true });
    expect("oppsett: Ane er gruppeansvarlig i gruppe 1, ikke 2", sql(`select string_agg(subgroup_id::text, ',') from community_subgroup_managers where user_id = '${ane.id}'`), group1.id);
    const moderatorsRead = sql(`select moderators_read from community_subgroups where id = '${group1.id}'`) === "t";

    // ════ B. Who may create ════════════════════════════════════════════
    expect("B1 admin i en åpen kanal", (await create(mia, ftrChannel)).code, "ok");
    expect("B1 moderator i en åpen kanal", (await create(kari, ftrChannel)).code, "ok");
    expect("B1 moderator i en kunngjøringskanal", (await create(kari, announce)).code, "ok");
    expect("B2 vanlig medlem i en åpen kanal: avvist", (await create(bo.client, ftrChannel)).code, "not_allowed");
    expect("B2 vanlig medlem i kunngjøringskanalen: avvist", (await create(dina.client, announce)).code, "not_allowed");
    expect("B2 vanlig medlem i lokallagets chat: avvist", (await create(bo.client, lokallagChat)).code, "not_allowed");
    expect("B2 gruppemedlem som ikke er ansvarlig: avvist", (await create(cato.client, group1.chat)).code, "not_allowed");
    expect("B3 gruppeansvarlig i egen gruppe", (await create(ane.client, group1.chat)).code, "ok");
    expect("B3 gruppeansvarlig i gruppe 2 (egen)", (await create(dina.client, group2.chat)).code, "ok");
    expect("B4 gruppeansvarlig i en annen gruppe hen er medlem av: avvist", (await create(ane.client, group2.chat)).code, "not_allowed");
    expect("B4 gruppeansvarlig i en åpen kanal: avvist", (await create(ane.client, ftrChannel)).code, "not_allowed");
    expect("B4 gruppeansvarlig i lokallagets chat: avvist", (await create(ane.client, lokallagChat)).code, "not_allowed");
    expect("B4 gruppeansvarlig i en privat kanal: avvist", (await create(ane.client, privateChannel!)).code, "not_allowed");
    expect("B4 gruppeansvarlig i en gruppe hen ikke er med i: finnes ikke", (await create(cato.client, group2.chat)).code, "not_found");
    expect(
      "B5 moderator i en gruppe: bare der moderatorer kan lese",
      (await create(kari, group1.chat)).code,
      moderatorsRead ? "ok" : "not_found",
    );
    expect("B5 admin i et lokallag og en privat kanal", `${(await create(mia, lokallagChat)).code}|${(await create(mia, privateChannel!)).code}`, "ok|ok");
    expect("B6 admin i et annet fellesskap: finnes ikke", (await create(mia, tuChannel)).code, "not_found");
    expect("B6 TU-admin i FTR: finnes ikke", (await create(emma, ftrChannel)).code, "not_found");
    expect("B6 TU-medlem i FTR: finnes ikke", (await create(tuva.client, ftrChannel)).code, "not_found");
    expect("B6 anonym: avvist", code((await anon.rpc("create_channel_poll", { p_channel_id: ftrChannel, p_question: `${TAG} x`, p_options: ["a", "b"] })).error) !== "ok", true);
    expect("B6 kanal som ikke finnes", (await create(mia, `${FTR}--finnes-ikke`)).code, "not_found");
    const dmId = sql(`select id from direct_conversations where community_id = '${FTR}' limit 1`);
    if (dmId) expect("B6 en direktesamtale er ingen kanal", (await create(mia, dmId)).code, "not_found");
    expect(
      "B7 can_create_channel_poll speiler reglene",
      [
        await canCreate(mia, ftrChannel),
        await canCreate(kari, ftrChannel),
        await canCreate(bo.client, ftrChannel),
        await canCreate(ane.client, group1.chat),
        await canCreate(ane.client, group2.chat),
        await canCreate(ane.client, ftrChannel),
        await canCreate(cato.client, group1.chat),
        await canCreate(emma, ftrChannel),
      ].join(","),
      "true,true,false,true,false,false,false,false",
    );

    // Forged writes: the tables, not the function.
    const forgedMessage = await bo.client.from("messages").insert({ channel_id: ftrChannel, body: `${TAG} falsk` }).select("id").single();
    expect("B8 et medlem kan skrive en vanlig melding", code(forgedMessage.error), "ok");
    expect(
      "B8 men ikke gjøre den til en avstemning",
      code((await loose(bo.client).from("channel_polls").insert({ message_id: forgedMessage.data!.id, channel_id: ftrChannel, question: "falsk" })).error),
      "denied",
    );
    expect(
      "B8 admin kan heller ikke skrive tabellen direkte",
      code((await loose(mia).from("channel_polls").insert({ message_id: forgedMessage.data!.id, channel_id: ftrChannel, question: "falsk" })).error),
      "denied",
    );
    const genuine = await mustCreate(mia, ftrChannel, "Ekte?", ["Ja", "Nei"]);
    expect("B8 ingen kan legge til alternativer", code((await loose(mia).from("channel_poll_options").insert({ poll_id: genuine, position: 5, label: "Kanskje" })).error), "denied");
    expect("B8 ingen kan endre spørsmålet", code((await loose(mia).from("channel_polls").update({ question: "Endret" }).eq("message_id", genuine)).error), "denied");
    expect("B8 heller ikke tjenestenøkkelen", code((await admin.from("channel_polls").update({ question: "Endret" }).eq("message_id", genuine)).error), "immutable");

    // Validation.
    expect("B9 ett alternativ", (await create(mia, ftrChannel, "Q", ["Bare én"])).code, "option_count");
    expect("B9 elleve alternativer", (await create(mia, ftrChannel, "Q", Array.from({ length: 11 }, (_, i) => `Valg ${i}`))).code, "option_count");
    expect("B9 ti alternativer er lov", (await create(mia, ftrChannel, "Ti", Array.from({ length: 10 }, (_, i) => `Valg ${i}`))).code, "ok");
    expect("B9 like alternativer (store/små bokstaver)", (await create(mia, ftrChannel, "Q", ["Ja", " ja "])).code, "duplicate");
    expect("B9 tomt alternativ", (await create(mia, ftrChannel, "Q", ["Ja", "  "])).code, "option");
    expect("B9 tomt spørsmål", code((await mia.rpc("create_channel_poll", { p_channel_id: ftrChannel, p_question: "   ", p_options: ["a", "b"] })).error), "question");
    expect("B9 for langt spørsmål", (await create(mia, ftrChannel, "x".repeat(300))).code, "question");
    expect("B9 linjeskift i spørsmålet", (await create(mia, ftrChannel, "to\nlinjer")).code, "question");
    expect("B9 for langt alternativ", (await create(mia, ftrChannel, "Q", ["a", "b".repeat(121)])).code, "option");

    // ════ C. Voting ════════════════════════════════════════════════════
    const poll = await mustCreate(mia, ftrChannel, "Hvilken dag?", ["Mandag", "Tirsdag", "Onsdag"]);
    const [monday, tuesday, wednesday] = [0, 1, 2].map((position) => option(poll, position));
    let before = await view(cato.client, ftrChannel, poll);
    expect("C1 medlemmet ser avstemningen", before?.question, `${TAG} Hvilken dag?`);
    expect("C1 men ikke antall per alternativ før hen har stemt", `${before?.resultsVisible}|${tally(before)}`, "false|Mandag:- Tirsdag:- Onsdag:- =0");
    expect("C1 og kan stemme, ikke avslutte", `${before?.canVote}|${before?.canClose}`, "true|false");
    const asCreator = await view(mia, ftrChannel, poll);
    expect("C1 skaperen ser ikke resultatene før hen har stemt, men kan avslutte", `${asCreator?.resultsVisible}|${tally(asCreator)}|${asCreator?.canClose}`, "false|Mandag:- Tirsdag:- Onsdag:- =0|true");
    expect("C1 anonym er standard", `${asCreator?.visibility}|${sql(`select visibility from channel_polls where message_id = '${poll}'`)}`, "anonymous|anonymous");

    let result = await vote(bo.client, poll, tuesday);
    expect("C2 stemme", `${result.code}|${result.view?.myOptionId === tuesday}|${tally(result.view)}`, "ok|true|Mandag:0 Tirsdag:1 Onsdag:0 =1");
    result = await vote(cato.client, poll, tuesday);
    expect("C2 en til", tally(result.view), "Mandag:0 Tirsdag:2 Onsdag:0 =2");
    result = await vote(cato.client, poll, wednesday);
    expect("C3 endre stemmen flytter den, ikke dobler", tally(result.view), "Mandag:0 Tirsdag:1 Onsdag:1 =2");
    result = await vote(cato.client, poll, wednesday);
    expect("C3 samme stemme igjen endrer ingenting", tally(result.view), "Mandag:0 Tirsdag:1 Onsdag:1 =2");
    expect("C3 én rad per person", sql(`select count(*) from channel_poll_votes where poll_id = '${poll}'`), 2);
    expect("C4 alternativ fra en annen avstemning", (await vote(cato.client, poll, option(genuine, 0))).code, "invalid_option");
    expect("C4 alternativ som ikke finnes", (await vote(cato.client, poll, crypto.randomUUID())).code, "invalid_option");
    expect(
      "C4 direkte innsetting av en stemme",
      code((await loose(dina.client).from("channel_poll_votes").insert({ poll_id: poll, user_id: dina.id, option_id: monday })).error),
      "denied",
    );
    expect(
      "C4 eller endring av en annens stemme",
      code((await loose(mia).from("channel_poll_votes").update({ option_id: monday }).eq("poll_id", poll)).error),
      "denied",
    );
    expect("C4 og stemmene står som før", tally(await view(cato.client, ftrChannel, poll)), "Mandag:0 Tirsdag:1 Onsdag:1 =2");
    const asModerator = await view(kari, ftrChannel, poll);
    expect("C6 moderatoren ser ikke resultatene før hen har stemt", `${asModerator?.resultsVisible}|${tally(asModerator)}|${asModerator?.canClose}`, "false|Mandag:- Tirsdag:- Onsdag:- =2|true");
    expect("C6 administratoren heller ikke", `${(await view(mia, ftrChannel, poll))?.resultsVisible}`, "false");

    const announcePoll = await mustCreate(kari, announce, "Kunngjøring?", ["Ja", "Nei"]);
    expect("C5 medlemmer kan stemme i en kunngjøringskanal", (await vote(dina.client, announcePoll, option(announcePoll, 0))).code, "ok");

    // ════ D. Privacy ═══════════════════════════════════════════════════
    const rowsFor = async (client: Client) =>
      ((await client.from("channel_poll_votes").select("user_id").eq("poll_id", poll)).data ?? []).map((row) => row.user_id).join(",");
    expect("D1 et medlem leser bare sin egen stemme", await rowsFor(cato.client), cato.id);
    expect("D1 skaperen leser ingen andres stemmer", await rowsFor(mia), "");
    expect("D1 moderatoren heller ikke", await rowsFor(kari), "");
    const everything = JSON.stringify(await states(mia, ftrChannel));
    expect("D2 ingen svar har en velgers konto-id", [bo.id, cato.id, dina.id].some((id) => everything.includes(id)), false);
    const voted = JSON.stringify(result.view);
    expect("D2 heller ikke svaret på en stemme", [bo.id, cato.id].some((id) => voted.includes(id)), false);
    const html = (await page(mia, `/community/${FTR}/channel/${encodeURIComponent(ftrChannel)}`)).html;
    expect("D3 kanalsiden viser spørsmålet", html.includes(`${TAG} Hvilken dag?`), true);
    // Bo wrote an ordinary message there (B8), so his id is on the page as an author.
    expect("D3 men har ikke kontoen til noen som bare stemte", [cato.id, dina.id].some((id) => html.includes(id)), false);

    // ════ E. Access: groups, lokallag, other communities ═══════════════
    const groupPoll = await mustCreate(ane.client, group1.chat, "Gruppe?", ["Ja", "Nei"]);
    expect("E1 gruppemedlem stemmer", (await vote(cato.client, groupPoll, option(groupPoll, 0))).code, "ok");
    expect("E1 utenforstående kan ikke stemme", (await vote(dina.client, groupPoll, option(groupPoll, 0))).code, "not_found");
    expect("E1 og ser ingen avstemninger der", (await states(dina.client, group1.chat)).length, 0);
    expect("E1 og leser ingen rader", [
      ((await dina.client.from("channel_polls").select("message_id").eq("message_id", groupPoll)).data ?? []).length,
      ((await dina.client.from("channel_poll_options").select("id").eq("poll_id", groupPoll)).data ?? []).length,
    ].join(","), "0,0");
    expect("E1 og kan ikke avslutte den", (await close(dina.client, groupPoll)).code, "not_found");
    expect("E2 TU-medlem ser ingenting i FTR", `${(await states(tuva.client, ftrChannel)).length}|${(await vote(tuva.client, poll, monday)).code}`, "0|not_found");
    expect("E2 TU-admin heller ikke", `${(await states(emma, ftrChannel)).length}|${(await vote(emma, poll, monday)).code}|${(await close(emma, poll)).code}`, "0|not_found|not_found");
    const lokallagPoll = await mustCreate(mia, lokallagChat, "Lokallag?", ["Ja", "Nei"]);
    expect("E3 lokallagsmedlem stemmer", (await vote(bo.client, lokallagPoll, option(lokallagPoll, 1))).code, "ok");
    expect("E3 medlem utenfor lokallaget: ingenting", `${(await states(cato.client, lokallagChat)).length}|${(await vote(cato.client, lokallagPoll, option(lokallagPoll, 1))).code}`, "0|not_found");
    const privatePoll = await mustCreate(mia, privateChannel!, "Privat?", ["Ja", "Nei"]);
    expect("E4 invitert deltaker stemmer i en privat kanal", (await vote(ane.client, privatePoll, option(privatePoll, 0))).code, "ok");
    expect("E4 lokallagsmedlem som ikke er invitert: ingenting", `${(await states(bo.client, privateChannel!)).length}|${(await vote(bo.client, privatePoll, option(privatePoll, 0))).code}`, "0|not_found");
    expect("E5 anonym leser ingenting", ((await anon.from("channel_polls").select("message_id")).data ?? []).length, 0);

    // ════ J. Lokallag leaders ══════════════════════════════════════════
    expect("J0 oppsett: Lea blir lokallagsleder", (await mia.rpc("add_local_group_manager", { p_local_group_id: localGroup, p_user_id: lea.id })).data, true);
    await mia.rpc("add_private_channel_participant", { p_channel_id: privateChannel!, p_user_id: lea.id });
    expect("J1 lokallagsleder i eget lokallags chat", (await create(lea.client, lokallagChat)).code, "ok");
    expect("J1 og can_create_channel_poll sier det samme", await canCreate(lea.client, lokallagChat), true);
    expect("J2 lokallagsleder i en privat kanal under lokallaget (som deltaker): avvist", (await create(lea.client, privateChannel!)).code, "not_allowed");
    expect("J2 lokallagsleder i en åpen kanal: avvist", (await create(lea.client, ftrChannel)).code, "not_allowed");
    expect("J2 lokallagsleder i kunngjøringskanalen: avvist", (await create(lea.client, announce)).code, "not_allowed");
    expect("J2 lokallagsleder i en gruppe hen ikke er med i: finnes ikke", (await create(lea.client, group1.chat)).code, "not_found");
    const { data: otherGroup } = await mia.rpc("create_local_group", { p_community_id: FTR, p_name: `${TAG} lag to` });
    const otherChat = sql(`select id from channels where local_group_id = '${otherGroup}' and not is_private`);
    const leo = await disposable("leo", "Leo Avstemning", FTR, otherGroup!);
    await mia.rpc("add_local_group_manager", { p_local_group_id: otherGroup!, p_user_id: leo.id });
    expect("J3 leder av et annet lokallag i dette: finnes ikke", (await create(leo.client, lokallagChat)).code, "not_found");
    expect("J3 og i sitt eget: ja", (await create(leo.client, otherChat)).code, "ok");
    expect("J3 lokallagsleder i et annet lokallag: finnes ikke", (await create(lea.client, otherChat)).code, "not_found");
    expect("J4 vanlig medlem i lokallaget fortsatt avvist", `${(await create(bo.client, lokallagChat)).code}|${await canCreate(bo.client, lokallagChat)}`, "not_allowed|false");
    const leaderPoll = await mustCreate(mia, lokallagChat, "Leder?", ["Ja", "Nei"]);
    expect("J5 lokallagsleder kan avslutte i eget lokallag", (await close(lea.client, leaderPoll)).code, "ok");
    await mia.rpc("remove_local_group_manager", { p_local_group_id: localGroup, p_user_id: lea.id });
    expect("J6 uten ledervervet: avvist igjen", `${(await create(lea.client, lokallagChat)).code}|${await canCreate(lea.client, lokallagChat)}`, "not_allowed|false");

    // ════ K. Anonymous or visible ══════════════════════════════════════
    expect("K1 ugyldig modus avvises", (await create(mia, ftrChannel, "Q", ["a", "b"], "public")).code, "visibility");
    const visible = await mustCreate(mia, ftrChannel, "Synlig?", ["Alfa", "Beta"], "visible");
    const [alfa, beta] = [0, 1].map((position) => option(visible, position));
    expect("K1 synlig modus lagres", (await view(cato.client, ftrChannel, visible))?.visibility, "visible");
    expect("K2 modusen kan ikke endres av tjenestenøkkelen", code((await admin.from("channel_polls").update({ visibility: "anonymous" }).eq("message_id", visible)).error), "immutable");
    expect("K2 eller av admin direkte", code((await loose(mia).from("channel_polls").update({ visibility: "anonymous" }).eq("message_id", visible)).error), "denied");
    expect("K2 og står som før", sql(`select visibility from channel_polls where message_id = '${visible}'`), "visible");

    await vote(bo.client, visible, alfa);
    await vote(dina.client, visible, alfa);
    expect("K3 før man har stemt: ingen liste", who(await voters(cato.client, visible, alfa)), "null");
    expect("K3 heller ikke for skaperen og administratoren", who(await voters(mia, visible, alfa)), "null");
    expect("K3 heller ikke for moderatoren", who(await voters(kari, visible, alfa)), "null");
    await vote(cato.client, visible, alfa);
    // FTR's member directory is for admins only, and Cato has no other way to
    // know Dina. Her vote on a visible poll names her to him all the same.
    expect("K4 medlem ser alle som stemte, også med lukket medlemsliste", who(await voters(cato.client, visible, alfa)), "(Cato Avstemning),Bo Avstemning,Dina Avstemning+0/3");
    expect("K4 men får ikke Dinas profil ellers", (await cato.client.rpc("can_view_community_identity", { p_community_id: FTR, p_user_id: dina.id })).data, false);
    expect("K4 og ser ikke medlemslisten", ((await cato.client.from("memberships").select("user_id").eq("community_id", FTR).eq("user_id", dina.id)).data ?? []).length, 0);
    await vote(mia, visible, beta);
    expect("K4 administratoren ser medlemslisten og alle navn", who(await voters(mia, visible, alfa)), "Bo Avstemning,Cato Avstemning,Dina Avstemning+0/3");
    await vote(eva.client, visible, beta);
    sql(`update memberships set status = 'invited' where user_id = '${eva.id}' and community_id = '${FTR}'`);
    expect("K5 en som har gått ut, telles men navngis ikke", who(await voters(mia, visible, beta)), "(Mia Minge)+1/2");
    expect("K5 og telles i resultatet", `${(await view(mia, ftrChannel, visible))?.total}`, 5);
    expect("K5 og ser ingenting selv", `${(await states(eva.client, ftrChannel)).length}|${who(await voters(eva.client, visible, beta))}`, "0|null");
    expect("K6 et annet fellesskap: ingenting", who(await voters(tuva.client, visible, alfa)), "null");
    expect("K6 TU-admin: ingenting", who(await voters(emma, visible, alfa)), "null");
    expect("K6 anonym klient: avvist", (await anon.rpc("channel_poll_voters", { p_message_id: visible, p_option_id: alfa })).data ?? null, null);
    expect("K6 alternativ fra en annen avstemning", who(await voters(mia, visible, monday)), "null");
    const listJson = JSON.stringify([await voters(mia, visible, alfa), await voters(cato.client, visible, alfa)]);
    expect("K7 listene har ingen konto-id", [bo.id, cato.id, dina.id, ids.mia, eva.id].some((id) => listJson.includes(id)), false);
    expect("K7 og ingen e-postadresse, globalt navn eller filsti", listJson.includes("@") || listJson.includes("check-poll-") || listJson.includes("/"), false);

    // ── Photos of visible voters ──
    const photoName = `${crypto.randomUUID()}.png`;
    const photoPath = `${FTR}/${dina.id}/${photoName}`;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const uploaded = await admin.storage.from("member-avatars").upload(photoPath, png, { contentType: "image/png" });
    if (uploaded.error) throw new Error(`kunne ikke laste opp bilde: ${uploaded.error.message}`);
    sql(`update community_profiles set avatar_path = '${photoPath}' where user_id = '${dina.id}' and community_id = '${FTR}'`);
    const dinaEntry = (await voters(cato.client, visible, alfa))?.people.find((person) => person.name === "Dina Avstemning");
    expect("K10 listen gir bildets versjon, ikke stien", `${dinaEntry?.avatar}|${dinaEntry?.ref === dina.id}`, `${photoName}|false`);
    const photoUrl = `/community/${FTR}/poll-voter-avatar/${visible}/${dinaEntry?.ref}`;
    const photo = await page(cato.client, photoUrl);
    expect("K10 en som har stemt, ser bildet", photo.status, 200);
    expect("K10 men den vanlige bilderuten følger medlemslisten", (await page(cato.client, `/community/${FTR}/member-avatar/${dina.id}`)).status, 404);
    expect("K10 et annet fellesskap får ikke bildet", (await page(tuva.client, photoUrl)).status, 404);
    expect("K10 heller ikke uten innlogging", (await fetch(`${APP}${photoUrl}`, { redirect: "manual" })).status, 404);
    expect("K10 heller ikke en som ikke har stemt", (await page(ane.client, photoUrl)).status, 404);
    const anonymousRef = sql(`select voter_ref from channel_poll_votes where poll_id = '${announcePoll}' and user_id = '${dina.id}'`);
    expect("K10 aldri for en anonym avstemning", (await page(kari, `/community/${FTR}/poll-voter-avatar/${announcePoll}/${anonymousRef}`)).status, 404);
    expect("K10 og funksjonen bak er bare for serveren", sql(`select has_function_privilege('authenticated', 'public.channel_poll_voter_avatar_path(uuid, uuid, uuid)', 'execute')`), "f");

    // ════ W. Withdrawing ═══════════════════════════════════════════════
    result = await withdraw(cato.client, visible);
    expect("W1 trekke stemmen på en synlig avstemning", `${result.code}|${result.view?.myOptionId ?? "ingen"}|${result.view?.resultsVisible}|${tally(result.view)}`, "ok|ingen|false|Alfa:- Beta:- =4");
    expect("W1 og listene er skjult igjen", who(await voters(cato.client, visible, alfa)), "null");
    expect("W1 og bildene", (await page(cato.client, photoUrl)).status, 404);
    expect("W1 de andre ser at Cato er borte fra listen", who(await voters(mia, visible, alfa)), "Bo Avstemning,Dina Avstemning+0/2");
    expect("W2 trekke igjen: samme svar", (await withdraw(cato.client, visible)).code, "ok");
    expect("W2 stemme igjen viser resultatene igjen", `${(await vote(cato.client, visible, alfa)).view?.resultsVisible}`, "true");
    expect("W3 kan ikke slette stemmeraden direkte", code((await loose(cato.client).from("channel_poll_votes").delete().eq("poll_id", visible)).error), "denied");
    expect("W3 og stemmen står", sql(`select count(*) from channel_poll_votes where poll_id = '${visible}' and user_id = '${cato.id}'`), 1);
    expect("W4 utenfor kanalen: finnes ikke", (await withdraw(tuva.client, visible)).code, "not_found");
    expect("W4 i en gruppe man ikke er med i: finnes ikke", (await withdraw(dina.client, groupPoll)).code, "not_found");
    const anonWithdraw = await withdraw(dina.client, announcePoll);
    // Dina was the only voter so far (C5).
    expect("W5 anonym avstemning: trekke stemmen", `${anonWithdraw.code}|${anonWithdraw.view?.resultsVisible}|${tally(anonWithdraw.view)}`, "ok|false|Ja:- Nei:- =0");
    expect("W5 og raden er borte", sql(`select count(*) from channel_poll_votes where poll_id = '${announcePoll}'`), 0);
    // The anonymous poll: names nobody, to anyone, ever.
    expect("K8 anonym avstemning: ingen liste for en som har stemt", who(await voters(cato.client, poll, wednesday)), "null");
    await vote(kari, announcePoll, option(announcePoll, 0));
    await vote(mia, announcePoll, option(announcePoll, 1));
    expect("K8 heller ikke for skaperen (moderator) etter at hen har stemt", who(await voters(kari, announcePoll, option(announcePoll, 0))), "null");
    expect("K8 heller ikke for administratoren", who(await voters(mia, announcePoll, option(announcePoll, 0))), "null");
    expect("K8 men antallene vises", tally(await view(mia, announce, announcePoll)), "Ja:1 Nei:1 =2");
    await close(kari, visible);
    expect("K9 avsluttet synlig avstemning: listen også for den som ikke stemte", who(await voters(kari, visible, alfa)), "Bo Avstemning,Cato Avstemning,Dina Avstemning+0/3");
    expect("W6 avsluttet: stemmen kan ikke trekkes", (await withdraw(cato.client, visible)).code, "closed");
    expect("W6 og den står", sql(`select count(*) from channel_poll_votes where poll_id = '${visible}'`), 5);

    // ════ F. Closing ═══════════════════════════════════════════════════
    expect("F1 vanlig medlem kan ikke avslutte", (await close(bo.client, poll)).code, "not_allowed");
    expect("F1 gruppeansvarlig kan ikke avslutte i en åpen kanal", (await close(ane.client, poll)).code, "not_allowed");
    result = await close(kari, poll);
    expect("F2 moderator avslutter en annens avstemning", `${result.code}|${Boolean(result.view?.closedAt)}|${result.view?.canVote}|${result.view?.canClose}`, "ok|true|false|false");
    expect("F2 igjen: samme svar", (await close(mia, poll)).code, "ok");
    expect("F2 anonym forblir anonym etter avslutning", who(await voters(kari, poll, tuesday)), "null");
    expect("F3 ingen ny stemme", (await vote(dina.client, poll, monday)).code, "closed");
    expect("F3 ingen endret stemme", (await vote(cato.client, poll, monday)).code, "closed");
    expect("F3 heller ikke med tjenestenøkkelen", code((await admin.from("channel_poll_votes").update({ option_id: monday }).eq("poll_id", poll).eq("user_id", cato.id)).error), "closed");
    expect("F3 kan ikke åpnes igjen", code((await admin.from("channel_polls").update({ closed_at: null, closed_by: null }).eq("message_id", poll)).error), "closed");
    before = await view(dina.client, ftrChannel, poll);
    expect("F4 avsluttet: alle ser resultatet, også uten å ha stemt", `${before?.resultsVisible}|${tally(before)}`, "true|Mandag:0 Tirsdag:1 Onsdag:1 =2");
    expect("F5 gruppeansvarlig avslutter i egen gruppe", (await close(ane.client, groupPoll)).code, "ok");
    const daPoll = await mustCreate(dina.client, group2.chat, "Egen?", ["Ja", "Nei"]);
    expect("F5 gruppeansvarlig i gruppe 1 kan ikke avslutte i gruppe 2", (await close(ane.client, daPoll)).code, "not_allowed");
    expect("F5 skaperen avslutter sin egen", (await close(dina.client, daPoll)).code, "ok");

    // ════ G. History ═══════════════════════════════════════════════════
    const { data: asMessage } = await cato.client.from("messages").select("body, author_id").eq("id", genuine).single();
    expect("G1 avstemningen er en melding i historikken", `${asMessage?.body}|${asMessage?.author_id === ids.mia}`, `${TAG} Ekte?|true`);
    expect("G2 spørsmålet kan ikke redigeres", code((await mia.rpc("edit_channel_message", { p_message_id: genuine, p_body: "Endret" })).error), "poll");
    await vote(cato.client, genuine, option(genuine, 0));
    expect("G3 sletting", code((await mia.rpc("delete_channel_message", { p_message_id: genuine })).error), "ok");
    expect(
      "G3 tar avstemningen, alternativene og stemmene med seg",
      sql(`select (select count(*) from channel_polls where message_id = '${genuine}') || '|' || (select count(*) from channel_poll_options where poll_id = '${genuine}') || '|' || (select count(*) from channel_poll_votes where poll_id = '${genuine}')`),
      "0|0|0",
    );
    expect("G3 og kan ikke stemmes på", (await vote(cato.client, genuine, option(poll, 0))).code, "not_found");
    const removed = await mustCreate(mia, ftrChannel, "Fjernes?", ["Ja", "Nei"]);
    expect("G4 moderator fjerner avstemningen", code((await kari.rpc("delete_channel_message", { p_message_id: removed })).error), "ok");
    expect("G4 og den er borte", sql(`select count(*) from channel_polls where message_id = '${removed}'`), 0);

    const archivedPoll = await mustCreate(mia, privateChannel!, "Arkiv?", ["Ja", "Nei"]);
    await vote(ane.client, archivedPoll, option(archivedPoll, 1));
    await mia.rpc("set_private_channel_archived", { p_channel_id: privateChannel!, p_archived: true });
    expect("G5 arkivert kanal: ingen stemmer", (await vote(ane.client, archivedPoll, option(archivedPoll, 0))).code, "archived");
    expect("G5 og ingen nye avstemninger", (await create(mia, privateChannel!)).code, "archived");
    expect("G5 og stemmen kan ikke trekkes", (await withdraw(ane.client, archivedPoll)).code, "archived");
    expect("G5 men avstemningen kan leses", `${(await view(ane.client, privateChannel!, archivedPoll))?.canVote}`, "false");

    // ════ H. Pages ═════════════════════════════════════════════════════
    // Either language: an account may have chosen English.
    const MENU = /aria-label="(Flere valg|More actions)"/;
    const channelPath = (id: string) => `/community/${FTR}/channel/${encodeURIComponent(id)}`;
    expect("H1 admin får «Avstemning» i skrivefeltet", (await page(mia, channelPath(ftrChannel))).html.match(MENU) !== null, true);
    expect("H1 vanlig medlem får det ikke", (await page(cato.client, channelPath(ftrChannel))).html.match(MENU) !== null, false);
    expect("H1 gruppeansvarlig får det i egen gruppe", (await page(ane.client, channelPath(group1.chat))).html.match(MENU) !== null, true);
    expect("H1 men ikke i gruppe 2", (await page(ane.client, channelPath(group2.chat))).html.match(MENU) !== null, false);
    expect("H1 lokallagsleder får det i eget lokallag", (await page(leo.client, channelPath(otherChat))).html.match(MENU) !== null, true);
    await mustCreate(mia, ftrChannel, "Synlig to?", ["Ja", "Nei"], "visible");
    const english = (await page(bo.client, channelPath(ftrChannel))).html;
    expect("H2 engelsk: «Poll», «Anonymous poll», «Visible votes»", english.includes(">Poll<") && english.includes("Anonymous poll") && english.includes("Visible votes"), true);
    expect("H2 engelsk: varsel før stemmen på en synlig avstemning", english.includes("When you vote, other voters can see your name and your choice."), true);
    const norwegian = (await page(ane.client, channelPath(ftrChannel))).html;
    expect("H2 norsk: «Avstemning», «Anonym avstemning», «Synlige stemmer»", norwegian.includes(">Avstemning<") && norwegian.includes("Anonym avstemning") && norwegian.includes("Synlige stemmer"), true);
    expect("H2 norsk: varsel før stemmen", norwegian.includes("Når du stemmer, kan andre som stemmer se navnet ditt og hva du har valgt."), true);
    expect("H3 siden har ingen velgerliste eller konto-id for velgere", [dina.id, eva.id].some((id) => norwegian.includes(id)), false);
  } finally {
    await cleanup();
  }

  console.log(`\n${checks - failures}/${checks} sjekker bestått.`);
  if (failures > 0) process.exit(1);
}

const ids: Record<string, string> = {};

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("opprydding feilet:", cleanupError);
  }
  process.exit(1);
});
