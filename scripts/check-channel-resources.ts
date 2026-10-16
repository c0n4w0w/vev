/**
 * Checks a channel's Ressurser — links, folders, filing and pins
 * (20261031100000_channel_resources) — under real authenticated sessions.
 *
 * The rule, in short. Everything follows the channel: whoever can read it
 * reads its resources; whoever may write in it may add links, create folders
 * and file things; links and folders are changed by whoever added them or by
 * the community's administrators; only administrators pin. An archived
 * channel is read-only for everyone. Folders are at most three deep, never
 * cross channels, and deleting one never deletes a file or a link. Nothing
 * about a file's message or stored object changes when it is filed or pinned.
 *
 * Exercised the way an attacker would reach it: the RPCs the app calls and
 * direct table writes with anon-key clients signed in as fixture accounts,
 * and the resources route over HTTP (the dev server must be running). The
 * service role only reads state back, plays the server's part in an upload,
 * builds bulk rows, simulates a lapsed membership and a deleted message, and
 * cleans up.
 *
 * Run with `npm run check:channel-resources` against the local stack after
 * `npm run seed`, with the app on http://localhost:3000 (or CHECK_APP_URL).
 * Creates only disposable channels marked "CHECK ressurs" / "check-ressurs",
 * restores every membership it changes, and clears leftovers first.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanAttachmentName, detectAttachmentFileType } from "@/lib/attachment-file-type";
import { purgeAttachmentObjects } from "@/lib/attachment-storage";
import { channelTakesFiles, normalizeLinkUrl } from "@/lib/channel-resources";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { pdfFixture, pngFixture, type Fixture } from "./lib/attachment-fixtures";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const BUCKET = "message-attachments";
const TAG = "CHECK ressurs";
const PRIVATE = "check-ressurs";

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

async function signIn(handle: string): Promise<Client> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${handle}: ${verifyError.message}`);
  return client;
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

type RouteBody = {
  resources: { type: string; id: string; name: string; folderId?: string; pinned: boolean; href?: string; contributorName: string }[];
  nextCursor?: string;
  meta?: {
    pins: { id: string }[];
    folders: { id: string; parentId?: string; name: string; depth: number; resourceCount: number }[];
    contributors: { id: string; name: string; count: number }[];
    summary: { files: number; links: number; folders: number; pins: number };
  };
};

async function route(client: Client | null, communityId: string, channelId: string, query = "") {
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  const response = await fetch(`${APP}/community/${communityId}/channel/${encodeURIComponent(channelId)}/resources?${query}`, {
    headers,
    redirect: "manual",
  });
  if (!response.ok) {
    await response.arrayBuffer();
    return { status: response.status, body: undefined };
  }
  return { status: response.status, body: (await response.json()) as RouteBody };
}

async function httpStatus(client: Client | null, path: string): Promise<number> {
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  const response = await fetch(`${APP}${path}`, { headers, redirect: "manual" });
  await response.arrayBuffer();
  return response.status;
}

// ── The database, as the app and a curious member reach it ──────────────

/** The refusal code a resource function raised, or "ok". */
function code(result: { error: { message?: string; code?: string } | null }): string {
  if (!result.error) return "ok";
  const match = /resource_error:([a-z_]+)/.exec(result.error.message ?? "");
  return match ? match[1] : (result.error.code ?? result.error.message ?? "error");
}

const N = null as unknown as string;

const addLink = (client: Client, channelId: string, url: string, title = "Lenke", options: { folder?: string; description?: string } = {}) =>
  client.rpc("add_channel_link", {
    p_channel_id: channelId,
    p_folder_id: options.folder ?? N,
    p_url: url,
    p_title: title,
    p_description: options.description ?? "",
  });
const editLink = (client: Client, linkId: string, title: string, url = "https://example.org/endret") =>
  client.rpc("update_channel_link", { p_link_id: linkId, p_url: url, p_title: title, p_description: "" });
const removeLink = (client: Client, linkId: string) => client.rpc("delete_channel_link", { p_link_id: linkId });
const newFolder = (client: Client, channelId: string, name: string, parent?: string) =>
  client.rpc("create_channel_resource_folder", { p_channel_id: channelId, p_parent_id: parent ?? N, p_name: name });
const renameFolder = (client: Client, folderId: string, name: string) =>
  client.rpc("rename_channel_resource_folder", { p_folder_id: folderId, p_name: name });
const deleteFolder = (client: Client, folderId: string) => client.rpc("delete_channel_resource_folder", { p_folder_id: folderId });
const move = (client: Client, type: "file" | "link", id: string, folder: string | null) =>
  client.rpc("move_channel_resource", { p_type: type, p_id: id, p_folder_id: folder ?? N });
const pin = (client: Client, type: "file" | "link", id: string, pinned = true) =>
  client.rpc("set_channel_resource_pinned", { p_type: type, p_id: id, p_pinned: pinned });

type ListArgs = { search?: string; kind?: string; contributor?: string; folder?: string; pinned?: boolean; sort?: string; afterKey?: string; afterId?: string; limit?: number };

async function list(client: Client, channelId: string, args: ListArgs = {}) {
  const { data, error } = await client.rpc("channel_resources", {
    p_channel_id: channelId,
    p_search: args.search ?? N,
    p_kind: args.kind ?? N,
    p_contributor: args.contributor ?? N,
    p_folder: args.folder ?? N,
    p_pinned: args.pinned ?? false,
    p_sort: args.sort ?? "newest",
    p_after_key: args.afterKey ?? N,
    p_after_id: args.afterId ?? N,
    p_limit: args.limit ?? 30,
  });
  if (error) throw new Error(`channel_resources: ${error.message}`);
  return data ?? [];
}

async function listAll(client: Client, channelId: string, args: ListArgs = {}, pageSize = 20) {
  const out: Awaited<ReturnType<typeof list>> = [];
  let afterKey: string | undefined;
  let afterId: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const rows = await list(client, channelId, { ...args, afterKey, afterId, limit: pageSize });
    out.push(...rows);
    if (rows.length < pageSize) break;
    afterKey = rows[rows.length - 1].sort_key;
    afterId = rows[rows.length - 1].id;
  }
  return out;
}

