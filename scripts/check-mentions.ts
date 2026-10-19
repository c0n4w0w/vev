/**
 * Checks @mentions in chat channels (20261103100000_chat_mentions) under real
 * authenticated sessions.
 *
 * The rule, in short. In a community channel or a lokallag's main chat only
 * people with a message there that is not deleted can be found and mentioned
 * — never a member who only reads, never someone who wrote only in another
 * channel. In a private lokallag channel and a group chat the invited people
 * can be mentioned before they write. Everyone must be able to read the
 * channel now. The database checks every mention a message gains, on send and
 * on edit, and refuses the whole write for one it may not hold; each new
 * mention raises one notice, an unchanged one never another, and removing a
 * mention or the message takes its notice away. A notice shows only while its
 * recipient can read the message.
 *
 * Exercised the way an attacker would reach it: the RPC the composer calls,
 * direct inserts and the edit/delete RPCs with anon-key clients signed in as
 * fixture and disposable accounts, plus the channel, profile and
 * notification pages over HTTP (the dev server must be running). The service
 * role sets up disposable accounts, reads state back and cleans up.
 *
 * Run with `npm run check:mentions` against the local stack after
 * `npm run seed`, with the app on http://localhost:3000 (or CHECK_APP_URL).
 * Creates only disposable accounts (check-nevn-…@example.test), channels and
 * groups marked "CHECK nevn" / "check-nevn"; messages it writes into the real
 * FTR Trøndelag chat are recorded and removed afterwards, also after an
 * interrupted run.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { draftToStored, mentionIds, mentionsToDraft } from "@/lib/mentions";
import { pngFixture } from "./lib/attachment-fixtures";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const TAG = "CHECK nevn";
const PRIVATE = "check-nevn";
const BODY = "CHECK-nevn";
const EMAIL = "check-nevn-";
const TRONDELAG_CHAT = `${FTR}--lokallag-ftr-trondelag`;
const LEDGER = join(tmpdir(), "ting-check-mentions.json");

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

const ids: Record<string, string> = {};

async function profileId(handle: string): Promise<string> {
  if (ids[handle]) return ids[handle];
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`fant ikke profilen ${handle}: ${error.message}`);
  ids[handle] = data.id;
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

/** A disposable active FTR member with this display name, signed in. */
async function disposable(key: string, name: string, community = FTR, bio = ""): Promise<{ id: string; client: Client }> {
  const email = `${EMAIL}${key}-${crypto.randomUUID().slice(0, 6)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name, handle: `${PRIVATE}-${key}-${crypto.randomUUID().slice(0, 4)}` },
  });
  if (error || !data.user) throw new Error(`kunne ikke opprette ${key}: ${error?.message}`);
  const id = data.user.id;
  sql(`insert into memberships (user_id, community_id, role, status) values ('${id}', '${community}', 'member', 'active')`);
  sql(`update community_profiles set display_name = '${name}', bio = '${bio}' where user_id = '${id}' and community_id = '${community}'`);
  return { id, client: await signInEmail(email) };
}

const cookieHeaders = new Map<Client, string>();

async function cookiesFor(client: Client): Promise<string> {
  const cached = cookieHeaders.get(client);
  if (cached) return cached;
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
  const header = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  cookieHeaders.set(client, header);
  return header;
}

async function page(client: Client, path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${APP}${path}`, { headers: { Cookie: await cookiesFor(client) }, redirect: "manual" });
  return { status: response.status, html: await response.text() };
}

/** The profile card for a name opened in a channel, as the popover asks for it. */
type CardJson = { name: string; bio: string | null; communityName: string; dm: { conversationId: string | null } | null };
async function card(client: Client | null, channelId: string, userId: string, community = FTR) {
  const response = await fetch(
    `${APP}/community/${community}/channel/${encodeURIComponent(channelId)}/people/${encodeURIComponent(userId)}`,
    { headers: client ? { Cookie: await cookiesFor(client) } : {}, redirect: "manual" },
  );
  const raw = await response.text();
  return { status: response.status, raw, json: response.ok ? (JSON.parse(raw) as CardJson) : undefined };
}

// ── The calls the app makes ─────────────────────────────────────────────

const N = null as unknown as string;
const tok = (userId: string) => `<@${userId}>`;
const ledger = new Set<string>();
/** Direct conversations this run started, removed afterwards. */
const createdDms = new Set<string>();

/** The refusal reason a message write raised, or "ok". */
function code(result: { error: { message?: string; code?: string } | null }): string {
  if (!result.error) return "ok";
  const match = /message_error:([a-z_]+)/.exec(result.error.message ?? "");
  return match ? match[1] : (result.error.code ?? result.error.message ?? "error");
}

async function send(client: Client, channelId: string, text: string) {
  const result = await client.from("messages").insert({ channel_id: channelId, body: `${BODY} ${text}` }).select("id").maybeSingle();
  if (result.data && channelId === TRONDELAG_CHAT) {
    ledger.add(result.data.id);
    writeFileSync(LEDGER, JSON.stringify([...ledger]));
  }
  return { id: result.data?.id ?? "", code: code(result) };
}

async function post(client: Client, channelId: string, text: string): Promise<string> {
  const sent = await send(client, channelId, text);
  if (sent.code !== "ok") throw new Error(`kunne ikke skrive i ${channelId}: ${sent.code}`);
  return sent.id;
}

const edit = (client: Client, messageId: string, body: string) =>
  client.rpc("edit_channel_message", { p_message_id: messageId, p_body: `${BODY} ${body}` });
const remove = (client: Client, messageId: string) => client.rpc("delete_channel_message", { p_message_id: messageId });

