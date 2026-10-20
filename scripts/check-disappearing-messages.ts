/**
 * Checks disappearing messages in direct conversations (20261107100000)
 * under real authenticated sessions: the setting, what each message captures,
 * when its timer starts, that expired content is refused on every path at
 * once, and that the physical cleanup removes text, files and notices —
 * repeatedly, concurrently, late and in batches, leaving no expired row
 * behind — without touching anything else. Also the step after a database
 * restore (20261109100000), which deletes every disappearing message from
 * before the restore point.
 *
 * Time is not waited for. A message is "aged" by moving its own timestamps
 * back (created_at, read_at, expires_at together) with the database's
 * triggers set aside for that one statement, which is what the passing of
 * that much time would have done. Everything else — sending, reading,
 * changing the setting, purging — goes through the same functions and
 * policies the app uses.
 *
 * Every person here is a disposable account made for this run and deleted at
 * the end, with their memberships, conversations, messages, notices and
 * files. Expiry purges are limited to this run's conversations, and Storage
 * cleanup to objects this run created: no development message or file is
 * read, changed or removed.
 *
 * Run with `npm run check:disappearing-messages` against the local stack. The
 * conversation page and the attachment route are also asked over HTTP, at
 * CHECK_APP_URL (default http://localhost:3000).
 */
import { execFileSync, spawn } from "node:child_process";
import { config } from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { purgeExpiredDirectMessages } from "@/lib/attachment-storage";
import { purgeOwnAttachmentObjects, rememberExistingAttachmentObjects } from "./lib/attachment-isolation";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const BUCKET = "message-attachments";
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev";

const FTR = "tryggere-ruspolitikk";
const UTR = "under-the-rug";

const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
const FOUR_WEEKS = 2419200;

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
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", statement], {
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Disposable people ─────────────────────────────────────────────────────

const createdUserIds: string[] = [];

async function person(name: string): Promise<{ id: string; client: Client }> {
  const email = `qa-dis-${name}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`kunne ikke lage ${email}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, client: await signIn(email) };
}

async function signIn(email: string): Promise<Client> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties) throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
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

// ── Conversations ─────────────────────────────────────────────────────────

const conversationIds = new Set<string>();
const createdPaths = new Set<string>();

async function start(client: Client, communityId: string, recipientId: string): Promise<string> {
  const { data, error } = await client.rpc("start_direct_conversation", {
    p_community_id: communityId,
    p_recipient_id: recipientId,
  });
  if (error || !data) throw new Error(`samtale avvist: ${error?.message}`);
  conversationIds.add(data);
  return data;
}

async function send(client: Client, conversationId: string, body: string) {
  const { data, error } = await client
    .from("direct_messages")
    .insert({ conversation_id: conversationId, body })
    .select("id, seq, disappear_seconds, read_at, expires_at")
    .maybeSingle();
  if (error || !data) throw new Error(`sending avvist: ${error?.message}`);
  return data;
}

async function setTimer(client: Client, conversationId: string, seconds: number | null) {
  const { data, error } = await client.rpc("set_direct_conversation_disappearing", {
    p_conversation_id: conversationId,
    p_seconds: seconds ?? 0,
  });
  return { value: data, error: error?.message };
}

async function markRead(client: Client, conversationId: string, throughSeq?: number) {
  const { data } = await client.rpc("mark_direct_conversation_read", {
    p_conversation_id: conversationId,
    ...(throughSeq !== undefined ? { p_through_seq: throughSeq } : {}),
  });
  return data;
}

/** The stored row, as the database has it — not as anyone may read it. */
function row(messageId: string) {
  const out = sql(
    `select coalesce(disappear_seconds::text, ''), coalesce(read_at::text, ''), coalesce(expires_at::text, ''),
            coalesce(extract(epoch from expires_at - created_at)::bigint::text, ''),
            coalesce(extract(epoch from expires_at - read_at)::bigint::text, ''),
            body, coalesce(edited_at::text, '')
       from direct_messages where id = '${messageId}'`,
  );
  if (!out) return undefined;
  const [seconds, readAt, expiresAt, sinceCreated, sinceRead, body, editedAt] = out.split("|");
  return { seconds, readAt, expiresAt, sinceCreated, sinceRead, body, editedAt };
}

async function sees(client: Client, messageId: string): Promise<boolean> {
  const { data } = await client.from("direct_messages").select("id").eq("id", messageId).maybeSingle();
  return Boolean(data);
}

async function seesBody(client: Client, conversationId: string, text: string): Promise<boolean> {
  const { data } = await client.from("direct_messages").select("body").eq("conversation_id", conversationId);
  return (data ?? []).some((message) => message.body.includes(text));
}

async function notices(client: Client, conversationId: string) {
  const { data } = await client
    .from("direct_conversation_notices")
    .select("seq, actor_id, disappear_seconds")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true });
  return data ?? [];
}

async function conversationSetting(client: Client, conversationId: string) {
  const { data } = await client.from("direct_conversations").select("disappear_seconds").eq("id", conversationId).maybeSingle();
  return data ? (data.disappear_seconds ?? "av") : "ingen tilgang";
}

async function directNotices(client: Client, communityId: string, conversationId: string) {
  const { data } = await client
    .from("notifications")
    .select("id, body, read, direct_message_id")
    .eq("kind", "direct_message")
    .eq("href", `/community/${communityId}/messages/${conversationId}`);
  return data ?? [];
}

