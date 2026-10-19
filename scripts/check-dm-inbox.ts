/**
 * Checks «Arkiver samtale», «Gjenopprett samtale» and «Slett samtale»
 * (20261104100000, 20261105100000) under real authenticated sessions,
 * including the physical purge of messages neither participant can read.
 *
 * Every person here is a disposable account made for this run and deleted at
 * the end, with their memberships, conversations, messages, notices and
 * files. Nothing belonging to the development data is read, changed or
 * purged: Storage cleanup is limited to objects this run created.
 *
 * Run with `npm run check:dm-inbox` against the local stack. The attachment
 * route is also asked over HTTP, at CHECK_APP_URL (default
 * http://localhost:3000).
 */
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { translator } from "@/lib/i18n";
import { purgeOwnAttachmentObjects, rememberExistingAttachmentObjects } from "./lib/attachment-isolation";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const BUCKET = "message-attachments";

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

const RUN = Math.random().toString(16).slice(2, 8);

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
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", statement],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();

// ── Disposable people ─────────────────────────────────────────────────────

const createdUserIds: string[] = [];

async function person(name: string): Promise<{ id: string; client: Client }> {
  const email = `qa-dm-${name}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`kunne ikke lage ${email}: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties) throw new Error(`kunne ikke lage lenke for ${email}: ${linkError?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return { id: data.user.id, client };
}

async function join(
  userId: string,
  communityId: string,
  role: Database["public"]["Enums"]["community_role"] = "member",
  acceptsMemberDms = false,
) {
  const { error } = await admin.from("memberships").insert({
    user_id: userId,
    community_id: communityId,
    role,
    status: "active",
    accepts_member_dms: acceptsMemberDms,
  });
  if (error) throw new Error(`medlemskap ${communityId}: ${error.message}`);
  await admin
    .from("community_profiles")
    .update({ display_name: `QA ${userId.slice(0, 4)}` })
    .eq("user_id", userId)
    .eq("community_id", communityId);
}

async function setStatus(userId: string, communityId: string, status: Database["public"]["Enums"]["membership_status"]) {
  const { error } = await admin.from("memberships").update({ status }).eq("user_id", userId).eq("community_id", communityId);
  if (error) throw error;
}

// ── Conversations ─────────────────────────────────────────────────────────

const conversationIds = new Set<string>();
const createdPaths = new Set<string>();

async function start(client: Client, communityId: string, recipientId: string) {
  const { data, error } = await client.rpc("start_direct_conversation", {
    p_community_id: communityId,
    p_recipient_id: recipientId,
  });
  if (data) conversationIds.add(data);
  return { id: data ?? undefined, error: error?.message };
}

async function send(client: Client, conversationId: string, body: string) {
  const { data, error } = await client
    .from("direct_messages")
    .insert({ conversation_id: conversationId, body })
    .select("id, seq")
    .maybeSingle();
  return { id: data?.id, seq: data?.seq, error: error?.message };
}

async function visibleIds(client: Client, conversationId: string): Promise<string[]> {
  const { data } = await client
    .from("direct_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true });
  return (data ?? []).map((row) => row.id);
}

async function inbox(client: Client, communityId: string, archived = false): Promise<string[]> {
  const { data, error } = await client.rpc("direct_inbox", { p_community_id: communityId, p_archived: archived });
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/** "inbox", "archive" or "none" — where the conversation is listed for this person. */
async function listedIn(client: Client, communityId: string, conversationId: string): Promise<string> {
  const [regular, archived] = await Promise.all([inbox(client, communityId), inbox(client, communityId, true)]);
  if (regular.includes(conversationId) && archived.includes(conversationId)) return "both";
  return regular.includes(conversationId) ? "inbox" : archived.includes(conversationId) ? "archive" : "none";
}

async function unread(client: Client, communityId: string): Promise<number> {
  const { data } = await client.rpc("direct_unread_count", { p_community_id: communityId });
  return data ?? -1;
}

/** The caller's own archived_at, read as the app does after an archive request. */
async function ownArchivedAt(client: Client, userId: string, conversationId: string): Promise<string | null> {
  const { data } = await client
    .from("direct_conversation_states")
    .select("archived_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.archived_at ?? null;
}

async function archive(client: Client, conversationId: string) {
  const { data, error } = await client.rpc("archive_direct_conversation", { p_conversation_id: conversationId });
  return { ok: data === true, error: error?.message };
}

async function restore(client: Client, conversationId: string) {
  const { data, error } = await client.rpc("restore_direct_conversation", { p_conversation_id: conversationId });
  return { ok: data === true, error: error?.message };
}

async function remove(client: Client, conversationId: string) {
  const { data, error } = await client.rpc("delete_direct_conversation", { p_conversation_id: conversationId });
  return { boundary: data ?? undefined, error: error?.message };
}

const rowsIn = (conversationId: string, where = "true") =>
  Number(sql(`select count(*) from direct_messages where conversation_id = '${conversationId}' and ${where}`));

const objectExists = (path: string) =>
  sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name = '${path}'`) === "1";

async function stateOf(userId: string, conversationId: string) {
  const { data } = await admin
    .from("direct_conversation_states")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return data;
}