/** Display names the composer would suggest, in order. */
async function search(client: Client, channelId: string, query: string): Promise<string> {
  const { data, error } = await client.rpc("search_channel_mention_candidates", { p_channel_id: channelId, p_query: query });
  if (error) return `feil:${error.code}`;
  return (data ?? []).map((row) => row.display_name).join(",");
}

const mentioned = (messageId: string) =>
  sql(`select coalesce(string_agg(user_id::text, ',' order by user_id), '') from message_mentions where message_id = '${messageId}'`);
const notices = (messageId: string, userId?: string) =>
  Number(sql(`select count(*) from notifications where message_id = '${messageId}' and kind = 'mention'${userId ? ` and user_id = '${userId}'` : ""}`));
const noticeIds = (messageId: string) =>
  sql(`select coalesce(string_agg(id::text, ',' order by id), '') from notifications where message_id = '${messageId}'`);
const sorted = (...values: string[]) => [...values].sort().join(",");

async function createChannel(client: Client, name: string) {
  const { data, error } = await client.rpc("create_community_channel", {
    p_community_id: FTR,
    p_name: `${TAG} ${name}`,
    p_purpose: "",
    p_section_id: N,
    p_creation_key: N,
    p_read_only: false,
    p_file_sharing: false,
  });
  if (error || !data) throw new Error(`kunne ikke opprette ${name}: ${error?.message}`);
  return data;
}

async function createChannelIn(client: Client, community: string, name: string) {
  const { data, error } = await client.rpc("create_community_channel", {
    p_community_id: community,
    p_name: `${TAG} ${name}`,
    p_purpose: "",
    p_section_id: N,
    p_creation_key: N,
    p_read_only: false,
    p_file_sharing: false,
  });
  if (error || !data) throw new Error(`kunne ikke opprette ${name} i ${community}: ${error?.message}`);
  return data;
}

async function createPrivate(client: Client, localGroupId: string, name: string, participants: string[]) {
  const { data, error } = await client.rpc("create_private_channel", {
    p_local_group_id: localGroupId,
    p_name: `${PRIVATE} ${name}`,
    p_purpose: "",
    p_participant_ids: participants,
  });
  if (error || !data) throw new Error(`kunne ikke opprette privat kanal ${name}: ${error?.message}`);
  return data;
}

async function createGroup(client: Client, name: string, memberIds: string[]) {
  const { data, error } = await client.rpc("create_subgroup", {
    p_community_id: FTR,
    p_name: `${TAG} ${name}`,
    p_description: "",
    p_member_ids: memberIds,
  });
  if (error || !data) throw new Error(`kunne ikke opprette gruppe ${name}: ${error?.message}`);
  const { data: channel } = await admin.from("channels").select("id").eq("subgroup_id", data).single();
  return { id: data, channelId: channel!.id };
}

async function localGroupId(name: string) {
  const { data } = await admin.from("community_local_groups").select("id").eq("community_id", FTR).eq("name", name).single();
  return data!.id;
}

// ── Cleanup ─────────────────────────────────────────────────────────────

