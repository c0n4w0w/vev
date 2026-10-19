/**
 * Checks file sharing in a community's own channels and the channel file
 * library (20261030100000_channel_file_sharing) under real authenticated
 * sessions.
 *
 * The rule, in short. A community channel takes files only while its
 * administrators have switched `file_sharing_enabled` on; off is the default.
 * Who may then attach is who may write — everyone, or admins and moderators
 * in a restricted channel — and nobody in an archived one. Switching it off
 * stops new files at upload AND at send, and keeps every file already sent.
 * Private lokallag channels and group chats take files as before and have no
 * switch. The library lists a channel's sent files to whoever can read the
 * channel right now, and to nobody else.
 *
 * Three layers, each the way an attacker would reach it:
 *
 *   * the database, with anon-key clients signed in as fixture accounts —
 *     the RPCs the app calls, and direct table, RPC and Storage calls;
 *   * the app's routes over HTTP with the same accounts' cookies (upload,
 *     download, the library's JSON route), so the dev server must be running;
 *   * pagination, search and sorting against a few hundred rows.
 *
 * The service role only reads state back, plays the server's part in an
 * upload where HTTP is not the point, builds bulk rows for paging, simulates
 * a lapsed membership and a deleted message, and cleans up.
 *
 * Run with `npm run check:channel-files` against the local stack after
 * `npm run seed`, with the app on http://localhost:3000 (or CHECK_APP_URL).
 * Creates only disposable channels and files marked "CHECK filer" /
 * "check-filer", touches no seeded channel or message, restores every
 * membership it changes, and clears leftovers of an interrupted run first.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanAttachmentName, detectAttachmentFileType } from "@/lib/attachment-file-type";
import { purgeOwnAttachmentObjects, rememberExistingAttachmentObjects } from "./lib/attachment-isolation";
import { channelTakesFiles } from "@/lib/channel-resources";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { pdfFixture, pngFixture, textFixture, type Fixture } from "./lib/attachment-fixtures";
import { rememberChannelParticipants, restoreChannelParticipants } from "./lib/participation-isolation";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const BUCKET = "message-attachments";
const TAG = "CHECK filer";
const PRIVATE = "check-filer";
const MIB = 1024 * 1024;

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
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError || !user.user?.email) throw new Error(`fant ikke kontoen ${handle}`);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${handle}: ${verifyError.message}`);
  return client;
}

const cookieHeaders = new Map<Client, string>();

/** The session as a browser carries it: the cookies @supabase/ssr writes. */
async function cookiesFor(client: Client): Promise<string> {
  const cached = cookieHeaders.get(client);
  if (cached) return cached;
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("ingen sesjon å lage informasjonskapsler av");
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
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  const header = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  cookieHeaders.set(client, header);
  return header;
}

// ── HTTP ────────────────────────────────────────────────────────────────

async function httpUpload(client: Client | null, communityId: string, channelId: string, file: Fixture) {
  const form = new FormData();
  form.set("file", new File([file.bytes as BlobPart], file.name));
  const headers: Record<string, string> = { Origin: APP };
  if (client) headers.Cookie = await cookiesFor(client);
  const response = await fetch(
    `${APP}/community/${communityId}/attachments/upload?channel=${encodeURIComponent(channelId)}`,
    { method: "POST", headers, body: form },
  );
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; attachment?: { id: string } };
  return { status: response.status, id: body.attachment?.id ?? null };
}

async function httpStatus(client: Client | null, path: string): Promise<number> {
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  const response = await fetch(`${APP}${path}`, { headers, redirect: "manual" });
  await response.arrayBuffer();
  return response.status;
}

type LibraryFile = { id: string; name: string; messageId: string; uploaderId: string; url: string };
type LibraryPage = { files: LibraryFile[]; nextCursor?: string; uploaders?: { id: string; name: string; count: number }[] };
type ResourcesBody = {
  resources: { type: string; id: string; name: string; messageId?: string; contributorId?: string; attachment?: { url: string } }[];
  nextCursor?: string;
  meta?: { contributors: { id: string; name: string; count: number }[] };
};

/** The channel's Ressurser route (20261031100000), read as the files it lists. */

async function httpLibrary(client: Client | null, communityId: string, channelId: string, query = "") {
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  const response = await fetch(
    `${APP}/community/${communityId}/channel/${encodeURIComponent(channelId)}/resources?${query.replace("uploaders=1", "meta=1")}`,
    { headers, redirect: "manual" },
  );
  if (!response.ok) {
    await response.arrayBuffer();
    return { status: response.status, body: undefined };
  }
  const raw = (await response.json()) as ResourcesBody;
  const body: LibraryPage = {
    files: raw.resources
      .filter((resource) => resource.type === "file")
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        messageId: resource.messageId ?? "",
        uploaderId: resource.contributorId ?? "",
        url: resource.attachment?.url ?? "",
      })),
    nextCursor: raw.nextCursor,
    uploaders: raw.meta?.contributors,
  };
  return { status: response.status, body };
}

const attachmentPath = (communityId: string, id: string) => `/community/${communityId}/attachments/${id}`;

// ── The database, as the app and a curious member reach it ──────────────

async function policy(client: Client, channelId: string): Promise<string> {
  const { data, error } = await client
    .rpc("message_attachment_policy", { p_channel_id: channelId, p_conversation_id: null as unknown as string })
    .maybeSingle();
  if (error || !data) return `error:${error?.message ?? "ingen rad"}`;
  return `${data.reason}/${Math.round(Number(data.max_bytes) / MIB)}/${data.max_files}`;
}

async function begin(client: Client, channelId: string, file: { name: string; mime: string; size: number }) {
  const { data, error } = await client
    .rpc("begin_message_attachment", {
      p_channel_id: channelId,
      p_conversation_id: null as unknown as string,
      p_display_name: file.name,
      p_mime_type: file.mime,
      p_size_bytes: file.size,
    })
    .maybeSingle();
  return { id: data?.attachment_id ?? null, path: data?.storage_path ?? null, error: error?.message ?? null };
}