async function directNotices(client: Client, communityId: string, conversationId: string) {
  const { data } = await client
    .from("notifications")
    .select("id, body")
    .eq("kind", "direct_message")
    .eq("href", `/community/${communityId}/messages/${conversationId}`);
  return data ?? [];
}

async function sendFile(client: Client, conversationId: string, body: string, name: string) {
  const bytes = new TextEncoder().encode(`CHECK DM INBOX ${name} ${RUN}\n`);
  const { data: begun, error } = await client
    .rpc("begin_message_attachment", {
      p_channel_id: null as unknown as string,
      p_conversation_id: conversationId,
      p_display_name: name,
      p_mime_type: "text/plain",
      p_size_bytes: bytes.byteLength,
    })
    .maybeSingle();
  if (error || !begun) throw new Error(`opplasting avvist: ${error?.message}`);
  createdPaths.add(begun.storage_path);
  const stored = await admin.storage.from(BUCKET).upload(begun.storage_path, bytes, { contentType: "text/plain" });
  if (stored.error) throw stored.error;
  const { data: completed } = await admin.rpc("complete_message_attachment", { p_attachment_id: begun.attachment_id });
  if (completed !== true) throw new Error("opplasting ble ikke fullført");
  const { data: messageId, error: sendError } = await client.rpc("send_direct_message_with_attachments", {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachment_ids: [begun.attachment_id],
  });
  if (sendError || !messageId) throw new Error(`sending med vedlegg avvist: ${sendError?.message}`);
  return { attachmentId: begun.attachment_id, path: begun.storage_path, messageId: messageId as string };
}

async function seesAttachment(client: Client, attachmentId: string): Promise<boolean> {
  const { data } = await client.from("message_attachments").select("id").eq("id", attachmentId).maybeSingle();
  return Boolean(data);
}

async function downloads(client: Client, path: string): Promise<boolean> {
  const { data } = await client.storage.from(BUCKET).download(path);
  return Boolean(data);
}

async function signedUrl(client: Client, path: string): Promise<boolean> {
  const { data } = await client.storage.from(BUCKET).createSignedUrl(path, 60);
  return Boolean(data?.signedUrl);
}

/** The same session as a browser carries it, for the app's own routes. */
async function cookiesFor(client: Client): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("ingen sesjon");
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
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

async function httpStatus(client: Client, path: string): Promise<number | string> {
  try {
    const response = await fetch(`${APP}${path}`, { headers: { Cookie: await cookiesFor(client) }, redirect: "manual" });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return "utilgjengelig";
  }
}

async function cleanup() {
  if (conversationIds.size > 0) {
    const hrefs = [...conversationIds].flatMap((id) => [FTR, TU, UTR].map((c) => `/community/${c}/messages/${id}`));
    await admin.from("notifications").delete().in("href", hrefs);
  }
  for (const id of createdUserIds) {
    // Takes their profile, memberships, conversations, messages, states and
    // attachment rows with it; the objects are queued for the purge below.
    await admin.auth.admin.deleteUser(id);
  }
  if (createdPaths.size > 0) {
    await purgeOwnAttachmentObjects();
    // Anything that never made it into the queue (an upload that failed half-way).
    await admin.storage.from(BUCKET).remove([...createdPaths]);
    await admin.from("message_attachment_purges").delete().in("storage_path", [...createdPaths]);
  }
}