async function upload(client: Client, channelId: string, file: Fixture): Promise<string> {
  const type = detectAttachmentFileType(file.bytes, file.name)!;
  const { data } = await client
    .rpc("begin_message_attachment", {
      p_channel_id: channelId,
      p_conversation_id: N,
      p_display_name: cleanAttachmentName(file.name, type),
      p_mime_type: type.mimeType,
      p_size_bytes: file.bytes.byteLength,
    })
    .maybeSingle();
  if (!data) throw new Error("kunne ikke starte opplasting");
  await admin.storage.from(BUCKET).upload(data.storage_path, file.bytes, { contentType: type.mimeType });
  await admin.rpc("complete_message_attachment", { p_attachment_id: data.attachment_id });
  return data.attachment_id;
}

async function share(client: Client, channelId: string, file: Fixture): Promise<{ attachmentId: string; messageId: string }> {
  const attachmentId = await upload(client, channelId, file);
  const { data, error } = await client.rpc("send_channel_message_with_attachments", {
    p_channel_id: channelId,
    p_body: "",
    p_attachment_ids: [attachmentId],
  });
  if (error || !data) throw new Error(`kunne ikke sende: ${error?.message}`);
  return { attachmentId, messageId: data as string };
}

async function createChannel(client: Client, name: string, options: { fileSharing?: boolean; readOnly?: boolean } = {}) {
  const { data, error } = await client.rpc("create_community_channel", {
    p_community_id: FTR,
    p_name: name,
    p_purpose: "",
    p_section_id: N,
    p_creation_key: N,
    p_read_only: options.readOnly ?? false,
    p_file_sharing: options.fileSharing ?? false,
  });
  if (error || !data) throw new Error(`kunne ikke opprette ${name}: ${error?.message}`);
  return data;
}

const touched: { userId: string; communityId: string; status: Database["public"]["Enums"]["membership_status"] }[] = [];

async function setMembershipStatus(userId: string, communityId: string, status: Database["public"]["Enums"]["membership_status"]) {
  if (!touched.some((entry) => entry.userId === userId && entry.communityId === communityId)) {
    const { data } = await admin.from("memberships").select("status").eq("user_id", userId).eq("community_id", communityId).single();
    touched.push({ userId, communityId, status: data!.status });
  }
  await admin.from("memberships").update({ status }).eq("user_id", userId).eq("community_id", communityId);
}

/** Real lokallag chats this suite switches, with the value to put back. */
const lokallagFlags = new Map<string, boolean>();
/** Memberships moved out of their lokallag, with the lokallag to put back. */
const movedMembers: { userId: string; communityId: string; localGroupId: string | null }[] = [];