async function cleanup() {
  const earlier: string[] = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : [];
  const recorded = [...new Set([...earlier, ...ledger])];
  if (recorded.length) {
    const list = recorded.map((id) => `'${id}'`).join(",");
    sql(`delete from message_moderation_log where message_id in (${list})`);
    sql(`delete from messages where id in (${list})`);
  }
  sql(`delete from messages where channel_id = '${TRONDELAG_CHAT}' and body like '${BODY}%'`);
  if (existsSync(LEDGER)) unlinkSync(LEDGER);
  ledger.clear();

  const channels = sql(
    `select string_agg(quote_literal(id), ',') from channels where community_id in ('${FTR}', '${TU}', '${UTR}') and (
       (name like '${TAG}%' and local_group_id is null and subgroup_id is null) or (is_private and name like '${PRIVATE}%'))`,
  );
  const groups = sql(`select string_agg(quote_literal(id::text), ',') from community_subgroups where name like '${TAG}%'`);
  if (groups) {
    sql(`delete from message_moderation_log where channel_id in (select id from channels where subgroup_id::text in (${groups}))`);
    sql(`delete from channels where subgroup_id::text in (${groups})`);
    sql(`delete from community_subgroups where id::text in (${groups})`);
  }
  if (channels) {
    sql(`delete from message_moderation_log where channel_id in (${channels})`);
    sql(`delete from channels where id in (${channels})`);
  }
  sql(`delete from channel_retired_ids where id like '%check-nevn%'`);
  for (const conversation of createdDms) {
    sql(`delete from notifications where href = '/community/${UTR}/messages/${conversation}'`);
    sql(`delete from direct_conversations where id = '${conversation}'`);
  }
  createdDms.clear();

  const users = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where email like '${EMAIL}%@example.test'`);
  // Profile photos this suite gave its own accounts, and nothing else.
  const photos = users
    ? sql(`select coalesce(string_agg(name, ','), '') from storage.objects where bucket_id = 'member-avatars' and split_part(name, '/', 2) = any(string_to_array('${users}', ','))`)
    : "";
  if (photos) await admin.storage.from("member-avatars").remove(photos.split(","));
  for (const userId of users ? users.split(",") : []) {
    await admin.auth.admin.deleteUser(userId);
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

  const handles = ["miaminge", "emmamortensen", "linn", "elise", "petter", "elironning", "karimoen", "kristoffer"];
  const [mia, emma, linn, elise, petter, eli, kari, kristoffer] = await Promise.all(handles.map(signIn));
  const id = (handle: string) => ids[handle];
  const loose = (client: Client) => client as unknown as Loose;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    expect("A1 message_mentions har radsikkerhet", sql(`select relrowsecurity from pg_class where oid = 'public.message_mentions'::regclass`), "t");
    expect("A1 medlemmer har ingen rettigheter på message_mentions", sql(`select count(*) from information_schema.role_table_grants where table_name = 'message_mentions' and grantee in ('anon', 'authenticated')`), 0);
    expect("A2 søket kan kalles av innloggede", sql(`select has_function_privilege('authenticated', 'public.search_channel_mention_candidates(text, text)', 'execute')`), "t");
    expect("A2 men ikke anonymt", sql(`select has_function_privilege('anon', 'public.search_channel_mention_candidates(text, text)', 'execute')`), "f");
    for (const fn of ["mention_target_admits(text, uuid)", "message_mention_ids(text)", "messages_sync_mentions()"]) {
      expect(`A3 ${fn} kan ikke kalles av API-roller`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') or has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
    }
    expect("A4 varsler skjules når meldingen ikke kan leses", sql(`select qual like '%can_read_notified_message(message_id)%' from pg_policies where tablename = 'notifications' and policyname = 'notifications_select'`), "t");
    expect("A5 direktemeldinger har ingen nevning", sql(`select count(*) from pg_trigger where tgrelid = 'public.direct_messages'::regclass and tgname like '%mention%'`), 0);

    // ════ B. Fixtures ══════════════════════════════════════════════════
    const asmund = await disposable("a", "Åsmund Nevnesen");
    const oyvind = await disposable("b", "Øyvind Passiv");
    const cecilie = await disposable("c", "Cecilie Annenkanal");
    const dag = await disposable("d", "Dag Slettemo");
    const frida = await disposable("f", "Frida Tidligere");
    const tuOnly = await disposable("t", "Tuva Annetsted", TU);

    const c1 = await createChannel(mia, "kanal 1");
    const c2 = await createChannel(mia, "kanal 2");
    await post(linn, c1, "hei fra Linn");
    await post(asmund.client, c1, "hei fra Åsmund");
    await post(cecilie.client, c2, "hei fra Cecilie i kanal 2");
    const dagsOnly = await post(dag.client, c1, "hei fra Dag");
    await post(frida.client, c1, "hei fra Frida");

    // ════ C. Who can be found in a community channel ═══════════════════
    expect("C1 en aktiv bidragsyter finnes", await search(linn, c1, "åsm"), "Åsmund Nevnesen");
    expect("C1 store bokstaver og æøå", await search(linn, c1, "ÅSMUND"), "Åsmund Nevnesen");
    expect("C1 treff på etternavn", await search(linn, c1, "nevne"), "Åsmund Nevnesen");
    expect("C1 ingen treff midt i et ord", await search(linn, c1, "smund"), "");
    expect("C1 «@» alene gir bare kanalens bidragsytere", sorted(...(await search(linn, c1, "")).split(",")), sorted("Åsmund Nevnesen", "Dag Slettemo", "Frida Tidligere"));
    expect("C2 et passivt medlem finnes ikke", await search(linn, c1, "øyv"), "");
    expect("C2 heller ikke administratoren som ikke har skrevet", await search(linn, c1, "mia"), "");
    expect("C3 en som bare har skrevet i en annen kanal finnes ikke", await search(linn, c1, "cec"), "");
    expect("C3 men finnes i sin egen kanal", await search(linn, c2, "cec"), "Cecilie Annenkanal");
    expect("C4 man finner ikke seg selv", await search(linn, c1, "linn"), "");
    expect("C5 wildcard-tegn er bokstavelige", await search(linn, c1, "%"), "");
    expect("C5 og understrek", await search(linn, c1, "_"), "");
    expect("C6 et medlem av et annet fellesskap får ingenting", await search(emma, c1, "åsm"), "");
    expect("C6 anonymt kall nektes", (await anon.rpc("search_channel_mention_candidates", { p_channel_id: c1, p_query: "" })).error?.code, "42501");
    expect("C6 for langt søk gir ingenting", await search(linn, c1, "a".repeat(41)), "");
    expect("C6 en kanal som ikke finnes gir ingenting", await search(linn, `${FTR}--finnes-ikke`, ""), "");

    // ════ D. Sending mentions ══════════════════════════════════════════
    const multi = await send(linn, c1, `${tok(asmund.id)} og ${tok(asmund.id)} og ${tok(frida.id)} og meg ${tok(id("linn"))}`);
    expect("D1 flere og gjentatte nevninger sendes", multi.code, "ok");
    expect("D1 hver person lagres én gang", mentioned(multi.id), sorted(asmund.id, frida.id, id("linn")));
    expect("D1 Åsmund får ett varsel", notices(multi.id, asmund.id), 1);
    expect("D1 Frida får ett varsel", notices(multi.id, frida.id), 1);
    expect("D1 ingen varsel til forfatteren selv", notices(multi.id, id("linn")), 0);
    const notice = await asmund.client.from("notifications").select("title, body, href, kind").eq("message_id", multi.id).single();
    expect("D2 tittelen sier hvem og hvor", notice.data?.title, `Linn Persen nevnte deg i #${TAG} kanal 1`);
    expect("D2 lenken går til meldingen", notice.data?.href, `/community/${FTR}/channel/${c1}?melding=${multi.id}`);
    expect("D2 teksten er bare fellesskapet", notice.data?.body, "Tryggere Ruspolitikk");
    expect("D2 varselet er en nevning", notice.data?.kind, "mention");
    expect("D3 andre ser ikke Åsmunds varsel", (await oyvind.client.from("notifications").select("id").eq("message_id", multi.id)).data?.length, 0);

    expect("D4 et passivt medlem kan ikke nevnes", (await send(linn, c1, `hei ${tok(oyvind.id)}`)).code, "mention_not_allowed");
    expect("D4 en fra en annen kanal kan ikke nevnes", (await send(linn, c1, `hei ${tok(cecilie.id)}`)).code, "mention_not_allowed");
    expect("D4 et medlem av et annet fellesskap kan ikke nevnes", (await send(linn, c1, `hei ${tok(tuOnly.id)}`)).code, "mention_not_allowed");
    expect("D4 en forfalsket id avvises", (await send(linn, c1, `hei ${tok(crypto.randomUUID())}`)).code, "mention_not_allowed");
    expect("D4 en ugyldig nevning avviser hele meldingen", sql(`select count(*) from messages where channel_id = '${c1}' and body like '%${oyvind.id}%'`), 0);
    expect("D4 og gir ingen varsler", sql(`select count(*) from notifications where user_id in ('${oyvind.id}', '${cecilie.id}', '${tuOnly.id}')`), 0);
    const upper = await send(linn, c1, `hei <@${oyvind.id.toUpperCase()}> og @Øyvind Passiv`);
    expect("D5 tekst som bare ligner en nevning er tekst", `${upper.code}|${mentioned(upper.id)}`, "ok|");
    const many = Array.from({ length: 21 }, () => tok(crypto.randomUUID())).join(" ");
    expect("D6 høyst 20 personer per melding", (await send(linn, c1, many)).code, "too_many_mentions");
    const spoof = await loose(linn).from("messages").insert({ channel_id: c1, author_id: asmund.id, body: `${BODY} ${tok(frida.id)}` });
    expect("D7 man kan ikke skrive i en annens navn", spoof.error?.code, "42501");
    const direct = await loose(linn).from("message_mentions").insert({ message_id: multi.id, channel_id: c1, user_id: oyvind.id });
    expect("D8 nevninger kan ikke skrives direkte", direct.error?.code, "42501");
    const readMentions = await loose(linn).from("message_mentions").select("user_id");
    expect("D8 og ikke leses direkte", readMentions.error?.code, "42501");
    const forgedNotice = await loose(linn).from("notifications").insert({ user_id: asmund.id, kind: "mention", title: "falsk", body: "", href: "/" });
    expect("D9 varsler kan ikke forfalskes", forgedNotice.error?.code, "42501");
    const repoint = await loose(asmund.client).from("notifications").update({ message_id: dagsOnly }).eq("message_id", multi.id);
    expect("D9 et varsel kan ikke pekes om", repoint.error?.code, "42501");
    expect("D10 interne regler kan ikke kalles", (await loose(linn).rpc("mention_target_admits", { p_channel_id: c1, p_user_id: oyvind.id })).error?.code, "42501");

    // ════ E. Deleted, former and display names ════════════════════════
    expect("E1 Dag finnes før han sletter", await search(linn, c1, "dag"), "Dag Slettemo");
    expect("E1 Dag sletter sin eneste melding", (await remove(dag.client, dagsOnly)).data, "author");
    expect("E1 da finnes han ikke lenger", await search(linn, c1, "dag"), "");
    expect("E1 og kan ikke nevnes", (await send(linn, c1, tok(dag.id))).code, "mention_not_allowed");
    expect("E2 Frida finnes mens hun er medlem", await search(linn, c1, "frida"), "Frida Tidligere");
    sql(`delete from memberships where user_id = '${frida.id}' and community_id = '${FTR}'`);
    expect("E2 et tidligere medlem finnes ikke", await search(linn, c1, "frida"), "");
    expect("E2 og kan ikke nevnes", (await send(linn, c1, tok(frida.id))).code, "mention_not_allowed");
    expect("E2 hennes gamle varsel vises ikke lenger", (await frida.client.from("notifications").select("id").eq("message_id", multi.id)).data?.length, 0);
    expect("E2 den gamle meldingen står med sin forfatter", sql(`select count(*) from messages where channel_id = '${c1}' and author_id = '${frida.id}'`), 1);
    sql(`update community_profiles set display_name = 'Åsmund Nytt-Navn' where user_id = '${asmund.id}' and community_id = '${FTR}'`);
    expect("E3 nytt visningsnavn finnes i søket", await search(linn, c1, "nytt"), "Åsmund Nytt-Navn");
    expect("E3 ord etter bindestrek", await search(linn, c1, "navn"), "Åsmund Nytt-Navn");
    expect("E3 den lagrede nevningen er uendret", sql(`select body like '%${tok(asmund.id)}%' from messages where id = '${multi.id}'`), "t");
    const channelPage = await page(linn, `/community/${FTR}/channel/${encodeURIComponent(c1)}`);
    expect("E3 kanalen viser det nye navnet som en knapp til profilkortet", channelPage.html.includes('aria-haspopup="dialog"') && channelPage.html.includes("@<!-- -->Åsmund Nytt-Navn"), true);
    expect("E3 ingen lenke til en egen profilside", channelPage.html.includes(`/community/${FTR}/profile/${asmund.id}`), false);
    expect("E3 kanalen viser ingen rå nevning", channelPage.html.includes(`&lt;@${asmund.id}&gt;`), false);
    const opened = await card(linn, c1, asmund.id);
    expect("E4 profilkortet åpnes fra nevningen", `${opened.status}|${opened.json?.name}|${opened.json?.communityName}`, "200|Åsmund Nytt-Navn|Tryggere Ruspolitikk");
    expect("E4 et passivt medlems kort er ikke tilgjengelig", (await card(linn, c1, oyvind.id)).status, 404);
    expect("E4 den gamle profilsiden finnes ikke", (await page(linn, `/community/${FTR}/profile/${asmund.id}`)).status, 404);
    const noticesPage = await page(asmund.client, "/notifications");
    expect("E5 varselsiden viser nevningen", noticesPage.html.includes(`Linn Persen nevnte deg i #${TAG} kanal 1`), true);
    const target = await page(asmund.client, `/community/${FTR}/channel/${encodeURIComponent(c1)}?melding=${multi.id}`);
    expect("E5 lenken åpner kanalen ved meldingen", target.status === 200 && target.html.includes(`melding-${multi.id}`), true);

    // ════ F. Editing ═══════════════════════════════════════════════════
    await post(mia, c1, "hei fra Mia");
    await post(elise, c1, "hei fra Elise");
    const edited = await post(linn, c1, `${tok(asmund.id)} ${tok(id("elise"))}`);
    const before = noticeIds(edited);
    expect("F1 to varsler før redigering", notices(edited), 2);
    expect("F2 lagre uendret", code(await edit(linn, edited, `${tok(asmund.id)} ${tok(id("elise"))}`)), "ok");
    expect("F2 gir ingen nye varsler", noticeIds(edited), before);
    expect("F3 endret tekst med samme nevninger", code(await edit(linn, edited, `rettet: ${tok(id("elise"))} og ${tok(asmund.id)}`)), "ok");
    expect("F3 gir ingen nye varsler", noticeIds(edited), before);
    const eliseNotice = sql(`select id from notifications where message_id = '${edited}' and user_id = '${id("elise")}'`);
    expect("F4 legg til Mia, fjern Åsmund", code(await edit(linn, edited, `${tok(id("elise"))} ${tok(id("miaminge"))}`)), "ok");
    expect("F4 nevningene følger teksten", mentioned(edited), sorted(id("elise"), id("miaminge")));
    expect("F4 Mia får ett varsel", notices(edited, id("miaminge")), 1);
    expect("F4 Åsmunds varsel er borte", notices(edited, asmund.id), 0);
    expect("F4 Elises varsel er det samme", sql(`select id from notifications where message_id = '${edited}' and user_id = '${id("elise")}'`), eliseNotice);
    expect("F5 en redigering kan ikke legge til et passivt medlem", code(await edit(linn, edited, `${tok(id("elise"))} ${tok(oyvind.id)}`)), "mention_not_allowed");
    expect("F5 meldingen er urørt", mentioned(edited), sorted(id("elise"), id("miaminge")));
    expect("F5 ingen varsel ble laget", notices(edited, oyvind.id), 0);
    expect("F6 bare forfatteren kan redigere", code(await edit(elise, edited, tok(asmund.id))), "not_allowed");

    // ════ G. Deleting and moderating ═══════════════════════════════════
    expect("G1 forfatteren sletter meldingen", (await remove(linn, edited)).data, "author");
    expect("G1 nevningene er borte", mentioned(edited), "");
    expect("G1 varslene er borte", notices(edited), 0);
    const moderated = await post(elise, c1, `til ${tok(asmund.id)}`);
    expect("G2 før fjerning har Åsmund et varsel", notices(moderated, asmund.id), 1);
    expect("G2 administratoren fjerner meldingen", (await remove(mia, moderated)).data, "moderator");
    expect("G2 varselet er borte", notices(moderated), 0);

    // ════ H. Archived channel ══════════════════════════════════════════
    const beforeArchive = await post(linn, c1, "før arkivering");
    expect("H0 kanalen arkiveres", (await mia.rpc("set_community_channel_archived", { p_channel_id: c1, p_archived: true })).error?.message ?? "ok", "ok");
    expect("H1 ingen forslag i en arkivert kanal", await search(linn, c1, ""), "");
    expect("H1 ingen ny melding med nevning", (await send(linn, c1, tok(asmund.id))).code === "ok", false);
    expect("H1 ingen redigering som legger til en nevning", code(await edit(linn, beforeArchive, tok(asmund.id))), "archived");
    expect("H1 eksisterende nevninger står", mentioned(multi.id), sorted(asmund.id, frida.id, id("linn")));

    // ════ I. Private lokallag channel ══════════════════════════════════
    const trondelag = await localGroupId("FTR Trøndelag");
    const privateChannel = await createPrivate(petter, trondelag, "styret", [id("elironning")]);
    expect("I1 en invitert deltaker finnes før hun har skrevet", await search(petter, privateChannel, "eli"), "Eli Rønning");
    expect("I1 et uinvitert medlem av lokallaget finnes ikke", await search(petter, privateChannel, "kari"), "");
    const invitedMention = await send(petter, privateChannel, `velkommen ${tok(id("elironning"))}`);
    expect("I2 en invitert deltaker kan nevnes", invitedMention.code, "ok");
    expect("I2 og får et varsel", notices(invitedMention.id, id("elironning")), 1);
    expect("I2 et uinvitert lokallagsmedlem kan ikke nevnes", (await send(petter, privateChannel, tok(id("karimoen")))).code, "mention_not_allowed");
    expect("I3 en utenforstående kan ikke søke i kanalen", await search(kari, privateChannel, ""), "");
    const outsiderSend = await send(kari, privateChannel, tok(id("elironning")));
    expect("I3 og ikke nevne noen der", outsiderSend.code === "ok", false);
    expect("I4 deltakeren ser varselet", (await eli.from("notifications").select("id").eq("message_id", invitedMention.id)).data?.length, 1);
    const removed = await petter.rpc("remove_private_channel_participant", { p_channel_id: privateChannel, p_user_id: id("elironning") });
    expect("I4 deltakeren tas ut av kanalen", removed.data, true);
    expect("I4 varselet skjules når tilgangen er borte", (await eli.from("notifications").select("id").eq("message_id", invitedMention.id)).data?.length, 0);
    expect("I4 hun kan ikke lese meldingen", (await eli.from("messages").select("id").eq("id", invitedMention.id)).data?.length, 0);
    expect("I4 og finnes ikke lenger i søket", await search(petter, privateChannel, "eli"), "");
    expect("I4 og kan ikke nevnes på nytt", (await send(petter, privateChannel, tok(id("elironning")))).code, "mention_not_allowed");

    // ════ J. Group chat ════════════════════════════════════════════════
    const group = await createGroup(mia, "gruppe", [id("linn"), id("elise")]);
    expect("J1 et gruppemedlem finnes før hun har skrevet", await search(linn, group.channelId, "eli"), "Elise Damsgaard");
    expect("J1 et medlem utenfor gruppen finnes ikke", await search(linn, group.channelId, "kris"), "");
    const groupMention = await send(linn, group.channelId, `${tok(id("elise"))} se her`);
    expect("J2 et gruppemedlem kan nevnes", `${groupMention.code}|${notices(groupMention.id, id("elise"))}`, "ok|1");
    expect("J2 en utenfor gruppen kan ikke nevnes", (await send(linn, group.channelId, tok(id("kristoffer")))).code, "mention_not_allowed");
    expect("J3 en utenfor gruppen får ingen forslag", await search(kristoffer, group.channelId, ""), "");

    // ════ K. Lokallag main chat ════════════════════════════════════════
    await post(eli, TRONDELAG_CHAT, "hei fra Eli i Trøndelag");
    expect("K1 en som har skrevet i lokallagets chat finnes", (await search(petter, TRONDELAG_CHAT, "eli r")).includes("Eli Rønning"), true);
    expect("K1 et Oslo-medlem kan ikke nevnes i Trøndelag", (await send(petter, TRONDELAG_CHAT, tok(id("kristoffer")))).code, "mention_not_allowed");
    expect("K1 en som bare har skrevet i en kanal i fellesskapet finnes ikke", await search(petter, TRONDELAG_CHAT, "åsm"), "");
    const local = await send(petter, TRONDELAG_CHAT, `takk ${tok(id("elironning"))}`);
    expect("K2 nevning i lokallagets chat", `${local.code}|${notices(local.id, id("elironning"))}`, "ok|1");
    const localNotice = await eli.from("notifications").select("title, href").eq("message_id", local.id).single();
    expect("K2 tittelen nevner lokallaget", localNotice.data?.title, "Petter Aune nevnte deg i #FTR Trøndelag");
    expect("K2 et Oslo-medlem får ingen forslag i Trøndelag", await search(kristoffer, TRONDELAG_CHAT, ""), "");

    // ════ M. Profiles: identity and bio ═══════════════════════════════
    // Name and photo for people one shares a private channel or group with,
    // or whom a readable message mentions; the bio only under the existing
    // profile rules. Asked through the RPC the app uses, the table's own row
    // security, the photo bucket and the page itself.
    const identities = async (client: Client, community: string, userIds: string[]) => {
      const { data, error } = await client.rpc("community_identities", { p_community_id: community, p_user_ids: userIds });
      return error ? `feil:${error.code}` : (data ?? []).map((row) => row.display_name).sort().join(",");
    };
    const bioRows = async (client: Client, userId: string) =>
      (await client.from("community_profiles").select("bio").eq("community_id", FTR).eq("user_id", userId)).data?.length ?? 0;
    const shows = async (client: Client, channelId: string, userId: string, text: string, community = FTR) => {
      const result = await card(client, channelId, userId, community);
      return result.status === 200 && result.raw.includes(text);
    };

    sql(`update community_profiles set bio = 'Åsmund-bio-synlig' where user_id = '${asmund.id}' and community_id = '${FTR}'`);
    expect("M1 mottakeren av en nevning kan åpnes", await shows(linn, c1, asmund.id, "Åsmund Nytt-Navn"), true);
    expect("M1 og bioen hans følger de vanlige reglene (han har skrevet i kanalen)", await shows(linn, c1, asmund.id, "Åsmund-bio-synlig"), true);
    expect("M1 identiteten gis av RPC-en", await identities(linn, FTR, [asmund.id]), "Åsmund Nytt-Navn");
    expect("M1 kortet krever at personen hører til kanalen", (await card(linn, c2, asmund.id)).status, 404);

    const pal = await disposable("p1", "Pål Deltaker", FTR, "Pål-bio-hemmelig");
    const pia = await disposable("p2", "Pia Invitert", FTR, "Pia-bio-hemmelig");
    sql(`update memberships set local_group_id = '${trondelag}' where user_id in ('${pal.id}', '${pia.id}') and community_id = '${FTR}'`);
    const shared = await createPrivate(petter, trondelag, "profiler", [pal.id, pia.id]);
    expect("M2 delt privat kanal: navnet vises", await identities(pal.client, FTR, [pia.id]), "Pia Invitert");
    expect("M2 delt privat kanal: profilkortet viser navnet", await shows(pal.client, shared, pia.id, "Pia Invitert"), true);
    expect("M2 delt privat kanal: bioen vises ikke i kortet", await shows(pal.client, shared, pia.id, "Pia-bio-hemmelig"), false);
    expect("M2 delt privat kanal: bioen kan ikke leses fra tabellen", await bioRows(pal.client, pia.id), 0);
    expect("M2 kanalens leder ser henne også", await identities(petter, FTR, [pia.id]), "Pia Invitert");

    const gro = await disposable("g1", "Gro Gruppe", FTR, "Gro-bio-hemmelig");
    const geir = await disposable("g2", "Geir Gruppemedlem", FTR, "Geir-bio-hemmelig");
    const sharedGroup = await createGroup(mia, "profiler", [gro.id, geir.id]);
    const photoPath = `${FTR}/${geir.id}/${crypto.randomUUID()}.png`;
    await admin.storage.from("member-avatars").upload(photoPath, (await pngFixture("geir.png", 64, 64)).bytes, { contentType: "image/png" });
    sql(`update community_profiles set avatar_path = '${photoPath}' where user_id = '${geir.id}' and community_id = '${FTR}'`);
    expect("M3 delt gruppe: navnet vises", await identities(gro.client, FTR, [geir.id]), "Geir Gruppemedlem");
    expect("M3 delt gruppe: bioen vises ikke i kortet", `${await shows(gro.client, sharedGroup.channelId, geir.id, "Geir Gruppemedlem")}|${await shows(gro.client, sharedGroup.channelId, geir.id, "Geir-bio-hemmelig")}`, "true|false");
    expect("M3 delt gruppe: bioen kan ikke leses fra tabellen", await bioRows(gro.client, geir.id), 0);
    expect("M3 delt gruppe: profilbildet kan lastes", Boolean((await gro.client.storage.from("member-avatars").download(photoPath)).data), true);
    expect("M3 utenfor gruppen: profilbildet kan ikke lastes", Boolean((await linn.storage.from("member-avatars").download(photoPath)).data), false);
    expect("M3 utenfor gruppen: ingen identitet", await identities(linn, FTR, [geir.id]), "");

    expect("M4 et passivt medlem: ingen identitet", await identities(linn, FTR, [oyvind.id]), "");
    expect("M4 et passivt medlem: gjettet id gir ikke noe kort", (await card(linn, c1, oyvind.id)).status, 404);
    expect("M4 et passivt medlem: heller ikke i en kanal personen ikke hører til", (await card(asmund.client, c2, oyvind.id)).status, 404);
    expect("M4 et passivt medlem: ikke heller for kanalens administrator via nevnings-veien", sql(`select community_identity_admits('${id("miaminge")}', '${FTR}', '${oyvind.id}')`), "f");

    const unknown = crypto.randomUUID();
    expect("M5 en tilfeldig id gir ingenting", `${await identities(linn, FTR, [unknown])}|${(await card(linn, c1, unknown)).status}`, "|404");
    expect("M5 en uinvitert ser ikke deltakerne i en privat kanal", `${await identities(linn, FTR, [pia.id, pal.id])}|${(await card(linn, shared, pia.id)).status}`, "|404");
    expect("M5 ugyldig id i adressen gir ikke noe kort", (await card(pal.client, shared, "ikke-en-id")).status, 404);
    expect("M5 for mange id-er avvises ikke, men gir bare synlige", await identities(pal.client, FTR, [pia.id, ...Array.from({ length: 250 }, () => crypto.randomUUID())]), "Pia Invitert");

    expect("M6 et medlem av et annet fellesskap får ingenting", `${await identities(tuOnly.client, FTR, [asmund.id, pia.id])}|${(await card(tuOnly.client, c1, asmund.id)).status}`, "|404");
    expect("M6 FTR-identitet kan ikke leses under TU", await identities(pal.client, TU, [pia.id]), "");
    expect("M6 en FTR-kanal kan ikke åpnes under TU-adressen", (await card(linn, c1, asmund.id, TU)).status, 404);

    expect("M7 tatt ut av den private kanalen", (await petter.rpc("remove_private_channel_participant", { p_channel_id: shared, p_user_id: pal.id })).data, true);
    expect("M7 … ser ikke lenger de andre", `${await identities(pal.client, FTR, [pia.id])}|${(await card(pal.client, shared, pia.id)).status}`, "|404");
    expect("M7 … og blir heller ikke sett", await identities(pia.client, FTR, [pal.id]), "");
    sql(`delete from community_subgroup_members where subgroup_id = '${sharedGroup.id}' and user_id = '${geir.id}'`);
    expect("M7 tatt ut av gruppen: ikke lenger synlig for gruppen", `${await identities(gro.client, FTR, [geir.id])}|${Boolean((await gro.client.storage.from("member-avatars").download(photoPath)).data)}`, "|false");
    sql(`insert into community_subgroup_members (subgroup_id, community_id, user_id) values ('${sharedGroup.id}', '${FTR}', '${geir.id}')`);
    expect("M7 tilbake i gruppen: synlig igjen", await identities(gro.client, FTR, [geir.id]), "Geir Gruppemedlem");
    sql(`delete from memberships where user_id = '${gro.id}' and community_id = '${FTR}'`);
    expect("M7 medlemskapet trukket tilbake: ser ingen", `${await identities(gro.client, FTR, [geir.id])}|${(await card(gro.client, sharedGroup.channelId, geir.id)).status}`, "|404");

    const anonCard = await card(null, c1, asmund.id);
    expect("M8 anonym: ikke noe kort", `${anonCard.status}|${anonCard.raw.includes("Åsmund")}`, "404|false");
    expect("M8 anonym: kortfunksjonen nektes", (await anon.rpc("channel_person_card", { p_channel_id: c1, p_user_id: asmund.id })).error?.code, "42501");
    expect("M8 anonym: RPC-en nektes", (await anon.rpc("community_identities", { p_community_id: FTR, p_user_ids: [asmund.id] })).error?.code, "42501");
    expect("M8 anonym: profilbildet kan ikke lastes", Boolean((await anon.storage.from("member-avatars").download(photoPath)).data), false);
    expect("M9 identitetsregelen kan ikke kalles direkte", (await loose(linn).rpc("community_identity_admits", { p_viewer: id("linn"), p_community_id: FTR, p_user_id: oyvind.id })).error?.code, "42501");
    const piaCard = await card(petter, shared, pia.id);
    expect("M9 kortet viser navnet", piaCard.json?.name, "Pia Invitert");
    expect("M9 kortet har bare navn, bilde, fellesskap, bio og meldingsvalg", Object.keys(JSON.parse(piaCard.raw)).sort().join(","), "avatarUrl,bio,communityName,dm,id,initials,name");
    expect("M9 ingen e-post i kortet", piaCard.raw.includes("@"), false);

    // ════ N. «Send melding» in the card: Under The Rug only ════════════
    expect("N1 FTR: kortet tilbyr aldri melding", (await card(linn, c1, asmund.id)).json?.dm, null);
    await post(kari, c2, "hei fra Kari i kanal 2");
    expect("N1 FTR: stab til stab kan ellers sende DM", (await mia.rpc("can_send_dm", { cid: FTR, recipient: id("karimoen") })).data, true);
    expect("N1 FTR: men kortet tilbyr det likevel ikke", (await card(mia, c2, id("karimoen"))).json?.dm, null);
    const tuChannel = await createChannelIn(emma, TU, "tu");
    await post(emma, tuChannel, "hei fra Emma");
    const hanne = await signIn("hanne");
    await post(hanne, tuChannel, "hei fra Hanne");
    expect("N2 TU: stab til stab kan ellers sende DM", (await emma.rpc("can_send_dm", { cid: TU, recipient: id("hanne") })).data, true);
    expect("N2 TU: kortet tilbyr det ikke", `${(await card(emma, tuChannel, id("hanne"), TU)).json?.name}|${(await card(emma, tuChannel, id("hanne"), TU)).json?.dm}`, "Hanne Nordbø|null");

    const [octavio, jonas, oskar] = await Promise.all(["octavio", "jonas", "oskar"].map(signIn));
    const utrChannel = await createChannelIn(octavio, UTR, "utr");
    await post(jonas, utrChannel, "hei fra Jonas");
    await post(oskar, utrChannel, "hei fra Oskar");
    const pairSql = `community_id = '${UTR}' and ((participant_one_id = '${id("jonas")}' and participant_two_id = '${id("oskar")}') or (participant_one_id = '${id("oskar")}' and participant_two_id = '${id("jonas")}'))`;
    const existingDm = sql(`select coalesce(id::text, '') from direct_conversations where ${pairSql}`);
    const utrCard = await card(jonas, utrChannel, id("oskar"), UTR);
    expect("N3 UTR: kortet tilbyr «Send melding»", Boolean(utrCard.json?.dm), true);
    expect("N3 UTR: med samtalen som finnes, ellers ingen", utrCard.json?.dm?.conversationId ?? "", existingDm);
    expect("N3 UTR: ikke til seg selv", (await card(jonas, utrChannel, id("jonas"), UTR)).json?.dm, null);
    const started = await jonas.rpc("start_direct_conversation", { p_community_id: UTR, p_recipient_id: id("oskar") });
    if (!existingDm && started.data) createdDms.add(started.data as string);
    expect("N4 UTR: samtalen åpnes eller opprettes med den vanlige funksjonen", Boolean(started.data), true);
    expect("N4 UTR: kortet peker deretter på den samme samtalen", (await card(jonas, utrChannel, id("oskar"), UTR)).json?.dm?.conversationId, started.data);
    expect("N5 UTR: en som ikke kan lese kanalen får ikke noe kort", (await card(linn, utrChannel, id("oskar"), UTR)).status, 404);
    sql(`update memberships set status = 'invited' where user_id = '${id("oskar")}' and community_id = '${UTR}'`);
    try {
      expect("N5 UTR: et inaktivt medlem gir ikke noe kort", (await card(jonas, utrChannel, id("oskar"), UTR)).status, 404);
      expect("N5 UTR: og kan ikke få melding", Boolean((await jonas.rpc("can_send_dm", { cid: UTR, recipient: id("oskar") })).data), false);
    } finally {
      sql(`update memberships set status = 'active' where user_id = '${id("oskar")}' and community_id = '${UTR}'`);
    }

    // ════ L. The composer's text ═══════════════════════════════════════
    const picked = [{ userId: asmund.id, name: "Åsmund Nevnesen" }, { userId: id("elise"), name: "Elise" }];
    expect("L1 valgte navn blir nevninger", draftToStored("@Åsmund Nevnesen og @Elise!", picked), `${tok(asmund.id)} og ${tok(id("elise"))}!`);
    expect("L1 skrevne navn som ikke er valgt, forblir tekst", draftToStored("@Mia og @Elisabeth", picked), "@Mia og @Elisabeth");
    expect("L1 e-postadresser er ikke nevninger", draftToStored("elise@Elise.no", picked), "elise@Elise.no");
    expect("L2 lagret tekst tilbake til utkast", mentionsToDraft(`hei ${tok(asmund.id)}`, (u) => (u === asmund.id ? "Åsmund" : undefined)).text, "hei @Åsmund");
    expect("L2 ukjente beholder nevningen", mentionsToDraft(`hei ${tok(oyvind.id)}`, () => undefined).text, `hei ${tok(oyvind.id)}`);
    expect("L3 ids leses ut", mentionIds(`${tok(asmund.id)} ${tok(asmund.id)} ${tok(oyvind.id)}`).join(","), `${asmund.id},${oyvind.id}`);
  } finally {
    await cleanup();
  }

  console.log(failures === 0 ? `✓ ${checks} kontroller av nevninger passerte` : `\n${failures} av ${checks} kontroller feilet`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