/** An upload without HTTP: the caller's own begin, the server's two steps played by the service role. */
async function upload(client: Client, channelId: string, file: Fixture): Promise<{ id: string | null; error: string | null }> {
  const type = detectAttachmentFileType(file.bytes, file.name);
  if (!type) return { id: null, error: "type" };
  const begun = await begin(client, channelId, { name: cleanAttachmentName(file.name, type), mime: type.mimeType, size: file.bytes.byteLength });
  if (!begun.id || !begun.path) return { id: null, error: begun.error };
  const { error: storeError } = await admin.storage.from(BUCKET).upload(begun.path, file.bytes, { contentType: type.mimeType });
  if (storeError) return { id: null, error: storeError.message };
  const { data: completed } = await admin.rpc("complete_message_attachment", { p_attachment_id: begun.id });
  return completed === true ? { id: begun.id, error: null } : { id: null, error: "ikke fullført" };
}

async function send(client: Client, channelId: string, body: string, attachmentIds: string[]) {
  const { data, error } = await client.rpc("send_channel_message_with_attachments", {
    p_channel_id: channelId,
    p_body: body,
    p_attachment_ids: attachmentIds,
  });
  return { id: (data as string | null) ?? null, error: error?.message ?? null };
}

function refusal(result: { error: string | null }): string {
  const match = /(attachment_[a-z_]+(?::[a-z_]+)?|message_too_long)/.exec(result.error ?? "");
  return match ? match[1] : (result.error ?? "ok");
}

type FilesArgs = { search?: string; kind?: string; uploader?: string; sort?: string; afterKey?: string; afterId?: string; limit?: number };