async function main() {
  rememberExistingAttachmentObjects();
  const devMessagesBefore = sql("select count(*) || ':' || coalesce(sum(length(body)), 0) from direct_messages");

  const ana = await person("ana");
  const ben = await person("ben");
  const cy = await person("cy");
  const staff = await person("staff");
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  for (const p of [ana, ben, cy, staff]) await join(p.id, UTR);
  await join(ana.id, FTR);
  await join(ben.id, FTR);
  await join(staff.id, FTR, "moderator", true);
  await join(ana.id, TU);
  await join(ben.id, TU);

  try {
    // ── Existing FTR/TU/UTR start rules are unchanged ──
    const utr = await start(ana.client, UTR, ben.id);
    expect("UTR: medlem kan starte samtale med medlem", utr.error ?? "ok", "ok");
    const conv = utr.id!;
    expect("FTR: medlem kan fortsatt ikke starte samtale med medlem", Boolean((await start(ana.client, FTR, ben.id)).error), true);
    expect("TU: medlem kan fortsatt ikke starte samtale med medlem", Boolean((await start(ana.client, TU, ben.id)).error), true);
    const ftr = await start(ana.client, FTR, staff.id);
    expect("FTR: medlem kan starte med staff som tar imot", ftr.error ?? "ok", "ok");
    const utrStaff = await start(ana.client, UTR, staff.id);
    expect("UTR: samme par har egen samtale i UTR", Boolean(utrStaff.id && utrStaff.id !== ftr.id), true);

    const m1 = await send(ana.client, conv, "CHECK INBOX: hei fra Ana");
    const m2 = await send(ben.client, conv, "CHECK INBOX: ok");
    expect("meldinger nummereres i rekkefølge", `${m1.seq}/${m2.seq}`, "1/2");
    await send(ana.client, ftr.id!, "CHECK INBOX: FTR-melding");
    await send(staff.client, ftr.id!, "CHECK INBOX: FTR-svar");
    await send(ana.client, utrStaff.id!, "CHECK INBOX: UTR med staff");

    const file = await sendFile(ben.client, conv, "CHECK INBOX: fil", "notat.txt");
    expect("vedlegg: Ana ser vedlegget før", await seesAttachment(ana.client, file.attachmentId), true);
    expect("vedlegg: Ana kan laste ned før", await downloads(ana.client, file.path), true);
    expect("vedlegg: ruten svarer Ana før", await httpStatus(ana.client, `/community/${UTR}/attachments/${file.attachmentId}`), 200);

    // ── 1. Archive: personal, reversible, sticky ──
    expect("arkiv: i Anas innboks før", await listedIn(ana.client, UTR, conv), "inbox");
    expect("arkiv: deltaker kan arkivere", (await archive(ana.client, conv)).ok, true);
    expect("arkiv: gjentatt arkivering er trygg", (await archive(ana.client, conv)).ok, true);
    expect("arkiv: i Anas arkiv, ikke innboks", await listedIn(ana.client, UTR, conv), "archive");
    expect("arkiv: Bens innboks er uendret", await listedIn(ben.client, UTR, conv), "inbox");
    expect("arkiv: Ben har ingen tilstandsrad", await stateOf(ben.id, conv), null);
    expect("arkiv: Ben ser ikke Anas tilstand", ((await ben.client.from("direct_conversation_states").select("user_id")).data ?? []).length, 0);
    expect("arkiv: historikken er bevart", (await visibleIds(ana.client, conv)).length, 3);
    expect("arkiv: vedlegget er fortsatt Anas", await downloads(ana.client, file.path), true);
    expect("arkiv: andre samtaler i UTR er uberørt", await listedIn(ana.client, UTR, utrStaff.id!), "inbox");

    // New messages leave it archived, with notices and unread state.
    await ana.client.rpc("mark_direct_conversation_read", { p_conversation_id: conv });
    await ana.client.from("notifications").update({ read: true }).eq("kind", "direct_message");
    const unreadBeforeIncoming = await unread(ana.client, UTR);
    const m3 = await send(ben.client, conv, "CHECK INBOX: er du der?");
    expect("arkiv: innkommende melding lar den ligge i arkivet", await listedIn(ana.client, UTR, conv), "archive");
    expect("arkiv: innkommende melding gir varsel", (await directNotices(ana.client, UTR, conv)).length >= 1, true);
    expect(
      "arkiv: varselet er ulest",
      ((await ana.client.from("notifications").select("id").eq("kind", "direct_message").eq("read", false).eq("href", `/community/${UTR}/messages/${conv}`)).data ?? []).length,
      1,
    );
    expect("arkiv: uleste teller arkivert samtale", await unread(ana.client, UTR), unreadBeforeIncoming + 1);
    expect("arkiv: Ana kan lese i arkivet", (await visibleIds(ana.client, conv)).includes(m3.id!), true);
    await ana.client.rpc("mark_direct_conversation_read", { p_conversation_id: conv });
    expect("arkiv: lest i arkivet teller ikke lenger", await unread(ana.client, UTR), unreadBeforeIncoming);
    expect("arkiv: Ana kan svare fra arkivet", (await send(ana.client, conv, "CHECK INBOX: svar fra arkivet")).error ?? "ok", "ok");
    expect("arkiv: eget svar gjenoppretter ikke", await listedIn(ana.client, UTR, conv), "archive");
    expect("arkiv: kontaktflyt gir samme tråd", (await start(ana.client, UTR, ben.id)).id, conv);
    expect("arkiv: kontaktflyt gjenoppretter ikke", await listedIn(ana.client, UTR, conv), "archive");
    expect(
      "arkiv: fortsatt én samtale for paret",
      sql(`select count(*) from direct_conversations where community_id = '${UTR}' and '${ana.id}' in (participant_one_id, participant_two_id) and '${ben.id}' in (participant_one_id, participant_two_id)`),
      1,
    );

    // Each participant on their own.
    expect("arkiv: Ben arkiverer uavhengig", (await archive(ben.client, conv)).ok, true);
    expect("arkiv: begge har den i arkivet", `${await listedIn(ana.client, UTR, conv)}/${await listedIn(ben.client, UTR, conv)}`, "archive/archive");
    expect("gjenopprett: Ben gjenoppretter sin", (await restore(ben.client, conv)).ok, true);
    expect("gjenopprett: Bens er tilbake, Anas er fortsatt arkivert", `${await listedIn(ben.client, UTR, conv)}/${await listedIn(ana.client, UTR, conv)}`, "inbox/archive");
    expect("gjenopprett: Ana gjenoppretter sin", (await restore(ana.client, conv)).ok, true);
    expect("gjenopprett: gjentatt gjenoppretting er trygg", (await restore(ana.client, conv)).ok, true);
    expect("gjenopprett: tilbake i Anas innboks", await listedIn(ana.client, UTR, conv), "inbox");
    expect("gjenopprett: historikken er hel", (await visibleIds(ana.client, conv)).length, 5);

    // ── 2. Who may change what ──
    for (const [label, call] of [
      ["arkivere", archive],
      ["gjenopprette", restore],
    ] as const) {
      expect(`tredjepart kan ikke ${label}`, Boolean((await call(cy.client, conv)).error), true);
      expect(`anonym kan ikke ${label}`, Boolean((await call(anon, conv)).error), true);
      expect(`oppdiktet id avvises (${label})`, Boolean((await call(ana.client, crypto.randomUUID())).error), true);
    }
    expect("tredjepart kan ikke slette", Boolean((await remove(cy.client, conv)).error), true);
    expect("anonym kan ikke slette", Boolean((await remove(anon, conv)).error), true);
    expect("oppdiktet id avvises (slette)", Boolean((await remove(ana.client, crypto.randomUUID())).error), true);
    const benCy = await start(ben.client, UTR, cy.id);
    expect("Ana kan ikke slette Ben og Cys samtale", Boolean((await remove(ana.client, benCy.id!)).error), true);
    expect("Ana kan ikke arkivere Ben og Cys samtale", Boolean((await archive(ana.client, benCy.id!)).error), true);
    expect("avviste forsøk lager ingen tilstandsrad", await stateOf(ana.id, benCy.id!), null);
    await archive(ben.client, conv);
    expect(
      "klient kan ikke endre en annens arkiv",
      Boolean((await ana.client.from("direct_conversation_states").update({ archived_at: null } as never).eq("user_id", ben.id)).error),
      true,
    );
    expect(
      "klient kan ikke skrive tilstand direkte",
      Boolean((await ana.client.from("direct_conversation_states").insert({ conversation_id: conv, user_id: ben.id, archived_at: new Date().toISOString() } as never)).error),
      true,
    );
    expect("Bens arkiv står", await listedIn(ben.client, UTR, conv), "archive");
    await restore(ben.client, conv);

    // ── 3. Delete (from the archive) ──
    await archive(ana.client, conv);
    await send(ben.client, conv, "CHECK INBOX: ulest før sletting");
    expect("slett: ulest for Ana før", (await unread(ana.client, UTR)) >= 1, true);
    const noticesBefore = await directNotices(ana.client, UTR, conv);
    expect("varsel: Ana har varsel for samtalen før", noticesBefore.length >= 1, true);
    const benNoticesBefore = (await directNotices(ben.client, UTR, conv)).length;
    const benVisibleBefore = await visibleIds(ben.client, conv);
    const oldIds = await visibleIds(ana.client, conv);
    const pending = await ana.client
      .rpc("begin_message_attachment", {
        p_channel_id: null as unknown as string,
        p_conversation_id: conv,
        p_display_name: "utkast.txt",
        p_mime_type: "text/plain",
        p_size_bytes: 5,
      })
      .maybeSingle();
    if (pending.data) createdPaths.add(pending.data.storage_path);

    const cleared = await remove(ana.client, conv);
    expect("slett: deltaker kan slette arkivert samtale", cleared.error ?? "ok", "ok");
    expect("slett: grensen er siste melding", cleared.boundary, sql(`select message_seq from direct_conversations where id = '${conv}'`));
    expect("slett: borte fra både innboks og arkiv", await listedIn(ana.client, UTR, conv), "none");
    expect("slett: ikke lenger arkivert", (await stateOf(ana.id, conv))?.archived_at, null);
    expect("slett: Bens innboks er uendret", await listedIn(ben.client, UTR, conv), "inbox");
    expect("slett: Ana ser ingen gamle meldinger", (await visibleIds(ana.client, conv)).length, 0);
    expect("slett: verken sendte eller mottatte", ((await ana.client.from("direct_messages").select("id").in("id", oldIds)).data ?? []).length, 0);
    expect("slett: gammel melding-id gir ingenting", Boolean((await ana.client.from("direct_messages").select("id").eq("id", m1.id!).maybeSingle()).data), false);
    expect("slett: markør (seq) omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).gte("seq", 0)).data ?? []).length, 0);
    expect("slett: tidsmarkør omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).lte("created_at", new Date(Date.now() + 60_000).toISOString())).data ?? []).length, 0);
    expect("slett: sidevisning omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).range(0, 100)).data ?? []).length, 0);
    expect("slett: Ben beholder hele historikken", (await visibleIds(ben.client, conv)).join(","), benVisibleBefore.join(","));
    expect("slett: Bens kopi av Anas tekst er urørt", (await ben.client.from("direct_messages").select("body").eq("id", m1.id!).single()).data?.body, "CHECK INBOX: hei fra Ana");
    expect("slett: ingenting fysisk slettet mens Ben har tilgang", rowsIn(conv), benVisibleBefore.length);
    expect("slett: Anas varsler for samtalen er borte", (await directNotices(ana.client, UTR, conv)).length, 0);
    expect("slett: Bens varsler er urørt", (await directNotices(ben.client, UTR, conv)).length, benNoticesBefore);
    expect("slett: uleste teller den ikke lenger", await unread(ana.client, UTR), 0);
    expect("slett: Anas usendte opplasting er forkastet", pending.data ? sql(`select count(*) from message_attachments where id = '${pending.data.attachment_id}'`) : "0", 0);

    expect("vedlegg: Ana ser ikke gammelt vedlegg", await seesAttachment(ana.client, file.attachmentId), false);
    expect("vedlegg: Ana kan ikke laste ned objektet direkte", await downloads(ana.client, file.path), false);
    expect("vedlegg: Ana får ingen signert URL", await signedUrl(ana.client, file.path), false);
    expect("vedlegg: ruten svarer 404 for Ana", await httpStatus(ana.client, `/community/${UTR}/attachments/${file.attachmentId}`), 404);
    expect("vedlegg: ruten svarer 404 for Anas forhåndsvisning", await httpStatus(ana.client, `/community/${UTR}/attachments/${file.attachmentId}?variant=thumb`), 404);
    expect("vedlegg: Ben ser fortsatt vedlegget", await seesAttachment(ben.client, file.attachmentId), true);
    expect("vedlegg: Ben kan fortsatt laste ned", await downloads(ben.client, file.path), true);
    expect("vedlegg: objektet beholdes mens Ben har tilgang", objectExists(file.path), true);
    expect("vedlegg: filrettighet består (begge har skrevet)", (await ana.client.rpc("message_attachment_policy", { p_conversation_id: conv }).maybeSingle()).data?.allowed, true);

    expect("slett: Ana kan ikke redigere egen gammel melding", Boolean((await ana.client.rpc("edit_direct_message", { p_message_id: m1.id!, p_body: "endret" })).error), true);
    expect("slett: Ana kan ikke slette egen gammel melding", Boolean((await ana.client.rpc("delete_direct_message", { p_message_id: m1.id! })).error), true);
    expect("slett: Ben kan fortsatt redigere sin egen", (await ben.client.rpc("edit_direct_message", { p_message_id: m3.id!, p_body: "CHECK INBOX: er du der? (2)" })).error?.message ?? "ok", "ok");
    expect("slett: samtalen finnes fortsatt for Ana (gammel URL)", Boolean((await ana.client.from("direct_conversations").select("id").eq("id", conv).maybeSingle()).data), true);
    expect("slett: kontaktflyt gir samme tråd uten historikk", `${(await start(ana.client, UTR, ben.id)).id === conv}/${(await visibleIds(ana.client, conv)).length}`, "true/0");
    expect("slett: kontaktflyt viser den ikke i noen liste", await listedIn(ana.client, UTR, conv), "none");

    const again = await remove(ana.client, conv);
    expect("slett: gjentatt sletting er trygg og idempotent", `${again.error ?? "ok"}/${again.boundary}`, `ok/${cleared.boundary}`);
    expect("vern: klient kan ikke flytte grensen tilbake", Boolean((await ana.client.from("direct_conversation_states").update({ cleared_through_seq: 0 } as never).eq("conversation_id", conv)).error), true);
    expect("vern: serverens nøkkel kan ikke flytte grensen tilbake", Boolean((await admin.from("direct_conversation_states").update({ cleared_through_seq: 0 }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: serverens nøkkel kan ikke nullstille tidspunktet", Boolean((await admin.from("direct_conversation_states").update({ cleared_at: null }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: serverens nøkkel kan ikke slette grensen", Boolean((await admin.from("direct_conversation_states").delete().eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: grensen kan ikke settes forbi samtalen", Boolean((await admin.from("direct_conversation_states").update({ cleared_through_seq: 999999 }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: meldingsnummer kan ikke endres", Boolean((await admin.from("direct_messages").update({ seq: 999 }).eq("id", m3.id!)).error), true);
    expect("vern: telleren kan ikke senkes", Boolean((await admin.from("direct_conversations").update({ message_seq: 0 }).eq("id", conv)).error), true);
    expect("vern: grensen står", (await stateOf(ana.id, conv))?.cleared_through_seq, cleared.boundary);

    // ── 4. After deleting: new messages only, in the inbox ──
    const m6 = await send(ben.client, conv, "CHECK INBOX: ok (redigert)");
    expect("etter: ny melding gjør samtalen synlig i innboksen", await listedIn(ana.client, UTR, conv), "inbox");
    expect("etter: Ana ser bare den nye", (await visibleIds(ana.client, conv)).join(","), m6.id);
    expect("etter: uleste teller den nye", (await unread(ana.client, UTR)) >= 1, true);
    expect("etter: nytt varsel for ny melding", (await directNotices(ana.client, UTR, conv)).length, 1);
    await ben.client.rpc("edit_direct_message", { p_message_id: m2.id!, p_body: "CHECK INBOX: HEMMELIG ENDRING" });
    expect("etter: redigert gammel melding siteres ikke i nytt varsel", (await directNotices(ana.client, UTR, conv))[0]?.body?.includes("HEMMELIG"), false);
    const fresh = await sendFile(ben.client, conv, "CHECK INBOX: ny fil", "ny.txt");
    expect("etter: Ana ser nytt vedlegg", await seesAttachment(ana.client, fresh.attachmentId), true);
    expect("etter: Ana kan laste ned nytt vedlegg", await downloads(ana.client, fresh.path), true);
    expect("etter: gammelt vedlegg er fortsatt utilgjengelig", await downloads(ana.client, file.path), false);
    const reply = await send(ana.client, conv, "CHECK INBOX: Ana svarer");
    expect("etter: Ana kan svare", reply.error ?? "ok", "ok");
    expect("etter: Ana kan redigere ny melding", (await ana.client.rpc("edit_direct_message", { p_message_id: reply.id!, p_body: "CHECK INBOX: Ana svarer (2)" })).error?.message ?? "ok", "ok");
    expect("etter: synk fra en annen enhet viser ikke gamle", (await visibleIds(await relogin(ana.id), conv)).length, 3);

    // ── 5. Concurrency: send, archive, restore and delete at once ──
    const burst = await Promise.all([
      send(ben.client, conv, "CHECK INBOX: samtidig 1"),
      archive(ana.client, conv),
      remove(ana.client, conv),
      send(ben.client, conv, "CHECK INBOX: samtidig 2"),
      restore(ana.client, conv),
      remove(ana.client, conv),
      send(ana.client, conv, "CHECK INBOX: samtidig 3"),
      send(ben.client, conv, "CHECK INBOX: samtidig 4"),
    ]);
    expect("samtidig: ingen operasjon feilet", burst.map((r) => r.error ?? "ok").join(","), "ok,ok,ok,ok,ok,ok,ok,ok");
    const boundary = (await stateOf(ana.id, conv))!.cleared_through_seq;
    const maxSeq = Number(sql(`select message_seq from direct_conversations where id = '${conv}'`));
    const expectedVisible = rowsIn(conv, `seq > ${boundary}`);
    expect("samtidig: Ana ser nøyaktig meldingene over grensen", (await visibleIds(ana.client, conv)).length, expectedVisible);
    expect("samtidig: ingen melding er fysisk slettet mens Ben har tilgang", rowsIn(conv), maxSeq);
    expect("samtidig: listet hvis og bare hvis noe kom etter grensen", (await listedIn(ana.client, UTR, conv)) !== "none", boundary < maxSeq);
    expect("samtidig: Ben ser alt", (await visibleIds(ben.client, conv)).length, maxSeq);

    // ── 6. Membership revoked ──
    await setStatus(ana.id, UTR, "requested");
    expect("tilbakekalt: kan ikke arkivere", Boolean((await archive(ana.client, conv)).error), true);
    expect("tilbakekalt: kan ikke slette", Boolean((await remove(ana.client, conv)).error), true);
    expect("tilbakekalt: ser ingen meldinger", (await visibleIds(ana.client, conv)).length, 0);
    expect("tilbakekalt: Ben kan ikke svare", Boolean((await send(ben.client, conv, "CHECK INBOX: til tilbakekalt")).error), true);
    await setStatus(ana.id, UTR, "active");
    expect("gjeninnsatt: grensen er den samme", (await stateOf(ana.id, conv))?.cleared_through_seq, boundary);
    expect("gjeninnsatt: gamle meldinger forblir borte", (await visibleIds(ana.client, conv)).length, expectedVisible);

    // ── 7. Cross-community isolation and FTR ──
    expect("isolasjon: FTR-samtalen er urørt", (await visibleIds(ana.client, ftr.id!)).length, 2);
    expect("isolasjon: FTR-innboksen har samtalen", await listedIn(ana.client, FTR, ftr.id!), "inbox");
    expect("isolasjon: UTR-samtalen vises ikke i FTR", `${(await inbox(ana.client, FTR)).includes(conv)}/${(await inbox(ana.client, FTR, true)).includes(conv)}`, "false/false");
    expect("FTR: deltaker kan arkivere", (await archive(ana.client, ftr.id!)).ok, true);
    expect("FTR: arkivert i FTR, ikke i UTR", `${await listedIn(ana.client, FTR, ftr.id!)}/${await listedIn(ana.client, UTR, utrStaff.id!)}`, "archive/inbox");
    await admin.from("memberships").update({ accepts_member_dms: false }).eq("user_id", staff.id).eq("community_id", FTR);
    expect("FTR: eksisterende samtale åpnes når staff har stengt for nye", (await start(ana.client, FTR, staff.id)).id, ftr.id);
    expect("FTR: forblir arkivert", await listedIn(ana.client, FTR, ftr.id!), "archive");
    expect("FTR: kan svare i arkivert samtale", (await send(ana.client, ftr.id!, "CHECK INBOX: FTR fra arkivet")).error ?? "ok", "ok");
    expect("FTR: ny medlemssamtale er fortsatt stengt", Boolean((await start(ben.client, FTR, staff.id)).error), true);
    expect("FTR: staff kan slette sin", (await remove(staff.client, ftr.id!)).error ?? "ok", "ok");
    expect("FTR: Ana beholder sin", (await visibleIds(ana.client, ftr.id!)).length, 3);
    expect("FTR: staff ser ingenting", (await visibleIds(staff.client, ftr.id!)).length, 0);
    expect("FTR: organisasjonsvedlegg fortsatt tillatt", (await staff.client.rpc("message_attachment_policy", { p_conversation_id: ftr.id! }).maybeSingle()).data?.allowed, true);
    expect("TU: medlem kan fortsatt ikke starte samtale", Boolean((await start(ana.client, TU, ben.id)).error), true);

    // ── 8. Both delete: physical purge of what neither can read ──
    const anaCut = boundary;
    // A file sent after Ana's cutoff: Ana can still read it, so it must stay.
    const kept = await sendFile(ben.client, conv, "CHECK INBOX: fil Ana beholder", "beholdes.txt");
    const anaVisibleBeforePurge = (await visibleIds(ana.client, conv)).length;
    expect("purge: gammel fil finnes før", sql(`select count(*) from message_attachments where id = '${file.attachmentId}'`), 1);
    const benCut = await remove(ben.client, conv);
    expect("purge: Ben kan slette", benCut.error ?? "ok", "ok");
    expect("purge: meldinger under begge grenser er fysisk slettet", rowsIn(conv, `seq <= ${anaCut}`), 0);
    expect("purge: meldinger Ana fortsatt kan lese er beholdt", rowsIn(conv, `seq > ${anaCut}`), anaVisibleBeforePurge);
    expect("purge: Ana ser fortsatt sine", (await visibleIds(ana.client, conv)).length, anaVisibleBeforePurge);
    expect("purge: Ben ser ingenting", (await visibleIds(ben.client, conv)).length, 0);
    expect("purge: gammel fils rad er borte", sql(`select count(*) from message_attachments where id = '${file.attachmentId}'`), 0);
    expect("purge: gammel fil står i ryddekøen", sql(`select count(*) from message_attachment_purges where storage_path = '${file.path}'`), 1);
    expect("purge: ny fil (Ana har tilgang) beholdes", `${sql(`select count(*) from message_attachments where id = '${kept.attachmentId}'`)}/${objectExists(kept.path)}`, "1/true");
    expect("purge: Ana kan fortsatt laste ned ny fil", await downloads(ana.client, kept.path), true);
    expect("purge: Ben kan ikke laste ned ny fil", await downloads(ben.client, kept.path), false);
    await purgeOwnAttachmentObjects();
    expect("purge: gammelt objekt fjernet fra lagringen", objectExists(file.path), false);
    expect("purge: køen er tømt for det", sql(`select count(*) from message_attachment_purges where storage_path = '${file.path}'`), 0);
    expect("purge: nytt objekt står", objectExists(kept.path), true);
    expect("purge: filrettighet består", (await ana.client.rpc("message_attachment_policy", { p_conversation_id: conv }).maybeSingle()).data?.allowed, true);
    expect("purge: samtalen og telleren består", sql(`select message_seq from direct_conversations where id = '${conv}'`), maxSeq + 1);

    expect("purge: Ana sletter igjen", (await remove(ana.client, conv)).error ?? "ok", "ok");
    expect("purge: nå kan ingen lese noe, alt er slettet", rowsIn(conv), 0);
    await purgeOwnAttachmentObjects();
    expect("purge: også den nye filen er fjernet", `${sql(`select count(*) from message_attachments where id = '${kept.attachmentId}'`)}/${objectExists(kept.path)}`, "0/false");

    const restart = await send(ana.client, conv, "CHECK INBOX: ny start");
    expect("purge: samme tråd kan brukes igjen", restart.error ?? "ok", "ok");
    expect("purge: begge ser bare den nye", `${(await visibleIds(ana.client, conv)).length}/${(await visibleIds(ben.client, conv)).length}`, "1/1");
    expect("purge: Ben gjentar sletting — den nye overlever (Ana har den)", `${(await remove(ben.client, conv)).error ?? "ok"}/${rowsIn(conv)}`, "ok/1");
    expect("purge: Ana ser fortsatt den nye", (await visibleIds(ana.client, conv)).length, 1);

    const race = await Promise.all([
      send(ben.client, conv, "CHECK INBOX: kappløp 1"),
      remove(ana.client, conv),
      send(ana.client, conv, "CHECK INBOX: kappløp 2"),
      remove(ben.client, conv),
      send(ben.client, conv, "CHECK INBOX: kappløp 3"),
    ]);
    expect("kappløp: ingen operasjon feilet", race.map((r) => r.error ?? "ok").join(","), "ok,ok,ok,ok,ok");
    const [aCut, bCut] = [(await stateOf(ana.id, conv))!.cleared_through_seq, (await stateOf(ben.id, conv))!.cleared_through_seq];
    expect("kappløp: ingenting under begge grenser er igjen", rowsIn(conv, `seq <= ${Math.min(aCut, bCut)}`), 0);
    expect("kappløp: alt over en av grensene er beholdt", rowsIn(conv), rowsIn(conv, `seq > ${Math.min(aCut, bCut)}`));
    expect(
      "kappløp: hver gjenværende melding kan leses av minst én",
      (await visibleIds(ana.client, conv)).length + (await visibleIds(ben.client, conv)).length >= rowsIn(conv),
      true,
    );

    // ── 8b. Deleting wins over archiving ──
    expect("slett>arkiv: Ana sletter", (await remove(ana.client, conv)).error ?? "ok", "ok");
    expect("slett>arkiv: foreldet arkivering etter sletting feiler ikke", (await archive(ana.client, conv)).error ?? "ok", "ok");
    expect("slett>arkiv: slettet samtale forblir uarkivert", (await stateOf(ana.id, conv))?.archived_at, null);
    // What the app reads back to decide whether to say «arkivert».
    expect("slett>arkiv: Anas egen tilstand viser ikke arkivert", (await ownArchivedAt(ana.client, ana.id, conv)) === null, true);
    expect("slett>arkiv: i ingen liste", await listedIn(ana.client, UTR, conv), "none");
    expect(
      "slett>arkiv: serverens nøkkel kan ikke arkivere en slettet samtale",
      `${(await admin.from("direct_conversation_states").update({ archived_at: new Date().toISOString() }).eq("conversation_id", conv).eq("user_id", ana.id)).error?.message ?? "ok"}/${(await stateOf(ana.id, conv))?.archived_at}`,
      "ok/null",
    );
    const cutBeforeRace = (await stateOf(ana.id, conv))!.cleared_through_seq;
    const tangle = await Promise.all([
      archive(ana.client, conv),
      remove(ana.client, conv),
      archive(ana.client, conv),
      archive(ana.client, conv),
      remove(ana.client, conv),
      archive(ana.client, conv),
    ]);
    expect("slett>arkiv: samtidige kall feiler ikke", tangle.map((r) => r.error ?? "ok").join(","), "ok,ok,ok,ok,ok,ok");
    const afterTangle = (await stateOf(ana.id, conv))!;
    expect("slett>arkiv: etter kappløpet er den slettet og uarkivert", `${afterTangle.hidden_at !== null}/${afterTangle.archived_at}`, "true/null");
    expect("slett>arkiv: grensen står eller går fram", afterTangle.cleared_through_seq >= cutBeforeRace, true);
    const comeback = await send(ben.client, conv, "CHECK INBOX: etter kappløpet");
    expect("slett>arkiv: ny melding gir innboksen, ikke arkivet", await listedIn(ana.client, UTR, conv), "inbox");
    expect("slett>arkiv: bare den nye vises", (await visibleIds(ana.client, conv)).join(","), comeback.id);
    expect("slett>arkiv: bevisst arkivering virker igjen", `${(await archive(ana.client, conv)).ok}/${await listedIn(ana.client, UTR, conv)}`, "true/archive");
    expect("slett>arkiv: Anas egen tilstand viser arkivert", (await ownArchivedAt(ana.client, ana.id, conv)) !== null, true);
    expect("slett>arkiv: ny melding lar den ligge i arkivet", `${(await send(ben.client, conv, "CHECK INBOX: arkivert igjen")).error ?? "ok"}/${await listedIn(ana.client, UTR, conv)}`, "ok/archive");
    expect("slett>arkiv: Bens liste er uberørt", await listedIn(ben.client, UTR, conv), "inbox");

    // ── 9. Norwegian and English wording ──
    const nb = translator("nb");
    const en = translator("en");
    expect("nb: arkiver", nb("dm.archive"), "Arkiver samtale");
    expect("nb: gjenopprett", nb("dm.restore"), "Gjenopprett samtale");
    expect("nb: arkivseksjon", nb("dm.archived"), "Arkiverte samtaler");
    expect("nb: slett", `${nb("dm.delete")}/${nb("dm.delete.title")}/${nb("dm.delete.cancel")}/${nb("dm.delete.confirm")}`, "Slett samtale/Slett samtale?/Avbryt/Slett samtale");
    expect(
      "nb: bekreftelsestekst",
      nb("dm.delete.body"),
      "Samtalen slettes permanent for deg, men ikke for den andre personen. Dette kan ikke angres.",
    );
    expect("en: archive/restore/delete", `${en("dm.archive")}/${en("dm.restore")}/${en("dm.delete")}`, "Archive conversation/Restore conversation/Delete conversation");
    expect("en: dialog buttons", `${en("dm.delete.cancel")}/${en("dm.delete.confirm")}`, "Cancel/Delete conversation");
    expect("ingen tekst lover sletting på serveren", [nb("dm.delete.body"), en("dm.delete.body")].some((text) => /server/i.test(text)), false);

    expect("utviklingsdata: andres meldinger er urørt", sql("select count(*) || ':' || coalesce(sum(length(body)), 0) from direct_messages where conversation_id not in (select id from direct_conversations where participant_one_id in (select id from profiles where handle like 'qa-dm-%') or participant_two_id in (select id from profiles where handle like 'qa-dm-%'))"), devMessagesBefore);
  } finally {
    await cleanup();
  }

  expect("opprydding: ingen QA-kontoer igjen", sql(`select count(*) from profiles where handle like 'qa-dm-%-${RUN}%'`), 0);
  expect("opprydding: ingen QA-objekter igjen", sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name in (${[...createdPaths].map((p) => `'${p}'`).join(",") || "''"})`), 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} innboks- og historikkontroller passerte`);
}

/** A second sign-in for the same person: another device. */
async function relogin(userId: string): Promise<Client> {
  const { data: user } = await admin.auth.admin.getUserById(userId);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties!.hashed_token });
  return client;
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
