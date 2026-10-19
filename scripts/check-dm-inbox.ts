/**
 * Checks «Fjern fra innboksen» and «Slett samtalehistorikk» (20261104100000)
 * under real authenticated sessions.
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

async function inbox(client: Client, communityId: string): Promise<string[]> {
  const { data, error } = await client.rpc("direct_inbox", { p_community_id: communityId });
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

async function unread(client: Client, communityId: string): Promise<number> {
  const { data } = await client.rpc("direct_unread_count", { p_community_id: communityId });
  return data ?? -1;
}

async function hide(client: Client, conversationId: string) {
  const { data, error } = await client.rpc("hide_direct_conversation", { p_conversation_id: conversationId });
  return { ok: data === true, error: error?.message };
}

async function clear(client: Client, conversationId: string) {
  const { data, error } = await client.rpc("clear_direct_conversation_history", { p_conversation_id: conversationId });
  return { boundary: data ?? undefined, error: error?.message };
}

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

    // ── 1. Hide: one participant only ──
    expect("skjul: Ana har samtalen i innboksen før", (await inbox(ana.client, UTR)).includes(conv), true);
    const unreadBeforeHide = await unread(ana.client, UTR);
    expect("skjul: Ana har uleste før", unreadBeforeHide >= 1, true);
    expect("skjul: deltaker kan skjule", (await hide(ana.client, conv)).ok, true);
    expect("skjul: gjentatt skjuling er trygg", (await hide(ana.client, conv)).ok, true);
    expect("skjul: borte fra Anas innboks", (await inbox(ana.client, UTR)).includes(conv), false);
    expect("skjul: uleste teller ikke skjult samtale", await unread(ana.client, UTR), unreadBeforeHide - 1);
    expect("skjul: Bens innboks er uendret", (await inbox(ben.client, UTR)).includes(conv), true);
    expect("skjul: Ben har ingen tilstandsrad", await stateOf(ben.id, conv), null);
    expect("skjul: historikken er bevart for Ana", (await visibleIds(ana.client, conv)).length, 3);
    expect("skjul: samtalen åpnes fortsatt via adressen", Boolean((await ana.client.from("direct_conversations").select("id").eq("id", conv).maybeSingle()).data), true);
    expect("skjul: vedlegget er fortsatt Anas", await downloads(ana.client, file.path), true);
    expect("skjul: Ben ser ikke Anas tilstand", ((await ben.client.from("direct_conversation_states").select("user_id")).data ?? []).length, 0);
    expect("skjul: andre samtaler i UTR er uberørt", (await inbox(ana.client, UTR)).includes(utrStaff.id!), true);

    // Unrelated activity does not bring it back.
    await ben.client.rpc("edit_direct_message", { p_message_id: m2.id!, p_body: "CHECK INBOX: ok (redigert)" });
    await ben.client.rpc("mark_direct_conversation_read", { p_conversation_id: conv });
    await send(ana.client, utrStaff.id!, "CHECK INBOX: annen samtale");
    await hide(ben.client, utrStaff.id!);
    expect("skjul: redigering, lesing og andre samtaler henter den ikke tilbake", (await inbox(ana.client, UTR)).includes(conv), false);

    // A new message does.
    const m3 = await send(ben.client, conv, "CHECK INBOX: er du der?");
    expect("skjul: ny innkommende melding henter den tilbake", (await inbox(ana.client, UTR)).includes(conv), true);
    expect("skjul: historikken er hel etter retur", (await visibleIds(ana.client, conv)).length, 4);

    // Reopening through an authorised flow returns the same thread.
    await hide(ana.client, conv);
    const reopened = await start(ana.client, UTR, ben.id);
    expect("gjenåpning: samme tråd, ingen duplikat", reopened.id, conv);
    expect("gjenåpning: tilbake i innboksen", (await inbox(ana.client, UTR)).includes(conv), true);
    expect(
      "gjenåpning: fortsatt én samtale for paret",
      sql(`select count(*) from direct_conversations where community_id = '${UTR}' and '${ana.id}' in (participant_one_id, participant_two_id) and '${ben.id}' in (participant_one_id, participant_two_id)`),
      1,
    );
    await hide(ben.client, conv);
    await start(ana.client, UTR, ben.id);
    expect("gjenåpning: Anas start endrer ikke Bens skjuling", (await inbox(ben.client, UTR)).includes(conv), false);
    await send(ana.client, conv, "CHECK INBOX: Ana skriver");
    expect("ny melding henter den tilbake hos mottakeren Ben", (await inbox(ben.client, UTR)).includes(conv), true);

    // ── 2. Who may hide or clear ──
    expect("tredjepart kan ikke skjule", Boolean((await hide(cy.client, conv)).error), true);
    expect("tredjepart kan ikke slette historikk", Boolean((await clear(cy.client, conv)).error), true);
    expect("anonym kan ikke skjule", Boolean((await hide(anon, conv)).error), true);
    expect("anonym kan ikke slette historikk", Boolean((await clear(anon, conv)).error), true);
    expect("oppdiktet samtale-id avvises", Boolean((await clear(ana.client, crypto.randomUUID())).error), true);
    const benCy = await start(ben.client, UTR, cy.id);
    expect("Ana kan ikke slette historikk i Ben og Cys samtale", Boolean((await clear(ana.client, benCy.id!)).error), true);
    expect("avvist forsøk lager ingen tilstandsrad", await stateOf(ana.id, benCy.id!), null);
    expect(
      "klient kan ikke skrive tilstand direkte",
      Boolean((await ana.client.from("direct_conversation_states").insert({ conversation_id: conv, user_id: ben.id, hidden_at: new Date().toISOString() } as never)).error),
      true,
    );
    expect(
      "klient kan ikke endre en annens tilstand",
      Boolean((await ana.client.from("direct_conversation_states").update({ cleared_through_seq: 0 } as never).eq("user_id", ben.id)).error),
      true,
    );

    // ── 3. Clear ──
    await send(ben.client, conv, "CHECK INBOX: ulest før sletting");
    expect("slett: samtalen er ulest for Ana før", (await unread(ana.client, UTR)) >= 1, true);
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

    const cleared = await clear(ana.client, conv);
    expect("slett: deltaker kan slette egen historikk", cleared.error ?? "ok", "ok");
    expect("slett: grensen er siste melding", cleared.boundary, sql(`select message_seq from direct_conversations where id = '${conv}'`));
    expect("slett: Ana ser ingen gamle meldinger", (await visibleIds(ana.client, conv)).length, 0);
    expect("slett: verken sendte eller mottatte", ((await ana.client.from("direct_messages").select("id").in("id", oldIds)).data ?? []).length, 0);
    expect("slett: gammel melding-id gir ingenting", Boolean((await ana.client.from("direct_messages").select("id").eq("id", m1.id!).maybeSingle()).data), false);
    expect("slett: markør (seq) omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).gte("seq", 0)).data ?? []).length, 0);
    expect("slett: tidsmarkør omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).lte("created_at", new Date(Date.now() + 60_000).toISOString())).data ?? []).length, 0);
    expect("slett: sidevisning omgår ikke grensen", ((await ana.client.from("direct_messages").select("id").eq("conversation_id", conv).range(0, 100)).data ?? []).length, 0);
    expect("slett: Ben beholder hele historikken", (await visibleIds(ben.client, conv)).join(","), benVisibleBefore.join(","));
    expect("slett: Bens tekst er urørt", (await ben.client.from("direct_messages").select("body").eq("id", m1.id!).single()).data?.body, "CHECK INBOX: hei fra Ana");
    expect("slett: Anas varsler for samtalen er borte", (await directNotices(ana.client, UTR, conv)).length, 0);
    expect("slett: Bens varsler er urørt", (await directNotices(ben.client, UTR, conv)).length, benNoticesBefore);
    expect("slett: borte fra Anas innboks", (await inbox(ana.client, UTR)).includes(conv), false);
    expect("slett: fortsatt i Bens innboks", (await inbox(ben.client, UTR)).includes(conv), true);
    expect("slett: uleste teller den ikke lenger", await unread(ana.client, UTR), 0);
    expect("slett: Anas usendte opplasting er forkastet", pending.data ? sql(`select count(*) from message_attachments where id = '${pending.data.attachment_id}'`) : "0", 0);

    expect("vedlegg: Ana ser ikke gammelt vedlegg", await seesAttachment(ana.client, file.attachmentId), false);
    expect("vedlegg: Ana kan ikke laste ned objektet direkte", await downloads(ana.client, file.path), false);
    expect("vedlegg: Ana får ingen signert URL", await signedUrl(ana.client, file.path), false);
    expect("vedlegg: ruten svarer 404 for Ana", await httpStatus(ana.client, `/community/${UTR}/attachments/${file.attachmentId}`), 404);
    expect("vedlegg: ruten svarer 404 for Anas forhåndsvisning", await httpStatus(ana.client, `/community/${UTR}/attachments/${file.attachmentId}?variant=thumb`), 404);
    expect("vedlegg: Ben ser fortsatt vedlegget", await seesAttachment(ben.client, file.attachmentId), true);
    expect("vedlegg: Ben kan fortsatt laste ned", await downloads(ben.client, file.path), true);
    expect("vedlegg: objektet er ikke slettet fra lagringen", sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name = '${file.path}'`), 1);
    expect("vedlegg: filrettighet består (begge har skrevet)", (await ana.client.rpc("message_attachment_policy", { p_conversation_id: conv }).maybeSingle()).data?.allowed, true);

    expect("slett: Ana kan ikke redigere egen gammel melding", Boolean((await ana.client.rpc("edit_direct_message", { p_message_id: m1.id!, p_body: "endret" })).error), true);
    expect("slett: Ana kan ikke slette egen gammel melding", Boolean((await ana.client.rpc("delete_direct_message", { p_message_id: m1.id! })).error), true);
    expect("slett: Bens kopi av Anas melding er uendret", (await ben.client.from("direct_messages").select("body, deleted_at").eq("id", m1.id!).single()).data?.deleted_at, null);
    expect("slett: Ben kan fortsatt redigere sin egen", (await ben.client.rpc("edit_direct_message", { p_message_id: m3.id!, p_body: "CHECK INBOX: er du der? (2)" })).error?.message ?? "ok", "ok");
    expect("slett: samtalen finnes fortsatt for Ana (gammel URL)", Boolean((await ana.client.from("direct_conversations").select("id").eq("id", conv).maybeSingle()).data), true);
    expect("slett: gjenåpning gjennom start gir ikke historikken tilbake", `${(await start(ana.client, UTR, ben.id)).id === conv}/${(await visibleIds(ana.client, conv)).length}`, "true/0");

    // Repeating is harmless, and the boundary only moves forward.
    const again = await clear(ana.client, conv);
    expect("slett: gjentatt sletting er trygg og idempotent", `${again.error ?? "ok"}/${again.boundary}`, `ok/${cleared.boundary}`);
    expect("vern: klient kan ikke flytte grensen tilbake", Boolean((await ana.client.from("direct_conversation_states").update({ cleared_through_seq: 0 } as never).eq("conversation_id", conv)).error), true);
    expect("vern: serverens nøkkel kan ikke flytte grensen tilbake", Boolean((await admin.from("direct_conversation_states").update({ cleared_through_seq: 0 }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: serverens nøkkel kan ikke nullstille tidspunktet", Boolean((await admin.from("direct_conversation_states").update({ cleared_at: null }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: serverens nøkkel kan ikke slette grensen", Boolean((await admin.from("direct_conversation_states").delete().eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: grensen kan ikke settes forbi samtalen", Boolean((await admin.from("direct_conversation_states").update({ cleared_through_seq: 999999 }).eq("conversation_id", conv).eq("user_id", ana.id)).error), true);
    expect("vern: meldingsnummer kan ikke endres", Boolean((await admin.from("direct_messages").update({ seq: 999 }).eq("id", m3.id!)).error), true);
    expect("vern: telleren kan ikke senkes", Boolean((await admin.from("direct_conversations").update({ message_seq: 0 }).eq("id", conv)).error), true);
    expect("vern: grensen står", (await stateOf(ana.id, conv))?.cleared_through_seq, cleared.boundary);

    // ── 4. After clearing: new messages only ──
    // The same words as Ben's cleared message m2 now says.
    const m6 = await send(ben.client, conv, "CHECK INBOX: ok (redigert)");
    expect("etter: ny melding henter samtalen tilbake", (await inbox(ana.client, UTR)).includes(conv), true);
    expect("etter: Ana ser bare den nye", (await visibleIds(ana.client, conv)).join(","), m6.id);
    expect("etter: uleste teller den nye", (await unread(ana.client, UTR)) >= 1, true);
    const freshNotices = await directNotices(ana.client, UTR, conv);
    expect("etter: nytt varsel for ny melding", freshNotices.length, 1);
    // A later edit of a cleared message that said the same words never
    // re-quotes it in the new notice.
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

    // ── 5. Concurrency: clears and sends at the same moment ──
    const burst = await Promise.all([
      send(ben.client, conv, "CHECK INBOX: samtidig 1"),
      clear(ana.client, conv),
      send(ben.client, conv, "CHECK INBOX: samtidig 2"),
      clear(ana.client, conv),
      send(ana.client, conv, "CHECK INBOX: samtidig 3"),
      send(ben.client, conv, "CHECK INBOX: samtidig 4"),
    ]);
    expect("samtidig: ingen operasjon feilet", burst.map((r) => r.error ?? "ok").join(","), "ok,ok,ok,ok,ok,ok");
    const boundary = (await stateOf(ana.id, conv))!.cleared_through_seq;
    const maxSeq = Number(sql(`select message_seq from direct_conversations where id = '${conv}'`));
    const expectedVisible = sql(`select count(*) from direct_messages where conversation_id = '${conv}' and seq > ${boundary}`);
    expect("samtidig: Ana ser nøyaktig meldingene over grensen", (await visibleIds(ana.client, conv)).length, expectedVisible);
    expect("samtidig: numrene er sammenhengende", sql(`select count(*) = max(seq) from direct_messages where conversation_id = '${conv}'`), "t");
    expect("samtidig: skjult hvis og bare hvis ingenting kom etter grensen", (await inbox(ana.client, UTR)).includes(conv), boundary < maxSeq);
    expect("samtidig: Ben ser alt", (await visibleIds(ben.client, conv)).length, maxSeq);

    // ── 6. Membership revoked ──
    await setStatus(ana.id, UTR, "requested");
    expect("tilbakekalt: kan ikke skjule", Boolean((await hide(ana.client, conv)).error), true);
    expect("tilbakekalt: kan ikke slette historikk", Boolean((await clear(ana.client, conv)).error), true);
    expect("tilbakekalt: ser ingen meldinger", (await visibleIds(ana.client, conv)).length, 0);
    expect("tilbakekalt: Ben kan ikke svare", Boolean((await send(ben.client, conv, "CHECK INBOX: til tilbakekalt")).error), true);
    await setStatus(ana.id, UTR, "active");
    expect("gjeninnsatt: grensen er den samme", (await stateOf(ana.id, conv))?.cleared_through_seq, boundary);
    expect("gjeninnsatt: gamle meldinger forblir borte", (await visibleIds(ana.client, conv)).length, expectedVisible);

    // ── 7. Cross-community isolation and FTR ──
    expect("isolasjon: FTR-samtalen er urørt", (await visibleIds(ana.client, ftr.id!)).length, 2);
    expect("isolasjon: FTR-innboksen har samtalen", (await inbox(ana.client, FTR)).includes(ftr.id!), true);
    expect("isolasjon: UTR-samtalen vises ikke i FTR", (await inbox(ana.client, FTR)).includes(conv), false);
    expect("FTR: deltaker kan skjule", (await hide(ana.client, ftr.id!)).ok, true);
    expect("FTR: skjult i FTR, ikke i UTR", `${(await inbox(ana.client, FTR)).includes(ftr.id!)}/${(await inbox(ana.client, UTR)).includes(utrStaff.id!)}`, "false/true");
    await admin.from("memberships").update({ accepts_member_dms: false }).eq("user_id", staff.id).eq("community_id", FTR);
    const ftrReopen = await start(ana.client, FTR, staff.id);
    expect("FTR: eksisterende samtale gjenåpnes når staff har stengt for nye", ftrReopen.id, ftr.id);
    expect("FTR: gjenåpnet er tilbake i innboksen", (await inbox(ana.client, FTR)).includes(ftr.id!), true);
    expect("FTR: ny medlemssamtale er fortsatt stengt", Boolean((await start(ben.client, FTR, staff.id)).error), true);
    const ftrClear = await clear(staff.client, ftr.id!);
    expect("FTR: staff kan slette egen historikk", ftrClear.error ?? "ok", "ok");
    expect("FTR: Ana beholder sin", (await visibleIds(ana.client, ftr.id!)).length, 2);
    expect("FTR: staff ser ingenting", (await visibleIds(staff.client, ftr.id!)).length, 0);
    expect("FTR: organisasjonsvedlegg fortsatt tillatt", (await staff.client.rpc("message_attachment_policy", { p_conversation_id: ftr.id! }).maybeSingle()).data?.allowed, true);

    // ── 8. Ben clears too: still only his own ──
    const benBoundaryBefore = (await stateOf(ana.id, conv))?.cleared_through_seq;
    expect("Ben: kan slette sin egen historikk", (await clear(ben.client, conv)).error ?? "ok", "ok");
    expect("Ben: Anas grense er urørt", (await stateOf(ana.id, conv))?.cleared_through_seq, benBoundaryBefore);
    expect("Ben: Ana ser fortsatt sine", (await visibleIds(ana.client, conv)).length, expectedVisible);
    expect("Ben: begge har slettet, objektene finnes for ingen", `${await downloads(ben.client, fresh.path)}`, "false");
    expect("Ben: ny melding etter at begge har slettet", (await send(ana.client, conv, "CHECK INBOX: ny start")).error ?? "ok", "ok");
    expect("Ben: ser bare den nye", (await visibleIds(ben.client, conv)).length, 1);

    expect("utviklingsdata: andres meldinger er urørt", sql("select count(*) || ':' || coalesce(sum(length(body)), 0) from direct_messages where conversation_id not in (select id from direct_conversations where created_at > now() - interval '1 hour' and (participant_one_id in (select id from profiles where handle like 'qa-dm-%') or participant_two_id in (select id from profiles where handle like 'qa-dm-%')))"), devMessagesBefore);
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