/** A channel's files through channel_resources() (20261031100000), in the file library's terms. */
async function files(client: Client, channelId: string, args: FilesArgs = {}) {
  const { data, error } = await client.rpc("channel_resources", {
    p_channel_id: channelId,
    p_search: (args.search ?? null) as string,
    p_kind: (args.kind ?? "file") as string,
    p_contributor: (args.uploader ?? null) as string,
    p_sort: (args.sort ?? "newest") as string,
    p_after_key: (args.afterKey ?? null) as string,
    p_after_id: (args.afterId ?? null) as string,
    p_limit: args.limit ?? 30,
  });
  if (error) throw new Error(`channel_resources: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    sort_key: row.sort_key,
    display_name: row.name,
    mime_type: row.mime_type,
    uploader_id: row.contributor_id,
    attached_at: row.created_at,
  }));
}

/** Every row, page by page, the way the library walks them. */
async function allFiles(client: Client, channelId: string, args: FilesArgs = {}, pageSize = 25) {
  const out: Awaited<ReturnType<typeof files>> = [];
  let afterKey: string | undefined;
  let afterId: string | undefined;
  for (let page = 0; page < 200; page += 1) {
    const rows = await files(client, channelId, { ...args, afterKey, afterId, limit: pageSize });
    out.push(...rows);
    if (rows.length < pageSize) break;
    afterKey = rows[rows.length - 1].sort_key;
    afterId = rows[rows.length - 1].id;
  }
  return out;
}

async function fileCount(client: Client, channelId: string): Promise<number> {
  const { data, error } = await client.rpc("channel_resource_summary", { p_channel_id: channelId }).maybeSingle();
  return error ? -1 : (data?.file_count ?? 0);
}

async function sees(client: Client, attachmentId: string): Promise<boolean> {
  const { data } = await client.from("message_attachments").select("id").eq("id", attachmentId).maybeSingle();
  return Boolean(data);
}

async function storageDownload(client: Client, path: string): Promise<boolean> {
  const { data } = await client.storage.from(BUCKET).download(path);
  return Boolean(data);
}

async function storagePath(attachmentId: string): Promise<string> {
  const { data } = await admin.from("message_attachments").select("storage_path").eq("id", attachmentId).single();
  return data!.storage_path;
}

async function objectExists(path: string): Promise<boolean> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 5 });
  return (data ?? []).some((entry) => entry.name === name);
}

// ── Channels ────────────────────────────────────────────────────────────

async function createChannel(client: Client, communityId: string, name: string, fileSharing: boolean, readOnly = false) {
  return client.rpc("create_community_channel", {
    p_community_id: communityId,
    p_name: name,
    p_purpose: "",
    p_section_id: null as unknown as string,
    p_creation_key: null as unknown as string,
    p_read_only: readOnly,
    p_file_sharing: fileSharing,
  });
}

const update = (client: Client, channelId: string, name: string, readOnly: boolean, fileSharing: boolean) =>
  client.rpc("update_community_channel", {
    p_channel_id: channelId,
    p_name: name,
    p_purpose: "",
    p_read_only: readOnly,
    p_file_sharing: fileSharing,
  });

const archive = (client: Client, channelId: string, archived: boolean) =>
  client.rpc("set_community_channel_archived", { p_channel_id: channelId, p_archived: archived });

async function localGroupId(communityId: string, name: string): Promise<string> {
  const { data, error } = await admin.from("community_local_groups").select("id").eq("community_id", communityId).eq("name", name).single();
  if (error) throw new Error(`fant ikke lokallaget ${name}`);
  return data.id;
}

const touched: { userId: string; communityId: string; status: Database["public"]["Enums"]["membership_status"] }[] = [];

async function setMembershipStatus(userId: string, communityId: string, status: Database["public"]["Enums"]["membership_status"]) {
  if (!touched.some((entry) => entry.userId === userId && entry.communityId === communityId)) {
    const { data } = await admin.from("memberships").select("status").eq("user_id", userId).eq("community_id", communityId).single();
    touched.push({ userId, communityId, status: data!.status });
  }
  const { error } = await admin.from("memberships").update({ status }).eq("user_id", userId).eq("community_id", communityId);
  if (error) throw error;
}

async function cleanup() {
  for (const entry of touched.splice(0)) {
    await admin.from("memberships").update({ status: entry.status }).eq("user_id", entry.userId).eq("community_id", entry.communityId);
  }
  sql(`delete from notifications where href like '%/channel/%check-filer%'`);
  sql(`delete from channels where (name like '${TAG}%' and local_group_id is null and subgroup_id is null) or (is_private and name like '${PRIVATE}%')`);
  sql(`delete from channel_retired_ids where id like '%check-filer%'`);
  // A pass reads at most 1000 queued names (the API's row limit); a channel
  // of thousands of files takes several, as the scheduled sweep would.
  for (let pass = 0; pass < 20; pass += 1) {
    const result = await purgeOwnAttachmentObjects(1000);
    if (result.remaining === 0 || result.removed === 0) break;
  }
  restoreChannelParticipants();
}

// ── The checks ──────────────────────────────────────────────────────────

async function main() {
  rememberChannelParticipants();
  rememberExistingAttachmentObjects();
  await cleanup();

  const reachable = await fetch(`${APP}/login`, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!reachable) {
    console.error(`\n✗ Appen svarer ikke på ${APP}. Start den med \`npm run dev\` (eller sett CHECK_APP_URL).`);
    process.exit(1);
  }

  const [mia, emma, kari, linn, petter, kristoffer, amina, sofie, adrian] = await Promise.all(
    ["miaminge", "emmamortensen", "karimoen", "linn", "petter", "kristoffer", "amina", "sofie", "adrian"].map(signIn),
  );
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const id = (handle: string) => ids[handle];

  const pdf = pdfFixture(`${TAG} referat.pdf`);
  const png = await pngFixture(`${TAG} bilde.png`);
  const txt = textFixture(`${TAG} notat.txt`);

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    expect("A: kolonnen finnes, av som standard", sql(`select column_default || '|' || is_nullable from information_schema.columns where table_name = 'channels' and column_name = 'file_sharing_enabled'`), "false|NO");
    expect(
      "A: bare én create_community_channel og update_community_channel",
      sql(`select string_agg(p.oid::regprocedure::text, ',' order by 1) from pg_proc p where p.proname in ('create_community_channel', 'update_community_channel') and p.pronamespace = 'public'::regnamespace`),
      "create_community_channel(text,text,text,uuid,uuid,boolean,boolean),update_community_channel(text,text,text,boolean,boolean)",
    );
    for (const fn of ["channel_resources(text,text,text,uuid,text,boolean,text,text,uuid,integer)", "channel_resource_summary(text)", "channel_resource_contributors(text)"]) {
      expect(`A: ${fn} har fast search_path`, sql(`select proconfig::text from pg_proc where oid = 'public.${fn}'::regprocedure`), "{search_path=public}");
      expect(
        `A: ${fn} spør can_read_channel først`,
        sql(`select pg_get_functiondef('public.${fn}'::regprocedure) like '%can_read_channel(p_channel_id)%'`),
        "t",
      );
      expect(`A: anon kan ikke kjøre ${fn}`, sql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`), "f");
      expect(`A: authenticated kan kjøre ${fn}`, sql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), "t");
    }
    expect("A: authenticated kan ikke kjøre message_attachment_policy_for", sql(`select has_function_privilege('authenticated', 'public.message_attachment_policy_for(uuid,text,uuid)', 'execute')`), "f");
    expect("A: bøtta er fortsatt privat", sql(`select public from storage.buckets where id = '${BUCKET}'`), "f");
    expect(
      "A: lesepolicyen i bøtta slipper bare autentisert nedlasting",
      sql(`select qual like '%message_attachment_storage_read_allowed()%' from pg_policies where schemaname = 'storage' and policyname = 'message_attachments_read'`),
      "t",
    );
    expect("A: ingen ny skrivepolicy på message_attachments", sql(`select count(*) from pg_policies where tablename = 'message_attachments' and cmd <> 'SELECT'`), 0);
    expect("A: ingen skrivepolicy for klienter i bøtta", sql(`select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT' and (qual like '%message-attachments%' or with_check like '%message-attachments%')`), 0);
    expect("A: authenticated skriver ikke message_attachments", sql(`select count(*) from information_schema.role_table_grants where table_name = 'message_attachments' and grantee = 'authenticated' and privilege_type <> 'SELECT'`), 0);

    // ════ B. The setting, and who may change it ════════════════════════
    const created = await createChannel(mia, FTR, `${TAG} av`, false);
    const off = created.data!;
    expect("B: admin oppretter kanal uten fildeling", Boolean(off), true);
    expect("B: lagret som av", sql(`select file_sharing_enabled from channels where id = '${off}'`), "f");
    const onCreated = await createChannel(mia, FTR, `${TAG} på`, true);
    const on = onCreated.data!;
    expect("B: admin oppretter kanal med fildeling", sql(`select file_sharing_enabled from channels where id = '${on}'`), "t");
    expect("B: medlem kan ikke opprette kanal med fildeling", (await createChannel(linn, FTR, `${TAG} medlem`, true)).data, null);
    expect("B: null som fildeling avvises", (await createChannel(mia, FTR, `${TAG} null`, null as unknown as boolean)).data, null);

    expect("B: medlem kan ikke slå på fildeling", (await update(linn, off, `${TAG} av`, false, true)).data, false);
    expect("B: moderator kan ikke slå på fildeling", (await update(kari, off, `${TAG} av`, false, true)).data, false);
    expect("B: lokallagsleder kan ikke slå på fildeling", (await update(petter, off, `${TAG} av`, false, true)).data, false);
    expect("B: TU-admin kan ikke endre en FTR-kanal", (await update(emma, off, `${TAG} av`, false, true)).data, false);
    expect("B: null avvises", (await update(mia, off, `${TAG} av`, false, null as unknown as boolean)).data, false);
    const loose = linn as unknown as Loose;
    expect("B: medlem kan ikke endre kolonnen direkte", (await loose.from("channels").update({ file_sharing_enabled: true }).eq("id", off)).error?.code, "42501");
    expect("B: fortsatt av etter forsøkene", sql(`select file_sharing_enabled from channels where id = '${off}'`), "f");

    const ftrOslo = await localGroupId(FTR, "FTR Oslo");
    const mainLokallag = sql(`select id from channels where local_group_id = '${ftrOslo}' and not is_private`);
    // A lokallag's main chat has the flag too, switched by set_channel_file_sharing
    // (checked in check:channel-resources); private channels and group chats never.
    expect(
      "B: flagget er tillatt på fellesskapskanaler og lokallagenes hovedkanaler, ikke andre",
      sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'channels_file_sharing_scope'`),
      "CHECK (((NOT file_sharing_enabled) OR ((NOT is_private) AND (subgroup_id IS NULL))))",
    );
    expect("B: update_community_channel rører ikke lokallagskanaler", (await update(mia, mainLokallag, "x", false, true)).data, false);

    // ════ C. Off: nothing gets in ══════════════════════════════════════
    expect("C: av – policy for medlem", await policy(linn, off), "unsupported/0/0");
    expect("C: av – policy for admin", await policy(mia, off), "unsupported/0/0");
    expect("C: av – begin avvises", refusal(await begin(linn, off, { name: "a.pdf", mime: "application/pdf", size: 100 })), "attachment_not_allowed:unsupported");
    expect("C: av – opplasting over HTTP avvises", (await httpUpload(linn, FTR, off, pdf)).status, 403);
    expect("C: av – admin får heller ikke laste opp", (await httpUpload(mia, FTR, off, pdf)).status, 403);
    expect("C: av – ingen rader etter forsøkene", sql(`select count(*) from message_attachments where channel_id = '${off}'`), 0);
    expect("C: av – Filer vises ikke (ingen filer, tar ikke filer)", channelTakesFiles({ fileSharing: false }) || (await fileCount(linn, off)) > 0, false);
    expect("C: på – Filer vises", channelTakesFiles({ fileSharing: true }), true);

    // A ready upload from a channel that does take files, sent into this one.
    const foreignReady = await upload(linn, on, txt);
    expect("C: klarert fil fra annen kanal", Boolean(foreignReady.id), true);
    expect("C: av – send med fil fra annen kanal avvises", refusal(await send(linn, off, "", [foreignReady.id!])), "attachment_not_allowed:unsupported");
    expect("C: av – send med oppdiktet id avvises", refusal(await send(linn, off, "", ["00000000-0000-4000-8000-000000000000"])), "attachment_not_allowed:unsupported");
    expect("C: av – ingen melding ble skrevet", sql(`select count(*) from messages where channel_id = '${off}'`), 0);

    // ════ D. On: members share files ═══════════════════════════════════
    expect("D: på – policy for medlem", await policy(linn, on), "ok/25/5");
    expect("D: på – policy for moderator", await policy(kari, on), "ok/25/5");
    expect("D: på – ikke-medlem", await policy(sofie, on), "not_found/0/0");
    expect("D: på – TU-admin", await policy(emma, on), "not_found/0/0");
    const httpPdf = await httpUpload(linn, FTR, on, pdf);
    expect("D: medlem laster opp PDF over HTTP", httpPdf.status, 201);
    const httpPng = await httpUpload(linn, FTR, on, png);
    expect("D: medlem laster opp bilde over HTTP", httpPng.status, 201);
    expect("D: bildet lagres uten tekst-metadata (rad finnes, bredde satt)", sql(`select width is not null from message_attachments where id = '${httpPng.id}'`), "t");
    const onlyFiles = await send(linn, on, "", [httpPdf.id!, httpPng.id!]);
    expect("D: melding med bare vedlegg", Boolean(onlyFiles.id), true);
    const withText = await send(linn, on, "Her er notatet", [foreignReady.id!]);
    expect("D: melding med tekst og vedlegg", Boolean(withText.id), true);
    expect("D: uten vedlegg avvises (krever minst ett)", refusal(await send(linn, on, "x", [])), "attachment_required");
    expect("D: same fil to ganger avvises", refusal(await send(linn, on, "", [httpPdf.id!])), "attachment_invalid");
    expect("D: fil i kanalens bibliotek (3)", (await files(linn, on)).length, 3);
    expect("D: antall for medlem", await fileCount(linn, on), 3);
    expect("D: moderator ser dem også", (await files(kari, on)).length, 3);
    expect("D: bibliotek over HTTP", (await httpLibrary(linn, FTR, on)).body?.files.length, 3);
    const uploaders = (await httpLibrary(linn, FTR, on, "uploaders=1")).body?.uploaders ?? [];
    expect("D: hvem som har delt", uploaders.map((u) => `${u.id === id("linn")}:${u.count}`).join(","), "true:3");
    expect("D: navnet er profilnavnet i fellesskapet", Boolean(uploaders[0]?.name), true);
    const library = (await httpLibrary(linn, FTR, on)).body!.files;
    expect("D: hver fil peker på sin melding", library.filter((f) => f.messageId === onlyFiles.id).length, 2);
    expect("D: adressen er den autentiserte ruten", library.every((f) => f.url.startsWith(`/community/${FTR}/attachments/`)), true);
    expect("D: forhåndsvisning (original) for medlem", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 200);
    expect("D: miniatyr for medlem", await httpStatus(linn, `${attachmentPath(FTR, httpPng.id!)}?variant=thumb`), 200);
    expect("D: nedlasting for et annet medlem", await httpStatus(petter, `${attachmentPath(FTR, httpPdf.id!)}?download=1`), 200);

    // Forged ids and addresses.
    expect("D: kanal fra annet fellesskap i opplastingsadressen", (await httpUpload(linn, TU, on, pdf)).status, 404);
    expect("D: ukjent kanal i opplastingsadressen", (await httpUpload(linn, FTR, `${on}-finnes-ikke`, pdf)).status, 404);
    expect("D: bibliotek under feil fellesskap", (await httpLibrary(linn, TU, on)).status, 404);
    expect("D: vedlegg under feil fellesskap", await httpStatus(linn, attachmentPath(TU, httpPdf.id!)), 404);
    const kariReady = await upload(kari, on, txt);
    expect("D: andres klarerte fil kan ikke sendes", refusal(await send(linn, on, "", [kariReady.id!])), "attachment_invalid");
    const linnReady = await upload(linn, on, txt);
    expect("D: egen klarert fil kan ikke sendes til en annen kanal", refusal(await send(linn, off, "", [linnReady.id!])), "attachment_not_allowed:unsupported");
    expect("D: usendte filer er ikke i biblioteket", (await files(linn, on)).some((row) => row.id === linnReady.id), false);
    expect("D: usendte filer telles ikke", await fileCount(linn, on), 3);

    // Limits: the established five files and 25 MiB, and the type allowlist.
    expect("D: 25 MiB + 1 byte avvises", refusal(await begin(linn, on, { name: "stor.pdf", mime: "application/pdf", size: 25 * MIB + 1 })), "attachment_too_large");
    expect("D: ukjent type avvises", refusal(await begin(linn, on, { name: "x.zip", mime: "application/zip", size: 100 })), "attachment_type");
    const six: string[] = [linnReady.id!];
    for (let n = 0; n < 5; n += 1) six.push((await upload(linn, on, textFixture(`${TAG} seks ${n}.txt`))).id!);
    expect("D: seks filer i én melding avvises", refusal(await send(linn, on, "", six)), "attachment_too_many");
    expect("D: fem går", Boolean((await send(linn, on, "", six.slice(0, 5))).id), true);
    expect("D: den sjette er fortsatt usendt", sql(`select status from message_attachments where id = '${six[5]}'`), "ready");

    // ════ E. Switched off: old files stay, new ones are refused ════════
    const pendingBeforeOff = (await upload(linn, on, txt)).id!;
    const countBeforeOff = await fileCount(linn, on);
    expect("E: admin slår av fildeling", (await update(mia, on, `${TAG} på`, false, false)).data, true);
    expect("E: av – policy", await policy(linn, on), "unsupported/0/0");
    expect("E: av – HTTP-opplasting avvises", (await httpUpload(linn, FTR, on, pdf)).status, 403);
    expect("E: av – begin avvises", refusal(await begin(linn, on, { name: "a.pdf", mime: "application/pdf", size: 100 })), "attachment_not_allowed:unsupported");
    expect("E: av – fil lastet opp før, sendt etter: avvises", refusal(await send(linn, on, "", [pendingBeforeOff])), "attachment_not_allowed:unsupported");
    expect("E: av – tekstmeldinger går fortsatt", (await linn.from("messages").insert({ channel_id: on, body: `${TAG} tekst` })).error, null);
    expect("E: av – alle filer er der fortsatt", await fileCount(linn, on), countBeforeOff);
    expect("E: av – Filer vises fortsatt (har filer)", (await fileCount(linn, on)) > 0, true);
    expect("E: av – forhåndsvisning virker", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 200);
    expect("E: av – nedlasting virker", await httpStatus(petter, `${attachmentPath(FTR, httpPng.id!)}?download=1`), 200);
    expect("E: av – biblioteket over HTTP", (await httpLibrary(petter, FTR, on)).body?.files.length, countBeforeOff);
    expect("E: av – andre kanaler er uberørt", await policy(linn, off), "unsupported/0/0");
    expect("E: admin slår på igjen", (await update(mia, on, `${TAG} på`, false, true)).data, true);
    expect("E: på igjen – opplasting virker", (await httpUpload(linn, FTR, on, pdf)).status, 201);
    expect("E: på igjen – den gamle usendte fila kan sendes", Boolean((await send(linn, on, "", [pendingBeforeOff])).id), true);

    // ════ F. Restricted posting ════════════════════════════════════════
    expect("F: kanalen blir bare for administratorer og moderatorer", (await update(mia, on, `${TAG} på`, true, true)).data, true);
    expect("F: medlem – read_only", await policy(linn, on), "read_only/25/5");
    expect("F: medlem – HTTP-opplasting avvises", (await httpUpload(linn, FTR, on, pdf)).status, 403);
    const readyBeforeRestriction = (await upload(kari, on, txt)).id!;
    expect("F: moderator – ok", await policy(kari, on), "ok/25/5");
    expect("F: moderator laster opp over HTTP", (await httpUpload(kari, FTR, on, pdf)).status, 201);
    expect("F: moderator sender", Boolean((await send(kari, on, "", [readyBeforeRestriction])).id), true);
    expect("F: medlem kan fortsatt lese filene", (await files(linn, on)).length > 0, true);
    expect("F: tilbake til alle medlemmer", (await update(mia, on, `${TAG} på`, false, true)).data, true);

    // ════ G. Archive and restore ═══════════════════════════════════════
    const beforeArchive = await fileCount(linn, on);
    expect("G: arkiveres", (await archive(mia, on, true)).data, true);
    expect("G: arkivert – policy", await policy(linn, on), "archived/25/5");
    expect("G: arkivert – også for admin", await policy(mia, on), "archived/25/5");
    expect("G: arkivert – HTTP-opplasting avvises", (await httpUpload(mia, FTR, on, pdf)).status, 403);
    expect("G: arkivert – filene står", await fileCount(linn, on), beforeArchive);
    expect("G: arkivert – lesbar", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 200);
    expect("G: arkivert – Filer tar ikke nye filer, men vises fordi det finnes filer", channelTakesFiles({ fileSharing: true, archived: true }), false);
    expect("G: gjenopprettes", (await archive(mia, on, false)).data, true);
    expect("G: gjenopprettet – samme filer", await fileCount(linn, on), beforeArchive);
    expect("G: gjenopprettet – fildeling som før", await policy(linn, on), "ok/25/5");

    // ════ H. Nobody else ═══════════════════════════════════════════════
    expect("H: TU-admin ser ingen filer", (await files(emma, on)).length, 0);
    expect("H: TU-admin teller 0", await fileCount(emma, on), 0);
    expect("H: TU-admin får 404 på biblioteket", (await httpLibrary(emma, FTR, on)).status, 404);
    expect("H: TU-admin får 404 på fila", await httpStatus(emma, attachmentPath(FTR, httpPdf.id!)), 404);
    expect("H: TU-admin ser ingen rad direkte", await sees(emma, httpPdf.id!), false);
    expect("H: TU-admin får ikke fila fra Storage", await storageDownload(emma, await storagePath(httpPdf.id!)), false);
    expect("H: TU-medlem ser ingen filer", (await files(adrian, on)).length, 0);
    expect("H: uten medlemskap: ingen filer", (await files(sofie, on)).length, 0);
    expect("H: uten medlemskap: 404 på biblioteket", (await httpLibrary(sofie, FTR, on)).status, 404);
    expect("H: uten medlemskap: 404 på fila", await httpStatus(sofie, attachmentPath(FTR, httpPdf.id!)), 404);
    expect("H: utlogget: 404 på biblioteket", (await httpLibrary(null, FTR, on)).status, 404);
    expect("H: utlogget: 404 på fila", await httpStatus(null, attachmentPath(FTR, httpPdf.id!)), 404);
    expect("H: anon kan ikke kalle channel_resources", (await anon.rpc("channel_resources", { p_channel_id: on })).error?.code, "42501");
    expect("H: anon kan ikke kalle channel_resource_summary", (await anon.rpc("channel_resource_summary", { p_channel_id: on })).error?.code, "42501");
    expect("H: anon får ikke fila fra Storage", Boolean((await anon.storage.from(BUCKET).download(await storagePath(httpPdf.id!))).data), false);
    const publicUrl = anon.storage.from(BUCKET).getPublicUrl(await storagePath(httpPdf.id!)).data.publicUrl;
    expect("H: ingen offentlig adresse", (await fetch(publicUrl)).status >= 400, true);
    const signed = await linn.storage.from(BUCKET).createSignedUrl(await storagePath(httpPdf.id!), 60 * 60 * 24 * 365);
    expect("H: medlemmer kan ikke lage signerte lenker selv", Boolean(signed.data?.signedUrl), false);
    const signedMany = await linn.storage.from(BUCKET).createSignedUrls([await storagePath(httpPdf.id!)], 60);
    expect("H: … heller ikke flere om gangen", (signedMany.data ?? []).some((entry) => Boolean(entry.signedUrl)), false);
    expect("H: medlemmer kan ikke liste bøtta", ((await linn.storage.from(BUCKET).list(FTR)).data ?? []).length, 0);
    expect("H: autentisert nedlasting (som ruten bruker) virker fortsatt", await storageDownload(linn, await storagePath(httpPdf.id!)), true);

    // Membership ending ends access, at once.
    await setMembershipStatus(id("linn"), FTR, "invited");
    expect("H: tidligere medlem: ingen filer", (await files(linn, on)).length, 0);
    expect("H: tidligere medlem: 404 på fila", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 404);
    expect("H: tidligere medlem: 404 på biblioteket", (await httpLibrary(linn, FTR, on)).status, 404);
    expect("H: tidligere medlem: kan ikke laste opp", (await httpUpload(linn, FTR, on, pdf)).status, 404);
    await setMembershipStatus(id("linn"), FTR, "active");
    expect("H: medlem igjen: leser igjen", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 200);

    // ════ I. Private lokallag channels ═════════════════════════════════
    const privateId = (
      await mia.rpc("create_private_channel", {
        p_local_group_id: ftrOslo,
        p_name: `${PRIVATE} privat`,
        p_purpose: "",
        p_participant_ids: [id("kristoffer")],
      })
    ).data as string;
    expect("I: privat kanal har ikke flagget", sql(`select file_sharing_enabled from channels where id = '${privateId}'`), "f");
    expect("I: privat kanal tar filer som før", await policy(kristoffer, privateId), "ok/25/5");
    expect("I: Filer tilbys i privat kanal", channelTakesFiles({ isPrivate: true }), true);
    expect("I: flagget kan ikke settes på privat kanal", (await admin.from("channels").update({ file_sharing_enabled: true }).eq("id", privateId)).error?.code, "23514");
    expect("I: update_community_channel rører ikke private kanaler", (await update(mia, privateId, "x", false, false)).data, false);
    const privateFile = await httpUpload(kristoffer, FTR, privateId, pdf);
    expect("I: deltaker laster opp", privateFile.status, 201);
    expect("I: deltaker sender", Boolean((await send(kristoffer, privateId, "", [privateFile.id!])).id), true);
    expect("I: deltaker ser fila i biblioteket", (await files(kristoffer, privateId)).length, 1);
    expect("I: admin ser den", (await files(mia, privateId)).length, 1);
    expect("I: moderator i samme lokallag uten invitasjon ser ingenting", (await files(amina, privateId)).length, 0);
    expect("I: … og får 404 på biblioteket", (await httpLibrary(amina, FTR, privateId)).status, 404);
    expect("I: … og på fila", await httpStatus(amina, attachmentPath(FTR, privateFile.id!)), 404);
    expect("I: vanlig medlem uten invitasjon ser ingenting", (await files(linn, privateId)).length, 0);
    expect("I: fjernes fra kanalen", (await mia.rpc("remove_private_channel_participant", { p_channel_id: privateId, p_user_id: id("kristoffer") })).data, true);
    expect("I: fjernet: ingen filer", (await files(kristoffer, privateId)).length, 0);
    expect("I: fjernet: 404 på biblioteket", (await httpLibrary(kristoffer, FTR, privateId)).status, 404);
    expect("I: fjernet: 404 på fila", await httpStatus(kristoffer, attachmentPath(FTR, privateFile.id!)), 404);
    expect("I: fjernet: Storage nekter", await storageDownload(kristoffer, await storagePath(privateFile.id!)), false);
    expect("I: legges til igjen", (await mia.rpc("add_private_channel_participant", { p_channel_id: privateId, p_user_id: id("kristoffer") })).data, true);
    expect("I: tilbake: ser fila igjen", (await files(kristoffer, privateId)).length, 1);

    // ════ J. Search, filters, sorting and paging ═══════════════════════
    // Rows built directly (the service role, through the same guard trigger)
    // in a channel of their own: names chosen to test Norwegian order, case,
    // and characters that mean something to LIKE.
    const bulkCreated = await createChannel(mia, FTR, `${TAG} mange`, true);
    const bulk = bulkCreated.data!;
    const linnId = id("linn");
    const kariId = id("karimoen");
    sql(`
      with m as (
        insert into messages (channel_id, author_id, body, created_at)
        select '${bulk}', case when g % 3 = 0 then '${kariId}'::uuid else '${linnId}'::uuid end, '', now() - (g || ' minutes')::interval
        from generate_series(1, 240) g
        returning id, author_id, created_at
      ), numbered as (
        select id, author_id, created_at, row_number() over (order by created_at desc) as n from m
      )
      insert into message_attachments (community_id, channel_id, message_id, uploader_id, storage_path, display_name, mime_type, size_bytes, status, attached_at)
      select '${FTR}', '${bulk}', id, author_id,
             '${FTR}/' || gen_random_uuid() || '.' || case n % 3 when 0 then 'pdf' when 1 then 'png' else 'mp3' end,
             'CHECK filer bulk ' || lpad(n::text, 3, '0') || '.' || case n % 3 when 0 then 'pdf' when 1 then 'png' else 'mp3' end,
             case n % 3 when 0 then 'application/pdf' when 1 then 'image/png' else 'audio/mpeg' end,
             1000 + n, 'sent', created_at
      from numbered;
    `);
    const special = ["Ål.txt", "Øl.txt", "Æble.txt", "apple.txt", "Zebra.txt", "100%.txt", "a_b.txt", "aXb.txt"];
    sql(`
      with m as (
        insert into messages (channel_id, author_id, body, created_at)
        select '${bulk}', '${linnId}', '', now() - interval '1 day' - (o || ' seconds')::interval
        from unnest(array[${special.map((_, i) => i).join(",")}]) o
        returning id, created_at
      ), numbered as (select id, created_at, row_number() over (order by created_at desc) as n from m)
      insert into message_attachments (community_id, channel_id, message_id, uploader_id, storage_path, display_name, mime_type, size_bytes, status, attached_at)
      select '${FTR}', '${bulk}', numbered.id, '${linnId}', '${FTR}/' || gen_random_uuid() || '.txt', names.name, 'text/plain', 10, 'sent', numbered.created_at
      from numbered join (select name, row_number() over () as n from unnest(array[${special.map((name) => `'${name}'`).join(",")}]) name) names using (n);
    `);
    const total = 240 + special.length;
    expect("J: antall", await fileCount(linn, bulk), total);

    const newest = await allFiles(linn, bulk, {}, 25);
    expect("J: nyeste først – alle, ingen dubletter", `${newest.length}/${new Set(newest.map((r) => r.id)).size}`, `${total}/${total}`);
    expect(
      "J: nyeste først – synkende dato",
      newest.every((row, i) => i === 0 || Date.parse(newest[i - 1].attached_at) >= Date.parse(row.attached_at)),
      true,
    );
    const oldest = await allFiles(linn, bulk, { sort: "oldest" }, 40);
    expect("J: eldste først er motsatt rekkefølge", oldest.map((r) => r.id).join(), [...newest].reverse().map((r) => r.id).join());
    expect("J: første side er 30 som standard", (await files(linn, bulk)).length, 30);
    expect("J: grensen er 100", (await files(linn, bulk, { limit: 5000 })).length, 100);

    const byName = await allFiles(linn, bulk, { sort: "name_asc", search: "txt" }, 3);
    expect("J: A–Å, norsk rekkefølge (æ ø å etter z), uten hensyn til store/små bokstaver", byName.map((r) => r.display_name).join(" | "), "100%.txt | a_b.txt | apple.txt | aXb.txt | Zebra.txt | Æble.txt | Øl.txt | Ål.txt");
    const byNameDesc = await allFiles(linn, bulk, { sort: "name_desc", search: "txt" }, 3);
    expect("J: Å–A er motsatt", byNameDesc.map((r) => r.display_name).join(" | "), [...byName].reverse().map((r) => r.display_name).join(" | "));
    const allByName = await allFiles(linn, bulk, { sort: "name_asc" }, 37);
    expect("J: A–Å over mange sider, ingen dubletter", `${allByName.length}/${new Set(allByName.map((r) => r.id)).size}`, `${total}/${total}`);

    expect("J: søk uten hensyn til store/små bokstaver", (await files(linn, bulk, { search: "æBLE" })).map((r) => r.display_name).join(), "Æble.txt");
    expect("J: % i søket er et vanlig tegn", (await files(linn, bulk, { search: "%" })).map((r) => r.display_name).join(), "100%.txt");
    expect("J: _ i søket er et vanlig tegn", (await files(linn, bulk, { search: "a_b" })).map((r) => r.display_name).join(), "a_b.txt");
    expect("J: søk på del av navnet", (await allFiles(linn, bulk, { search: "bulk 00" })).length, 9);
    expect("J: tomt søk er alt", await allFiles(linn, bulk, { search: "   " }).then((r) => r.length), total);

    const images = await allFiles(linn, bulk, { kind: "image" });
    const docs = await allFiles(linn, bulk, { kind: "document" });
    const others = await allFiles(linn, bulk, { kind: "other" });
    expect("J: bilder", images.length, 80);
    expect("J: bilder er bare bilder", images.every((r) => r.mime_type.startsWith("image/")), true);
    expect("J: dokumenter (PDF og tekst)", docs.length, 80 + special.length);
    expect("J: andre (lyd)", others.length, 80);
    expect("J: ukjent filtype-filter er alt", (await allFiles(linn, bulk, { kind: "video" })).length, total);
    const kariFiles = await allFiles(linn, bulk, { uploader: kariId });
    expect("J: filter på opplaster", kariFiles.length, 80);
    expect("J: bare den opplasteren", kariFiles.every((r) => r.uploader_id === kariId), true);
    const combined = await allFiles(linn, bulk, { uploader: kariId, kind: "document", search: "bulk", sort: "name_desc" }, 7);
    expect(
      "J: søk, filter og sortering sammen",
      combined.every((r, i) => r.uploader_id === kariId && r.mime_type === "application/pdf" && (i === 0 || combined[i - 1].display_name > r.display_name)),
      true,
    );
    expect("J: … og riktig antall", combined.length, newest.filter((r) => r.uploader_id === kariId && r.mime_type === "application/pdf").length);

    // The route pages the same way, with an opaque cursor.
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page += 1) {
      const result = await httpLibrary(linn, FTR, bulk, `sort=name_asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const file of result.body?.files ?? []) seen.add(file.id);
      cursor = result.body?.nextCursor;
      if (!cursor) break;
    }
    expect("J: HTTP-ruten blar gjennom alle", seen.size, total);
    expect("J: ødelagt markør starter fra toppen", (await httpLibrary(linn, FTR, bulk, "cursor=%%%")).body?.files.length, 30);
    expect("J: ukjent sortering blir nyeste først", (await httpLibrary(linn, FTR, bulk, "sort=drop")).body?.files[0]?.id, newest[0].id);
    const foreignCursor = Buffer.from(JSON.stringify(["2000-01-01T00:00:00.000000Z", newest[0].id])).toString("base64url");
    expect("J: markør fra annen sortering gir ingen feil", (await httpLibrary(linn, FTR, bulk, `sort=name_asc&cursor=${foreignCursor}`)).status, 200);

    // Speed with a full channel (the 248 above plus more), as the caller.
    sql(`
      with m as (
        insert into messages (channel_id, author_id, body)
        select '${bulk}', '${linnId}', '' from generate_series(1, 1800) returning id, created_at
      )
      insert into message_attachments (community_id, channel_id, message_id, uploader_id, storage_path, display_name, mime_type, size_bytes, status, attached_at)
      select '${FTR}', '${bulk}', id, '${linnId}', '${FTR}/' || gen_random_uuid() || '.pdf', 'CHECK filer last ' || id || '.pdf', 'application/pdf', 100, 'sent', created_at from m;
    `);
    const timings: string[] = [];
    for (const [label, args] of [
      ["nyeste", {}],
      ["A–Å", { sort: "name_asc" }],
      ["søk", { search: "Æble" }],
      ["søk+type+sortering", { search: "bulk", kind: "image", sort: "name_desc" }],
    ] as const) {
      const started = performance.now();
      await files(linn, bulk, args);
      const ms = Math.round(performance.now() - started);
      timings.push(`${label} ${ms} ms`);
      expect(`J: ${label} med ${total + 1800} filer under 750 ms`, ms < 750, true);
    }
    const countStarted = performance.now();
    expect("J: antall med mange filer", await fileCount(linn, bulk), total + 1800);
    timings.push(`antall ${Math.round(performance.now() - countStarted)} ms`);
    console.log(`  (bibliotek, ${total + 1800} filer: ${timings.join(", ")})`);

    // ════ K. Deleting ══════════════════════════════════════════════════
    // A message going (the database's cascade; members cannot delete
    // messages) takes its files out of the library and queues their objects.
    const pathBefore = await storagePath(httpPdf.id!);
    const pngPath = await storagePath(httpPng.id!);
    expect("K: objektet finnes før", await objectExists(pathBefore), true);
    await admin.from("messages").delete().eq("id", onlyFiles.id!);
    expect("K: slettet melding – filene er ute av biblioteket", (await files(linn, on)).some((r) => r.id === httpPdf.id || r.id === httpPng.id), false);
    expect("K: slettet melding – 404 på fila", await httpStatus(linn, attachmentPath(FTR, httpPdf.id!)), 404);
    expect("K: slettet melding – i slettekøen", sql(`select count(*) from message_attachment_purges where storage_path in ('${pathBefore}', '${pngPath}')`), 2);
    await purgeOwnAttachmentObjects(1000);
    expect("K: slettet melding – objektet er borte", await objectExists(pathBefore), false);

    // A channel deleted by its administrator takes every file with it, and
    // nothing of any other channel.
    const otherBefore = await fileCount(kristoffer, privateId);
    const onPaths = sql(`select string_agg(storage_path, ',') from message_attachments where channel_id = '${on}'`).split(",").filter(Boolean);
    expect("K: kanalen har filer før sletting", onPaths.length > 0, true);
    const deleted = await mia.rpc("delete_community_channel", { p_channel_id: on, p_confirm_name: `${TAG} på` });
    expect("K: admin sletter kanalen", deleted.data, true);
    expect("K: ingen vedleggsrader igjen", sql(`select count(*) from message_attachments where channel_id = '${on}'`), 0);
    expect("K: alle objektene i slettekøen", sql(`select count(*) from message_attachment_purges where storage_path = any(string_to_array('${onPaths.join(",")}', ','))`), onPaths.length);
    await purgeOwnAttachmentObjects(1000);
    expect("K: objektene er fjernet", (await Promise.all(onPaths.map(objectExists))).some(Boolean), false);
    expect("K: slettekøen er tom for dem", sql(`select count(*) from message_attachment_purges where storage_path = any(string_to_array('${onPaths.join(",")}', ','))`), 0);
    expect("K: andre kanalers filer er uberørt", await fileCount(kristoffer, privateId), otherBefore);
    expect("K: biblioteket for slettet kanal er 404", (await httpLibrary(linn, FTR, on)).status, 404);
    expect("K: medlem kan ikke slette kanalen", (await linn.rpc("delete_community_channel", { p_channel_id: bulk, p_confirm_name: `${TAG} mange` })).data, false);
    expect("K: medlem kan ikke slette en fil", (await (linn as unknown as Loose).from("message_attachments").delete().eq("id", privateFile.id!)).error?.code, "42501");
    expect("K: medlem kan ikke trekke tilbake en sendt fil", (await linn.rpc("discard_message_attachment", { p_attachment_id: privateFile.id! })).data, false);
  } finally {
    await cleanup();
  }

  expect("rydding: ingen testkanaler igjen", sql(`select count(*) from channels where name like '${TAG}%' or name like '${PRIVATE}%'`), 0);
  expect("rydding: ingen testfiler igjen", sql(`select count(*) from message_attachments where display_name like '${TAG}%'`), 0);
  expect("rydding: slettekøen er tom", sql(`select count(*) from message_attachment_purges`), 0);

  console.log(`\n${checks - failures}/${checks} kontroller bestått.`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
