/**
 * Checks administrator-managed community channels and sections
 * (supabase/migrations/20261028100000_community_channel_management.sql).
 *
 *   A. The catalog: the new table's row level security and grants, and who may
 *      call which function.
 *   B. Who may manage: members, moderators, a lokallagsleder, an account with
 *      no membership, anonymous visitors, and another community's
 *      administrator are all refused — by the database, through the same
 *      functions the app calls, and on direct table writes.
 *   C. What an administrator can do: sections and channels created, named,
 *      described, moved, ordered, archived, restored and deleted, with
 *      idempotent creation, slug rules, name uniqueness, forged ids refused,
 *      and concurrent changes that keep the ordering whole.
 *   D. What deleting a channel removes — its messages, their attachments
 *      (objects purged from Storage), notifications addressed to it — and
 *      what it never touches: other channels, other communities, the feed.
 *   E. The sidebar as rendered: a new channel appears, an archived one moves
 *      to "Arkiverte kanaler", a deleted one is gone; a missing channel's
 *      address answers in place.
 *   F. Who may write: "Alle medlemmer" or "Administratorer og moderatorer"
 *      (`channels.read_only`), on every write path — messages, files, direct
 *      API calls — and archived channels closed to everyone.
 *   G. Addresses are never reused: a deleted channel's id stays retired,
 *      a new channel with its name gets another, and concurrent requests
 *      cannot take it.
 *
 * Run with `npm run check:channel-management` against the local stack after
 * `npm run seed`, with the dev server on localhost:3000 for section E. Every
 * row it creates carries a run tag and is removed at the end, and the seeded
 * channels, sections and messages are compared before and after.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { purgeAttachmentObjects } from "@/lib/attachment-storage";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const APP = process.env.CHECK_APP_URL ?? "http://localhost:3000";

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const TAG = `sjekk${Date.now().toString(36)}`;
const BUCKET = "message-attachments";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const sql = (statement: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "postgres", "-d", "postgres", "-AtF", "|", "-c", statement],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`fant ikke ${handle}: ${error.message}`);
  return data.id;
}

async function magicLink(handle: string) {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  return data.properties.hashed_token;
}

async function signIn(handle: string): Promise<Client> {
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: await magicLink(handle) });
  if (error) throw error;
  return client;
}

/** The cookies the app reads, for fetching a page as this person. */
async function sessionCookie(handle: string): Promise<string> {
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: { getAll: () => [], setAll: (list) => list.forEach((cookie) => cookies.push(cookie)) },
  });
  const { error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: await magicLink(handle) });
  if (error) throw error;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

const code = (result: { error: { code?: string } | null }) => result.error?.code ?? "ok";
const message = (result: { error: { message?: string } | null }) => result.error?.message ?? "";

async function createChannel(
  client: Client,
  communityId: string,
  name: string,
  options: {
    purpose?: string;
    sectionId?: string | null;
    key?: string | null;
    readOnly?: boolean | null;
    fileSharing?: boolean | null;
  } = {},
) {
  return client.rpc("create_community_channel", {
    p_community_id: communityId,
    p_name: name,
    p_purpose: options.purpose ?? "",
    p_section_id: (options.sectionId ?? null) as unknown as string,
    p_creation_key: (options.key ?? null) as unknown as string,
    p_read_only: (options.readOnly === undefined ? false : options.readOnly) as boolean,
    p_file_sharing: (options.fileSharing === undefined ? false : options.fileSharing) as boolean,
  });
}

async function createSection(client: Client, communityId: string, name: string, key: string | null = null) {
  return client.rpc("create_channel_section", {
    p_community_id: communityId,
    p_name: name,
    p_creation_key: key as unknown as string,
  });
}

const move = (client: Client, channelId: string, sectionId: string | null, position: number | null) =>
  client.rpc("move_community_channel", {
    p_channel_id: channelId,
    p_section_id: sectionId as unknown as string,
    p_position: position as unknown as number,
  });
const archive = (client: Client, channelId: string, archived: boolean) =>
  client.rpc("set_community_channel_archived", { p_channel_id: channelId, p_archived: archived });
const destroy = (client: Client, channelId: string, confirm = "") =>
  client.rpc("delete_community_channel", { p_channel_id: channelId, p_confirm_name: confirm });
const renameSection = (client: Client, sectionId: string, name: string) =>
  client.rpc("rename_channel_section", { p_section_id: sectionId, p_name: name });
const moveSection = (client: Client, sectionId: string, position: number) =>
  client.rpc("move_channel_section", { p_section_id: sectionId, p_position: position });
const deleteSection = (client: Client, sectionId: string, to: string | null) =>
  client.rpc("delete_channel_section", { p_section_id: sectionId, p_channels_to: to as unknown as string });
const update = (client: Client, channelId: string, name: string, purpose: string, readOnly: boolean, fileSharing = false) =>
  client.rpc("update_community_channel", {
    p_channel_id: channelId,
    p_name: name,
    p_purpose: purpose,
    p_read_only: readOnly,
    p_file_sharing: fileSharing,
  });
const setDetails = (client: Client, communityId: string, channelId: string, name: string, purpose: string) =>
  client.rpc("set_channel_details", { p_community_id: communityId, p_channel_id: channelId, p_name: name, p_purpose: purpose });

async function channelRow(id: string) {
  const { data } = await admin.from("channels").select("*").eq("id", id).maybeSingle();
  return data;
}

async function listOrder(communityId: string, sectionId: string | null) {
  let query = admin
    .from("channels")
    .select("id, position, archived_at")
    .eq("community_id", communityId)
    .is("local_group_id", null)
    .is("subgroup_id", null)
    .order("position");
  query = sectionId ? query.eq("section_id", sectionId) : query.is("section_id", null);
  return (await query).data ?? [];
}

const contiguous = (rows: { position: number }[]) => rows.every((row, index) => row.position === index);

