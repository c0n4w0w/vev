/**
 * Checks editing, deleting, moderating and pinning chat messages
 * (20261101100000_message_editing_and_moderation) under real authenticated
 * sessions.
 *
 * The rule, in short. Only the author edits a message, text only, never after
 * it was deleted or once its channel is archived. The author deletes it; in a
 * channel, whoever moderates that channel may remove anyone's: the
 * community's admins and moderators in its own channels, a lokallag's leaders
 * (and admins) in its chat, a private channel's managers in that channel, a
 * group's managers in its chat — and only where they can read. Nobody
 * moderates a direct message. One message per channel may be pinned, by its
 * moderators. A deleted message is a placeholder with no text, reactions or
 * files; its files leave Ressurser and Storage, its pin goes, and a removal by
 * someone else is logged without its text.
 *
 * Exercised the way an attacker would reach it: the RPCs the app calls and
 * direct table writes with anon-key clients signed in as fixture accounts,
 * plus the channel page and attachment route over HTTP (the dev server must be
 * running). The service role only reads state back, plays the server's part
 * in an upload, sets up a direct conversation and cleans up.
 *
 * Run with `npm run check:message-moderation` against the local stack after
 * `npm run seed`, with the app on http://localhost:3000 (or CHECK_APP_URL).
 * Creates only disposable channels and groups marked "CHECK melding" /
 * "check-melding"; messages it writes into real lokallag chats are recorded
 * and removed afterwards, also after an interrupted run.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanAttachmentName, detectAttachmentFileType } from "@/lib/attachment-file-type";
import { purgeOwnAttachmentObjects, rememberExistingAttachmentObjects } from "./lib/attachment-isolation";
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
const BUCKET = "message-attachments";
const TAG = "CHECK melding";
const PRIVATE = "check-melding";
const BODY = "CHECK-melding";
const TRONDELAG_CHAT = `${FTR}--lokallag-ftr-trondelag`;
const OSLO_CHAT = `${FTR}--lokallag-ftr-oslo`;
/** Messages written into real lokallag chats, so a later run can remove them too. */
const LEDGER = join(tmpdir(), "ting-check-message-moderation.json");

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