async function cleanup() {
  for (const entry of touched.splice(0)) {
    await admin.from("memberships").update({ status: entry.status }).eq("user_id", entry.userId).eq("community_id", entry.communityId);
  }
  for (const entry of movedMembers.splice(0)) {
    await admin.from("memberships").update({ local_group_id: entry.localGroupId }).eq("user_id", entry.userId).eq("community_id", entry.communityId);
  }
  // What this suite put into real lokallag chats: marked links, folders and
  // files, and the messages that carried the files.
  sql(`delete from channel_links where title like '${TAG}%'`);
  sql(`delete from channel_resource_folders where name like '${TAG}%'`);
  sql(`delete from messages where id in (select message_id from message_attachments where display_name like '${TAG}%' and message_id is not null)`);
  sql(`delete from message_attachments where display_name like '${TAG}%'`);
  for (const [channelId, value] of lokallagFlags) {
    sql(`update channels set file_sharing_enabled = ${value} where id = '${channelId}'`);
  }
  lokallagFlags.clear();
  sql(`delete from channels where (name like '${TAG}%' and local_group_id is null and subgroup_id is null) or (is_private and name like '${PRIVATE}%')`);
  sql(`delete from channel_retired_ids where id like '%check-ressurs%'`);
  for (let pass = 0; pass < 10; pass += 1) {
    const result = await purgeAttachmentObjects(1000);
    if (result.remaining === 0 || result.removed === 0) break;
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

  const [mia, emma, kari, linn, petter, kristoffer, amina, sofie] = await Promise.all(
    ["miaminge", "emmamortensen", "karimoen", "linn", "petter", "kristoffer", "amina", "sofie"].map(signIn),
  );
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const id = (handle: string) => ids[handle];
  const loose = (client: Client) => client as unknown as Loose;

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    const TABLES = ["channel_resource_folders", "channel_links", "channel_attachment_placements", "channel_resource_pins"];
    for (const table of TABLES) {
      expect(`A: ${table} har radsikkerhet`, sql(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`), "t");
      expect(
        `A: authenticated bare leser ${table}`,
        sql(`select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name = '${table}' and grantee = 'authenticated'`),
        "SELECT",
      );
      expect(`A: anon har ingenting på ${table}`, sql(`select count(*) from information_schema.role_table_grants where table_name = '${table}' and grantee = 'anon'`), 0);
      expect(`A: ingen skrivepolicy på ${table}`, sql(`select count(*) from pg_policies where tablename = '${table}' and cmd <> 'SELECT'`), 0);
    }
    const FUNCTIONS = [
      "add_channel_link(text,uuid,text,text,text)",
      "update_channel_link(uuid,text,text,text)",
      "delete_channel_link(uuid)",
      "create_channel_resource_folder(text,uuid,text)",
      "rename_channel_resource_folder(uuid,text)",
      "delete_channel_resource_folder(uuid)",
      "move_channel_resource(text,uuid,uuid)",
      "set_channel_resource_pinned(text,uuid,boolean)",
      "channel_resources(text,text,text,uuid,text,boolean,text,text,uuid,integer)",
      "channel_resource_folders(text)",
      "channel_resource_summary(text)",
      "channel_resource_contributors(text)",
      "channel_resource_permissions(text)",
      "set_channel_file_sharing(text,boolean)",
    ];
    for (const fn of FUNCTIONS) {
      expect(`A: ${fn} har fast search_path`, sql(`select proconfig::text from pg_proc where oid = 'public.${fn}'::regprocedure`), "{search_path=public}");
      expect(`A: anon kan ikke kjøre ${fn}`, sql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
      expect(`A: authenticated kan kjøre ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "t");
    }
    for (const fn of ["channel_resource_rights(uuid,text)", "require_channel_resource_rights(text,boolean,uuid)"]) {
      expect(`A: ${fn} er intern`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "f");
    }

    // Disposable channels: files on, files off, restricted.
    const R = await createChannel(mia, `${TAG} hoved`, { fileSharing: true });
    const OFF = await createChannel(mia, `${TAG} uten filer`);
    const RO = await createChannel(mia, `${TAG} kunngjøring`, { readOnly: true });
    const ftrOslo = sql(`select id from community_local_groups where community_id = '${FTR}' and name = 'FTR Oslo'`);
    const mainLokallag = sql(`select id from channels where local_group_id = '${ftrOslo}' and not is_private`);

    // ════ B. Links ═════════════════════════════════════════════════════
    const l1 = await addLink(linn, R, "https://docs.example.org/budsjett", "Budsjett 2027", { description: "Regneark i Drive" });
    expect("B: medlem legger til lenke", code(l1), "ok");
    const linnLink = l1.data!;
    expect("B: lenke uten at filopplasting er slått på", code(await addLink(linn, OFF, "https://example.org/a", "Uten filer")), "ok");
    for (const [label, url] of [
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:text/html,<b>x</b>"],
      ["ftp:", "ftp://files.example.org/x"],
      ["brukernavn og passord", "https://user:pw@example.org/x"],
      ["mellomrom", "https://exa mple.org/x"],
      ["uten vert", "https:///sti"],
      ["store bokstaver i vert (ikke normalisert)", "https://EXAMPLE.org/x"],
      ["tom", ""],
    ] as const) {
      expect(`B: ugyldig adresse avvises (${label})`, code(await addLink(linn, R, url, "x")), "link_url");
    }
    expect("B: tittel kreves", code(await addLink(linn, R, "https://example.org/x", "   ")), "link_title");
    expect("B: for lang tittel", code(await addLink(linn, R, "https://example.org/x", "x".repeat(121))), "link_title");
    expect("B: for lang beskrivelse", code(await addLink(linn, R, "https://example.org/x", "x", { description: "y".repeat(301) })), "link_description");
    expect("B: normalisering i appen: internasjonalt navn", normalizeLinkUrl("https://blåbær.no/side"), "https://xn--blbr-roah.no/side");
    expect("B: normalisering i appen: adresse uten skjema", normalizeLinkUrl("example.org/side"), "https://example.org/side");
    expect("B: normalisering i appen: javascript avvises", normalizeLinkUrl("javascript:alert(1)"), undefined);
    expect("B: normalisering i appen: passord avvises", normalizeLinkUrl("https://a:b@example.org"), undefined);
    expect("B: medlem kan ikke skrive tabellen direkte", (await loose(linn).from("channel_links").insert({ channel_id: R, url: "https://example.org/z", title: "z" })).error?.code, "42501");
    expect("B: … heller ikke endre", (await loose(linn).from("channel_links").update({ title: "kapret" }).eq("id", linnLink)).error?.code, "42501");
    expect("B: … heller ikke slette", (await loose(linn).from("channel_links").delete().eq("id", linnLink)).error?.code, "42501");

    expect("B: eier endrer egen lenke", code(await editLink(linn, linnLink, "Budsjett 2027 (oppdatert)")), "ok");
    expect("B: annet medlem kan ikke endre den", code(await editLink(petter, linnLink, "kapret")), "not_allowed");
    expect("B: moderator kan ikke endre andres lenke", code(await editLink(kari, linnLink, "kapret")), "not_allowed");
    expect("B: administrator kan endre alle lenker", code(await editLink(mia, linnLink, "Budsjett 2027")), "ok");
    expect("B: TU-administrator finner den ikke", code(await editLink(emma, linnLink, "kapret")), "not_found");
    expect("B: tittelen er administratorens", sql(`select title from channel_links where id = '${linnLink}'`), "Budsjett 2027");
    expect("B: annet medlem kan ikke fjerne den", code(await removeLink(petter, linnLink)), "not_allowed");

    expect("B: begrenset kanal – medlem kan ikke legge til", code(await addLink(linn, RO, "https://example.org/x", "x")), "not_allowed");
    expect("B: begrenset kanal – moderator kan", code(await addLink(kari, RO, "https://example.org/x", "Fra moderator")), "ok");
    expect("B: TU-medlem kan ikke legge til i et FTR-lokallag", code(await addLink(emma, mainLokallag, "https://example.org/x", `${TAG} x`)), "not_found");
    expect("B: TU-administrator kan ikke legge til i FTR", code(await addLink(emma, R, "https://example.org/x", "x")), "not_found");
    expect("B: uten medlemskap: ikke funnet", code(await addLink(sofie, R, "https://example.org/x", "x")), "not_found");
    expect("B: uinnlogget: ingen tilgang", (await anon.rpc("add_channel_link", { p_channel_id: R, p_folder_id: N, p_url: "https://example.org/x", p_title: "x", p_description: "" })).error?.code, "42501");

    // ════ C. Folders ═══════════════════════════════════════════════════
    const fA = (await newFolder(linn, R, "Styret")).data!;
    const fB = (await newFolder(linn, R, "2027", fA)).data!;
    const fC = (await newFolder(linn, R, "Budsjett", fB)).data!;
    expect("C: tre nivåer", sql(`select string_agg(depth::text, ',' order by depth) from channel_resource_folders where channel_id = '${R}'`), "1,2,3");
    expect("C: et fjerde nivå avvises", code(await newFolder(linn, R, "For dypt", fC)), "folder_depth");
    expect("C: samme navn i samme mappe avvises (uten hensyn til store/små)", code(await newFolder(linn, R, "styret")), "folder_name_taken");
    expect("C: samme navn i en annen mappe går", code(await newFolder(linn, R, "Styret", fA)), "ok");
    expect("C: tomt navn avvises", code(await newFolder(linn, R, "   ")), "folder_name");
    const offFolder = (await newFolder(linn, OFF, "Annen kanal")).data!;
    expect("C: overmappe fra en annen kanal avvises", code(await newFolder(linn, R, "Kryss", offFolder)), "not_found");
    expect("C: begrenset kanal – medlem kan ikke lage mapper", code(await newFolder(linn, RO, "x")), "not_allowed");
    expect("C: TU-administrator kan ikke lage mapper i FTR", code(await newFolder(emma, R, "x")), "not_found");
    expect("C: annet medlem kan ikke gi mappen nytt navn", code(await renameFolder(petter, fA, "Kapret")), "not_allowed");
    expect("C: administrator kan", code(await renameFolder(mia, fA, "Styret og ledelse")), "ok");
    expect("C: eier kan", code(await renameFolder(linn, fA, "Styret")), "ok");
    expect("C: nytt navn som en søster allerede har, avvises", code(await renameFolder(linn, fB, "STYRET")), "folder_name_taken");
    expect("C: en ny søstermappe", code(await newFolder(linn, R, "Søster", fA)), "ok");
    expect("C: samme navn som en mappe på et annet nivå går", code(await renameFolder(linn, fB, "Budsjett")), "ok");
    await renameFolder(linn, fB, "2027");
    expect("C: medlem kan ikke skrive mapper direkte", (await loose(linn).from("channel_resource_folders").insert({ channel_id: R, name: "x", depth: 1 })).error?.code, "42501");
    expect(
      "C: en mappe kan ikke flyttes, heller ikke med tjenestenøkkel",
      Boolean((await admin.from("channel_resource_folders").update({ parent_id: null, depth: 1 }).eq("id", fB)).error),
      true,
    );
    expect(
      "C: ingen mappe kan peke på en mappe i en annen kanal",
      Boolean((await admin.from("channel_resource_folders").insert({ channel_id: R, parent_id: offFolder, name: "kryss", depth: 2 })).error),
      true,
    );

    // ════ D. Filing ════════════════════════════════════════════════════
    const fileOne = await share(linn, R, pdfFixture(`${TAG} referat.pdf`));
    const fileTwo = await share(petter, R, await pngFixture(`${TAG} plakat.png`));
    const before = sql(`select message_id || '|' || storage_path || '|' || status from message_attachments where id = '${fileOne.attachmentId}'`);
    expect("D: medlem legger en fil i en undermappe", code(await move(linn, "file", fileOne.attachmentId, fB)), "ok");
    expect("D: annet medlem kan også ordne (samarbeid)", code(await move(petter, "file", fileOne.attachmentId, fC)), "ok");
    expect("D: lenke i en mappe", code(await move(linn, "link", linnLink, fC)), "ok");
    expect("D: fila er i mappen", (await list(linn, R, { folder: fC })).map((r) => r.id).sort().join(), [fileOne.attachmentId, linnLink].sort().join());
    expect("D: ikke i «Uten mappe»", (await list(linn, R, { folder: "none" })).some((r) => r.id === fileOne.attachmentId), false);
    expect("D: men i «Alle»", (await list(linn, R)).some((r) => r.id === fileOne.attachmentId), true);
    expect("D: meldingen og lagringsstedet er uendret", sql(`select message_id || '|' || storage_path || '|' || status from message_attachments where id = '${fileOne.attachmentId}'`), before);
    expect("D: én plassering, ikke en kopi", sql(`select count(*) from channel_attachment_placements where attachment_id = '${fileOne.attachmentId}'`), 1);
    expect("D: kan ikke flyttes til en mappe i en annen kanal", code(await move(linn, "file", fileOne.attachmentId, offFolder)), "not_found");
    const offLink = (await addLink(linn, OFF, "https://example.org/off", "Annen kanal")).data!;
    expect("D: lenke fra en annen kanal kan ikke legges i denne kanalens mappe", code(await move(linn, "link", offLink, fA)), "not_found");
    expect("D: plassering på tvers av kanaler er umulig også med tjenestenøkkel",
      Boolean((await admin.from("channel_attachment_placements").insert({ attachment_id: fileOne.attachmentId, channel_id: OFF, folder_id: offFolder })).error), true);
    const pending = await upload(linn, R, pdfFixture(`${TAG} usendt.pdf`));
    expect("D: en usendt opplasting kan ikke ordnes", code(await move(linn, "file", pending, fA)), "not_found");
    expect("D: TU-administrator finner ikke fila", code(await move(emma, "file", fileOne.attachmentId, null)), "not_found");
    expect("D: oppdiktet id", code(await move(linn, "file", "00000000-0000-4000-8000-000000000000", null)), "not_found");
    expect("D: medlem kan ikke skrive plasseringer direkte", (await loose(linn).from("channel_attachment_placements").delete().eq("attachment_id", fileOne.attachmentId)).error?.code, "42501");

    // ════ E. Pins ══════════════════════════════════════════════════════
    expect("E: medlem kan ikke feste", code(await pin(linn, "file", fileOne.attachmentId)), "not_allowed");
    expect("E: moderator kan ikke feste", code(await pin(kari, "link", linnLink)), "not_allowed");
    expect("E: administrator fester en fil", code(await pin(mia, "file", fileOne.attachmentId)), "ok");
    expect("E: administrator fester en lenke", code(await pin(mia, "link", linnLink)), "ok");
    expect("E: å feste igjen lager ikke en ny", code(await pin(mia, "file", fileOne.attachmentId)), "ok");
    expect("E: to festede, ingen duplikater", sql(`select count(*) from channel_resource_pins where channel_id = '${R}'`), 2);
    expect("E: ingen fil er kopiert", sql(`select count(*) from message_attachments where channel_id = '${R}' and status = 'sent'`), 2);
    expect("E: medlemmer ser de festede", (await list(linn, R, { pinned: true })).map((r) => r.id).sort().join(), [fileOne.attachmentId, linnLink].sort().join());
    expect("E: festet uansett mappe", (await list(linn, R, { pinned: true })).every((r) => r.folder_id === fC), true);
    expect("E: TU-administrator kan ikke feste", code(await pin(emma, "file", fileOne.attachmentId)), "not_found");
    expect("E: medlem kan ikke skrive festene direkte", (await loose(linn).from("channel_resource_pins").delete().eq("channel_id", R)).error?.code, "42501");
    expect("E: løsne", code(await pin(mia, "file", fileOne.attachmentId, false)), "ok");
    await pin(mia, "file", fileOne.attachmentId);
    const many: string[] = [];
    for (let n = 0; n < 19; n += 1) many.push((await addLink(linn, R, `https://example.org/mange/${n}`, `Mange ${n}`)).data!);
    for (const link of many.slice(0, 18)) await pin(mia, "link", link);
    expect("E: høyst 20 festede", code(await pin(mia, "link", many[18])), "pin_limit");

    // ════ F. Search, filters, sorting and paging ═══════════════════════
    const names = ["Ål.txt", "Øl-plan", "Æble-ark", "apple", "Zebra"];
    for (const title of names) await addLink(petter, R, `https://example.org/${encodeURIComponent(title)}`, title);
    const all = await listAll(linn, R, {}, 7);
    const total = Number(sql(`select (select count(*) from channel_links where channel_id = '${R}') + (select count(*) from message_attachments where channel_id = '${R}' and status = 'sent')`));
    expect("F: alle ressurser over mange sider, ingen dubletter", `${all.length}/${new Set(all.map((r) => r.id)).size}`, `${total}/${total}`);
    expect("F: søk finner det som ligger dypt i en mappe", (await list(linn, R, { search: "referat" })).map((r) => r.id).join(), fileOne.attachmentId);
    expect("F: søk på lenketittel", (await list(linn, R, { search: "budsjett 2027" })).map((r) => r.id).join(), linnLink);
    expect("F: bare lenker", (await listAll(linn, R, { kind: "link" })).every((r) => r.resource_type === "link"), true);
    expect("F: bare filer", (await listAll(linn, R, { kind: "file" })).map((r) => r.resource_type).join(), "file,file");
    expect("F: bilder", (await list(linn, R, { kind: "image" })).map((r) => r.id).join(), fileTwo.attachmentId);
    expect("F: dokumenter", (await list(linn, R, { kind: "document" })).map((r) => r.id).join(), fileOne.attachmentId);
    expect("F: bidragsyter", (await listAll(linn, R, { contributor: id("petter") })).length, names.length + 1);
    const byName = (await listAll(linn, R, { kind: "link", contributor: id("petter"), sort: "name_asc" }, 2)).map((r) => r.name);
    expect("F: A–Å med norsk rekkefølge, over sider", byName.join(" | "), "apple | Zebra | Æble-ark | Øl-plan | Ål.txt");
    const byNameDesc = (await listAll(linn, R, { kind: "link", contributor: id("petter"), sort: "name_desc" }, 2)).map((r) => r.name);
    expect("F: Å–A", byNameDesc.join(" | "), [...byName].reverse().join(" | "));
    const oldest = await listAll(linn, R, { sort: "oldest" }, 9);
    expect("F: eldste først er motsatt av nyeste", oldest.map((r) => r.id).join(), [...all].reverse().map((r) => r.id).join());
    expect("F: søk + type + mappe", (await list(linn, R, { search: "budsjett", kind: "link", folder: fC })).length, 1);
    expect("F: ugyldig mappe-id gir ingenting", (await list(linn, R, { folder: "ikke-en-id" })).length, 0);

    // The route, as the dialog reads it.
    const first = await route(linn, FTR, R, "meta=1");
    expect("F: ruten svarer", first.status, 200);
    expect("F: ruten gir festede", first.body?.meta?.pins.length, 20);
    expect("F: ruten gir mappene", first.body?.meta?.folders.length, 5);
    expect("F: ruten teller", JSON.stringify(first.body?.meta?.summary), JSON.stringify({ files: 2, links: total - 2, folders: 5, pins: 20 }));
    expect("F: lenker har adresse og navn på bidragsyter", first.body?.resources.filter((r) => r.type === "link").every((r) => r.href?.startsWith("https://") && r.contributorName), true);
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await route(linn, FTR, R, `sort=name_asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const resource of result.body?.resources ?? []) seen.add(resource.id);
      cursor = result.body?.nextCursor;
      if (!cursor) break;
    }
    expect("F: ruten blar gjennom alt", seen.size, total);
    expect("F: feil fellesskap i adressen: 404", (await route(linn, TU, R)).status, 404);
    expect("F: TU-administrator: 404", (await route(emma, FTR, R)).status, 404);
    expect("F: uten medlemskap: 404", (await route(sofie, FTR, R)).status, 404);
    expect("F: uinnlogget: 404", (await route(null, FTR, R)).status, 404);
    expect("F: TU-administrator får ingen rader", (await list(emma, R)).length, 0);
    expect("F: TU-administrator leser ikke tabellene direkte", ((await emma.from("channel_links").select("id").eq("channel_id", R)).data ?? []).length, 0);
    expect("F: medlem leser tabellene direkte (samme regel som kanalen)", ((await linn.from("channel_links").select("id").eq("channel_id", R)).data ?? []).length, total - 2);
    expect("F: uinnlogget kan ikke kalle channel_resources", (await anon.rpc("channel_resources", { p_channel_id: R })).error?.code, "42501");

    // ════ G. Archived ══════════════════════════════════════════════════
    await mia.rpc("set_community_channel_archived", { p_channel_id: R, p_archived: true });
    expect("G: arkivert – lenke avvises", code(await addLink(linn, R, "https://example.org/arkiv", "x")), "archived");
    expect("G: arkivert – administrator kan heller ikke endre", code(await editLink(mia, linnLink, "x")), "archived");
    expect("G: arkivert – mappe avvises", code(await newFolder(mia, R, "x")), "archived");
    expect("G: arkivert – flytting avvises", code(await move(linn, "file", fileOne.attachmentId, null)), "archived");
    expect("G: arkivert – feste avvises", code(await pin(mia, "file", fileTwo.attachmentId)), "archived");
    expect("G: arkivert – sletting av mappe avvises", code(await deleteFolder(mia, fA)), "archived");
    expect("G: arkivert – alt kan fortsatt leses", (await listAll(linn, R)).length, total);
    await mia.rpc("set_community_channel_archived", { p_channel_id: R, p_archived: false });
    expect("G: gjenopprettet – mappene og festene er som før", sql(`select (select count(*) from channel_resource_folders where channel_id = '${R}') || '/' || (select count(*) from channel_resource_pins where channel_id = '${R}')`), "5/20");

    // ════ H. Deleting things ═══════════════════════════════════════════
    const before2 = Number(sql(`select count(*) from channel_links where channel_id = '${R}'`));
    const deleted = await deleteFolder(linn, fA);
    expect("H: eier sletter en mappe med undermapper", code(deleted), "ok");
    expect("H: det som lå i dem, blir meldt flyttet", deleted.data, 2);
    expect("H: alle tre undermappene er borte", sql(`select count(*) from channel_resource_folders where id in ('${fA}', '${fB}', '${fC}')`), 0);
    expect("H: ingen lenke ble slettet", Number(sql(`select count(*) from channel_links where channel_id = '${R}'`)), before2);
    expect("H: fila er der fortsatt, uten mappe", (await list(linn, R, { folder: "none" })).some((r) => r.id === fileOne.attachmentId), true);
    expect("H: lenka er der fortsatt, uten mappe", sql(`select folder_id is null from channel_links where id = '${linnLink}'`), "t");
    expect("H: festene står", sql(`select count(*) from channel_resource_pins where attachment_id = '${fileOne.attachmentId}' or link_id = '${linnLink}'`), 2);
    expect("H: eier fjerner egen lenke", code(await removeLink(linn, linnLink)), "ok");
    expect("H: festet forsvant med lenka", sql(`select count(*) from channel_resource_pins where link_id = '${linnLink}'`), 0);
    await move(linn, "file", fileTwo.attachmentId, (await newFolder(linn, R, "Bilder")).data!);
    await pin(mia, "link", many[18]);
    sql(`delete from channel_resource_pins where link_id = '${many[18]}'`);
    await pin(mia, "file", fileTwo.attachmentId);
    await admin.from("messages").delete().eq("id", fileTwo.messageId);
    expect("H: slettet melding – plasseringen og festet forsvant", sql(`select (select count(*) from channel_attachment_placements where attachment_id = '${fileTwo.attachmentId}') + (select count(*) from channel_resource_pins where attachment_id = '${fileTwo.attachmentId}')`), 0);
    expect("H: slettet melding – ute av biblioteket", (await listAll(linn, R)).some((r) => r.id === fileTwo.attachmentId), false);

    // ════ I. Private lokallag channels ═════════════════════════════════
    const privateId = (await mia.rpc("create_private_channel", { p_local_group_id: ftrOslo, p_name: `${PRIVATE} privat`, p_purpose: "", p_participant_ids: [id("kristoffer")] })).data as string;
    expect("I: deltaker legger til lenke", code(await addLink(kristoffer, privateId, "https://example.org/privat", "Privat plan")), "ok");
    expect("I: deltaker lager mappe", code(await newFolder(kristoffer, privateId, "Privat mappe")), "ok");
    expect("I: moderator utenfor kanalen ser ingenting", (await list(amina, privateId)).length, 0);
    expect("I: … får 404 på ruten", (await route(amina, FTR, privateId)).status, 404);
    expect("I: … kan ikke legge til", code(await addLink(amina, privateId, "https://example.org/x", "x")), "not_found");
    expect("I: … leser ikke tabellen direkte", ((await amina.from("channel_links").select("id").eq("channel_id", privateId)).data ?? []).length, 0);
    expect("I: administrator ser den", (await list(mia, privateId)).length, 1);
    await mia.rpc("remove_private_channel_participant", { p_channel_id: privateId, p_user_id: id("kristoffer") });
    expect("I: fjernet – ser ingenting med en gang", (await list(kristoffer, privateId)).length, 0);
    expect("I: fjernet – kan ikke legge til", code(await addLink(kristoffer, privateId, "https://example.org/x", "x")), "not_found");
    expect("I: fjernet – 404 på ruten", (await route(kristoffer, FTR, privateId)).status, 404);
    await mia.rpc("add_private_channel_participant", { p_channel_id: privateId, p_user_id: id("kristoffer") });
    expect("I: lagt til igjen – ser igjen", (await list(kristoffer, privateId)).length, 1);

    // ════ J. Membership ending ═════════════════════════════════════════
    await setMembershipStatus(id("linn"), FTR, "invited");
    expect("J: tidligere medlem ser ingenting", (await list(linn, R)).length, 0);
    expect("J: … leser ikke tabellene", ((await linn.from("channel_links").select("id").eq("channel_id", R)).data ?? []).length, 0);
    expect("J: … kan ikke endre egne lenker", code(await editLink(linn, many[0], "x")), "not_found");
    expect("J: … 404 på ruten", (await route(linn, FTR, R)).status, 404);
    await setMembershipStatus(id("linn"), FTR, "active");
    expect("J: medlem igjen – ser igjen", (await list(linn, R)).length > 0, true);

    // ════ L. A lokallag's main chat ════════════════════════════════════
    // Real chats of the seed (FTR Trøndelag, led by Petter; FTR Oslo); every
    // change here is marked and put back by cleanup().
    const ftrTrondelag = sql(`select id from community_local_groups where community_id = '${FTR}' and name = 'FTR Trøndelag'`);
    const TRD = sql(`select id from channels where local_group_id = '${ftrTrondelag}' and not is_private`);
    const OSLO = mainLokallag;
    for (const chat of [TRD, OSLO]) {
      lokallagFlags.set(chat, sql(`select file_sharing_enabled from channels where id = '${chat}'`) === "t");
    }
    sql(`update channels set file_sharing_enabled = false where id in ('${TRD}', '${OSLO}')`);
    const [eli] = await Promise.all(["elironning"].map(signIn));
    const setSharing = (client: Client, chat: string, on: boolean) => client.rpc("set_channel_file_sharing", { p_channel_id: chat, p_enabled: on });
    const perms = async (client: Client, chat: string) => {
      const { data } = await client.rpc("channel_resource_permissions", { p_channel_id: chat }).maybeSingle();
      return data ? `${data.can_read}/${data.can_contribute}/${data.can_manage}/${data.can_configure_uploads}` : "ingen";
    };
    const policyOf = async (client: Client, chat: string) => {
      const { data } = await client.rpc("message_attachment_policy", { p_channel_id: chat, p_conversation_id: N }).maybeSingle();
      return data ? `${data.reason}/${Number(data.max_bytes) / 1048576}/${data.max_files}` : "ingen";
    };

    // Who may do what, as the interface is told.
    expect("L: leder av lokallaget – leser, bidrar, forvalter, styrer opplasting", await perms(petter, TRD), "true/true/true/true");
    expect("L: vanlig medlem av lokallaget – leser og bidrar", await perms(eli, TRD), "true/true/false/false");
    expect("L: moderator i lokallaget uten lederrolle – leser og bidrar", await perms(kari, TRD), "true/true/false/false");
    expect("L: administrator – alt", await perms(mia, TRD), "true/true/true/true");
    expect("L: medlem uten lokallag – ingenting", await perms(linn, TRD), "false/false/false/false");
    expect("L: medlem av et annet lokallag – ingenting", await perms(kristoffer, TRD), "false/false/false/false");
    expect("L: leder av et annet lokallag – ingenting i Oslo", await perms(petter, OSLO), "false/false/false/false");
    expect("L: TU-administrator – ingenting", await perms(emma, TRD), "false/false/false/false");

    // Uploads: off by default, switched by admins and that lokallag's leaders only.
    expect("L: av som standard – ingen vedlegg", await policyOf(eli, TRD), "unsupported/0/0");
    expect("L: av – appen tilbyr ikke binders", channelTakesFiles({ fileSharing: false }), false);
    expect("L: medlem kan ikke slå på", (await setSharing(eli, TRD, true)).data, false);
    expect("L: moderator (ikke leder) kan ikke slå på", (await setSharing(kari, TRD, true)).data, false);
    expect("L: medlem uten lokallag kan ikke", (await setSharing(linn, TRD, true)).data, false);
    expect("L: leder kan ikke slå på i et annet lokallag", (await setSharing(petter, OSLO, true)).data, false);
    expect("L: TU-administrator kan ikke", (await setSharing(emma, TRD, true)).data, false);
    expect("L: medlem kan ikke skrive flagget direkte", (await loose(eli).from("channels").update({ file_sharing_enabled: true }).eq("id", TRD)).error?.code, "42501");
    expect("L: fortsatt av", sql(`select file_sharing_enabled from channels where id = '${TRD}'`), "f");
    expect("L: lederen slår på", (await setSharing(petter, TRD, true)).data, true);
    expect("L: på – medlemmet kan legge ved, med de vanlige grensene", await policyOf(eli, TRD), "ok/25/5");
    expect("L: på – medlem av et annet lokallag kan ikke", await policyOf(kristoffer, TRD), "not_found/0/0");
    expect("L: på – medlem uten lokallag kan ikke", await policyOf(linn, TRD), "not_found/0/0");
    expect("L: administrator slår av og på i Oslo", `${(await setSharing(mia, OSLO, true)).data}/${(await setSharing(mia, OSLO, false)).data}`, "true/true");
    expect("L: private kanaler har ingen bryter", (await setSharing(mia, privateId, true)).data, false);

    // Files, links, folders.
    const trdFile = await share(eli, TRD, pdfFixture(`${TAG} lokallag referat.pdf`));
    const trdLink = (await addLink(eli, TRD, "https://example.org/lokallag", `${TAG} lokallagsplan`)).data!;
    expect("L: medlemmet la til en lenke", Boolean(trdLink), true);
    const trdFolder = (await newFolder(eli, TRD, `${TAG} Styre`)).data!;
    expect("L: medlemmet lagde en mappe", Boolean(trdFolder), true);
    expect("L: medlemmet ordner fila", code(await move(eli, "file", trdFile.attachmentId, trdFolder)), "ok");
    expect("L: tre nivåer også her", code(await newFolder(eli, TRD, `${TAG} b`, (await newFolder(eli, TRD, `${TAG} a`, trdFolder)).data!)), "ok");
    expect("L: lokallagets ressurser er der", (await list(eli, TRD, { search: TAG })).length, 2);
    expect("L: medlem av et annet lokallag kan ikke legge til", code(await addLink(kristoffer, TRD, "https://example.org/x", `${TAG} x`)), "not_found");
    expect("L: medlem uten lokallag kan ikke legge til", code(await addLink(linn, TRD, "https://example.org/x", `${TAG} x`)), "not_found");
    expect("L: medlem uten lokallag ser ingenting", (await list(linn, TRD)).length, 0);
    expect("L: leder av et annet lokallag ser ingenting", (await list(petter, OSLO, { search: TAG })).length, 0);
    expect("L: medlem av et annet lokallag ser ingenting", (await list(kristoffer, TRD)).length, 0);
    expect("L: … heller ikke i tabellene", ((await kristoffer.from("channel_links").select("id").eq("channel_id", TRD)).data ?? []).length, 0);
    expect("L: … og får 404 på ruten", (await route(kristoffer, FTR, TRD)).status, 404);
    expect("L: medlem uten lokallag får 404 på ruten", (await route(linn, FTR, TRD)).status, 404);
    expect("L: medlem av et annet lokallag får 404 på fila", await httpStatus(kristoffer, `/community/${FTR}/attachments/${trdFile.attachmentId}`), 404);
    expect("L: medlemmet leser fila", await httpStatus(eli, `/community/${FTR}/attachments/${trdFile.attachmentId}`), 200);
    expect("L: oppdiktet mappe fra Oslo avvises", code(await move(eli, "link", trdLink, (await newFolder(mia, OSLO, `${TAG} oslo`)).data!)), "not_found");

    // Pins and managing: admins and that lokallag's leaders.
    expect("L: medlem kan ikke feste", code(await pin(eli, "link", trdLink)), "not_allowed");
    expect("L: moderator uten lederrolle kan ikke feste", code(await pin(kari, "link", trdLink)), "not_allowed");
    expect("L: lederen fester", code(await pin(petter, "link", trdLink)), "ok");
    expect("L: lederen fester en fil", code(await pin(petter, "file", trdFile.attachmentId)), "ok");
    expect("L: lederen kan endre medlemmets lenke", code(await editLink(petter, trdLink, `${TAG} lokallagsplan (leder)`)), "ok");
    expect("L: et annet medlem kan ikke", code(await editLink(kari, trdLink, `${TAG} kapret`)), "not_allowed");
    expect("L: lederen kan gi mappen nytt navn", code(await renameFolder(petter, trdFolder, `${TAG} Styret`)), "ok");
    const osloLink = (await addLink(mia, OSLO, "https://example.org/oslo", `${TAG} oslo`)).data!;
    expect("L: lederen fester ikke i et annet lokallag", code(await pin(petter, "link", osloLink)), "not_found");
    expect("L: … og endrer ikke lenker der", code(await editLink(petter, osloLink, `${TAG} kapret`)), "not_found");
    expect("L: festet uansett mappe", (await list(eli, TRD, { pinned: true })).map((r) => r.id).sort().join(), [trdFile.attachmentId, trdLink].sort().join());

    // A leader's own private channel under the lokallag.
    const trdPrivate = (await petter.rpc("create_private_channel", { p_local_group_id: ftrTrondelag, p_name: `${PRIVATE} trd`, p_purpose: "", p_participant_ids: [id("elironning")] })).data as string;
    expect("L: lederen lager en privat kanal", Boolean(trdPrivate), true);
    expect("L: privat – lederen forvalter", await perms(petter, trdPrivate), "true/true/true/false");
    expect("L: privat – deltakeren bidrar", await perms(eli, trdPrivate), "true/true/false/false");
    expect("L: privat – lokallagsmedlem utenfor kanalen ser ingenting", await perms(kari, trdPrivate), "false/false/false/false");
    const privLink = (await addLink(eli, trdPrivate, "https://example.org/privat-trd", `${TAG} privat`)).data!;
    expect("L: privat – lederen fester deltakerens lenke", code(await pin(petter, "link", privLink)), "ok");
    expect("L: privat – deltakeren kan ikke feste", code(await pin(eli, "link", privLink, false)), "not_allowed");

    // Uploads off again: everything stays.
    expect("L: lederen slår av", (await setSharing(petter, TRD, false)).data, true);
    expect("L: av – nye filer avvises", await policyOf(eli, TRD), "unsupported/0/0");
    expect("L: av – fila står", (await list(eli, TRD, { kind: "file", search: TAG })).length, 1);
    expect("L: av – fila kan leses", await httpStatus(eli, `/community/${FTR}/attachments/${trdFile.attachmentId}`), 200);
    expect("L: av – lenker kan fortsatt legges til", code(await addLink(eli, TRD, "https://example.org/av", `${TAG} etter av`)), "ok");

    // Leaving the lokallag ends access at once.
    const eliGroup = sql(`select coalesce(local_group_id::text, '') from memberships where user_id = '${id("elironning")}' and community_id = '${FTR}'`);
    movedMembers.push({ userId: id("elironning"), communityId: FTR, localGroupId: eliGroup || null });
    await admin.from("memberships").update({ local_group_id: null }).eq("user_id", id("elironning")).eq("community_id", FTR);
    expect("L: ute av lokallaget – ser ingenting", (await list(eli, TRD)).length, 0);
    expect("L: … kan ikke endre egen lenke", code(await editLink(eli, trdLink, `${TAG} x`)), "not_found");
    expect("L: … 404 på fila", await httpStatus(eli, `/community/${FTR}/attachments/${trdFile.attachmentId}`), 404);
    expect("L: … 404 på ruten", (await route(eli, FTR, TRD)).status, 404);
    await admin.from("memberships").update({ local_group_id: eliGroup || null }).eq("user_id", id("elironning")).eq("community_id", FTR);
    movedMembers.length = 0;
    expect("L: tilbake i lokallaget – ser igjen", (await list(eli, TRD, { search: TAG })).length > 0, true);

    // A deleted message takes its file, placement and pin; the object is removed.
    const trdPath = sql(`select storage_path from message_attachments where id = '${trdFile.attachmentId}'`);
    await admin.from("messages").delete().eq("id", trdFile.messageId);
    expect("L: slettet melding – fila er ute av ressursene", (await list(eli, TRD, { kind: "file", search: TAG })).length, 0);
    expect("L: … plassering og feste er borte", sql(`select (select count(*) from channel_attachment_placements where attachment_id = '${trdFile.attachmentId}') + (select count(*) from channel_resource_pins where attachment_id = '${trdFile.attachmentId}')`), 0);
    await purgeAttachmentObjects(1000);
    expect("L: … objektet er fjernet fra lagringen", sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name = '${trdPath}'`), 0);
    expect("L: lokallagets hovedkanal kan ikke arkiveres (følger lokallaget)", Boolean((await admin.from("channels").update({ archived_at: new Date().toISOString() }).eq("id", TRD)).error), true);

    // ════ K. Deleting the channel ══════════════════════════════════════
    const linksOnly = await createChannel(mia, `${TAG} bare lenker`);
    await addLink(mia, linksOnly, "https://example.org/eneste", "Eneste lenke");
    const counts = await mia.rpc("community_channel_content_counts", { p_channel_id: linksOnly });
    expect("K: slettedialogen teller lenker", counts.data?.[0]?.link_count, 1);
    expect("K: en kanal med bare lenker krever bekreftelse", (await mia.rpc("delete_community_channel", { p_channel_id: linksOnly, p_confirm_name: "" })).error?.message.includes("channel_delete_unconfirmed"), true);
    expect("K: med navnet slettes den", (await mia.rpc("delete_community_channel", { p_channel_id: linksOnly, p_confirm_name: `${TAG} bare lenker` })).data, true);
    const rows = sql(`select (select count(*) from channel_links) - (select count(*) from channel_links l join channels c on c.id = l.channel_id)`);
    expect("K: ingen lenker uten kanal", rows, 0);
    expect("K: medlem kan ikke slette kanalen", (await linn.rpc("delete_community_channel", { p_channel_id: R, p_confirm_name: `${TAG} hoved` })).data, false);
    expect("K: admin sletter kanalen med alt", (await mia.rpc("delete_community_channel", { p_channel_id: R, p_confirm_name: `${TAG} hoved` })).data, true);
    expect(
      "K: lenker, mapper, plasseringer og fester er borte",
      sql(`select (select count(*) from channel_links where channel_id = '${R}') + (select count(*) from channel_resource_folders where channel_id = '${R}') + (select count(*) from channel_attachment_placements where channel_id = '${R}') + (select count(*) from channel_resource_pins where channel_id = '${R}')`),
      0,
    );
    expect("K: andre kanalers ressurser står", sql(`select count(*) from channel_links where channel_id in ('${OFF}', '${RO}', '${privateId}')`), 4);
  } finally {
    await cleanup();
  }

  expect("rydding: ingen testkanaler igjen", sql(`select count(*) from channels where name like '${TAG}%' or name like '${PRIVATE}%'`), 0);
  expect("rydding: ingen ressurser uten kanal", sql(`select count(*) from channel_links l left join channels c on c.id = l.channel_id where c.id is null`), 0);

  console.log(`\n${checks - failures}/${checks} kontroller bestått.`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