async function unread(client: Client, communityId: string): Promise<number> {
  const { data } = await client.rpc("direct_unread_count", { p_community_id: communityId });
  return data ?? -1;
}

/**
 * As if `interval` had passed for this message: its own times move back by
 * that much. Triggers are set aside for this one statement only — the guard
 * would (rightly) refuse anyone moving a message's times.
 */
function age(messageId: string, interval: string) {
  sql(
    `begin; set local session_replication_role = replica;
     update direct_messages
        set created_at = created_at - interval '${interval}',
            read_at = read_at - interval '${interval}',
            expires_at = expires_at - interval '${interval}'
      where id = '${messageId}';
     commit;`,
  );
}

async function purge(conversations = [...conversationIds]) {
  const { data, error } = await admin.rpc("purge_expired_direct_messages", { p_conversation_ids: conversations });
  if (error) throw new Error(`purge: ${error.message}`);
  return data ?? 0;
}

const objectExists = (path: string) =>
  sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name = '${path}'`) === "1";

async function sendFile(client: Client, conversationId: string, body: string, name: string) {
  const bytes = new TextEncoder().encode(`CHECK DISAPPEARING ${name} ${RUN}\n`);
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

/** The app's session cookies for this client, as the browser would send them. */
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

async function http(
  client: Client,
  path: string,
): Promise<{ status: number | string; body: string; cacheControl: string | null }> {
  try {
    const response = await fetch(`${APP}${path}`, { headers: { Cookie: await cookiesFor(client) }, redirect: "manual" });
    return { status: response.status, body: await response.text(), cacheControl: response.headers.get("cache-control") };
  } catch {
    return { status: "utilgjengelig", body: "", cacheControl: null };
  }
}

async function cleanup() {
  if (conversationIds.size > 0) {
    const hrefs = [...conversationIds].flatMap((id) => [FTR, UTR].map((c) => `/community/${c}/messages/${id}`));
    await admin.from("notifications").delete().in("href", hrefs);
  }
  for (const id of createdUserIds) {
    // Takes their profile, memberships, conversations, messages, notices,
    // states and attachment rows with it; the objects are queued.
    await admin.auth.admin.deleteUser(id);
  }
  if (createdPaths.size > 0) {
    await purgeOwnAttachmentObjects();
    await admin.storage.from(BUCKET).remove([...createdPaths]);
    await admin.from("message_attachment_purges").delete().in("storage_path", [...createdPaths]);
  }
}

async function main() {
  rememberExistingAttachmentObjects();
  const ownConversations = () =>
    `select id from direct_conversations where participant_one_id in (select id from profiles where handle like 'qa-dis-%') or participant_two_id in (select id from profiles where handle like 'qa-dis-%')`;
  const devBefore = sql(
    `select count(*) || ':' || coalesce(sum(length(body)), 0) || ':' || count(expires_at) from direct_messages`,
  );
  const devFilesBefore = sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}'`);

  const ana = await person("ana");
  const ben = await person("ben");
  const cy = await person("cy");
  const staff = await person("staff");
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  for (const p of [ana, ben, cy]) await join(p.id, UTR);
  await join(ana.id, FTR);
  await join(staff.id, FTR, "moderator", true);

  try {
    const conv = await start(ana.client, UTR, ben.id);

    // ── 1. Off by default ──
    expect("standard: av for Ana", await conversationSetting(ana.client, conv), "av");
    expect("standard: av for Ben", await conversationSetting(ben.client, conv), "av");
    const plain = await send(ana.client, conv, `CHECK DIS vanlig ${RUN}`);
    expect("standard: vanlig melding har ingen varighet", plain.disappear_seconds ?? "ingen", "ingen");
    expect("standard: vanlig melding utløper aldri", plain.expires_at ?? "aldri", "aldri");
    await send(ben.client, conv, `CHECK DIS svar ${RUN}`);
    await markRead(ben.client, conv);
    expect("standard: lest vanlig melding får ingen lesetid", row(plain.id)?.readAt, "");

    // ── 2. Either participant changes it, for both ──
    expect("innstilling: Ana slår på 1 dag", (await setTimer(ana.client, conv, DAY)).value, DAY);
    expect("innstilling: Ben ser 1 dag", await conversationSetting(ben.client, conv), DAY);
    expect("innstilling: samme valg igjen er trygt", (await setTimer(ana.client, conv, DAY)).value, DAY);
    expect("innstilling: samme valg lager ingen ny merknad", (await notices(ben.client, conv)).length, 1);
    expect("innstilling: Ben endrer til 1 time", (await setTimer(ben.client, conv, HOUR)).value, HOUR);
    expect("innstilling: Ana ser 1 time", await conversationSetting(ana.client, conv), HOUR);
    const shown = await notices(ana.client, conv);
    expect(
      "merknader: begge endringer, med hvem og hva",
      shown.map((n) => `${n.actor_id === ana.id ? "ana" : n.actor_id === ben.id ? "ben" : "?"}:${n.disappear_seconds ?? "av"}`).join(","),
      `ana:${DAY},ben:${HOUR}`,
    );
    expect("merknader: Ben ser de samme", (await notices(ben.client, conv)).length, 2);
    expect("merknader: tredjepart ser ingen", (await notices(cy.client, conv)).length, 0);
    expect("innstilling: ugyldig varighet avvises", /invalid_timer/.test((await setTimer(ana.client, conv, 1234)).error ?? ""), true);
    expect("innstilling: tredjepart avvises", /not_found/.test((await setTimer(cy.client, conv, WEEK)).error ?? ""), true);
    expect("innstilling: anonym avvises", Boolean((await setTimer(anon, conv, WEEK)).error), true);
    expect("innstilling: oppdiktet samtale avvises", /not_found/.test((await setTimer(ana.client, crypto.randomUUID(), WEEK)).error ?? ""), true);
    expect(
      "innstilling: kan ikke skrives direkte",
      Boolean((await ana.client.from("direct_conversations").update({ disappear_seconds: WEEK } as never).eq("id", conv)).error) ||
        (await conversationSetting(ana.client, conv)) === HOUR,
      true,
    );
    expect(
      "merknader: kan ikke skrives direkte",
      Boolean((await ana.client.from("direct_conversation_notices").insert({ conversation_id: conv, seq: 999, actor_id: ben.id } as never)).error),
      true,
    );
    expect("innstilling: tredjepartens forsøk endret ingenting", await conversationSetting(ana.client, conv), HOUR);

    // Notices are not messages.
    const quiet = await start(ana.client, UTR, cy.id);
    await setTimer(ana.client, quiet, DAY);
    await setTimer(cy.client, quiet, WEEK);
    expect("merknader: gir ikke uleste", await unread(cy.client, UTR), 0);
    expect("merknader: gir ikke varsel", (await directNotices(cy.client, UTR, quiet)).length, 0);
    expect(
      "merknader: teller ikke som skrevet (fildeling)",
      sql(`select participant_one_wrote::text || '/' || participant_two_wrote::text from direct_conversations where id = '${quiet}'`),
      "false/false",
    );
    const { data: quietPolicy } = await ana.client.rpc("message_attachment_policy", { p_channel_id: null as unknown as string, p_conversation_id: quiet }).maybeSingle();
    expect("merknader: fildeling er fortsatt låst", quietPolicy?.reason, "needs_mutual");
    await send(ana.client, quiet, `CHECK DIS tekst fra Ana ${RUN}`);
    await send(cy.client, quiet, `CHECK DIS tekst fra Cy ${RUN}`);
    await markRead(ana.client, quiet);
    const { data: openPolicy } = await ana.client.rpc("message_attachment_policy", { p_channel_id: null as unknown as string, p_conversation_id: quiet }).maybeSingle();
    expect("fildeling: forsvinnende tekst fra begge åpner som før", openPolicy?.reason, "ok");

    // ── 3. Only messages sent afterwards take a new setting ──
    const h1 = await send(ana.client, conv, `CHECK DIS en time ${RUN}`);
    expect("varighet: ny melding fanger 1 time", h1.disappear_seconds, HOUR);
    expect("varighet: ulest utløper 30 dager etter sending", row(h1.id)?.sinceCreated, 30 * DAY);
    await setTimer(ana.client, conv, WEEK);
    const w1 = await send(ben.client, conv, `CHECK DIS en uke ${RUN}`);
    expect("varighet: etter endring fanger ny melding 1 uke", w1.disappear_seconds, WEEK);
    expect("varighet: eldre melding beholder 1 time", row(h1.id)?.seconds, HOUR);
    expect("varighet: vanlig melding forblir vanlig", row(plain.id)?.seconds, "");
    await setTimer(ben.client, conv, null);
    const off = await send(ana.client, conv, `CHECK DIS av igjen ${RUN}`);
    expect("av: ny melding er vanlig", off.disappear_seconds ?? "ingen", "ingen");
    expect("av: eldre forsvinnende melding beholder sin tid", `${row(h1.id)?.seconds}/${row(w1.id)?.seconds}`, `${HOUR}/${WEEK}`);
    expect(
      "varighet: kan ikke endres i ettertid, heller ikke av serveren",
      Boolean((await admin.from("direct_messages").update({ disappear_seconds: FOUR_WEEKS }).eq("id", h1.id)).error),
      true,
    );
    expect("varighet: uendret etter forsøket", row(h1.id)?.seconds, HOUR);

    // ── 4. A change while messages are being sent ──
    for (let round = 0; round < 3; round += 1) {
      const before = round % 2 === 0 ? DAY : null;
      const after = round % 2 === 0 ? HOUR : WEEK;
      await setTimer(ana.client, conv, before);
      const sends = Array.from({ length: 8 }, (_, i) =>
        send(i % 2 === 0 ? ana.client : ben.client, conv, `CHECK DIS samtidig ${round}-${i} ${RUN}`),
      );
      const change = setTimer(ben.client, conv, after);
      const [sent] = await Promise.all([Promise.all(sends), change]);
      const noticeSeq = Number(
        sql(`select max(seq) from direct_conversation_notices where conversation_id = '${conv}' and coalesce(disappear_seconds, 0) = ${after}`),
      );
      const wrong = sent.filter((m) =>
        m.seq < noticeSeq ? (m.disappear_seconds ?? null) !== before : m.disappear_seconds !== after,
      );
      expect(`samtidighet runde ${round + 1}: hver melding har varigheten på sin side av merknaden`, wrong.length, 0);
    }
    await setTimer(ana.client, conv, HOUR);

    // ── 5. The timer starts at the recipient's first read ──
    // Ana has read her earlier notices, so the next message raises a new one.
    await ana.client.from("notifications").update({ read: true }).eq("kind", "direct_message");
    const r1 = await send(ben.client, conv, `CHECK DIS hemmelig ${RUN}`);
    expect("lesing: ny melding er ulest", row(r1.id)?.readAt, "");
    await markRead(ben.client, conv);
    expect("lesing: avsenderens egen visning starter ikke tiden", row(r1.id)?.readAt, "");
    const anaNotices = await directNotices(ana.client, UTR, conv);
    const timedNotice = anaNotices.find((n) => n.direct_message_id === r1.id);
    expect("varsel: Ana får varsel for forsvinnende melding", Boolean(timedNotice), true);
    expect("varsel: siterer ikke innholdet", anaNotices.some((n) => n.body.includes("hemmelig")), false);
    expect("varsel: sier at det er en forsvinnende melding", timedNotice?.body.endsWith("Forsvinnende melding"), true);
    await ana.client.from("notifications").update({ read: true }).eq("id", timedNotice?.id ?? crypto.randomUUID());
    expect("lesing: å åpne varselet starter ikke tiden", row(r1.id)?.readAt, "");
    await ana.client.from("direct_messages").select("body").eq("conversation_id", conv);
    await ana.client.rpc("direct_inbox", { p_community_id: UTR });
    expect("lesing: forhåndsvisning/innboks starter ikke tiden", row(r1.id)?.readAt, "");
    await markRead(ana.client, conv, r1.seq - 1);
    expect("lesing: en side som ikke viste meldingen starter ikke tiden", row(r1.id)?.readAt, "");
    expect("lesing: tredjepart kan ikke markere lest", await markRead(cy.client, conv), false);
    expect("lesing: tredjepart startet ingenting", row(r1.id)?.readAt, "");
    expect(
      "lesing: mottaker kan ikke skrive lesetid selv",
      Boolean((await ana.client.from("direct_messages").update({ read_at: "2000-01-01T00:00:00Z" } as never).eq("id", r1.id)).error),
      true,
    );
    await markRead(ana.client, conv, r1.seq);
    const read1 = row(r1.id);
    expect("lesing: mottakerens første lesing starter tiden", Boolean(read1?.readAt), true);
    expect("lesing: utløper én time etter lesing", read1?.sinceRead, HOUR);
    await sleep(1100);
    await markRead(ana.client, conv);
    expect("lesing: ny lesing flytter ikke tiden", row(r1.id)?.readAt, read1?.readAt);
    await admin.from("direct_messages").update({ read_at: "2000-01-01T00:00:00Z" }).eq("id", r1.id);
    expect("lesing: heller ikke serveren kan flytte lesetiden", row(r1.id)?.readAt, read1?.readAt);
    await admin.from("direct_messages").update({ expires_at: "2100-01-01T00:00:00Z" }).eq("id", r1.id);
    expect("utløp: kan ikke settes direkte, heller ikke av serveren", row(r1.id)?.expiresAt, read1?.expiresAt);
    const fresh = await send(ben.client, conv, `CHECK DIS fersk ${RUN}`);
    expect("lesing: en annen melding forlenger ikke den første", row(r1.id)?.expiresAt, read1?.expiresAt);
    expect("lesing: ny melding er ulest til den leses", row(fresh.id)?.readAt, "");

    // Unread messages: 30 days at most.
    const u1 = await send(ana.client, conv, `CHECK DIS aldri lest ${RUN}`);
    age(u1.id, "29 days");
    expect("ulest: synlig etter 29 dager", `${await sees(ana.client, u1.id)}/${await sees(ben.client, u1.id)}`, "true/true");
    age(u1.id, "2 days");
    expect("ulest: borte for begge etter 30 dager", `${await sees(ana.client, u1.id)}/${await sees(ben.client, u1.id)}`, "false/false");
    expect("ulest: utløpt melding kan ikke leses (startes) lenger", (await markRead(ben.client, conv), row(u1.id)?.readAt), "");

    // Read just before the limit: the duration runs from the read.
    await setTimer(ben.client, conv, FOUR_WEEKS);
    const late = await send(ana.client, conv, `CHECK DIS lest sent ${RUN}`);
    age(late.id, "29 days");
    await markRead(ben.client, conv);
    expect("sen lesing: 4 uker fra lesing", row(late.id)?.sinceRead, FOUR_WEEKS);
    age(late.id, "3 days");
    expect("sen lesing: fortsatt synlig etter 32 dager totalt", await sees(ana.client, late.id), true);
    await setTimer(ben.client, conv, HOUR);

    // ── 6. Edits do not reset the timer ──
    const e1 = await send(ana.client, conv, `CHECK DIS redigeres ${RUN}`);
    const unreadExpiry = row(e1.id)?.expiresAt;
    const { error: editUnread } = await ana.client.rpc("edit_direct_message", { p_message_id: e1.id, p_body: `CHECK DIS redigert ulest ${RUN}` });
    expect("redigering: tillatt", editUnread?.message ?? "ok", "ok");
    expect("redigering: ulest utløp er uendret", row(e1.id)?.expiresAt, unreadExpiry);
    await markRead(ben.client, conv);
    const readExpiry = row(e1.id)?.expiresAt;
    await sleep(1100);
    await ana.client.rpc("edit_direct_message", { p_message_id: e1.id, p_body: `CHECK DIS redigert lest ${RUN}` });
    expect("redigering: lest utløp er uendret", row(e1.id)?.expiresAt, readExpiry);
    expect("redigering: varsel siterer ikke redigert tekst", (await directNotices(ben.client, UTR, conv)).some((n) => n.body.includes("redigert")), false);

    // ── 7. Expired: gone for both, on every path, before any cleanup ──
    const file = await sendFile(ben.client, conv, `CHECK DIS med fil ${RUN}`, "forsvinner.txt");
    expect("fil: Ana ser vedlegget", await seesAttachment(ana.client, file.attachmentId), true);
    expect("fil: Ana kan laste ned", await downloads(ana.client, file.path), true);
    const served = await http(ana.client, `/community/${UTR}/attachments/${file.attachmentId}`);
    expect("fil: ruten svarer Ana", served.status, 200);
    // A file in a direct conversation is never kept by the browser: a copy on
    // disk would outlive the message.
    expect("fil: aldri lagret i nettleseren", served.cacheControl, "private, no-store");
    await markRead(ana.client, conv);
    const fileNoticeBefore = await directNotices(ana.client, UTR, conv);

    // r1 (read, 1 hour) and the file message (read, 1 hour) pass their time.
    age(r1.id, "2 hours");
    age(file.messageId, "2 hours");
    expect("utløpt: Ana ser ikke meldingen", await sees(ana.client, r1.id), false);
    expect("utløpt: Ben (avsender) ser den heller ikke", await sees(ben.client, r1.id), false);
    expect("utløpt: teksten finnes ikke i noen liste", `${await seesBody(ana.client, conv, "hemmelig")}/${await seesBody(ben.client, conv, "hemmelig")}`, "false/false");
    expect("utløpt: raden finnes fortsatt fysisk før opprydding", row(r1.id) ? "ja" : "nei", "ja");
    expect("utløpt: vedlegg er borte for Ana", await seesAttachment(ana.client, file.attachmentId), false);
    expect("utløpt: vedlegg er borte for Ben", await seesAttachment(ben.client, file.attachmentId), false);
    expect("utløpt: nedlasting avvises", `${await downloads(ana.client, file.path)}/${await downloads(ben.client, file.path)}`, "false/false");
    expect("utløpt: signert URL avvises", await signedUrl(ben.client, file.path), false);
    expect("utløpt: gammel vedleggsadresse gir 404", (await http(ana.client, `/community/${UTR}/attachments/${file.attachmentId}`)).status, 404);
    expect("utløpt: miniatyr gir 404", (await http(ben.client, `/community/${UTR}/attachments/${file.attachmentId}?variant=thumb`)).status, 404);
    const { error: editExpired } = await ben.client.rpc("edit_direct_message", { p_message_id: file.messageId, p_body: "x" });
    expect("utløpt: kan ikke redigeres", /not_found/.test(editExpired?.message ?? ""), true);
    const { error: deleteExpired } = await ben.client.rpc("delete_direct_message", { p_message_id: file.messageId });
    expect("utløpt: kan ikke slettes som plassholder", /not_found/.test(deleteExpired?.message ?? ""), true);
    expect(
      "utløpt: serveren kan heller ikke endre den",
      /expired/.test((await admin.from("direct_messages").update({ body: "gjenopplivet" }).eq("id", r1.id)).error?.message ?? ""),
      true,
    );
    const timedNoticeIds = fileNoticeBefore.filter((n) => n.direct_message_id === r1.id || n.direct_message_id === file.messageId).map((n) => n.id);
    const noticesAfter = await directNotices(ana.client, UTR, conv);
    expect("utløpt: varsel for utløpt melding er usynlig", noticesAfter.filter((n) => timedNoticeIds.includes(n.id)).length, 0);
    const page = await http(ana.client, `/community/${UTR}/messages/${conv}`);
    expect("utløpt: samtalesiden svarer", page.status, 200);
    expect("utløpt: siden inneholder ikke teksten", page.body.includes("hemmelig") || page.body.includes("med fil"), false);
    expect("utløpt: siden inneholder ikke vedleggsadressen", page.body.includes(file.attachmentId), false);
    expect("utløpt: uleste teller ikke utløpte meldinger", await unread(ana.client, UTR), 0);
    // Opening the page also starts the app's own cleanup for this
    // conversation, after the response; let it finish before counting.
    await sleep(1500);

    // ── 8. Physical cleanup ──
    // The app may already have done this when the page was opened above;
    // either way the same rows are gone, through the same queue.
    const expiredRows = Number(sql(`select count(*) from direct_messages where conversation_id = '${conv}' and expires_at <= now()`));
    const purged = await purge([conv]);
    expect("opprydding: hver utløpte rad slettes av kjøringen", purged, expiredRows);
    expect("opprydding: ingen utløpte rader igjen", sql(`select count(*) from direct_messages where conversation_id = '${conv}' and expires_at <= now()`), 0);
    expect("opprydding: raden er borte", row(r1.id) ? "ja" : "nei", "nei");
    expect("opprydding: den uleste etter 30 dager er borte", row(u1.id) ? "ja" : "nei", "nei");
    expect("opprydding: vedleggsraden er borte", sql(`select count(*) from message_attachments where id = '${file.attachmentId}'`), 0);
    expect(
      "opprydding: filen gikk gjennom den felles slettekøen",
      sql(`select count(*) from message_attachment_purges where storage_path = '${file.path}'`) === "1" || !objectExists(file.path),
      true,
    );
    expect("opprydding: varslene er slettet", sql(`select count(*) from notifications where direct_message_id in ('${r1.id}', '${file.messageId}')`), 0);
    await purgeOwnAttachmentObjects();
    expect("opprydding: objektet er fjernet fra Storage", objectExists(file.path), false);
    expect("opprydding: gjentatt kjøring sletter ingenting mer", await purge([conv]), 0);
    expect("opprydding: ikke-utløpte meldinger er urørt", `${await sees(ana.client, fresh.id)}/${await sees(ana.client, late.id)}/${await sees(ana.client, plain.id)}/${await sees(ana.client, e1.id)}`, "true/true/true/true");

    // Many at once, from several runs at once.
    const batch = await Promise.all(Array.from({ length: 12 }, (_, i) => send(ana.client, conv, `CHECK DIS mange ${i} ${RUN}`)));
    for (const message of batch) age(message.id, "31 days");
    const keep = await send(ana.client, conv, `CHECK DIS blir ${RUN}`);
    const counts = await Promise.all([purge([conv]), purge([conv]), purge([conv])]);
    expect("samtidig opprydding: hver melding slettet nøyaktig én gang", counts.reduce((a, b) => a + b, 0), 12);
    expect("samtidig opprydding: den nye er urørt", await sees(ben.client, keep.id), true);
    expect("samtidig opprydding: via appens hjelper er det tomt", (await purgeExpiredDirectMessages({ conversationIds: [conv], purge: { keep: new Set(sql("select storage_path from message_attachment_purges").split("\n")) } })).expired, 0);

    // A backlog larger than one database call, through the same helper the
    // scheduled sweep uses. A run that cannot take all of it says how many
    // expired messages are still stored (the sweep then fails and alerts);
    // the next run leaves none.
    const BACKLOG = 600;
    sql(
      `insert into direct_messages (conversation_id, author_id, body)
       select '${conv}', '${ana.id}', 'CHECK DIS kø ' || g || ' ${RUN}' from generate_series(1, ${BACKLOG}) g`,
    );
    sql(
      `begin; set local session_replication_role = replica;
       update direct_messages set created_at = created_at - interval '31 days', expires_at = expires_at - interval '31 days'
        where conversation_id = '${conv}' and body like 'CHECK DIS kø %'; commit;`,
    );
    const otherQueued = () => ({ keep: new Set(sql("select storage_path from message_attachment_purges").split("\n")) });
    const partial = await purgeExpiredDirectMessages({ conversationIds: [conv], maxBatches: 1, verify: true, purge: otherQueued() });
    expect("sweep: én omgang tar én porsjon", partial.expired, 500);
    expect("sweep: det som ble liggende, meldes", partial.expiredLeft, BACKLOG - 500);
    const swept = await purgeExpiredDirectMessages({ conversationIds: [conv], verify: true, purge: otherQueued() });
    expect("sweep: neste kjøring tar resten", swept.expired, BACKLOG - 500);
    expect("sweep: ingen utløpt rad igjen etter kjøringen", swept.expiredLeft, 0);
    expect("sweep: heller ikke i databasen", sql(`select count(*) from direct_messages where conversation_id = '${conv}' and expires_at <= now()`), 0);
    expect("sweep: varslene for køen er borte", sql(`select count(*) from notifications n join direct_messages dm on dm.id = n.direct_message_id where dm.conversation_id = '${conv}' and dm.body like 'CHECK DIS kø %'`), 0);
    expect("sweep: den nye er fortsatt urørt", await sees(ben.client, keep.id), true);

    // A late run never deletes a message whose timer started meanwhile.
    const race = await send(ben.client, conv, `CHECK DIS kappløp ${RUN}`);
    sql(
      `begin; set local session_replication_role = replica;
       update direct_messages set created_at = now() - interval '720 hours' + interval '3 seconds',
                                  expires_at = now() + interval '3 seconds' where id = '${race.id}'; commit;`,
    );
    const reader = spawn("docker", [
      "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-c",
      `begin; update direct_messages set read_at = now() where id = '${race.id}'; select pg_sleep(6); commit;`,
    ]);
    const readerDone = new Promise((resolve) => reader.on("close", resolve));
    await sleep(4500);
    expect("kappløp: rett etter gammel utløpstid, mens lesing holder raden: ingenting slettes", await purge([conv]), 0);
    await readerDone;
    expect("kappløp: meldingen finnes og er synlig etter lesingen", await sees(ben.client, race.id), true);
    expect("kappløp: ny utløpstid er lesing + 1 time", row(race.id)?.sinceRead, HOUR);
    expect("kappløp: senere opprydding lar den være", await purge([conv]), 0);

    // ── 9. Archive, restore and personal deletion ──
    const ar = await send(ben.client, conv, `CHECK DIS arkiv ${RUN}`);
    await ana.client.rpc("archive_direct_conversation", { p_conversation_id: conv });
    await markRead(ana.client, conv);
    age(ar.id, "2 hours");
    await ana.client.rpc("restore_direct_conversation", { p_conversation_id: conv });
    expect("arkiv: gjenoppretting vekker ikke utløpt melding", await sees(ana.client, ar.id), false);
    expect("arkiv: heller ikke for Ben", await sees(ben.client, ar.id), false);
    await send(ben.client, conv, `CHECK DIS etter arkiv ${RUN}`);
    expect("arkiv: ny melding vekker ikke utløpt melding", await sees(ana.client, ar.id), false);
    const otherDevice = await signIn(`qa-dis-ana-${RUN}@example.test`);
    expect("arkiv: annen enhet ser den heller ikke", await sees(otherDevice, ar.id), false);

    // Recipient deletes before reading: the sender's copy keeps its original (unread) timer.
    const del = quiet;
    await setTimer(ana.client, del, HOUR);
    const d1 = await send(ana.client, del, `CHECK DIS før sletting ${RUN}`);
    await cy.client.rpc("delete_direct_conversation", { p_conversation_id: del });
    await markRead(cy.client, del);
    expect("sletting: mottaker som slettet ulest starter ikke tiden", row(d1.id)?.readAt, "");
    expect("sletting: avsender ser den fortsatt", await sees(ana.client, d1.id), true);
    expect("sletting: avsenders kopi har sin opprinnelige frist (30 dager)", row(d1.id)?.sinceCreated, 30 * DAY);
    expect("sletting: merknader før Cys sletting er skjult for Cy", (await notices(cy.client, del)).length, 0);
    expect("sletting: Ana ser fortsatt merknadene", (await notices(ana.client, del)).length, 3);
    age(d1.id, "31 days");
    expect("sletting: avsenders kopi utløper etter sin opprinnelige frist", await sees(ana.client, d1.id), false);

    // Read, then cleared by the reader: still expires for the sender on time.
    const d2 = await send(ana.client, del, `CHECK DIS lest så slettet ${RUN}`);
    await markRead(cy.client, del);
    expect("sletting: lest etter sletting starter tiden", row(d2.id)?.sinceRead, HOUR);
    await cy.client.rpc("delete_direct_conversation", { p_conversation_id: del });
    expect("sletting: Cy ser den ikke etter sin sletting", await sees(cy.client, d2.id), false);
    expect("sletting: Ana ser den fortsatt", await sees(ana.client, d2.id), true);
    age(d2.id, "2 hours");
    expect("sletting: utløper for Ana etter den opprinnelige tiden", await sees(ana.client, d2.id), false);
    const d3 = await send(cy.client, del, `CHECK DIS ny etter sletting ${RUN}`);
    expect("sletting: grensen står — ny melding vises for Cy", await sees(cy.client, d3.id), true);
    expect("sletting: grensen står — gamle vises ikke", await seesBody(cy.client, del, "før sletting"), false);
    await ana.client.rpc("delete_direct_conversation", { p_conversation_id: del });
    expect(
      "sletting: når begge har slettet, er merknader under begge grensene fjernet",
      sql(`select count(*) from direct_conversation_notices where conversation_id = '${del}' and seq <= (select min(cleared_through_seq) from direct_conversation_states where conversation_id = '${del}')`),
      0,
    );
    expect("sletting: fildeling består etter sletting og utløp", sql(`select participant_one_wrote::text || '/' || participant_two_wrote::text from direct_conversations where id = '${del}'`), "true/true");

    // ── 10. Notices when a later ordinary message arrives ──
    const nconv = await start(ben.client, UTR, cy.id);
    await setTimer(ben.client, nconv, DAY);
    await send(ben.client, nconv, `CHECK DIS varsel forsvinnende ${RUN}`);
    await setTimer(ben.client, nconv, null);
    await send(ben.client, nconv, `CHECK DIS varsel vanlig ${RUN}`);
    const cyNotices = (await directNotices(cy.client, UTR, nconv)).filter((n) => !n.read);
    expect("varsel: ett ulest varsel for samtalen", cyNotices.length, 1);
    expect("varsel: det gjelder den nyeste, vanlige meldingen", cyNotices[0]?.direct_message_id ?? "ingen", "ingen");

    // ── 11. Who may, and community isolation ──
    const ftr = await start(ana.client, FTR, staff.id);
    expect("fellesskap: FTR-samtalen er av", await conversationSetting(ana.client, ftr), "av");
    expect("fellesskap: Cy (ikke i FTR) kan ikke endre", /not_found/.test((await setTimer(cy.client, ftr, DAY)).error ?? ""), true);
    expect("fellesskap: Ben kan ikke lese FTR-merknader", (await notices(ben.client, ftr)).length, 0);
    expect("FTR: staff kan slå på", (await setTimer(staff.client, ftr, WEEK)).value, WEEK);
    expect("FTR: UTR-samtalen er uberørt", await conversationSetting(ana.client, conv), HOUR);
    const { error: callPurge } = await ana.client.rpc("purge_expired_direct_messages", {});
    expect("rettigheter: medlem kan ikke kjøre oppryddingen", Boolean(callPurge), true);
    await admin.from("memberships").update({ status: "requested" }).eq("user_id", ben.id).eq("community_id", UTR);
    expect("lukket: Ana kan ikke endre når Ben ikke er medlem", /closed/.test((await setTimer(ana.client, conv, DAY)).error ?? ""), true);
    expect("lukket: Ben (ikke medlem) kan ikke endre", /not_found/.test((await setTimer(ben.client, conv, DAY)).error ?? ""), true);
    await admin.from("memberships").update({ status: "active" }).eq("user_id", ben.id).eq("community_id", UTR);

    // ── 12. Both languages ──
    const english = await http(ana.client, `/community/${UTR}/messages/${conv}`);
    expect("engelsk (UTR): status i toppen", english.body.includes("1 hour"), true);
    expect("engelsk (UTR): merknad", english.body.includes("turned on disappearing messages"), true);
    const norwegian = await http(ana.client, `/community/${FTR}/messages/${ftr}`);
    expect("norsk (FTR): status i toppen", norwegian.body.includes("1 uke"), true);
    expect("norsk (FTR): merknad", norwegian.body.includes("slo på forsvinnende meldinger"), true);

    // ── 13. After a database restore ──
    // A restore to before the recipient's first read brings a message back
    // unread, with created_at + 30 days to run: one that had already
    // disappeared is readable again. The post-restore step deletes every
    // disappearing message from before the restore point, read or not,
    // expired or not, and leaves ordinary messages alone.
    await setTimer(ben.client, nconv, HOUR);
    const restoredUnread = await send(ben.client, nconv, `CHECK DIS gjenopprettet ulest ${RUN}`);
    const restoredRead = await send(ben.client, nconv, `CHECK DIS gjenopprettet lest ${RUN}`);
    // As restored from a backup taken before Cy read it, three hours after it
    // was written: in the real timeline it expired two hours ago.
    sql(
      `begin; set local session_replication_role = replica;
       update direct_messages set created_at = created_at - interval '3 hours', read_at = null,
                                  expires_at = created_at - interval '3 hours' + interval '720 hours'
        where id = '${restoredRead.id}'; commit;`,
    );
    expect("gjenoppretting: uten steget er en utløpt melding lesbar igjen", await sees(cy.client, restoredRead.id), true);
    await setTimer(ben.client, nconv, null);
    const ordinaryBefore = await send(ben.client, nconv, `CHECK DIS gjenopprettet vanlig ${RUN}`);
    const restoredTo = sql("select now()");
    await sleep(1100);
    await setTimer(ben.client, nconv, HOUR);
    const afterReopen = await send(ben.client, nconv, `CHECK DIS etter gjenåpning ${RUN}`);

    const restorePurge = (client: Client, at: string) =>
      client.rpc("purge_restored_disappearing_direct_messages", { p_restored_to: at, p_conversation_ids: [nconv] });
    expect("gjenoppretting: medlem kan ikke kjøre steget", Boolean((await restorePurge(cy.client, restoredTo)).error), true);
    expect(
      "gjenoppretting: tidspunkt i fremtiden avvises",
      /invalid_cutoff/.test((await restorePurge(admin, new Date(Date.now() + HOUR * 1000).toISOString())).error?.message ?? ""),
      true,
    );
    const restoredCount = Number(
      sql(`select count(*) from direct_messages where conversation_id = '${nconv}' and disappear_seconds is not null and created_at < '${restoredTo}'`),
    );
    expect("gjenoppretting: det finnes forsvinnende meldinger å slette", restoredCount >= 2, true);
    const { data: restoreDeleted, error: restoreError } = await restorePurge(admin, restoredTo);
    expect("gjenoppretting: steget kjører", restoreError?.message ?? "ok", "ok");
    expect("gjenoppretting: hver forsvinnende melding fra før punktet slettes", restoreDeleted, restoredCount);
    expect(
      "gjenoppretting: ingen igjen fra før punktet",
      sql(`select count(*) from direct_messages where conversation_id = '${nconv}' and disappear_seconds is not null and created_at < '${restoredTo}'`),
      0,
    );
    expect("gjenoppretting: den gjenopprettede leste er borte", row(restoredRead.id) ? "ja" : "nei", "nei");
    expect("gjenoppretting: den uleste er også borte", row(restoredUnread.id) ? "ja" : "nei", "nei");
    expect("gjenoppretting: Cy ser den ikke", await sees(cy.client, restoredRead.id), false);
    expect("gjenoppretting: varslene er slettet", sql(`select count(*) from notifications where direct_message_id in ('${restoredRead.id}', '${restoredUnread.id}')`), 0);
    expect("gjenoppretting: vanlige meldinger er urørt", await sees(cy.client, ordinaryBefore.id), true);
    expect("gjenoppretting: meldinger etter punktet er urørt", await sees(cy.client, afterReopen.id), true);
    expect("gjenoppretting: innstillingen står", await conversationSetting(cy.client, nconv), HOUR);
    const afterRestoreSweep = await purgeExpiredDirectMessages({ conversationIds: [...conversationIds], verify: true, purge: otherQueued() });
    expect("gjenoppretting: oppryddingen etterpå finner ingen utløpt rad", afterRestoreSweep.expiredLeft, 0);

    expect(
      "utviklingsdata: andres meldinger er urørt",
      sql(`select count(*) || ':' || coalesce(sum(length(body)), 0) || ':' || count(expires_at) from direct_messages where conversation_id not in (${ownConversations()})`),
      devBefore,
    );
  } finally {
    await cleanup();
  }

  expect("opprydding: ingen QA-kontoer igjen", sql(`select count(*) from profiles where handle like 'qa-dis-%-${RUN}%'`), 0);
  expect("opprydding: ingen QA-objekter igjen", sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and name in (${[...createdPaths].map((p) => `'${p}'`).join(",") || "''"})`), 0);
  expect("utviklingsdata: filene i bøtta er de samme", sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}'`), devFilesBefore);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} kontroller for forsvinnende meldinger passerte`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