async function page(client: Client, path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${APP}${path}`, { headers: { Cookie: await cookiesFor(client) }, redirect: "manual" });
  return { status: response.status, html: await response.text() };
}

// ── The calls the app makes ─────────────────────────────────────────────

/** The refusal reason a message function raised, or "ok". */
function code(result: { error: { message?: string; code?: string } | null }): string {
  if (!result.error) return "ok";
  const match = /message_error:([a-z_]+)/.exec(result.error.message ?? "");
  return match ? match[1] : (result.error.code ?? result.error.message ?? "error");
}

const N = null as unknown as string;
const ledger = new Set<string>();

function remember(id: string, channelId: string) {
  if (channelId === TRONDELAG_CHAT || channelId === OSLO_CHAT) {
    ledger.add(id);
    writeFileSync(LEDGER, JSON.stringify([...ledger]));
  }
}

async function post(client: Client, channelId: string, note: string): Promise<string> {
  const { data, error } = await client
    .from("messages")
    .insert({ channel_id: channelId, body: `${BODY}: ${note}` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`kunne ikke skrive i ${channelId}: ${error?.message}`);
  remember(data.id, channelId);
  return data.id;
}

const edit = (client: Client, messageId: string, body: string) =>
  client.rpc("edit_channel_message", { p_message_id: messageId, p_body: body });
const remove = (client: Client, messageId: string) => client.rpc("delete_channel_message", { p_message_id: messageId });
const pin = (client: Client, messageId: string, pinned = true) =>
  client.rpc("set_channel_message_pinned", { p_message_id: messageId, p_pinned: pinned });
const editDm = (client: Client, messageId: string, body: string) =>
  client.rpc("edit_direct_message", { p_message_id: messageId, p_body: body });
const removeDm = (client: Client, messageId: string) => client.rpc("delete_direct_message", { p_message_id: messageId });

async function stored(messageId: string) {
  const { data } = await admin.from("messages").select("*").eq("id", messageId).single();
  return data!;
}

async function pinnedIn(channelId: string): Promise<string> {
  const { data } = await admin.from("channel_pinned_messages").select("message_id").eq("channel_id", channelId).maybeSingle();
  return data?.message_id ?? "-";
}

const logRows = (messageId: string) =>
  sql(`select coalesce(string_agg(action || ':' || coalesce(actor_id::text, '-'), ',' order by created_at), '') from message_moderation_log where message_id = '${messageId}'`);

async function upload(client: Client, channelId: string, file: Fixture): Promise<{ id: string; path: string }> {
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
  return { id: data.attachment_id, path: data.storage_path };
}

async function share(client: Client, channelId: string, file: Fixture, body = "") {
  const attachment = await upload(client, channelId, file);
  const { data, error } = await client.rpc("send_channel_message_with_attachments", {
    p_channel_id: channelId,
    p_body: body,
    p_attachment_ids: [attachment.id],
  });
  if (error || !data) throw new Error(`kunne ikke sende: ${error?.message}`);
  return { attachmentId: attachment.id, path: attachment.path, messageId: data as string };
}

async function createChannel(client: Client, name: string, fileSharing = false) {
  const { data, error } = await client.rpc("create_community_channel", {
    p_community_id: FTR,
    p_name: `${TAG} ${name}`,
    p_purpose: "",
    p_section_id: N,
    p_creation_key: N,
    p_read_only: false,
    p_file_sharing: fileSharing,
  });
  if (error || !data) throw new Error(`kunne ikke opprette ${name}: ${error?.message}`);
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

let conversation: { id: string; created: boolean; since: string; markedRead: string[] } | undefined;

async function cleanup() {
  const earlier: string[] = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : [];
  const recorded = [...new Set([...earlier, ...ledger])];
  if (recorded.length) {
    const list = recorded.map((id) => `'${id}'`).join(",");
    sql(`delete from message_moderation_log where message_id in (${list})`);
    sql(`delete from messages where id in (${list})`);
  }
  sql(`delete from messages where channel_id in ('${TRONDELAG_CHAT}', '${OSLO_CHAT}') and body like '${BODY}%'`);
  if (existsSync(LEDGER)) unlinkSync(LEDGER);
  ledger.clear();

  if (conversation) {
    const href = `/community/${FTR}/messages/${conversation.id}`;
    if (conversation.created) {
      sql(`delete from notifications where href = '${href}'`);
      sql(`delete from direct_conversations where id = '${conversation.id}'`);
    } else {
      sql(`delete from notifications where href = '${href}' and created_at >= '${conversation.since}'`);
      sql(`delete from direct_messages where conversation_id = '${conversation.id}' and created_at >= '${conversation.since}'`);
      if (conversation.markedRead.length) {
        sql(`update notifications set read = false where id in (${conversation.markedRead.map((id) => `'${id}'`).join(",")})`);
      }
    }
    conversation = undefined;
  }

  const channels = sql(
    `select string_agg(quote_literal(id), ',') from channels where community_id = '${FTR}' and (
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
  sql(`delete from channel_retired_ids where id like '%check-melding%'`);
  for (let pass = 0; pass < 10; pass += 1) {
    const result = await purgeOwnAttachmentObjects(1000);
    if (result.remaining === 0 || result.removed === 0) break;
  }
}

// ── The checks ──────────────────────────────────────────────────────────

async function main() {
  rememberExistingAttachmentObjects();
  await cleanup();
  const reachable = await fetch(`${APP}/login`, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!reachable) {
    console.error(`\n✗ Appen svarer ikke på ${APP}. Start den med \`npm run dev\` (eller sett CHECK_APP_URL).`);
    process.exit(1);
  }

  const handles = ["miaminge", "emmamortensen", "ingrid", "karimoen", "hanne", "linn", "elise", "petter", "elironning", "kristoffer"];
  const [mia, emma, ingrid, kari, hanne, linn, elise, petter, eli, kristoffer] = await Promise.all(handles.map(signIn));
  const id = (handle: string) => ids[handle];
  const loose = (client: Client) => client as unknown as Loose;

  try {
    // ════ A. Catalog ═══════════════════════════════════════════════════
    for (const table of ["messages", "direct_messages"]) {
      expect(
        `A: authenticated har verken UPDATE eller DELETE på ${table}`,
        sql(`select has_table_privilege('authenticated', 'public.${table}', 'UPDATE') or has_table_privilege('authenticated', 'public.${table}', 'DELETE')`),
        "f",
      );
    }
    expect("A: ingen skrivepolicy for oppdatering/sletting av meldinger", sql(`select count(*) from pg_policies where tablename in ('messages', 'direct_messages') and permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'DELETE', 'ALL')`), 0);
    expect("A: channel_pinned_messages har radsikkerhet", sql(`select relrowsecurity from pg_class where oid = 'public.channel_pinned_messages'::regclass`), "t");
    expect("A: medlemmer leser bare festene", sql(`select string_agg(privilege_type, ',') from information_schema.role_table_grants where table_name = 'channel_pinned_messages' and grantee = 'authenticated'`), "SELECT");
    expect("A: revisjonsloggen er stengt for medlemmer", sql(`select count(*) from information_schema.role_table_grants where table_name = 'message_moderation_log' and grantee in ('anon', 'authenticated')`), 0);
    expect("A: revisjonsloggen har ingen tekstkolonne", sql(`select count(*) from information_schema.columns where table_name = 'message_moderation_log' and column_name in ('body', 'text', 'content')`), 0);
    expect("A: modereringsregelen kan ikke kalles av API-roller", sql(`select has_function_privilege('authenticated', 'public.channel_message_moderate_admits(uuid, text)', 'execute')`), "f");

    // ════ B. Fixtures ══════════════════════════════════════════════════
    const general = await createChannel(mia, "generelt", true);
    const archive = await createChannel(mia, "arkiv", true);
    const trondelag = await localGroupId("FTR Trøndelag");
    const oslo = await localGroupId("FTR Oslo");
    const p1 = await createPrivate(petter, trondelag, "leders", [id("elironning")]);
    const p2 = await createPrivate(mia, oslo, "oslo", [id("kristoffer")]);
    const p3 = await createPrivate(mia, trondelag, "uten-leder", [id("elironning")]);
    const g1 = await createGroup(mia, "g1", [id("linn"), id("elise")]);
    const g2 = await createGroup(mia, "g2", [id("linn")]);
    await mia.rpc("set_subgroup_manager", { p_subgroup_id: g1.id, p_user_id: id("elise"), p_is_manager: true });
    expect("B: Elise styrer gruppe 1", (await elise.rpc("can_manage_subgroup", { p_subgroup_id: g1.id })).data, true);
    expect("B: Petter styrer sin private kanal", (await petter.rpc("can_manage_private_channel", { p_channel_id: p1 })).data, true);

    // ════ C. Editing ═══════════════════════════════════════════════════
    const first = await post(linn, general, "første");
    const second = await post(elise, general, "andre");
    const before = await stored(first);
    const edited = await edit(linn, first, `  ${BODY}: første, rettet  `);
    expect("C1 forfatteren redigerer egen melding", code(edited), "ok");
    const after = await stored(first);
    expect("C1 teksten er byttet og trimmet", after.body, `${BODY}: første, rettet`);
    expect("C1 redigert-tidspunkt er satt", Boolean(after.edited_at), true);
    expect("C1 id, forfatter, kanal og opprettet er uendret", [after.id, after.author_id, after.channel_id, after.created_at].join("|"), [before.id, before.author_id, before.channel_id, before.created_at].join("|"));
    expect("C1 RPC-en gir den lagrede raden tilbake", edited.data?.edited_at, after.edited_at);
    const order = await linn.from("messages").select("id").eq("channel_id", general).order("created_at");
    expect("C1 rekkefølgen er den samme, ingen ny melding", order.data?.map((row) => row.id).join(","), [first, second].join(","));
    const unchanged = await edit(linn, first, `${BODY}: første, rettet`);
    expect("C2 samme tekst igjen endrer ingenting", unchanged.data?.edited_at, after.edited_at);
    expect("C3 tom tekst avvises", code(await edit(linn, first, "   ")), "empty");
    expect("C3 for lang tekst avvises", code(await edit(linn, first, "x".repeat(4001))), "too_long");
    expect("C4 et medlem kan ikke redigere andres melding", code(await edit(linn, second, "kapret")), "not_allowed");
    expect("C4 ikke en administrator heller", code(await edit(mia, second, "kapret")), "not_allowed");
    expect("C4 ikke en moderator heller", code(await edit(ingrid, second, "kapret")), "not_allowed");
    expect("C4 teksten er urørt", (await stored(second)).body, `${BODY}: andre`);
    expect("C5 forfalsket id avvises", code(await edit(linn, crypto.randomUUID(), "x")), "not_found");
    expect("C5 et annet fellesskaps admin finner den ikke", code(await edit(emma, first, "x")), "not_found");
    const html = `<script>alert(1)</script> ${BODY}`;
    expect("C6 HTML lagres som tekst", code(await edit(linn, first, html)), "ok");
    const rendered = await page(linn, `/community/${FTR}/channel/${encodeURIComponent(general)}`);
    expect("C6 siden viser HTML-en escaped, ikke som skript", rendered.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !rendered.html.includes("<script>alert(1)</script>"), true);
    expect("C6 siden viser «redigert»", rendered.html.includes("redigert"), true);

    // Concurrent edits: both are answered, one text wins, nothing else moves.
    const [e1, e2] = await Promise.all([edit(linn, first, `${BODY}: samtidig A`), edit(linn, first, `${BODY}: samtidig B`)]);
    const raced = await stored(first);
    expect("C7 samtidige redigeringer svarer begge ok", `${code(e1)}|${code(e2)}`, "ok|ok");
    expect("C7 en av dem står igjen", [`${BODY}: samtidig A`, `${BODY}: samtidig B`].includes(raced.body), true);
    expect("C7 opprettet er fortsatt uendret", raced.created_at, before.created_at);

    // ════ D. Direct table access ═══════════════════════════════════════
    const directUpdate = await loose(linn).from("messages").update({ body: "kapret" }).eq("id", first);
    expect("D1 direkte oppdatering nektes", directUpdate.error?.code, "42501");
    const directDelete = await loose(linn).from("messages").delete().eq("id", first);
    expect("D1 direkte sletting nektes", directDelete.error?.code, "42501");
    const forged = await loose(linn).from("messages").insert({ channel_id: general, body: `${BODY}: falsk`, deleted_at: new Date().toISOString(), removed_by_moderator: true });
    // Refused on privilege since 20261114100000: members insert only channel_id and body.
    expect("D2 en melding kan ikke settes inn som slettet", code(forged), "42501");
    const forgedEdit = await loose(linn).from("messages").insert({ channel_id: general, body: `${BODY}: falsk`, edited_at: new Date().toISOString() });
    expect("D2 en melding kan ikke settes inn som redigert", code(forgedEdit), "42501");
    const moved = await admin.from("messages").update({ author_id: id("elise") }).eq("id", first);
    expect("D3 forfatteren kan ikke byttes, heller ikke av serveren", code(moved), "immutable");
    const redated = await admin.from("messages").update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", first);
    expect("D3 opprettet kan ikke endres", code(redated), "immutable");
    const rechanneled = await admin.from("messages").update({ channel_id: archive }).eq("id", first);
    expect("D3 kanalen kan ikke byttes", code(rechanneled), "immutable");

    // ════ E. Community channel: author, member, moderator, admin ═══════
    const own = await post(linn, general, "slettes av meg");
    expect("E1 et medlem kan ikke slette andres melding", code(await remove(elise, own)), "not_allowed");
    expect("E1 forfatteren sletter egen melding", (await remove(linn, own)).data, "author");
    const ownGone = await stored(own);
    expect("E1 plassholderen har ingen tekst", ownGone.body, "");
    expect("E1 merket som slettet av forfatteren", `${Boolean(ownGone.deleted_at)}|${ownGone.removed_by_moderator}`, "true|false");
    expect("E1 egen sletting logges ikke", logRows(own), "");
    expect("E2 gjentatt sletting gir samme svar", (await remove(linn, own)).data, "author");
    expect("E2 en slettet melding kan ikke redigeres", code(await edit(linn, own, "tilbake")), "deleted");
    const restore = await admin.from("messages").update({ body: "tilbake", deleted_at: null }).eq("id", own);
    expect("E2 en plassholder kan ikke gjenopprettes", code(restore), "deleted");
    expect("E2 en slettet melding kan ikke festes", code(await pin(ingrid, own)), "deleted");

    const victim = await post(elise, general, "fjernes av moderator");
    expect("E3 moderatoren fjerner andres melding", (await remove(ingrid, victim)).data, "moderator");
    const victimGone = await stored(victim);
    expect("E3 merket som fjernet av moderator", `${victimGone.body}|${victimGone.removed_by_moderator}`, "|true");
    expect("E3 fjerningen er logget med hvem, uten tekst", logRows(victim), `remove:${id("ingrid")}`);
    expect("E3 loggen har kanal og fellesskap", sql(`select community_id || '|' || channel_id from message_moderation_log where message_id = '${victim}'`), `${FTR}|${general}`);
    const replay = await Promise.all([remove(ingrid, victim), remove(ingrid, victim)]);
    expect("E4 gjentatte fjerninger gir samme svar", replay.map((r) => r.data).join(","), "moderator,moderator");
    expect("E4 og logges bare én gang", logRows(victim), `remove:${id("ingrid")}`);
    const race = await post(elise, general, "samtidig fjerning");
    const raced2 = await Promise.all([remove(mia, race), remove(ingrid, race), remove(elise, race)]);
    expect("E4 samtidige slettinger feiler ikke", raced2.map(code).join(","), "ok,ok,ok");
    expect("E4 bare én fjerning er logget", Number(sql(`select count(*) from message_moderation_log where message_id = '${race}'`)) <= 1, true);
    const viaApi = await linn.from("messages").select("body, reactions, attachment").eq("id", victim).single();
    expect("E5 den opprinnelige teksten er borte fra API-et", `${viaApi.data?.body}|${JSON.stringify(viaApi.data?.reactions)}|${viaApi.data?.attachment}`, "|[]|null");
    const memberLog = await loose(linn).from("message_moderation_log").select("*").limit(1);
    expect("E5 et medlem kan ikke lese revisjonsloggen", memberLog.error?.code, "42501");
    const adminLog = await loose(mia).from("message_moderation_log").select("*").limit(1);
    expect("E5 heller ikke en administrator via API-et", adminLog.error?.code, "42501");
    const removedPage = await page(linn, `/community/${FTR}/channel/${encodeURIComponent(general)}`);
    expect("E5 siden viser «fjernet av en moderator»", removedPage.html.includes("Meldingen ble fjernet av en moderator."), true);
    expect("E5 siden viser «Meldingen er slettet.»", removedPage.html.includes("Meldingen er slettet."), true);
    expect("E5 siden viser ikke den fjernede teksten", removedPage.html.includes("fjernes av moderator"), false);

    const byAdmin = await post(linn, general, "fjernes av admin");
    expect("E6 administratoren fjerner i egen kanal", (await remove(mia, byAdmin)).data, "moderator");
    expect("E6 et annet fellesskaps moderator finner den ikke", code(await remove(hanne, await post(linn, general, "tu-moderator"))), "not_found");
    expect("E6 et annet fellesskaps admin finner den ikke", code(await remove(emma, await post(linn, general, "tu-admin"))), "not_found");
    expect("E6 forfalsket id avvises", code(await remove(ingrid, crypto.randomUUID())), "not_found");

    // ════ F. Lokallag chats ════════════════════════════════════════════
    const local = await post(eli, TRONDELAG_CHAT, "lokallag");
    expect("F1 et medlem i lokallaget kan ikke fjerne andres", code(await remove(kari, local)), "not_allowed");
    expect("F1 en moderator uten lokallaget finner den ikke", code(await remove(ingrid, local)), "not_found");
    expect("F1 lokallagslederen fjerner i sitt lokallag", (await remove(petter, local)).data, "moderator");
    expect("F1 og fjerningen er logget", logRows(local), `remove:${id("petter")}`);
    const otherLocal = await post(kristoffer, OSLO_CHAT, "annet lokallag");
    expect("F2 lederen kan ikke moderere et annet lokallag", code(await remove(petter, otherLocal)), "not_found");
    expect("F2 lederen kan ikke feste der heller", code(await pin(petter, otherLocal)), "not_found");
    expect("F2 administratoren kan moderere lokallagschatten", code(await pin(mia, otherLocal)), "ok");
    expect("F2 og fjerne festingen", code(await pin(mia, otherLocal, false)), "ok");
    const leaderPin = await post(eli, TRONDELAG_CHAT, "festes av leder");
    expect("F3 lederen fester i sitt lokallag", code(await pin(petter, leaderPin)), "ok");
    expect("F3 et medlem kan ikke feste", code(await pin(eli, leaderPin, false)), "not_allowed");
    expect("F3 lederen fjerner festingen", code(await pin(petter, leaderPin, false)), "ok");

    // ════ G. Private lokallag channels ═════════════════════════════════
    const inP1 = await post(eli, p1, "privat 1");
    expect("G1 kanalens leder fjerner i kanalen han styrer", (await remove(petter, inP1)).data, "moderator");
    const inP3 = await post(eli, p3, "privat 3");
    expect("G2 lederen er ikke med i kanalen og finner den ikke", code(await remove(petter, inP3)), "not_found");
    expect("G2 og kan ikke feste den", code(await pin(petter, inP3)), "not_found");
    const inP2 = await post(kristoffer, p2, "privat 2");
    expect("G3 lederen kan ikke moderere et annet lokallags private kanal", code(await remove(petter, inP2)), "not_found");
    expect("G3 en moderator har ingen tilgang til private kanaler", code(await remove(ingrid, inP2)), "not_found");
    expect("G3 et annet fellesskaps admin heller ikke", code(await remove(emma, inP2)), "not_found");
    expect("G3 en deltaker kan ikke fjerne en annens melding", code(await remove(eli, await post(petter, p1, "lederens"))), "not_allowed");
    expect("G4 deltakeren sletter egen melding", (await remove(kristoffer, inP2)).data, "author");

    // ════ H. Groups ════════════════════════════════════════════════════
    const inG1 = await post(linn, g1.channelId, "gruppe 1");
    expect("H1 gruppelederen fjerner i sin gruppe", (await remove(elise, inG1)).data, "moderator");
    const inG2 = await post(linn, g2.channelId, "gruppe 2");
    expect("H2 gruppelederen finner ikke en annen gruppe", code(await remove(elise, inG2)), "not_found");
    expect("H2 en moderator utenfor gruppen finner den ikke", code(await remove(ingrid, inG2)), "not_found");
    const peer = await post(elise, g1.channelId, "lederens egen");
    expect("H3 et gruppemedlem kan ikke fjerne andres", code(await remove(linn, peer)), "not_allowed");
    expect("H3 gruppelederen fester i sin gruppe", code(await pin(elise, peer)), "ok");
    expect("H3 et gruppemedlem kan ikke feste", code(await pin(linn, peer, false)), "not_allowed");

    // ════ I. Pinning ═══════════════════════════════════════════════════
    const pinA = await post(linn, general, "festes først");
    const pinB = await post(elise, general, "festes etterpå");
    expect("I1 et medlem kan ikke feste", code(await pin(linn, pinA)), "not_allowed");
    expect("I1 moderatoren fester", code(await pin(ingrid, pinA)), "ok");
    expect("I1 festet er lagret", await pinnedIn(general), pinA);
    const memberSees = await linn.from("channel_pinned_messages").select("message_id").eq("channel_id", general).maybeSingle();
    expect("I1 medlemmer ser festet", memberSees.data?.message_id, pinA);
    const outsider = await emma.from("channel_pinned_messages").select("message_id").eq("channel_id", general);
    expect("I1 et annet fellesskap ser det ikke", outsider.data?.length, 0);
    expect("I2 å feste en annen erstatter den første", code(await pin(mia, pinB)), "ok");
    expect("I2 bare én er festet", `${await pinnedIn(general)}|${sql(`select count(*) from channel_pinned_messages where channel_id = '${general}'`)}`, `${pinB}|1`);
    expect("I2 den samme igjen er ingen endring", code(await pin(mia, pinB)), "ok");
    expect("I2 festing og bytte er logget", logRows(pinA) + "/" + logRows(pinB), `pin:${id("ingrid")}/pin:${id("miaminge")}`);
    await edit(elise, pinB, `${BODY}: festet, redigert`);
    const pinnedPage = await page(linn, `/community/${FTR}/channel/${encodeURIComponent(general)}`);
    expect("I3 den redigerte teksten vises i festet", pinnedPage.html.includes("Festet melding") && pinnedPage.html.includes("festet, redigert"), true);
    const direct = await loose(ingrid).from("channel_pinned_messages").insert({ channel_id: general, message_id: pinA });
    expect("I4 festet kan ikke skrives direkte", direct.error?.code, "42501");
    expect("I5 sletting av festet melding fjerner festet", `${(await remove(elise, pinB)).data}|${await pinnedIn(general)}`, "author|-");
    expect("I6 å fjerne festing som ikke finnes er ingen feil", code(await pin(ingrid, pinA, false)), "ok");

    // ════ J. Archived channel ══════════════════════════════════════════
    const archived = await post(linn, archive, "arkiveres");
    const archivedOther = await post(elise, archive, "arkiveres også");
    const archivedOwn = await post(linn, archive, "slettes etter arkivering");
    const archivedFile = await share(linn, archive, await pngFixture(`${TAG} arkivert.png`), `${BODY}: arkivert med vedlegg`);
    expect("J0 festet før arkivering", code(await pin(mia, archived)), "ok");
    const archivedOk = await mia.rpc("set_community_channel_archived", { p_channel_id: archive, p_archived: true });
    expect("J0 kanalen er arkivert", archivedOk.error?.message ?? "ok", "ok");
    expect("J1 kan ikke redigeres", code(await edit(linn, archived, "etterpå")), "archived");
    expect("J1 forfatteren kan heller ikke redigere en annen melding", code(await edit(linn, archivedOwn, "etterpå")), "archived");
    expect("J1 ingen ny melding i en arkivert kanal", Boolean((await linn.from("messages").insert({ channel_id: archive, body: `${BODY}: ny` })).error), true);
    expect("J1 ingen ny opplasting i en arkivert kanal", (await linn.rpc("message_attachment_policy", { p_channel_id: archive, p_conversation_id: N }).single()).data?.reason, "archived");
    expect("J4 et annet medlem kan ikke slette forfatterens melding", code(await remove(elise, archivedOwn)), "not_allowed");
    expect("J4 et annet fellesskaps admin finner den ikke", code(await remove(emma, archivedOwn)), "not_found");
    expect("J4 forfatteren sletter egen melding i en arkivert kanal", (await remove(linn, archivedOwn)).data, "author");
    const archivedGone = await stored(archivedOwn);
    expect("J4 plassholderen er forfatterens", `${archivedGone.body}|${Boolean(archivedGone.deleted_at)}|${archivedGone.removed_by_moderator}`, "|true|false");
    expect("J4 og kan ikke redigeres etterpå", code(await edit(linn, archivedOwn, "tilbake")), "deleted");
    expect("J5 forfatteren sletter en melding med vedlegg i arkivert kanal", (await remove(linn, archivedFile.messageId)).data, "author");
    expect("J5 vedleggsraden er borte", sql(`select count(*) from message_attachments where id = '${archivedFile.attachmentId}'`), 0);
    expect("J5 objektet står i slettekøen", sql(`select count(*) from message_attachment_purges where storage_path = '${archivedFile.path}'`), 1);
    expect("J5 objektet kan ikke leses", Boolean((await linn.storage.from(BUCKET).download(archivedFile.path)).data), false);
    expect("J2 festet står igjen", await pinnedIn(archive), archived);
    expect("J2 festet kan ikke endres", code(await pin(mia, archivedOther)), "archived");
    expect("J2 eller fjernes", code(await pin(mia, archived, false)), "archived");
    expect("J3 en moderator kan fortsatt fjerne en melding", (await remove(ingrid, archivedOther)).data, "moderator");

    // ════ K. Attachments, Ressurser and Storage ════════════════════════
    const unrelated = await share(elise, general, await pdfFixture(`${TAG} urørt.pdf`));
    const shared = await share(linn, general, await pngFixture(`${TAG} bilde.png`), `${BODY}: med vedlegg`);
    const folder = await mia.rpc("create_channel_resource_folder", { p_channel_id: general, p_parent_id: N, p_name: `${TAG} mappe` });
    await linn.rpc("move_channel_resource", { p_type: "file", p_id: shared.attachmentId, p_folder_id: folder.data as string });
    await mia.rpc("set_channel_resource_pinned", { p_type: "file", p_id: shared.attachmentId, p_pinned: true });
    await mia.rpc("set_channel_resource_pinned", { p_type: "file", p_id: unrelated.attachmentId, p_pinned: true });
    const link = await linn.rpc("add_channel_link", { p_channel_id: general, p_folder_id: folder.data as string, p_url: "https://example.org/check-melding", p_title: `${TAG} lenke`, p_description: "" });
    await mia.rpc("set_channel_resource_pinned", { p_type: "link", p_id: link.data as string, p_pinned: true });
    expect("K0 bildet kan lastes ned før sletting", Boolean((await linn.storage.from(BUCKET).download(shared.path)).data), true);

    expect("K1 en vedleggsmelding kan redigeres til tom tekst", code(await edit(linn, shared.messageId, "")), "ok");
    expect("K1 vedlegget er urørt av redigeringen", sql(`select count(*) from message_attachments where id = '${shared.attachmentId}' and status = 'sent'`), 1);
    expect("K1 og står fortsatt i mappen", sql(`select count(*) from channel_attachment_placements where attachment_id = '${shared.attachmentId}'`), 1);

    expect("K2 forfatteren sletter meldingen med vedlegget", (await remove(linn, shared.messageId)).data, "author");
    expect("K2 vedleggsraden er borte", sql(`select count(*) from message_attachments where id = '${shared.attachmentId}'`), 0);
    expect("K2 plasseringen i mappen er borte", sql(`select count(*) from channel_attachment_placements where attachment_id = '${shared.attachmentId}'`), 0);
    expect("K2 festingen i Ressurser er borte", sql(`select count(*) from channel_resource_pins where attachment_id = '${shared.attachmentId}'`), 0);
    expect("K2 objektet og miniatyren står i slettekøen", sql(`select count(*) from message_attachment_purges where storage_path like '${shared.path.split(".")[0]}%'`), 2);
    const library = await linn.rpc("channel_resources", {
      p_channel_id: general, p_search: N, p_kind: N, p_contributor: N, p_folder: N, p_pinned: false, p_sort: "newest", p_after_key: N, p_after_id: N, p_limit: 50,
    });
    const listed = (library.data ?? []).map((row) => row.id);
    expect("K3 det slettede vedlegget er ute av Ressurser", listed.includes(shared.attachmentId), false);
    expect("K3 den urørte filen er der fortsatt", listed.includes(unrelated.attachmentId), true);
    expect("K3 lenken er der fortsatt", listed.includes(link.data as string), true);
    expect("K3 mappen er der fortsatt", sql(`select count(*) from channel_resource_folders where id = '${folder.data}'`), 1);
    expect("K3 andre festinger står", sql(`select count(*) from channel_resource_pins where channel_id = '${general}'`), 2);
    expect("K4 objektet kan ikke leses av medlemmer", Boolean((await linn.storage.from(BUCKET).download(shared.path)).data), false);
    const route = await fetch(`${APP}/community/${FTR}/attachments/${shared.attachmentId}`, { headers: { Cookie: await cookiesFor(linn) }, redirect: "manual" });
    await route.arrayBuffer();
    expect("K4 vedleggsruten svarer 404", route.status, 404);
    await purgeOwnAttachmentObjects(1000);
    const swept = await admin.storage.from(BUCKET).list(shared.path.split("/")[0], { search: shared.path.split("/")[1].split(".")[0] });
    expect("K5 opprydningen fjerner objektene", swept.data?.length ?? 0, 0);
    expect("K5 den urørte filen kan fortsatt lastes ned", Boolean((await linn.storage.from(BUCKET).download(unrelated.path)).data), true);

    const moderated = await share(linn, general, await pngFixture(`${TAG} moderert.png`));
    expect("K6 moderatoren fjerner en melding med vedlegg", (await remove(ingrid, moderated.messageId)).data, "moderator");
    expect("K6 vedlegget er borte", sql(`select count(*) from message_attachments where id = '${moderated.attachmentId}'`), 0);

    // ════ L. Direct messages ═══════════════════════════════════════════
    const [one, two] = [id("elise"), id("ingrid")].sort();
    const existing = await admin.from("direct_conversations").select("id").eq("community_id", FTR).eq("participant_one_id", one).eq("participant_two_id", two).maybeSingle();
    const since = new Date().toISOString();
    if (existing.data) {
      conversation = { id: existing.data.id, created: false, since, markedRead: [] };
    } else {
      const created = await admin.from("direct_conversations").insert({ community_id: FTR, participant_one_id: one, participant_two_id: two, created_by: one }).select("id").single();
      conversation = { id: created.data!.id, created: true, since, markedRead: [] };
    }
    // An unread notice for this conversation would absorb the new one; it is
    // marked read for the run and put back afterwards.
    const unread = sql(`update notifications set read = true where href = '/community/${FTR}/messages/${conversation.id}' and user_id = '${id("ingrid")}' and not read returning id`);
    conversation.markedRead = unread ? unread.split("\n") : [];
    const sent = await elise.from("direct_messages").insert({ conversation_id: conversation.id, body: `${BODY}: privat hemmelighet` }).select("id").single();
    const reply = await ingrid.from("direct_messages").insert({ conversation_id: conversation.id, body: `${BODY}: svar` }).select("id").single();
    const dm = sent.data!.id;
    const dmReply = reply.data!.id;
    const href = `/community/${FTR}/messages/${conversation.id}`;
    const notice = () => sql(`select body from notifications where user_id = '${id("ingrid")}' and href = '${href}' and created_at >= '${since}' order by created_at desc limit 1`);
    expect("L0 mottakeren har et varsel som siterer meldingen", notice().includes("privat hemmelighet"), true);

    expect("L1 forfatteren redigerer egen direktemelding", code(await editDm(elise, dm, `${BODY}: rettet`)), "ok");
    expect("L1 varselet følger redigeringen", notice().includes("rettet") && !notice().includes("hemmelighet"), true);
    expect("L1 redigert-tidspunkt er satt", Boolean(sql(`select edited_at from direct_messages where id = '${dm}'`)), true);
    expect("L2 den andre deltakeren kan ikke redigere", code(await editDm(ingrid, dm, "kapret")), "not_allowed");
    expect("L2 og ikke slette", code(await removeDm(ingrid, dm)), "not_allowed");
    expect("L3 en administrator utenfor samtalen finner den ikke", code(await removeDm(mia, dm)), "not_found");
    expect("L3 og kan ikke lese den", (await mia.from("direct_messages").select("id").eq("id", dm)).data?.length, 0);
    expect("L3 kanalfunksjonen kjenner ikke direktemeldinger", code(await remove(mia, dm)), "not_found");
    expect("L3 direktemeldinger kan ikke festes", code(await pin(ingrid, dm)), "not_found");
    expect("L4 tom tekst avvises", code(await editDm(elise, dm, " ")), "empty");
    const directDm = await loose(elise).from("direct_messages").update({ body: "kapret" }).eq("id", dm);
    expect("L5 direkte oppdatering nektes", directDm.error?.code, "42501");
    expect("L6 forfatteren sletter egen direktemelding", (await removeDm(elise, dm)).data, "author");
    const dmRow = await ingrid.from("direct_messages").select("body, deleted_at").eq("id", dm).single();
    expect("L6 mottakeren ser bare en plassholder", `${dmRow.data?.body}|${Boolean(dmRow.data?.deleted_at)}`, "|true");
    expect("L6 varselet siterer ikke lenger meldingen", notice().endsWith("Meldingen er slettet.") && !notice().includes("rettet"), true);
    expect("L6 gjentatt sletting gir samme svar", (await removeDm(elise, dm)).data, "author");
    expect("L6 en slettet direktemelding kan ikke redigeres", code(await editDm(elise, dm, "tilbake")), "deleted");
    expect("L7 svaret er urørt", sql(`select body from direct_messages where id = '${dmReply}'`), `${BODY}: svar`);
    expect("L7 ingen revisjonslogg for direktemeldinger", sql(`select count(*) from message_moderation_log where message_id in ('${dm}', '${dmReply}')`), 0);
    const dmPage = await page(ingrid, href);
    expect("L8 samtalen viser plassholderen", dmPage.html.includes("Meldingen er slettet.") && !dmPage.html.includes("hemmelighet"), true);
  } finally {
    await cleanup();
  }

  console.log(failures === 0 ? `✓ ${checks} kontroller av meldingsredigering og moderering passerte` : `\n${failures} av ${checks} kontroller feilet`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
