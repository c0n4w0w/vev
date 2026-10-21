/**
 * Checks reactions everywhere (20261108100000_reactions_everywhere) under real
 * authenticated sessions: feed posts, community channels, lokallag chats,
 * private lokallag channels, group chats and direct messages.
 *
 * What must hold:
 *
 *   counts       every reader sees how many reacted with each emoji; the
 *                stored counts never carry an account id.
 *   your own     a reader can tell which reactions are theirs, and the
 *                reaction tables give them their own rows and nothing else.
 *   who reacted  reaction_authors() names people only to those allowed: in
 *                FTR/TU community channels and community-wide posts the
 *                admins and moderators (or everyone, once an admin chooses
 *                that, for old reactions too); in UTR everyone who reads; in
 *                lokallag chats, private channels and groups whoever reads
 *                now; in a DM its two participants. Anyone else gets a count,
 *                and anything they cannot read gets nothing at all.
 *   writing      only set_reaction(), only for oneself, only where one may
 *                read (and write) now; idempotent, one per person per emoji,
 *                custom emojis only from the parent's own community; nothing
 *                on deleted, moderated, expired or archived messages; the
 *                reactions go with their message.
 *
 * Exercised the way an attacker would reach it: RPCs and direct table
 * requests with anon-key clients signed in as fixture and disposable
 * accounts, plus the channel page over HTTP (the dev server must be running)
 * to see what server-rendered data carries. The service role sets up and
 * cleans up.
 *
 * Run with `npm run check:reactions` against the local stack, with the app on
 * http://localhost:3000 (or CHECK_APP_URL). Creates only disposable accounts
 * (check-reak-…@example.test), a lokallag, channels, a group and posts marked
 * "CHECK reak", and removes them afterwards — also after an interrupted run.
 * Restores FTR's and UTR's reaction setting to what it was.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { canonicalEmoji } from "@/lib/emoji/canonical";
import { emojiCatalog, knownEmoji } from "@/lib/emoji/catalog";
import { searchEmojiEntries } from "@/lib/emoji/search";
import { EMOJI_GROUPS, QUICK_REACTIONS } from "@/lib/emoji/types";
import { isLocale, resolveLocale, t, type Locale } from "@/lib/i18n";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const TAG = "CHECK reak";
const EMAIL = "check-reak-";
const N = null as unknown as string;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

type Person = { id: string; name: string; client: Client };

/** A disposable active member with this display name, signed in. */
async function disposable(key: string, name: string, community: string, localGroupId?: string): Promise<Person> {
  const email = `${EMAIL}${key}-${crypto.randomUUID().slice(0, 6)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name, handle: `check-reak-${key}-${crypto.randomUUID().slice(0, 4)}` },
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

type Kind = "message" | "direct" | "post";
type View = { emoji: string | null; emojiId: string | null; name: string | null; count: number; mine: boolean }[];
type Authors = { visible: boolean; total: number; mine: boolean; people?: { name: string; me: boolean }[]; unnamed?: number } | null;

function code(error: { message?: string } | null): string {
  if (!error) return "ok";
  const match = /reaction_error:([a-z_]+)/.exec(error.message ?? "");
  return match ? match[1] : (error.message ?? "error");
}

async function react(client: Client, kind: Kind, target: string, choice: { emoji?: string; emojiId?: string }, on = true) {
  const { data, error } = await client.rpc("set_reaction", {
    p_kind: kind,
    p_target_id: target,
    p_emoji: choice.emoji ?? N,
    p_emoji_id: choice.emojiId ?? N,
    p_on: on,
  });
  return { code: code(error), view: (data as View | null) ?? [] };
}

async function authors(client: Client, kind: Kind, target: string, choice: { emoji?: string; emojiId?: string }): Promise<Authors> {
  const { data, error } = await client.rpc("reaction_authors", {
    p_kind: kind,
    p_target_id: target,
    p_emoji: choice.emoji ?? N,
    p_emoji_id: choice.emojiId ?? N,
  });
  if (error) return { visible: false, total: -1, mine: false, people: [{ name: `feil:${error.message}`, me: false }] };
  return data as Authors;
}

const names = (result: Authors) =>
  result === null ? "null" : result.visible ? (result.people ?? []).map((person) => (person.me ? `(${person.name})` : person.name)).sort().join(",") : `skjult:${result.total}`;
/** The names `names()` should print: sorted, the caller's own in brackets. */
const nameList = (...people: string[]) => people.sort().join(",");
const counts = (view: View) => view.map((entry) => `${entry.emoji ?? `:${entry.name}:`}${entry.count}${entry.mine ? "*" : ""}`).join(" ");
const storedCounts = (table: "messages" | "direct_messages" | "posts", id: string) =>
  sql(`select reactions::text from ${table} where id = '${id}'`);
const rowCount = (table: string, column: string, id: string) => Number(sql(`select count(*) from ${table} where ${column} = '${id}'`));

async function send(client: Client, channelId: string, body: string): Promise<string> {
  const { data, error } = await client.from("messages").insert({ channel_id: channelId, body: `${TAG} ${body}` }).select("id").single();
  if (error || !data) throw new Error(`kunne ikke skrive i ${channelId}: ${error?.message}`);
  return data.id;
}

async function sendDirect(client: Client, conversationId: string, body: string): Promise<string> {
  const { data, error } = await client.from("direct_messages").insert({ conversation_id: conversationId, body: `${TAG} ${body}` }).select("id").single();
  if (error || !data) throw new Error(`kunne ikke sende direktemelding: ${error?.message}`);
  return data.id;
}

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

// ── Cleanup ─────────────────────────────────────────────────────────────

const settingsBefore = new Map<string, string>();

async function cleanup() {
  for (const [community, value] of settingsBefore) {
    sql(`update communities set reaction_author_visibility = '${value}' where id = '${community}'`);
  }
  sql(`delete from posts where body like '${TAG}%'`);
  const conversations = sql(
    `select coalesce(string_agg(quote_literal(dc.id::text), ','), '') from direct_conversations dc
      join auth.users u on u.id in (dc.participant_one_id, dc.participant_two_id) where u.email like '${EMAIL}%@example.test'`,
  );
  if (conversations) {
    sql(`delete from notifications where kind = 'direct_message' and href like any (array(select '%' || id::text from direct_conversations where id::text in (${conversations})))`);
    sql(`delete from direct_conversations where id::text in (${conversations})`);
  }
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
  sql(`delete from channel_retired_ids where id like '%check-reak%'`);
  sql(`delete from community_emojis where name like 'check-reak%'`);

  const users = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where email like '${EMAIL}%@example.test'`);
  for (const userId of users ? users.split(",") : []) await admin.auth.admin.deleteUser(userId);
  if (localGroups) {
    sql(`delete from community_local_group_managers where local_group_id::text in (${localGroups})`);
    sql(`delete from community_local_groups where id::text in (${localGroups})`);
  }
}