/** Everything outside this run that a change here must leave alone. */
async function fingerprint() {
  const channels = sql(
    `select string_agg(id || ':' || coalesce(section_id::text, '-') || ':' || name || ':' || position || ':' || (archived_at is not null), ',' order by id)
       from channels where name not like '%${TAG}%' and id not like '%${TAG}%'`,
  );
  const sections = sql(
    `select string_agg(id || ':' || name || ':' || position, ',' order by id) from channel_sections where name not like '%${TAG}%'`,
  );
  const messages = sql(
    `select count(*) || ':' || coalesce(sum(length(body)), 0) from messages m join channels c on c.id = m.channel_id
      where c.name not like '%${TAG}%' and c.id not like '%${TAG}%'`,
  );
  const feed = sql(`select (select count(*) from posts) || ':' || (select count(*) from comments) || ':' || (select count(*) from post_reactions)`);
  return { channels, sections, messages, feed };
}

async function cleanUp() {
  // Messages and attachments first go with their channels; sections after.
  sql(`delete from notifications where title like '%${TAG}%'`);
  sql(`delete from channels where (name like '%${TAG}%' or id like '%${TAG}%') and local_group_id is null and subgroup_id is null`);
  sql(`delete from channel_sections where name like '%${TAG}%'`);
  sql(`delete from channel_retired_ids where id like '%${TAG}%'`);
  await purgeAttachmentObjects();
}

// ── A. Catalog ────────────────────────────────────────────────────────────

const MANAGEMENT_FUNCTIONS = [
  "create_community_channel(text,text,text,uuid,uuid,boolean,boolean)",
  "update_community_channel(text,text,text,boolean,boolean)",
  "move_community_channel(text,uuid,integer)",
  "set_community_channel_archived(text,boolean)",
  "community_channel_content_counts(text)",
  "delete_community_channel(text,text)",
  "create_channel_section(text,text,uuid)",
  "rename_channel_section(uuid,text)",
  "move_channel_section(uuid,integer)",
  "delete_channel_section(uuid,text)",
  "set_channel_details(text,text,text,text)",
];
const INTERNAL_FUNCTIONS = [
  "lock_channel_layout(text)",
  "community_channel_id(text,text)",
  "renumber_community_channels(text,uuid)",
  "renumber_channel_sections(text)",
  "channels_guard_identity()",
  "channels_refuse_retired_id()",
];