// ── The checks ──────────────────────────────────────────────────────────

async function main() {
  for (const row of sql(`select id || '=' || reaction_author_visibility from communities where id in ('${FTR}', '${UTR}', '${TU}')`).split("\n")) {
    const [community, value] = row.split("=");
    settingsBefore.set(community, value);
  }
  await cleanup();
  const reachable = await fetch(`${APP}/login`, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!reachable) {
    console.error(`\n✗ Appen svarer ikke på ${APP}. Start den med \`npm run dev\` (eller sett CHECK_APP_URL).`);
    process.exit(1);
  }

  const [mia, kari, emma, octavio] = await Promise.all(["miaminge", "karimoen", "emmamortensen", "octavio"].map(signIn));
  const loose = (client: Client) => client as unknown as Loose;
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    for (const table of ["message_reactions", "direct_message_reactions"]) {
      expect(`A1 ${table} har radsikkerhet`, sql(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`), "t");
      expect(
        `A1 ${table}: medlemmer får bare lese`,
        sql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where table_name = '${table}' and grantee = 'authenticated'`),
        "SELECT",
      );
      expect(`A1 ${table}: anonyme får ingenting`, sql(`select count(*) from information_schema.role_table_grants where table_name = '${table}' and grantee = 'anon'`), 0);
    }
    for (const fn of ["set_reaction(text, uuid, text, uuid, boolean)", "reaction_authors(text, uuid, text, uuid)", "channel_reaction_authors_visible(text)", "set_community_reaction_visibility(text, text)"]) {
      expect(`A2 innloggede kan kalle ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "t");
      expect(`A2 anonyme kan ikke kalle ${fn}`, sql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
    }
    for (const fn of ["reaction_authors_admit(uuid, text, uuid)", "reaction_target_readable(uuid, text, uuid)", "reaction_view(uuid, text, uuid)", "reaction_rows(text, uuid, text, uuid)", "message_reaction_counts(uuid)"]) {
      expect(`A2 ingen API-rolle kan kalle ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') or has_function_privilege('service_role', 'public.${fn}', 'execute')`), "f");
    }
    expect("A3 standard: FTR og TU bare ansvarlige, UTR alle", `${settingsBefore.get(FTR)}/${settingsBefore.get(TU)}/${settingsBefore.get(UTR)}`, "moderators/moderators/channel");
    expect(
      "A4 ingen lagrede antall bærer en konto-id",
      sql(`select count(*) from (select reactions::text r from messages union all select reactions::text from direct_messages union all select reactions::text from posts) x where r ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' and r !~ '"emojiId": "'`),
      0,
    );
    expect(
      "A4 de gamle reaksjonene i chatten ble rader, med samme antall",
      sql(`select count(*) from messages m where m.reactions is distinct from message_reaction_counts(m.id) and m.deleted_at is null`),
      0,
    );

    // ════ B. Emoji library ═════════════════════════════════════════════
    const nb = emojiCatalog("nb");
    const en = emojiCatalog("en");
    expect("B1 hele Unicode-listen (over 1800)", nb.entries.length > 1800 && en.entries.length === nb.entries.length, true);
    expect("B1 bare kjente kategorier, ingen komponenter", [...new Set(nb.entries.map((entry) => entry[1]))].every((group) => EMOJI_GROUPS.some((g) => g.id === group)), true);
    const segmenter = new Intl.Segmenter("nb", { granularity: "grapheme" });
    expect("B2 hver emoji er ett tegn på skjermen", nb.entries.filter((entry) => [...segmenter.segment(entry[0])].length !== 1).map((e) => e[0]).join(""), "");
    expect("B2 hver emoji står i kanonisk form", nb.entries.filter((entry) => canonicalEmoji(entry[0]) !== entry[0]).length, 0);
    expect("B2 ingen emoji to ganger", new Set(nb.entries.map((entry) => entry[0])).size, nb.entries.length);
    expect("B3 hurtigreaksjonene finnes i listen", QUICK_REACTIONS.every((emoji) => nb.entries.some((entry) => entry[0] === emoji)), true);
    expect("B4 søk «tommel opp» gir 👍 først", searchEmojiEntries(nb.entries, "tommel opp")[0]?.[0], "👍");
    expect("B4 søk på engelsk i norsk liste: «thumbs»", searchEmojiEntries(nb.entries, "thumbs").some((entry) => entry[0] === "👍"), true);
    expect("B4 søk «hjerte» finner ❤️", searchEmojiEntries(nb.entries, "hjerte").some((entry) => entry[0] === "❤️"), true);
    expect("B4 søk «fire» finner 🔥", searchEmojiEntries(en.entries, "fire").some((entry) => entry[0] === "🔥"), true);
    expect("B4 søk uten treff", searchEmojiEntries(nb.entries, "xqzvw").length, 0);
    expect("B4 søk på emojien selv", searchEmojiEntries(nb.entries, "🎉")[0]?.[0], "🎉");
    expect("B5 👍️ og 👍 er samme reaksjon", knownEmoji("👍️"), "👍");
    expect("B5 ❤ uten variasjonsvelger blir ❤️", knownEmoji("❤"), "❤️");
    expect("B5 hudtone godtas", knownEmoji("👋🏽"), "👋🏽");
    expect("B5 flagg og ZWJ-sekvenser godtas", `${knownEmoji("🇳🇴")}${knownEmoji("🏳️‍🌈")}${knownEmoji("❤️‍🔥")}`, "🇳🇴🏳️‍🌈❤️‍🔥");
    expect("B5 tekst er ikke en emoji", `${knownEmoji("abc")}|${knownEmoji("<b>")}|${knownEmoji("👍 👍")}|${knownEmoji("")}`, "undefined|undefined|undefined|undefined");
    const route = await fetch(`${APP}/emoji-catalog/nb`);
    expect("B6 listen hentes uten innlogging", route.status, 200);
    expect("B6 og sier ingenting om noe fellesskap", JSON.stringify(await route.json()).includes("harmreduction"), false);

    // ════ Setup ════════════════════════════════════════════════════════
    const { data: localGroup, error: localGroupError } = await mia.rpc("create_local_group", { p_community_id: FTR, p_name: `${TAG} lag` });
    if (localGroupError || !localGroup) throw new Error(`kunne ikke opprette lokallag: ${localGroupError?.message}`);
    const lokallagChat = sql(`select id from channels where local_group_id = '${localGroup}' and not is_private`);

    const ane = await disposable("ane", "Ane Reaksjon", FTR, localGroup);
    const bo = await disposable("bo", "Bo Reaksjon", FTR, localGroup);
    const cato = await disposable("cato", "Cato Reaksjon", FTR);
    const dina = await disposable("dina", "Dina Reaksjon", FTR);
    const ulf = await disposable("ulf", "Ulf Reaksjon", UTR);
    const vera = await disposable("vera", "Vera Reaksjon", UTR);
    const wenche = await disposable("wenche", "Wenche Reaksjon", UTR);
    const tuva = await disposable("tuva", "Tuva Reaksjon", TU);

    const ftrChannel = await createChannel(mia, FTR, "offentlig");
    const announce = await createChannel(mia, FTR, "kunngjøring", true);
    const utrChannel = await createChannel(octavio, UTR, "offentlig");
    const tuChannel = await createChannel(emma, TU, "offentlig");
    const { data: privateChannel } = await mia.rpc("create_private_channel", {
      p_local_group_id: localGroup,
      p_name: `${TAG} privat`,
      p_purpose: "",
      p_participant_ids: [ane.id],
    });
    const { data: groupId } = await mia.rpc("create_subgroup", {
      p_community_id: FTR,
      p_name: `${TAG} gruppe`,
      p_description: "",
      p_member_ids: [ane.id, cato.id],
    });
    const groupChat = sql(`select id from channels where subgroup_id = '${groupId}'`);
    const moderatorsRead = sql(`select moderators_read from community_subgroups where id = '${groupId}'`) === "t";

    const ftrMessage = await send(mia, ftrChannel, "melding i en åpen kanal");
    const announcement = await send(mia, announce, "kunngjøring");
    const utrMessage = await send(octavio, utrChannel, "melding i UTR");
    const tuMessage = await send(emma, tuChannel, "melding i TU");
    const lokallagMessage = await send(ane.client, lokallagChat, "melding i lokallaget");
    const privateMessage = await send(ane.client, privateChannel!, "melding i den private kanalen");
    const groupMessage = await send(ane.client, groupChat, "melding i gruppa");

    // ════ C. Adding, removing, toggling ════════════════════════════════
    let result = await react(dina.client, "message", ftrMessage, { emoji: "👍" });
    expect("C1 et medlem kan reagere", result.code, "ok");
    expect("C1 svaret er antallet, med ditt merket", counts(result.view), "👍1*");
    expect("C1 lagret antall uten konto-id", UUID_RE.test(storedCounts("messages", ftrMessage)), false);
    result = await react(dina.client, "message", ftrMessage, { emoji: "👍" });
    expect("C2 samme reaksjon igjen endrer ingenting", counts(result.view), "👍1*");
    result = await react(dina.client, "message", ftrMessage, { emoji: "🔥" });
    expect("C3 flere ulike emojier på samme melding", counts(result.view), "👍1* 🔥1*");
    result = await react(dina.client, "message", ftrMessage, { emoji: "👍" }, false);
    expect("C4 trekke tilbake", counts(result.view), "🔥1*");
    result = await react(dina.client, "message", ftrMessage, { emoji: "👍" }, false);
    expect("C4 trekke tilbake to ganger er det samme", counts(result.view), "🔥1*");
    await react(dina.client, "message", ftrMessage, { emoji: "🔥" }, false);
    expect("C4 tomt igjen", storedCounts("messages", ftrMessage), "[]");

    const burst = await Promise.all(Array.from({ length: 8 }, () => react(dina.client, "message", ftrMessage, { emoji: "🎉" })));
    expect("C5 åtte samtidige like forespørsler gir én reaksjon", burst.every((r) => r.code === "ok") && rowCount("message_reactions", "message_id", ftrMessage), 1);
    await Promise.all([ane.client, bo.client, cato.client, kari].map((client) => react(client, "message", ftrMessage, { emoji: "🎉" })));
    expect("C6 samtidige reaksjoner fra fem personer telles alle", sql(`select reactions->0->>'count' from messages where id = '${ftrMessage}'`), 5);
    expect("C6 lagret antall stemmer med radene", sql(`select reactions = message_reaction_counts(id) from messages where id = '${ftrMessage}'`), "t");
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => react(dina.client, "message", ftrMessage, { emoji: "😂" }, i % 2 === 0)),
    );
    expect("C7 kryssende legg til/fjern ender i samsvar med radene", sql(`select reactions = message_reaction_counts(id) from messages where id = '${ftrMessage}'`), "t");
    await react(dina.client, "message", ftrMessage, { emoji: "😂" }, false);

    expect("C8 lest-kun-kanal: medlemmer kan reagere på kunngjøringer", (await react(dina.client, "message", announcement, { emoji: "👏" })).code, "ok");
    expect("C9 ikke en emoji avvises", (await react(dina.client, "message", ftrMessage, { emoji: "abc" })).code, "invalid");
    expect("C9 markup avvises", (await react(dina.client, "message", ftrMessage, { emoji: "<b>" })).code, "invalid");
    expect("C9 begge eller ingen avvises", (await react(dina.client, "message", ftrMessage, { emoji: "👍", emojiId: crypto.randomUUID() })).code, "invalid");
    const twentyOne = emojiCatalog("nb").entries.slice(0, 21).map((entry) => entry[0]);
    for (const emoji of twentyOne.slice(0, 20)) await react(dina.client, "message", announcement, { emoji });
    expect("C10 høyst 20 ulike reaksjoner per person per melding", (await react(dina.client, "message", announcement, { emoji: twentyOne[20] })).code, "too_many");
    expect("C10 og de 20 står", sql(`select count(*) from message_reactions where message_id = '${announcement}' and user_id = '${dina.id}'`), 20);
    sql(`delete from message_reactions where message_id = '${announcement}' and user_id = '${dina.id}'`);

    // ════ D. No other way in ═══════════════════════════════════════════
    const direct = await loose(dina.client).from("message_reactions").insert({ message_id: ftrMessage, user_id: dina.id, emoji: "👍" });
    expect("D1 direkte innsetting i message_reactions avvises", Boolean(direct.error), true);
    const forged = await loose(dina.client).from("message_reactions").insert({ message_id: ftrMessage, user_id: ane.id, emoji: "👍" });
    expect("D1 en reaksjon i en annens navn avvises", Boolean(forged.error), true);
    await loose(dina.client).from("message_reactions").delete().eq("message_id", ftrMessage);
    await loose(dina.client).from("message_reactions").update({ emoji: "💩" }).eq("message_id", ftrMessage);
    expect("D2 ingen kan slette eller endre andres reaksjoner direkte", sql(`select reactions->0->>'count' || (reactions->0->>'emoji') from messages where id = '${ftrMessage}'`), "5🎉");
    await react(dina.client, "message", ftrMessage, { emoji: "🎉" }, false);
    expect("D3 å trekke tilbake tar bare ens egen", sql(`select reactions->0->>'count' from messages where id = '${ftrMessage}'`), 4);
    await react(dina.client, "message", ftrMessage, { emoji: "🎉" });
    const ownRows = await dina.client.from("message_reactions").select("user_id, message_id");
    expect("D4 tabellen gir bare egne rader", (ownRows.data ?? []).every((row) => row.user_id === dina.id) && (ownRows.data ?? []).length >= 1, true);
    const kariRows = await kari.from("message_reactions").select("user_id").eq("message_id", ftrMessage);
    expect("D4 også for moderatorer", (kariRows.data ?? []).map((row) => row.user_id).join(","), await profileId("karimoen"));
    expect("D5 anonym når ingenting", (await anon.rpc("reaction_authors", { p_kind: "message", p_target_id: ftrMessage, p_emoji: "🎉", p_emoji_id: N })).error !== null, true);
    expect("D5 anonym kan ikke reagere", (await anon.rpc("set_reaction", { p_kind: "message", p_target_id: ftrMessage, p_emoji: "🎉", p_emoji_id: N, p_on: true })).error !== null, true);

    // ════ E. FTR community channel: names for admins and moderators ════
    expect("E1 medlem ser antall, ikke navn", names(await authors(dina.client, "message", ftrMessage, { emoji: "🎉" })), "skjult:5");
    const hidden = await authors(dina.client, "message", ftrMessage, { emoji: "🎉" });
    expect("E1 medlem får vite at en av dem er hennes", hidden?.mine, true);
    expect("E1 og svaret har ingen navn eller id-er", JSON.stringify(hidden).includes("Reaksjon") || UUID_RE.test(JSON.stringify(hidden)), false);
    const reactors = ["Ane Reaksjon", "Bo Reaksjon", "Cato Reaksjon"];
    expect("E2 moderator ser hvem", names(await authors(kari, "message", ftrMessage, { emoji: "🎉" })), nameList("(Kari Moen)", ...reactors, "Dina Reaksjon"));
    expect("E2 administrator ser hvem", names(await authors(mia, "message", ftrMessage, { emoji: "🎉" })), nameList("Kari Moen", ...reactors, "Dina Reaksjon"));
    expect("E3 kanalflagget for medlem", (await dina.client.rpc("channel_reaction_authors_visible", { p_channel_id: ftrChannel })).data, false);
    expect("E3 kanalflagget for moderator", (await kari.rpc("channel_reaction_authors_visible", { p_channel_id: ftrChannel })).data, true);
    expect("E4 TU-administrator når ingenting i FTR", names(await authors(emma, "message", ftrMessage, { emoji: "🎉" })), "null");
    expect("E4 TU-administrator kan ikke reagere i FTR", (await react(emma, "message", ftrMessage, { emoji: "🎉" })).code, "not_found");

    // Server-rendered data: the member's page carries counts, not people.
    const memberPage = await page(dina.client, `/community/${FTR}/channel/${encodeURIComponent(ftrChannel)}`);
    expect("E5 kanalsiden lastes", memberPage.status, 200);
    expect("E5 siden har ikke navnene på dem som reagerte uten å skrive", ["Bo Reaksjon", "Cato Reaksjon"].some((name) => memberPage.html.includes(name)), false);
    expect("E5 siden har ikke kontoene deres", [bo.id, cato.id].some((id) => memberPage.html.includes(id)), false);

    // ════ F. The administrator's setting ═══════════════════════════════
    expect("F1 moderator kan ikke endre innstillingen", (await kari.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "channel" })).data, null);
    expect("F1 medlem kan ikke", (await dina.client.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "channel" })).data, null);
    expect("F1 TU-administrator kan ikke endre FTR", (await emma.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "channel" })).data, null);
    expect("F1 ukjent verdi avvises", (await mia.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "everyone" })).data, null);
    expect("F1 direkte endring av communities avvises", (await loose(mia).from("communities").update({ reaction_author_visibility: "channel" }).eq("id", FTR).select("id")).data?.length ?? 0, 0);
    expect("F2 administratoren kan endre den", (await mia.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "channel" })).data, "channel");
    expect("F2 og da ser medlemmer navnene, også for gamle reaksjoner", names(await authors(dina.client, "message", ftrMessage, { emoji: "🎉" })), nameList("Kari Moen", ...reactors, "(Dina Reaksjon)"));
    expect("F2 kanalflagget følger med", (await dina.client.rpc("channel_reaction_authors_visible", { p_channel_id: ftrChannel })).data, true);
    expect("F3 men gir ikke tilgang til noe medlemmet ikke kan lese", names(await authors(cato.client, "message", lokallagMessage, { emoji: "👍" })), "null");
    // The page speaks each viewer's own language: their account's choice,
    // else the community's. Read, never changed.
    const localeOrNull = (value: string): Locale | null => (isLocale(value) ? value : null);
    const pageLocale = (handle: string): Locale =>
      resolveLocale({
        user: localeOrNull(sql(`select coalesce(preferred_locale, '') from profiles where handle = '${handle}'`)),
        community: localeOrNull(sql(`select coalesce(default_locale, '') from communities where id = '${FTR}'`)),
      });
    const reactionsQuestion = (handle: string) => t(pageLocale(handle), "settings.reactions.question");
    const adminSettings = await page(mia, `/community/${FTR}/settings`);
    expect("F4 administratoren ser «Reaksjoner» i innstillingene", adminSettings.html.includes(reactionsQuestion("miaminge")), true);
    const modSettings = await page(kari, `/community/${FTR}/settings`);
    expect(
      "F4 moderatoren ser den ikke",
      modSettings.html.includes(reactionsQuestion("karimoen")) || modSettings.html.includes(reactionsQuestion("miaminge")),
      false,
    );
    expect("F5 tilbake til bare ansvarlige", (await mia.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "moderators" })).data, "moderators");
    expect("F5 og navnene er skjult igjen", names(await authors(dina.client, "message", ftrMessage, { emoji: "🎉" })), "skjult:5");

    // ════ G. UTR community channel: everyone with access ═══════════════
    await react(ulf.client, "message", utrMessage, { emoji: "🔥" });
    expect("G1 UTR-medlem ser hvem", names(await authors(vera.client, "message", utrMessage, { emoji: "🔥" })), "Ulf Reaksjon");
    expect("G1 FTR-medlem når ingenting i UTR", names(await authors(dina.client, "message", utrMessage, { emoji: "🔥" })), "null");

    // ════ H. Lokallag main chat ════════════════════════════════════════
    await react(ane.client, "message", lokallagMessage, { emoji: "👍" });
    await react(bo.client, "message", lokallagMessage, { emoji: "👍" });
    expect("H1 lokallagsmedlem ser hvem (også i FTR)", names(await authors(bo.client, "message", lokallagMessage, { emoji: "👍" })), nameList("(Bo Reaksjon)", "Ane Reaksjon"));
    expect("H1 administratoren, som leser alle lokallag", names(await authors(mia, "message", lokallagMessage, { emoji: "👍" })), "Ane Reaksjon,Bo Reaksjon");
    expect("H2 medlem utenfor lokallaget når ingenting", names(await authors(cato.client, "message", lokallagMessage, { emoji: "👍" })), "null");
    expect("H2 og kan ikke reagere", (await react(cato.client, "message", lokallagMessage, { emoji: "👍" })).code, "not_found");
    expect("H2 moderator i et annet lokallag når ingenting", names(await authors(kari, "message", lokallagMessage, { emoji: "👍" })), "null");

    // ════ I. Private lokallag channel ══════════════════════════════════
    await react(ane.client, "message", privateMessage!, { emoji: "🙏" });
    expect("I1 invitert deltaker ser hvem", names(await authors(ane.client, "message", privateMessage!, { emoji: "🙏" })), "(Ane Reaksjon)");
    expect("I2 lokallagsmedlem som ikke er invitert, når ingenting", names(await authors(bo.client, "message", privateMessage!, { emoji: "🙏" })), "null");
    expect("I2 og kan ikke reagere", (await react(bo.client, "message", privateMessage!, { emoji: "🙏" })).code, "not_found");
    expect("I2 moderator utenfor kanalen når ingenting", names(await authors(kari, "message", privateMessage!, { emoji: "🙏" })), "null");

    // ════ J. Group chat ════════════════════════════════════════════════
    await react(cato.client, "message", groupMessage, { emoji: "🎉" });
    expect("J1 gruppemedlem ser hvem", names(await authors(ane.client, "message", groupMessage, { emoji: "🎉" })), "Cato Reaksjon");
    expect("J2 utenfor gruppa: ingenting", names(await authors(dina.client, "message", groupMessage, { emoji: "🎉" })), "null");
    expect(
      "J2 moderatorer får ikke mer enn gruppa gir dem",
      names(await authors(kari, "message", groupMessage, { emoji: "🎉" })),
      moderatorsRead ? "Cato Reaksjon" : "null",
    );

    // ════ K. Direct messages ═══════════════════════════════════════════
    const { data: conversation, error: conversationError } = await ulf.client.rpc("start_direct_conversation", { p_community_id: UTR, p_recipient_id: vera.id });
    if (conversationError || !conversation) throw new Error(`kunne ikke starte samtale: ${conversationError?.message}`);
    const dm = await sendDirect(ulf.client, conversation, "hei");
    expect("K1 mottakeren kan reagere", (await react(vera.client, "direct", dm, { emoji: "❤️" })).code, "ok");
    expect("K1 avsenderen ser hvem", names(await authors(ulf.client, "direct", dm, { emoji: "❤️" })), "Vera Reaksjon");
    expect("K1 lagret antall uten konto-id", UUID_RE.test(storedCounts("direct_messages", dm)), false);
    expect("K2 en tredje person når ingenting", names(await authors(wenche.client, "direct", dm, { emoji: "❤️" })), "null");
    expect("K2 og kan ikke reagere", (await react(wenche.client, "direct", dm, { emoji: "❤️" })).code, "not_found");
    expect("K2 heller ikke fellesskapets administrator", names(await authors(octavio, "direct", dm, { emoji: "❤️" })), "null");
    const veraOwn = await vera.client.from("direct_message_reactions").select("emoji");
    expect("K3 ens egne rader", (veraOwn.data ?? []).map((row) => row.emoji).join(""), "❤️");
    expect("K3 den andres rader er usynlige", ((await ulf.client.from("direct_message_reactions").select("emoji")).data ?? []).length, 0);

    // ════ L. Enumeration and cross-community requests ══════════════════
    expect("L1 en tilfeldig id gir ingenting", names(await authors(dina.client, "message", crypto.randomUUID(), { emoji: "🎉" })), "null");
    expect("L1 feil type for en ekte id gir ingenting", names(await authors(ulf.client, "post", dm, { emoji: "❤️" })), "null");
    expect("L1 en kanalmelding spurt om som DM gir ingenting", names(await authors(dina.client, "direct", ftrMessage, { emoji: "🎉" })), "null");
    expect("L2 en melding i TU spurt om fra FTR gir ingenting", names(await authors(dina.client, "message", tuMessage, { emoji: "👍" })), "null");
    expect("L2 og kan ikke reageres på", (await react(dina.client, "message", tuMessage, { emoji: "👍" })).code, "not_found");
    const ftrEmoji = sql(`insert into community_emojis (community_id, name, storage_path, content_type, byte_size, created_by) values ('${FTR}', 'check-reak-ftr', '${FTR}/check-reak.png', 'image/png', 10, '${await profileId("miaminge")}') returning id`).split("\n")[0];
    const tuEmoji = sql(`insert into community_emojis (community_id, name, storage_path, content_type, byte_size, created_by) values ('${TU}', 'check-reak-tu', '${TU}/check-reak.png', 'image/png', 10, '${await profileId("emmamortensen")}') returning id`).split("\n")[0];
    result = await react(dina.client, "message", ftrMessage, { emojiId: ftrEmoji });
    expect("L3 fellesskapets egen emoji som reaksjon", result.code, "ok");
    expect("L3 vises med navn", counts(result.view).includes(":check-reak-ftr:1*"), true);
    expect("L3 en emoji fra et annet fellesskap avvises", (await react(dina.client, "message", ftrMessage, { emojiId: tuEmoji })).code, "other_community");
    expect("L3 også i en DM", (await react(vera.client, "direct", dm, { emojiId: tuEmoji })).code, "other_community");
    expect("L3 TU-emoji fungerer i TU", (await react(tuva.client, "message", tuMessage, { emojiId: tuEmoji })).code, "ok");
    sql(`delete from community_emojis where id = '${ftrEmoji}'`);
    expect("L4 en slettet egen emoji tar reaksjonene med seg", storedCounts("messages", ftrMessage).includes(ftrEmoji), false);
    expect("L4 og radene", rowCount("message_reactions", "emoji_id", ftrEmoji), 0);

    // ════ M. Mentions stay as they were ════════════════════════════════
    const candidates = await ane.client.rpc("search_channel_mention_candidates", { p_channel_id: ftrChannel, p_query: "" });
    expect("M1 å reagere gjør ingen nevnbar", (candidates.data ?? []).some((row) => [bo.id, cato.id, dina.id].includes(row.user_id)), false);
    // Bo and Dina share no private channel or group with Ane (Cato does —
    // and that, not a reaction, is what lets Ane see Cato's name).
    const identities = await ane.client.rpc("community_identities", { p_community_id: FTR, p_user_ids: [bo.id, dina.id] });
    expect("M1 og avslører ingen identitet", (identities.data ?? []).length, 0);

    // ════ N. Former members and revoked access ═════════════════════════
    sql(`delete from memberships where user_id = '${dina.id}' and community_id = '${FTR}'`);
    expect("N1 tidligere medlem når ingenting", names(await authors(dina.client, "message", ftrMessage, { emoji: "🎉" })), "null");
    expect("N1 og kan ikke reagere", (await react(dina.client, "message", ftrMessage, { emoji: "🎉" }, false)).code, "not_found");
    const afterLeaving = await authors(kari, "message", ftrMessage, { emoji: "🎉" });
    expect("N2 hun telles fortsatt, men navngis ikke", `${afterLeaving?.total}/${names(afterLeaving)}/${afterLeaving?.unnamed}`, `5/${nameList("(Kari Moen)", ...reactors)}/1`);
    await mia.rpc("remove_private_channel_participant", { p_channel_id: privateChannel!, p_user_id: ane.id });
    expect("N3 tatt ut av den private kanalen: ingenting", names(await authors(ane.client, "message", privateMessage!, { emoji: "🙏" })), "null");
    expect("N3 og kan ikke trekke tilbake eller legge til", (await react(ane.client, "message", privateMessage!, { emoji: "🙏" }, false)).code, "not_found");
    expect("N3 hennes egne rader der er usynlige for henne", ((await ane.client.from("message_reactions").select("id").eq("message_id", privateMessage!)).data ?? []).length, 0);

    // ════ O. Deleted, moderated, disappearing and archived ═════════════
    await react(bo.client, "message", lokallagMessage, { emoji: "🔥" });
    await ane.client.rpc("delete_channel_message", { p_message_id: lokallagMessage });
    expect("O1 slettet melding: reaksjonene er borte", `${rowCount("message_reactions", "message_id", lokallagMessage)}|${storedCounts("messages", lokallagMessage)}`, "0|[]");
    expect("O1 og kan ikke reageres på", (await react(bo.client, "message", lokallagMessage, { emoji: "👍" })).code, "not_found");
    expect("O1 og ingen navn", names(await authors(mia, "message", lokallagMessage, { emoji: "👍" })), "null");
    const victim = await send(cato.client, ftrChannel, "skal fjernes");
    await react(ane.client, "message", victim, { emoji: "👍" });
    expect("O2 moderator fjerner meldingen", (await kari.rpc("delete_channel_message", { p_message_id: victim })).data, "moderator");
    expect("O2 og reaksjonene går med", `${rowCount("message_reactions", "message_id", victim)}|${storedCounts("messages", victim)}`, "0|[]");
    expect("O2 en fjernet melding tar ingen nye", (await react(ane.client, "message", victim, { emoji: "👍" })).code, "not_found");

    await ulf.client.rpc("set_direct_conversation_disappearing", { p_conversation_id: conversation, p_seconds: 3600 });
    const fleeting = await sendDirect(ulf.client, conversation, "forsvinner");
    expect("O3 forsvinnende melding kan få reaksjoner", (await react(vera.client, "direct", fleeting, { emoji: "😂" })).code, "ok");
    sql(`set session_replication_role = replica; update direct_messages set expires_at = now() - interval '1 second' where id = '${fleeting}'`);
    expect("O3 utløpt: ingen navn", names(await authors(ulf.client, "direct", fleeting, { emoji: "😂" })), "null");
    expect("O3 utløpt: ingen nye reaksjoner", (await react(vera.client, "direct", fleeting, { emoji: "🔥" })).code, "not_found");
    expect("O3 utløpt: ens egen rad er usynlig", ((await vera.client.from("direct_message_reactions").select("id").eq("direct_message_id", fleeting)).data ?? []).length, 0);
    await admin.rpc("purge_expired_direct_messages", { p_limit: 50, p_conversation_ids: [conversation] });
    expect("O3 slettet sammen med meldingen", rowCount("direct_message_reactions", "direct_message_id", fleeting), 0);
    await vera.client.rpc("delete_direct_message", { p_message_id: (await sendDirect(vera.client, conversation, "slettes")) });
    const deletedDm = sql(`select id from direct_messages where conversation_id = '${conversation}' and deleted_at is not null limit 1`);
    expect("O4 slettet DM tar ingen reaksjoner", (await react(ulf.client, "direct", deletedDm, { emoji: "👍" })).code, "not_found");
    const toDelete = await sendDirect(ulf.client, conversation, "slettes med reaksjon");
    await react(vera.client, "direct", toDelete, { emoji: "👍" });
    await ulf.client.rpc("delete_direct_message", { p_message_id: toDelete });
    expect("O4 slettet DM: reaksjonene er borte", `${rowCount("direct_message_reactions", "direct_message_id", toDelete)}|${storedCounts("direct_messages", toDelete)}`, "0|[]");

    expect("O5 arkivert kanal", (await mia.rpc("set_community_channel_archived", { p_channel_id: ftrChannel, p_archived: true })).data, true);
    expect("O5 tar ingen nye reaksjoner", (await react(ane.client, "message", ftrMessage, { emoji: "👍" })).code, "archived");
    expect("O5 men antallene står", sql(`select reactions->0->>'count' from messages where id = '${ftrMessage}'`), 5);
    await mia.rpc("set_community_channel_archived", { p_channel_id: ftrChannel, p_archived: false });

    sql(`update memberships set status = 'requested' where user_id = '${ulf.id}' and community_id = '${UTR}'`);
    expect("O6 samtale med en som har gått ut: ingen nye reaksjoner", (await react(vera.client, "direct", dm, { emoji: "👍" })).code, "closed");
    sql(`update memberships set status = 'active' where user_id = '${ulf.id}' and community_id = '${UTR}'`);

    // ════ P. Feed posts ════════════════════════════════════════════════
    const { data: wide } = await mia.from("posts").insert({ community_id: FTR, body: `${TAG} innlegg for alle` }).select("id").single();
    const { data: scoped } = await mia.from("posts").insert({ community_id: FTR, local_group_id: localGroup, body: `${TAG} innlegg for lokallaget` }).select("id").single();
    result = await react(cato.client, "post", wide!.id, { emoji: "❤️" });
    expect("P1 reagere på et innlegg", counts(result.view), "❤️1*");
    expect("P1 innlegget lagrer antall uten konto-id", UUID_RE.test(storedCounts("posts", wide!.id)), false);
    const legacy = await ane.client.from("post_reactions").insert({ post_id: wide!.id, user_id: ane.id, emoji: "❤️" });
    expect("P2 den gamle veien (tabellen) virker fortsatt", legacy.error?.message ?? "ok", "ok");
    expect("P2 og teller med", sql(`select reactions->0->>'count' from posts where id = '${wide!.id}'`), 2);
    expect("P3 medlemmer leser bare egne post_reactions-rader", ((await ane.client.from("post_reactions").select("user_id").eq("post_id", wide!.id)).data ?? []).map((row) => row.user_id).join(","), ane.id);
    expect("P4 innlegg for hele FTR: medlem ser antall", names(await authors(ane.client, "post", wide!.id, { emoji: "❤️" })), "skjult:2");
    expect("P4 moderator ser hvem", names(await authors(kari, "post", wide!.id, { emoji: "❤️" })), "Ane Reaksjon,Cato Reaksjon");
    await react(bo.client, "post", scoped!.id, { emoji: "👏" });
    expect("P5 lokallagsinnlegg: lokallaget ser hvem", names(await authors(ane.client, "post", scoped!.id, { emoji: "👏" })), "Bo Reaksjon");
    expect("P5 utenfor lokallaget: ingenting", names(await authors(cato.client, "post", scoped!.id, { emoji: "👏" })), "null");
    await mia.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "channel" });
    expect("P6 innstillingen gjelder også innlegg for hele fellesskapet", names(await authors(ane.client, "post", wide!.id, { emoji: "❤️" })), nameList("(Ane Reaksjon)", "Cato Reaksjon"));
    await mia.rpc("set_community_reaction_visibility", { p_community_id: FTR, p_value: "moderators" });
    const postPage = await page(ane.client, `/community/${FTR}/feed`);
    expect("P7 feed-siden har ikke kontoen til den som reagerte", postPage.html.includes(cato.id), false);
  } finally {
    await cleanup();
  }

  console.log(`\n${checks - failures}/${checks} sjekker bestått.`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("opprydding feilet:", cleanupError);
  }
  process.exit(1);
});