function checkCatalog() {
  expect("A: channel_sections har radsikkerhet", sql(`select relrowsecurity from pg_class where oid = 'public.channel_sections'::regclass`), "t");
  expect(
    "A: authenticated leser channel_sections, skriver ikke",
    sql(`select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name = 'channel_sections' and grantee = 'authenticated'`),
    "SELECT",
  );
  expect(
    "A: anon har ingenting på channel_sections",
    sql(`select count(*) from information_schema.role_table_grants where table_name = 'channel_sections' and grantee = 'anon'`),
    0,
  );
  expect(
    "A: ingen skrivepolicy på channels eller channel_sections",
    sql(`select count(*) from pg_policies where tablename in ('channels', 'channel_sections') and cmd <> 'SELECT'`),
    0,
  );
  for (const fn of MANAGEMENT_FUNCTIONS) {
    expect(`A: authenticated kan kalle ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "t");
    expect(`A: anon kan ikke kalle ${fn}`, sql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
    expect(`A: ${fn} er SECURITY DEFINER med låst search_path`, sql(`select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where oid = 'public.${fn}'::regprocedure`), "t");
  }
  for (const fn of INTERNAL_FUNCTIONS) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(`A: ${role} kan ikke kalle ${fn}`, sql(`select has_function_privilege('${role}', 'public.${fn}', 'execute')`), "f");
    }
  }
  expect("A: channel_retired_ids har radsikkerhet", sql(`select relrowsecurity from pg_class where oid = 'public.channel_retired_ids'::regclass`), "t");
  expect(
    "A: ingen API-rolle utenom serveren har noe på channel_retired_ids",
    sql(`select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'channel_retired_ids' and grantee in ('anon', 'authenticated')`),
    0,
  );
  expect(
    "A: plattformoverskriftene er bare lokallag og grupper",
    sql(`select string_agg(id || ':' || position, ',' order by position) from channel_groups`),
    "lokallag:0,grupper:1",
  );
  expect(
    "A: ingen fellesskapskanal har plattformoverskrift",
    sql(`select count(*) from channels where local_group_id is null and subgroup_id is null and group_id is not null`),
    0,
  );
}

// ── B, C, D ───────────────────────────────────────────────────────────────

async function main() {
  checkCatalog();

  const mia = await signIn("miaminge"); // FTR admin
  const emma = await signIn("emmamortensen"); // TU admin
  const kari = await signIn("karimoen"); // moderator in FTR and TU
  const petter = await signIn("petter"); // FTR member, lokallagsleder
  const linn = await signIn("linn"); // FTR member
  const adrian = await signIn("adrian"); // TU member
  const sofie = await signIn("sofie"); // no membership
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const linnId = await profileId("linn");

  const before = await fingerprint();
  const { data: ftrSeedSection } = await admin.from("channel_sections").select("id").eq("community_id", FTR).limit(1).single();
  const { data: tuSeedSection } = await admin.from("channel_sections").select("id").eq("community_id", TU).limit(1).single();
  const { data: tuChannel } = await admin.from("channels").select("id, name").eq("community_id", TU).is("local_group_id", null).is("subgroup_id", null).limit(1).single();
  const { data: ftrLokallag } = await admin.from("channels").select("id").eq("community_id", FTR).not("local_group_id", "is", null).eq("is_private", false).limit(1).single();
  const { data: ftrGroupChat } = await admin.from("channels").select("id").eq("community_id", FTR).not("subgroup_id", "is", null).limit(1).single();
  const lokallagCount = sql(`select count(*) from channels where local_group_id is not null or subgroup_id is not null`);

  try {
    // ── B. Who may manage ─────────────────────────────────────────────────
    for (const [who, client] of [
      ["medlem", linn],
      ["moderator", kari],
      ["lokallagsleder", petter],
      ["uten medlemskap", sofie],
    ] as const) {
      const created = await createChannel(client, FTR, `${who} ${TAG}`);
      expect(`B: ${who} kan ikke opprette kanal`, created.data ?? null, null);
      const section = await createSection(client, FTR, `${who} ${TAG}`);
      expect(`B: ${who} kan ikke opprette seksjon`, section.data ?? null, null);
      expect(`B: ${who} kan ikke flytte en kanal`, (await move(client, tuChannel!.id, null, 0)).data, false);
      expect(`B: ${who} kan ikke arkivere`, (await archive(client, `${FTR}--generelt`, true)).data, false);
      expect(`B: ${who} kan ikke slette`, (await destroy(client, `${FTR}--generelt`, "generelt")).data, false);
      expect(`B: ${who} kan ikke gi seksjonen nytt navn`, (await renameSection(client, ftrSeedSection!.id, "x")).data, false);
      expect(`B: ${who} kan ikke flytte seksjonen`, (await moveSection(client, ftrSeedSection!.id, 5)).data, false);
      expect(`B: ${who} kan ikke slette seksjonen`, (await deleteSection(client, ftrSeedSection!.id, "none")).data, false);
      expect(`B: ${who} får ikke innholdstall`, ((await client.rpc("community_channel_content_counts", { p_channel_id: `${FTR}--generelt` })).data ?? []).length, 0);
      expect(`B: ${who} kan ikke endre navn`, ((await setDetails(client, FTR, `${FTR}--generelt`, "x", "")).data ?? []).length, 0);
    }
    expect("B: #generelt er urørt etter forsøkene", (await channelRow(`${FTR}--generelt`))?.archived_at, null);

    // Another community's administrator, with real and forged ids.
    expect("B: FTR-admin kan ikke opprette i TU", (await createChannel(mia, TU, `Mia i TU ${TAG}`)).data ?? null, null);
    expect("B: FTR-admin kan ikke opprette seksjon i TU", (await createSection(mia, TU, `Mia i TU ${TAG}`)).data ?? null, null);
    expect("B: FTR-admin kan ikke flytte en TU-kanal", (await move(mia, tuChannel!.id, null, 0)).data, false);
    expect("B: FTR-admin kan ikke arkivere en TU-kanal", (await archive(mia, tuChannel!.id, true)).data, false);
    expect("B: FTR-admin kan ikke slette en TU-kanal", (await destroy(mia, tuChannel!.id, tuChannel!.name)).data, false);
    expect("B: FTR-admin kan ikke endre en TU-kanal via FTR-id", ((await setDetails(mia, FTR, tuChannel!.id, "x", "")).data ?? []).length, 0);
    expect("B: FTR-admin kan ikke endre en TU-kanal via TU-id", ((await setDetails(mia, TU, tuChannel!.id, "x", "")).data ?? []).length, 0);
    expect("B: FTR-admin kan ikke gi en TU-seksjon nytt navn", (await renameSection(mia, tuSeedSection!.id, "x")).data, false);
    expect("B: FTR-admin kan ikke slette en TU-seksjon", (await deleteSection(mia, tuSeedSection!.id, "none")).data, false);
    expect("B: FTR-admin får ikke TU-tall", ((await mia.rpc("community_channel_content_counts", { p_channel_id: tuChannel!.id })).data ?? []).length, 0);
    expect("B: FTR-admin kan ikke opprette i FTR med TU-seksjon", (await createChannel(mia, FTR, `Forfalsket ${TAG}`, { sectionId: tuSeedSection!.id })).data ?? null, null);
    expect("B: FTR-admin kan ikke flytte en FTR-kanal inn i en TU-seksjon", (await move(mia, `${FTR}--samarbeid`, tuSeedSection!.id, 0)).data, false);
    expect("B: ukjent fellesskap", (await createChannel(mia, "finnes-ikke", `x ${TAG}`)).data ?? null, null);
    expect("B: ukjent kanal", (await destroy(mia, `${FTR}--finnes-ikke-${TAG}`)).data, false);

    // Not this feature's channels, even for the community's own admin.
    expect("B: lokallagets hovedkanal kan ikke slettes her", (await destroy(mia, ftrLokallag!.id, "x")).data, false);
    expect("B: lokallagets hovedkanal kan ikke arkiveres her", (await archive(mia, ftrLokallag!.id, true)).data, false);
    expect("B: lokallagets hovedkanal kan ikke flyttes", (await move(mia, ftrLokallag!.id, null, 0)).data, false);
    expect("B: gruppekanalen kan ikke slettes her", (await destroy(mia, ftrGroupChat!.id, "x")).data, false);

    // Anonymous visitors, and direct table writes by anyone.
    expect("B: anon kan ikke kalle create_community_channel", code(await createChannel(anon, FTR, `anon ${TAG}`)), "42501");
    expect("B: anon kan ikke kalle delete_community_channel", code(await destroy(anon, `${FTR}--generelt`, "generelt")), "42501");
    expect("B: anon kan ikke lese seksjoner", code(await anon.from("channel_sections").select("id").limit(1)), "42501");
    for (const [who, client] of [["admin", mia], ["medlem", linn]] as const) {
      const loose = client as unknown as Loose;
      expect(`B: ${who} kan ikke sette inn en kanal direkte`, code(await loose.from("channels").insert({ id: `${FTR}--${TAG}`, community_id: FTR, name: TAG, purpose: "" })), "42501");
      expect(`B: ${who} kan ikke endre en kanal direkte`, code(await loose.from("channels").update({ name: "x" }).eq("id", `${FTR}--generelt`)), "42501");
      expect(`B: ${who} kan ikke slette en kanal direkte`, code(await loose.from("channels").delete().eq("id", `${FTR}--generelt`)), "42501");
      expect(`B: ${who} kan ikke sette inn en seksjon direkte`, code(await loose.from("channel_sections").insert({ community_id: FTR, name: TAG })), "42501");
      expect(`B: ${who} kan ikke slette en seksjon direkte`, code(await loose.from("channel_sections").delete().eq("community_id", FTR)), "42501");
    }

    // Reading: sections are members' only.
    expect("B: TU-medlem ser ingen FTR-seksjoner", ((await adrian.from("channel_sections").select("id").eq("community_id", FTR)).data ?? []).length, 0);
    expect("B: uten medlemskap ser ingen seksjoner", ((await sofie.from("channel_sections").select("id")).data ?? []).length, 0);
    expect("B: FTR-medlem ser FTR-seksjonene", ((await linn.from("channel_sections").select("id").eq("community_id", FTR)).data ?? []).length > 0, true);

    // ── C. Sections ───────────────────────────────────────────────────────
    const sectionKey = randomUUID();
    const s1 = await createSection(mia, FTR, `Seksjon A ${TAG}`, sectionKey);
    expect("C: admin oppretter seksjon", typeof s1.data, "string");
    const s1Again = await createSection(mia, FTR, `Seksjon A ${TAG}`, sectionKey);
    expect("C: samme nøkkel gir samme seksjon", s1Again.data, s1.data);
    expect("C: én rad etter gjentak", sql(`select count(*) from channel_sections where name = 'Seksjon A ${TAG}'`), 1);
    expect("C: samme navn med annen nøkkel avvises", /channel_section_name_taken/.test(message(await createSection(mia, FTR, `seksjon a ${TAG}`))), true);
    expect("C: tomt seksjonsnavn avvises", (await createSection(mia, FTR, "   ")).data ?? null, null);
    expect("C: for langt seksjonsnavn avvises", (await createSection(mia, FTR, "x".repeat(41))).data ?? null, null);
    expect("C: samme seksjonsnavn i et annet fellesskap er lov", typeof (await createSection(emma, TU, `Seksjon A ${TAG}`)).data, "string");
    const s2 = (await createSection(mia, FTR, `Seksjon B ${TAG}`)).data!;
    const sectionA = s1.data!;
    const sectionsAfter = (await admin.from("channel_sections").select("id, position").eq("community_id", FTR).order("position")).data ?? [];
    expect("C: seksjonene står sist, uten hull", contiguous(sectionsAfter) && sectionsAfter.at(-1)?.id === s2, true);

    expect("C: gi nytt navn", (await renameSection(mia, s2, `Seksjon C ${TAG}`)).data, true);
    expect("C: nytt navn kan ikke kollidere", /channel_section_name_taken/.test(message(await renameSection(mia, s2, `Seksjon A ${TAG}`))), true);
    expect("C: flytt seksjon først", (await moveSection(mia, s2, 0)).data, true);
    const reordered = (await admin.from("channel_sections").select("id, position").eq("community_id", FTR).order("position")).data ?? [];
    expect("C: seksjonen står først, uten hull", reordered[0]?.id === s2 && contiguous(reordered), true);
    expect("C: flytt tilbake sist", (await moveSection(mia, s2, 99)).data, true);

    // ── C. Channels: creation ─────────────────────────────────────────────
    const key = randomUUID();
    const c1 = await createChannel(mia, FTR, `Planlegging ${TAG}`, { purpose: "  Hva vi gjør  ", sectionId: sectionA, key });
    expect("C: admin oppretter kanal", typeof c1.data, "string");
    const c1Id = c1.data!;
    expect("C: id er fellesskap--slug", c1Id, `${FTR}--planlegging-${TAG}`);
    const again = await Promise.all([1, 2, 3].map(() => createChannel(mia, FTR, `Planlegging ${TAG}`, { sectionId: sectionA, key })));
    expect("C: dobbeltklikk/gjentak gir samme kanal", again.every((result) => result.data === c1Id), true);
    expect("C: én kanal etter gjentak", sql(`select count(*) from channels where name = 'Planlegging ${TAG}'`), 1);
    const stored = await channelRow(c1Id);
    expect("C: lagret i seksjonen, uten plattformoverskrift", `${stored?.section_id}/${stored?.group_id}`, `${sectionA}/null`);
    expect("C: beskrivelsen er trimmet", stored?.purpose, "Hva vi gjør");
    // A key answers only within its community: TU's admin reusing it there
    // makes TU's own channel, never hands back FTR's.
    const tuSame = await createChannel(emma, TU, `Planlegging ${TAG}`, { key });
    expect("C: samme navn og nøkkel i TU gir TUs egen kanal", tuSame.data, `${TU}--planlegging-${TAG}`);

    expect("C: samme navn avvises (store/små bokstaver)", /channel_name_taken/.test(message(await createChannel(mia, FTR, `PLANLEGGING ${TAG}`))), true);
    expect("C: navn som finnes i seed avvises", /channel_name_taken/.test(message(await createChannel(mia, FTR, "Generelt"))), true);
    expect("C: tomt navn avvises", (await createChannel(mia, FTR, "  ")).data ?? null, null);
    expect("C: for langt navn avvises", (await createChannel(mia, FTR, "x".repeat(41))).data ?? null, null);
    expect("C: kontrolltegn avvises", (await createChannel(mia, FTR, `a\nb ${TAG}`)).data ?? null, null);
    expect("C: for lang beskrivelse avvises", (await createChannel(mia, FTR, `lang ${TAG}`, { purpose: "x".repeat(201) })).data ?? null, null);

    const twin = await createChannel(mia, FTR, `Planlegging-${TAG}`);
    expect("C: samme slug får -2", twin.data, `${FTR}--planlegging-${TAG}-2`);
    const nordic = await createChannel(mia, FTR, `Ærlig Øvelse på Å ${TAG}`);
    expect("C: æøå blir a/o/a i adressen", nordic.data, `${FTR}--arlig-ovelse-pa-a-${TAG}`);
    const reserved = await createChannel(mia, FTR, `Lokallag ${TAG}`);
    expect("C: reservert prefiks får kanal-", reserved.data, `${FTR}--kanal-lokallag-${TAG}`);
    const symbols = await createChannel(mia, FTR, `🎉 ${TAG}`);
    expect("C: navn uten bokstaver gir likevel en adresse", symbols.data, `${FTR}--${TAG}`);
    const unsectioned = await createChannel(mia, FTR, `Uten seksjon ${TAG}`);
    expect("C: kanal uten seksjon", (await channelRow(unsectioned.data!))?.section_id, null);

    // Concurrent creation into one list keeps the ordering whole.
    const burst = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => createChannel(mia, FTR, `Samtidig ${n} ${TAG}`, { sectionId: s2 })),
    );
    expect("C: fem samtidige opprettelser lyktes", burst.every((result) => typeof result.data === "string"), true);
    const burstOrder = await listOrder(FTR, s2);
    expect("C: samtidige opprettelser gir sammenhengende rekkefølge", burstOrder.length === 5 && contiguous(burstOrder), true);

    // Reading and writing as members.
    expect("C: medlem ser den nye kanalen", ((await linn.from("channels").select("id").eq("id", c1Id)).data ?? []).length, 1);
    expect("C: TU-medlem ser den ikke", ((await adrian.from("channels").select("id").eq("id", c1Id)).data ?? []).length, 0);
    expect("C: uten medlemskap ser den ikke", ((await sofie.from("channels").select("id").eq("id", c1Id)).data ?? []).length, 0);
    const posted = await linn.from("messages").insert({ channel_id: c1Id, body: `Hei ${TAG}` }).select("id").single();
    expect("C: medlem kan skrive i den nye kanalen", code(posted), "ok");
    expect("C: TU-medlem kan ikke skrive i den", code(await adrian.from("messages").insert({ channel_id: c1Id, body: "x" })) !== "ok", true);

    // ── C. Editing, moving, ordering ──────────────────────────────────────
    const renamed = await setDetails(mia, FTR, c1Id, `Planlegging og drift ${TAG}`, "Ny beskrivelse");
    expect("C: gi nytt navn", renamed.data?.[0]?.name, `Planlegging og drift ${TAG}`);
    expect("C: id er uendret etter nytt navn", (await channelRow(c1Id))?.id, c1Id);
    expect("C: meldingen er der fortsatt", ((await linn.from("messages").select("id").eq("channel_id", c1Id)).data ?? []).length, 1);
    expect("C: nytt navn kan ikke ta en annen kanals", /channel_name_taken/.test(message(await setDetails(mia, FTR, c1Id, "generelt", ""))), true);

    expect("C: flytt ut av seksjonen", (await move(mia, c1Id, null, null)).data, true);
    expect("C: står uten seksjon", (await channelRow(c1Id))?.section_id, null);
    expect("C: seksjon A er tom og uten hull", (await listOrder(FTR, sectionA)).length, 0);
    expect("C: flytt til seksjon C, først", (await move(mia, c1Id, s2, 0)).data, true);
    const sectionCOrder = await listOrder(FTR, s2);
    expect("C: står først i seksjon C, uten hull", sectionCOrder[0]?.id === c1Id && contiguous(sectionCOrder), true);
    expect("C: flytt ned ett steg", (await move(mia, c1Id, s2, 1)).data, true);
    expect("C: står nå som nummer to", (await listOrder(FTR, s2))[1]?.id, c1Id);
    expect("C: meldingen følger med flyttingen", ((await linn.from("messages").select("id").eq("channel_id", c1Id)).data ?? []).length, 1);

    // Concurrent moves within one list.
    const burstIds = burst.map((result) => result.data!);
    await Promise.all(burstIds.map((id, n) => move(mia, id, s2, n % 3)));
    const afterMoves = await listOrder(FTR, s2);
    expect("C: samtidige flyttinger etterlater sammenhengende rekkefølge", afterMoves.length === 6 && contiguous(afterMoves), true);

    // ── C. Archive and restore ────────────────────────────────────────────
    expect("C: arkiver", (await archive(mia, c1Id, true)).data, true);
    expect("C: arkivert", Boolean((await channelRow(c1Id))?.archived_at), true);
    expect("C: arkivert kanal tar ikke nye meldinger", code(await linn.from("messages").insert({ channel_id: c1Id, body: "x" })) !== "ok", true);
    expect("C: … heller ikke fra admin", code(await mia.from("messages").insert({ channel_id: c1Id, body: "x" })) !== "ok", true);
    expect("C: historikken kan fortsatt leses", ((await linn.from("messages").select("id").eq("channel_id", c1Id)).data ?? []).length, 1);
    expect("C: kanalen er fortsatt synlig for medlemmer", ((await linn.from("channels").select("id").eq("id", c1Id)).data ?? []).length, 1);
    const archivedOrder = await listOrder(FTR, s2);
    expect("C: arkivert kanal står bak de aktive", archivedOrder.at(-1)?.id === c1Id && contiguous(archivedOrder), true);
    expect("C: arkivere igjen er ufarlig", (await archive(mia, c1Id, true)).data, true);
    expect("C: gjenopprett", (await archive(mia, c1Id, false)).data, true);
    expect("C: ikke lenger arkivert", (await channelRow(c1Id))?.archived_at ?? null, null);
    expect("C: gjenopprettet uten duplikat", sql(`select count(*) from channels where name = 'Planlegging og drift ${TAG}'`) + "/" + sql(`select count(*) from channels where id = '${c1Id}'`), "1/1");
    expect("C: samme meldinger etter gjenoppretting", ((await linn.from("messages").select("id").eq("channel_id", c1Id)).data ?? []).length, 1);
    expect("C: kan skrive igjen", code(await linn.from("messages").insert({ channel_id: c1Id, body: `Igjen ${TAG}` })), "ok");

    // ── D. Permanent deletion ─────────────────────────────────────────────
    const counts = (await mia.rpc("community_channel_content_counts", { p_channel_id: c1Id })).data?.[0];
    expect("D: admin får innholdstall", `${counts?.message_count}/${counts?.attachment_count}`, "2/0");

    // A file in the channel, as the attachment system would store it.
    const fileId = randomUUID();
    const path = `${FTR}/${fileId}.png`;
    const { data: fileMessage } = await admin.from("messages").insert({ channel_id: c1Id, author_id: linnId, body: "" }).select("id").single();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    expect("D: testfil lastet opp", (await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png" })).error, null);
    const attachment = await admin.from("message_attachments").insert({
      id: fileId, community_id: FTR, channel_id: c1Id, uploader_id: linnId, message_id: fileMessage!.id,
      storage_path: path, display_name: "bilde.png", mime_type: "image/png", size_bytes: png.length, status: "sent",
    });
    expect("D: vedleggsrad opprettet", attachment.error?.message ?? null, null);

    // A notification addressed to the channel, and one that is not.
    const miaId = await profileId("miaminge");
    await admin.from("notifications").insert([
      { user_id: miaId, kind: "mention", community_id: FTR, title: `Til kanalen ${TAG}`, body: "", href: `/community/${FTR}/channel/${c1Id}` },
      { user_id: miaId, kind: "mention", community_id: FTR, title: `Til en annen ${TAG}`, body: "", href: `/community/${FTR}/channel/${FTR}--generelt` },
    ]);

    expect("D: uten bekreftelse avvises", /channel_delete_unconfirmed/.test(message(await destroy(mia, c1Id, ""))), true);
    expect("D: feil navn avvises", /channel_delete_unconfirmed/.test(message(await destroy(mia, c1Id, "Planlegging"))), true);
    expect("D: kanalen finnes etter avvisning", Boolean(await channelRow(c1Id)), true);
    expect("D: moderator kan ikke slette selv med riktig navn", (await destroy(kari, c1Id, `Planlegging og drift ${TAG}`)).data, false);
    expect("D: slett med riktig navn", (await destroy(mia, c1Id, `Planlegging og drift ${TAG}`)).data, true);
    expect("D: kanalen er borte", await channelRow(c1Id), null);
    expect("D: meldingene er borte", sql(`select count(*) from messages where channel_id = '${c1Id}'`), 0);
    expect("D: vedleggsraden er borte", sql(`select count(*) from message_attachments where id = '${fileId}'`), 0);
    expect("D: filen står i slettekøen", sql(`select count(*) from message_attachment_purges where storage_path = '${path}'`), 1);
    expect("D: varselet til kanalen er borte", sql(`select count(*) from notifications where title = 'Til kanalen ${TAG}'`), 0);
    expect("D: andre varsler står", sql(`select count(*) from notifications where title = 'Til en annen ${TAG}'`), 1);
    await purgeAttachmentObjects();
    const { data: leftover } = await admin.storage.from(BUCKET).list(FTR, { search: fileId });
    expect("D: filen er fjernet fra Storage", (leftover ?? []).length, 0);
    expect("D: slettekøen er tom for filen", sql(`select count(*) from message_attachment_purges where storage_path = '${path}'`), 0);
    expect("D: medlem ser ikke lenger kanalen", ((await linn.from("channels").select("id").eq("id", c1Id)).data ?? []).length, 0);
    expect("D: adressen er pensjonert", sql(`select count(*) from channel_retired_ids where id = '${c1Id}' and community_id = '${FTR}'`), 1);
    const reborn = (await createChannel(mia, FTR, `Planlegging ${TAG}`)).data;
    expect("D: samme navn igjen får en annen adresse", typeof reborn === "string" && reborn !== c1Id, true);
    expect("D: den gamle adressen er fortsatt borte", await channelRow(c1Id), null);

    expect("D: tom kanal slettes uten bekreftelse", (await destroy(mia, unsectioned.data!)).data, true);
    expect("D: TU-kanal med samme navn er urørt", Boolean(await channelRow(tuSame.data!)), true);

    // ── C. Deleting sections ──────────────────────────────────────────────
    expect("C: seksjon med kanaler krever et valg", /channel_section_not_empty/.test(message(await deleteSection(mia, s2, null))), true);
    expect("C: kan ikke flytte kanalene til seg selv", (await deleteSection(mia, s2, s2)).data, false);
    expect("C: kan ikke flytte kanalene til en TU-seksjon", (await deleteSection(mia, s2, tuSeedSection!.id)).data, false);
    expect("C: ugyldig mål avvises", (await deleteSection(mia, s2, "ikke-en-id")).data, false);
    const s2Channels = (await listOrder(FTR, s2)).map((row) => row.id);
    expect("C: slett seksjon C og flytt kanalene til A", (await deleteSection(mia, s2, sectionA)).data, true);
    const inA = await listOrder(FTR, sectionA);
    expect("C: alle kanalene står nå i A, i samme rekkefølge", inA.map((row) => row.id).join(","), s2Channels.join(","));
    expect("C: ingen kanal ble slettet", sql(`select count(*) from channels where name like 'Samtidig % ${TAG}'`), 5);
    expect("C: seksjon C er borte", sql(`select count(*) from channel_sections where id = '${s2}'`), 0);
    expect("C: slett seksjon A og la kanalene stå uten seksjon", (await deleteSection(mia, sectionA, "none")).data, true);
    expect("C: kanalene står uten seksjon", sql(`select count(*) from channels where name like 'Samtidig % ${TAG}' and section_id is null`), 5);
    const unsectionedOrder = await listOrder(FTR, null);
    expect("C: listen uten seksjon er sammenhengende", contiguous(unsectionedOrder), true);
    const empty = (await createSection(mia, FTR, `Tom ${TAG}`)).data!;
    expect("C: tom seksjon slettes uten valg", (await deleteSection(mia, empty, null)).data, true);
    const ftrSections = (await admin.from("channel_sections").select("position").eq("community_id", FTR).order("position")).data ?? [];
    expect("C: seksjonene er sammenhengende etter sletting", contiguous(ftrSections), true);

    // ── E. As rendered ────────────────────────────────────────────────────
    await checkRendered(mia, linn);

    // ── F. Who may write ──────────────────────────────────────────────────
    await checkWriteAccess({ mia, emma, kari, petter, linn, adrian });

    // ── G. Addresses are never reused ─────────────────────────────────────
    await checkRetiredAddresses({ mia, emma, linn });
  } finally {
    await cleanUp();
  }

  const after = await fingerprint();
  expect("Seed: kanalene er som før", after.channels, before.channels);
  expect("Seed: seksjonene er som før", after.sections, before.sections);
  expect("Seed: meldingene er som før", after.messages, before.messages);
  expect("Seed: feeden (innlegg, kommentarer, reaksjoner) er urørt", after.feed, before.feed);
  expect("Seed: lokallags- og gruppekanalene er de samme", sql(`select count(*) from channels where local_group_id is not null or subgroup_id is not null`), lokallagCount);
  expect("Seed: UTR er urørt", sql(`select count(*) from channels where community_id = '${UTR}' and name like '%${TAG}%'`), 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kanaladministrasjonskontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} kanaladministrasjonskontroller passerte`);
}

async function appReachable() {
  try {
    await fetch(`${APP}/login`, { redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

type Cast = { mia: Client; emma: Client; kari: Client; petter: Client; linn: Client; adrian: Client };

async function say(client: Client, channelId: string, body: string) {
  return code(await client.from("messages").insert({ channel_id: channelId, body: `${body} ${TAG}` }));
}

async function checkWriteAccess({ mia, emma, kari, petter, linn }: Cast) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  // 1–2. Open to everyone by default.
  const id = (await createChannel(mia, FTR, `Skriverett ${TAG}`)).data!;
  expect("F1: ny kanal er åpen for alle", (await channelRow(id))?.read_only, false);
  expect("F2: medlem kan skrive", await say(linn, id, "medlem"), "ok");

  // 3–7. Administrators and moderators only.
  expect("F3: admin gjør kanalen til bare administratorer og moderatorer", (await update(mia, id, `Skriverett ${TAG}`, "", true)).data, true);
  expect("F3: lagret som read_only", (await channelRow(id))?.read_only, true);
  expect("F4: medlem kan fortsatt lese", ((await linn.from("messages").select("id").eq("channel_id", id)).data ?? []).length, 1);
  expect("F4: medlem kan ikke skrive", await say(linn, id, "medlem nei"), "42501");
  expect("F5: moderator kan skrive", await say(kari, id, "moderator"), "ok");
  expect("F6: administrator kan skrive", await say(mia, id, "admin"), "ok");
  expect("F7: lokallagsleder uten moderatorrolle kan ikke skrive", await say(petter, id, "leder"), "42501");

  // 8. Files: no way to an attachment-only message.
  const policy = (await linn.rpc("message_attachment_policy", { p_channel_id: id, p_conversation_id: null as unknown as string }).maybeSingle()).data;
  expect("F8: vedleggspolicy sier nei til medlemmet", policy?.allowed ?? false, false);
  const begun = await linn
    .rpc("begin_message_attachment", {
      p_channel_id: id,
      p_conversation_id: null as unknown as string,
      p_display_name: "a.png",
      p_mime_type: "image/png",
      p_size_bytes: png.length,
    })
    .maybeSingle();
  expect("F8: medlem kan ikke starte en opplasting", Boolean(begun.error) || !begun.data?.attachment_id, true);
  const sent = await linn.rpc("send_channel_message_with_attachments", { p_channel_id: id, p_body: "", p_attachment_ids: [] });
  expect("F8: medlem kan ikke sende en melding med bare vedlegg", Boolean(sent.error) || !sent.data, true);
  const sentText = await linn.rpc("send_channel_message_with_attachments", { p_channel_id: id, p_body: `via rpc ${TAG}`, p_attachment_ids: [] });
  expect("F9: medlem kan ikke skrive via vedleggsfunksjonen", Boolean(sentText.error) || !sentText.data, true);
  if (await appReachable()) {
    const form = new FormData();
    form.set("file", new File([png as BlobPart], "a.png"));
    const upload = await fetch(`${APP}/community/${FTR}/attachments/upload?channel=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { Cookie: await sessionCookie("linn"), Origin: APP },
      body: form,
    });
    expect("F8: opplastingsruten avviser medlemmet", upload.status >= 400, true);
  }

  // 9. No other door.
  const loose = linn as unknown as Loose;
  const kariId = await profileId("karimoen");
  expect("F9: medlem kan ikke skrive i en moderators navn", code(await loose.from("messages").insert({ channel_id: id, author_id: kariId, body: "x" })), "42501");
  expect("F9: medlem kan ikke endre en melding", code(await loose.from("messages").update({ body: "x" }).eq("channel_id", id)), "42501");
  expect("F9: medlem kan ikke slette en melding", code(await loose.from("messages").delete().eq("channel_id", id)), "42501");
  expect("F9: medlem kan ikke åpne kanalen selv", (await update(linn, id, `Skriverett ${TAG}`, "", false)).data, false);
  expect("F9: medlem kan ikke åpne kanalen direkte", code(await loose.from("channels").update({ read_only: false }).eq("id", id)), "42501");
  expect("F9: moderator kan skrive, men ikke endre innstillingen", (await update(kari, id, `Skriverett ${TAG}`, "", false)).data, false);
  expect("F9: lokallagsleder kan ikke endre innstillingen", (await update(petter, id, `Skriverett ${TAG}`, "", false)).data, false);
  expect("F9: TU-admin kan ikke endre en FTR-kanal", (await update(emma, id, `Skriverett ${TAG}`, "", false)).data, false);
  expect("F9: navneendring rører ikke skriveretten", (await setDetails(mia, FTR, id, `Skriverett ${TAG}`, "ny")).data?.length, 1);
  expect("F9: fortsatt bare administratorer og moderatorer", (await channelRow(id))?.read_only, true);
  expect("F9: ugyldig verdi avvises", (await update(mia, id, `Skriverett ${TAG}`, "", null as unknown as boolean)).data, false);
  expect("F9: medlem kan ikke opprette en kanal, åpen eller ei", (await createChannel(linn, FTR, `Medlem ${TAG}`, { readOnly: false })).data ?? null, null);

  // 10. Back to everyone.
  expect("F10: admin åpner kanalen igjen", (await update(mia, id, `Skriverett ${TAG}`, "", false)).data, true);
  expect("F10: medlem kan skrive igjen", await say(linn, id, "medlem igjen"), "ok");

  // Created restricted from the start.
  const staffOnly = (await createChannel(mia, FTR, `Beskjeder ${TAG}`, { readOnly: true })).data!;
  expect("F: kanal kan opprettes som bare administratorer og moderatorer", (await channelRow(staffOnly))?.read_only, true);
  expect("F: … og medlemmet kan ikke skrive der", await say(linn, staffOnly, "nei"), "42501");
  expect("F: manglende valg avvises ved opprettelse", (await createChannel(mia, FTR, `Uten valg ${TAG}`, { readOnly: null })).data ?? null, null);

  // 11. Archived: nobody, whatever the setting.
  for (const readOnly of [false, true]) {
    await update(mia, id, `Skriverett ${TAG}`, "", readOnly);
    await archive(mia, id, true);
    const which = readOnly ? "bare stab" : "alle";
    expect(`F11 (${which}): arkivert — medlem kan ikke skrive`, await say(linn, id, "arkiv"), "42501");
    expect(`F11 (${which}): arkivert — moderator kan ikke skrive`, await say(kari, id, "arkiv"), "42501");
    expect(`F11 (${which}): arkivert — administrator kan ikke skrive`, await say(mia, id, "arkiv"), "42501");
    expect(`F11 (${which}): arkivert — kan fortsatt leses`, ((await linn.from("messages").select("id").eq("channel_id", id)).data ?? []).length, 4);
    await archive(mia, id, false);
  }

  // Seeded channels keep what they had.
  for (const community of [FTR, TU, UTR]) {
    expect(`F: ${community} #kunngjoringer er fortsatt bare for stab`, (await channelRow(`${community}--kunngjoringer`))?.read_only, true);
  }
  expect("F: private og lokallagskanaler er aldri read_only", sql(`select count(*) from channels where read_only and (is_private or local_group_id is not null or subgroup_id is not null)`), 0);
}

async function checkRetiredAddresses({ mia, emma, linn }: Pick<Cast, "mia" | "emma" | "linn">) {
  // 12–14.
  const name = `Adresse ${TAG}`;
  const first = (await createChannel(mia, FTR, name)).data!;
  expect("G12: kanalen har sin adresse", first, `${FTR}--adresse-${TAG}`);
  expect("G13: slettet", (await destroy(mia, first)).data, true);
  expect("G14: den gamle adressen finnes ikke", await channelRow(first), null);
  expect("G14: medlemmet ser den ikke", ((await linn.from("channels").select("id").eq("id", first)).data ?? []).length, 0);
  expect("G14: bare id-en er tatt vare på", sql(`select count(*) from messages where channel_id = '${first}'`), 0);

  // 15–17.
  const second = (await createChannel(mia, FTR, name)).data!;
  expect("G15: samme navn kan brukes igjen", typeof second, "string");
  expect("G16: … med en annen adresse", second, `${FTR}--adresse-${TAG}-2`);
  expect("G17: den gamle adressen finnes fortsatt ikke", await channelRow(first), null);
  const forced = await admin.from("channels").insert({ id: first, community_id: FTR, name: `Tvang ${TAG}`, purpose: "" });
  expect("G17: ikke engang serverens nøkkel kan ta adressen igjen", /channel_id_retired/.test(forced.error?.message ?? ""), true);
  const tu = (await createChannel(emma, TU, name)).data;
  expect("G: pensjonerte adresser gjelder per fellesskap", tu, `${TU}--adresse-${TAG}`);

  // 18.
  expect("G18: nytt navn", (await update(mia, second, `Nytt navn ${TAG}`, "", false)).data, true);
  expect("G18: adressen er den samme", (await channelRow(second))?.name, `Nytt navn ${TAG}`);
  expect("G18: navnet er ledig igjen, men den nye får ikke en brukt adresse", (await createChannel(mia, FTR, name)).data, `${FTR}--adresse-${TAG}-3`);

  // 19. Deleting and creating at the same moment.
  const third = `${FTR}--adresse-${TAG}-3`;
  const results = await Promise.all([
    destroy(mia, third),
    destroy(mia, second),
    createChannel(mia, FTR, name),
    createChannel(mia, FTR, `${name}!`),
    createChannel(mia, FTR, name.toUpperCase()),
  ]);
  const created = results.slice(2).map((result) => (result.data as string | null) ?? null).filter(Boolean) as string[];
  const retired = sql(`select string_agg(id, ',') from channel_retired_ids where id like '%adresse-${TAG}%'`).split(",");
  expect("G19: ingen ny kanal fikk en pensjonert adresse", created.some((id) => retired.includes(id) || id === first), false);
  expect("G19: alle nye adresser er forskjellige", new Set(created).size, created.length);
  expect("G19: alle tre gamle adresser er pensjonert", [first, second, third].every((id) => retired.includes(id)), true);

  if (await appReachable()) {
    const page = await (await fetch(`${APP}/community/${FTR}/channel/${first}`, { headers: { cookie: await sessionCookie("linn") } })).text();
    expect("G14/17: den gamle lenken svarer «finnes ikke»", page.includes("Kanalen finnes ikke"), true);
    expect("G17: … og leder ikke til den nye kanalen", page.includes(`/channel/${created[0]}"`) && page.includes("Dette er starten"), false);
  }
}

/** The sidebar and channel route as the app renders them for real sessions. */
async function checkRendered(mia: Client, linn: Client) {
  void linn;
  let reachable = true;
  try {
    await fetch(`${APP}/login`, { redirect: "manual" });
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.log(`  (E hoppet over: ingen app på ${APP})`);
    return;
  }
  const miaCookie = await sessionCookie("miaminge");
  const linnCookie = await sessionCookie("linn");
  const page = async (cookie: string, path: string) =>
    (await fetch(`${APP}${path}`, { headers: { cookie }, redirect: "manual" })).text();

  const name = `Synlig ${TAG}`;
  const id = (await createChannel(mia, FTR, name)).data!;
  const overview = await page(linnCookie, `/community/${FTR}`);
  expect("E: ny kanal står i medlemmets sidefelt", overview.includes(`/community/${FTR}/channel/${id}`), true);
  expect("E: medlemmet får ingen opprett-knapp", overview.includes("Opprett kanal"), false);
  const adminView = await page(miaCookie, `/community/${FTR}`);
  expect("E: administratoren får opprett-knappen", adminView.includes("Opprett kanal"), true);
  expect("E: administratoren får lenken til Kanaler", adminView.includes(`/community/${FTR}/kanaler`), true);

  await archive(mia, id, true);
  const archivedView = await page(linnCookie, `/community/${FTR}`);
  expect("E: arkivert kanal flyttes til «Arkiverte kanaler»", /Arkiverte kanaler \(\d+\)/.test(archivedView), true);
  const archivedPage = await page(linnCookie, `/community/${FTR}/channel/${id}`);
  expect("E: arkivert kanal kan åpnes og sier at den er arkivert", archivedPage.includes("Kanalen er arkivert"), true);

  await destroy(mia, id);
  const gone = await page(linnCookie, `/community/${FTR}/channel/${id}`);
  expect("E: slettet kanal svarer «finnes ikke» i fellesskapet", gone.includes("Kanalen finnes ikke"), true);
  expect("E: … uten navnet", gone.includes(name), false);
  expect("E: Kanaler-siden er stengt for medlemmer", (await page(linnCookie, `/community/${FTR}/kanaler`)).includes("Bare for administratorer"), true);
  expect("E: Kanaler-siden åpner for administratoren", (await page(miaCookie, `/community/${FTR}/kanaler`)).includes("Ny seksjon"), true);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => undefined);
  process.exit(1);
});
