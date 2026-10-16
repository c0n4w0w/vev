/**
 * Checks file attachments in private conversations under real authenticated
 * sessions (20261024100000_message_attachments).
 *
 * The rule, in short. Files may be attached in a private group's chat, a
 * private lokallag channel and a direct message — nowhere else. In channels
 * and in direct messages with an organisational representative: 25 MiB a
 * file, five a message, straight away. Between two ordinary members: text
 * only until EACH has sent a text message in that conversation, then 10 MiB
 * and three. A file belongs to one uploader and one conversation from the
 * moment it is uploaded and to one message once it is sent, and none of that
 * can change. It is readable by whoever can read the conversation right now,
 * through an authenticated address and nothing else.
 *
 * Three layers are exercised, each the way an attacker would reach it:
 *
 *   * the database, with ordinary anon-key clients signed in as fixture
 *     accounts — the RPCs the app calls plus direct table and Storage calls a
 *     curious member could make by hand;
 *   * the two route handlers, over HTTP with the same accounts' session
 *     cookies (so the dev server must be running: `npm run dev`);
 *   * the file-type detector, directly.
 *
 * The service role is used only to read state back, to play the server's part
 * in an upload where the database layer is tested without HTTP, to simulate a
 * lapsed membership and a deleted message, and to clean up.
 *
 * Run with `npm run check:attachments` against the local stack after
 * `npm run seed`, with the app on http://localhost:3000 (or CHECK_APP_URL).
 * Creates only disposable groups, channels, conversations and files (all
 * marked "CHECK vedlegg" / "check-vedlegg"), writes nothing to Safe-Space or
 * any seeded conversation, leaves fixture state as it found it, and clears
 * leftovers from an interrupted earlier run first.
 */
import { config } from "dotenv";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectAttachmentFileType, cleanAttachmentName } from "@/lib/attachment-file-type";
import { purgeAttachmentObjects, sweepAbandonedAttachments, thumbnailPath } from "@/lib/attachment-storage";
import { attachmentFileType, bothHaveWritten } from "@/lib/attachment-types";
import { stripImageMetadata } from "@/lib/image-metadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import {
  METADATA_SECRET,
  animatedGifFixture,
  animatedWebpFixture,
  gpsJpegFixture,
  metadataPngFixture,
  metadataWebpFixture,
  binaryAsTextFixture,
  csvFixture,
  docxFixture,
  executableAsPdfFixture,
  gifFixture,
  htmlAsTextFixture,
  jpegFixture,
  latin1CsvFixture,
  m4aFixture,
  macroDocxFixture,
  mp3Fixture,
  pdfFixture,
  pngFixture,
  pptxFixture,
  rotatedJpegFixture,
  sizedTextFixture,
  svgFixture,
  textFixture,
  videoAsM4aFixture,
  wavFixture,
  webpFixture,
  xlsxFixture,
  zipAsDocxFixture,
  type Fixture,
} from "./lib/attachment-fixtures";

config({ path: ".env.local" });
config({ path: ".env" });

type Client = SupabaseClient<Database>;

const admin = createSupabaseAdminClient();
const APP = (process.env.CHECK_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const BUCKET = "message-attachments";
const GROUP = "CHECK vedlegg";
const CHANNEL = "check-vedlegg";
const BODY = "CHECK vedlegg";
const SAFE_SPACE_CHANNEL = `${FTR}--gruppe-safe-space-frivillige`;
const MIB = 1024 * 1024;

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

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
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${handle}: ${verifyError.message}`);
  return client;
}

/**
 * The same session as a browser would carry it: the cookies @supabase/ssr
 * writes for it, which is what the app's own server client reads.
 */
const cookieHeaders = new Map<Client, string>();

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
  await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  const header = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  cookieHeaders.set(client, header);
  return header;
}

// ── The app's routes, over HTTP ─────────────────────────────────────────

type Target = { channelId: string } | { conversationId: string };

function targetQuery(target: Target): string {
  return "channelId" in target
    ? `channel=${encodeURIComponent(target.channelId)}`
    : `conversation=${encodeURIComponent(target.conversationId)}`;
}

type UploadReply = {
  status: number;
  ok: boolean;
  message?: string;
  attachment?: { id: string; name: string; mimeType: string; hasThumbnail: boolean; width?: number; height?: number; url: string };
};

async function httpUpload(
  client: Client | null,
  communityId: string,
  target: Target,
  file: Fixture,
  options: { origin?: string | null } = {},
): Promise<UploadReply> {
  const form = new FormData();
  form.set("file", new File([file.bytes as BlobPart], file.name));
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  if (options.origin !== null) headers.Origin = options.origin ?? APP;

  const response = await fetch(`${APP}/community/${communityId}/attachments/upload?${targetQuery(target)}`, {
    method: "POST",
    headers,
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as Partial<UploadReply>;
  return { status: response.status, ok: body.ok === true, message: body.message, attachment: body.attachment };
}

async function httpGet(
  client: Client | null,
  communityId: string,
  attachmentId: string,
  query = "",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (client) headers.Cookie = await cookiesFor(client);
  return fetch(`${APP}/community/${communityId}/attachments/${attachmentId}${query}`, { headers, redirect: "manual" });
}

async function httpStatus(client: Client | null, communityId: string, attachmentId: string, query = "") {
  const response = await httpGet(client, communityId, attachmentId, query);
  await response.arrayBuffer();
  return response.status;
}

async function httpDelete(client: Client | null, communityId: string, attachmentId: string, origin: string | null = APP) {
  const headers: Record<string, string> = {};
  if (client) headers.Cookie = await cookiesFor(client);
  if (origin !== null) headers.Origin = origin;
  const response = await fetch(`${APP}/community/${communityId}/attachments/${attachmentId}`, {
    method: "DELETE",
    headers,
  });
  return response.status;
}

// ── The same calls the app makes, at the database ───────────────────────

function args(target: Target) {
  return {
    p_channel_id: ("channelId" in target ? target.channelId : null) as string,
    p_conversation_id: ("conversationId" in target ? target.conversationId : null) as string,
  };
}

async function policy(client: Client, target: Target): Promise<string> {
  const { data, error } = await client.rpc("message_attachment_policy", args(target)).maybeSingle();
  if (error || !data) return `error:${error?.message ?? "ingen rad"}`;
  return `${data.reason}/${Math.round(Number(data.max_bytes) / MIB)}/${data.max_files}`;
}

async function begin(client: Client, target: Target, file: { name: string; mime: string; size: number }) {
  const { data, error } = await client
    .rpc("begin_message_attachment", {
      ...args(target),
      p_display_name: file.name,
      p_mime_type: file.mime,
      p_size_bytes: file.size,
    })
    .maybeSingle();
  return { id: data?.attachment_id ?? null, path: data?.storage_path ?? null, error: error?.message ?? null };
}

/**
 * An upload without HTTP: the caller's own `begin`, then the server's two
 * steps played by the service role. Returns the attachment id, or the refusal.
 */
async function upload(client: Client, target: Target, file: Fixture): Promise<{ id: string | null; error: string | null }> {
  const type = detectAttachmentFileType(file.bytes, file.name);
  if (!type) return { id: null, error: "type" };
  const begun = await begin(client, target, { name: cleanAttachmentName(file.name, type), mime: type.mimeType, size: file.bytes.byteLength });
  if (!begun.id || !begun.path) return { id: null, error: begun.error };
  const { error: storeError } = await admin.storage.from(BUCKET).upload(begun.path, file.bytes, { contentType: type.mimeType });
  if (storeError) return { id: null, error: storeError.message };
  const { data: completed } = await admin.rpc("complete_message_attachment", { p_attachment_id: begun.id });
  return completed === true ? { id: begun.id, error: null } : { id: null, error: "ikke fullført" };
}

async function send(client: Client, target: Target, body: string, attachmentIds: string[]) {
  const { data, error } =
    "channelId" in target
      ? await client.rpc("send_channel_message_with_attachments", {
          p_channel_id: target.channelId,
          p_body: body,
          p_attachment_ids: attachmentIds,
        })
      : await client.rpc("send_direct_message_with_attachments", {
          p_conversation_id: target.conversationId,
          p_body: body,
          p_attachment_ids: attachmentIds,
        });
  return { id: (data as string | null) ?? null, error: error?.message ?? null };
}

function refusal(result: { error: string | null }): string {
  const match = /(attachment_[a-z_]+(?::[a-z_]+)?|message_too_long)/.exec(result.error ?? "");
  return match ? match[1] : (result.error ?? "ok");
}

async function row(attachmentId: string) {
  const { data } = await admin.from("message_attachments").select("*").eq("id", attachmentId).maybeSingle();
  return data;
}

async function sees(client: Client, attachmentId: string): Promise<boolean> {
  const { data } = await client.from("message_attachments").select("id").eq("id", attachmentId).maybeSingle();
  return Boolean(data);
}

async function objectExists(path: string): Promise<boolean> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 5 });
  return (data ?? []).some((entry) => entry.name === name);
}

async function storageDownload(client: Client, path: string): Promise<boolean> {
  const { data } = await client.storage.from(BUCKET).download(path);
  return Boolean(data);
}

/** Waits for something the server does after it has answered (the purge). */
async function eventually(test: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return test();
}

async function channelMessageCount(channelId: string): Promise<number> {
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channelId);
  return count ?? 0;
}

// ── Disposable conversations ────────────────────────────────────────────

const createdConversations = new Set<string>();
const touchedMemberships: { userId: string; communityId: string; status: Database["public"]["Enums"]["membership_status"] }[] = [];

async function localGroupId(communityId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", communityId)
    .eq("name", name)
    .single();
  if (error) throw new Error(`fant ikke lokallaget ${name}`);
  return data.id;
}

async function createGroup(client: Client, communityId: string, name: string, memberIds: string[]) {
  const { data, error } = await client.rpc("create_subgroup", {
    p_community_id: communityId,
    p_name: name,
    p_description: "",
    p_member_ids: memberIds,
  });
  if (error || !data) throw new Error(`kunne ikke opprette gruppen ${name}: ${error?.message}`);
  const { data: channel } = await admin.from("channels").select("id").eq("subgroup_id", data).single();
  return { subgroupId: data as string, channelId: channel!.id };
}

async function createPrivateChannel(client: Client, localGroup: string, name: string, participantIds: string[]) {
  const { data, error } = await client.rpc("create_private_channel", {
    p_local_group_id: localGroup,
    p_name: name,
    p_purpose: "",
    p_participant_ids: participantIds,
  });
  if (error || !data) throw new Error(`kunne ikke opprette kanalen ${name}: ${error?.message}`);
  return data as string;
}

async function startConversation(client: Client, communityId: string, recipientId: string): Promise<string> {
  const { data, error } = await client.rpc("start_direct_conversation", {
    p_community_id: communityId,
    p_recipient_id: recipientId,
  });
  if (error || !data) throw new Error(`kunne ikke starte samtale: ${error?.message}`);
  createdConversations.add(data);
  return data;
}

async function say(client: Client, conversationId: string, body: string) {
  const { error } = await client.from("direct_messages").insert({ conversation_id: conversationId, body });
  return error?.message ?? null;
}

async function setMembershipStatus(userId: string, communityId: string, status: Database["public"]["Enums"]["membership_status"]) {
  if (!touchedMemberships.some((entry) => entry.userId === userId && entry.communityId === communityId)) {
    const { data } = await admin
      .from("memberships")
      .select("status")
      .eq("user_id", userId)
      .eq("community_id", communityId)
      .single();
    touchedMemberships.push({ userId, communityId, status: data!.status });
  }
  const { error } = await admin.from("memberships").update({ status }).eq("user_id", userId).eq("community_id", communityId);
  if (error) throw error;
}

/** Everything this suite ever creates, found by its markers. */
async function cleanup() {
  for (const entry of touchedMemberships.splice(0)) {
    await admin.from("memberships").update({ status: entry.status }).eq("user_id", entry.userId).eq("community_id", entry.communityId);
  }

  const { data: marked } = await admin.from("direct_messages").select("conversation_id").like("body", `${BODY}%`);
  for (const message of marked ?? []) createdConversations.add(message.conversation_id);
  for (const conversationId of createdConversations) {
    await admin.from("notifications").delete().like("href", `%/messages/${conversationId}`);
    await admin.from("direct_conversations").delete().eq("id", conversationId);
  }
  createdConversations.clear();

  const { data: privateChannels } = await admin.from("channels").select("id").eq("is_private", true).like("name", `${CHANNEL}%`);
  for (const channel of privateChannels ?? []) await admin.from("channels").delete().eq("id", channel.id);

  const { data: groups } = await admin.from("community_subgroups").select("id").like("name", `${GROUP}%`);
  for (const group of groups ?? []) {
    await admin.from("channels").delete().eq("subgroup_id", group.id);
    await admin.from("community_subgroups").delete().eq("id", group.id);
  }

  // Rows this suite inserted by hand, and whatever the above left queued.
  await admin.from("message_attachments").delete().like("display_name", `${BODY}%`);
  await purgeAttachmentObjects(1000);
}

// ── The checks ──────────────────────────────────────────────────────────

async function main() {
  await cleanup();

  const reachable = await fetch(`${APP}/login`, { redirect: "manual" }).then((response) => response.status < 500, () => false);
  if (!reachable) {
    console.error(`\n✗ Appen svarer ikke på ${APP}. Start den med \`npm run dev\` (eller sett CHECK_APP_URL).`);
    process.exit(1);
  }

  const [mia, kristoffer, linn, test551, amina, eli, emma, adrian, nymedlem, jonas, oskar, tobias] = await Promise.all(
    ["miaminge", "kristoffer", "linn", "test-551d", "amina", "elironning", "emmamortensen", "adrian", "tu.nymedlem1-dcb8", "jonas", "oskar", "tobias"].map(signIn),
  );
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const id = (handle: string) => ids[handle];

  const png = await pngFixture("CHECK vedlegg bilde.png");
  const jpeg = await jpegFixture("CHECK vedlegg foto.jpg");
  const pdf = pdfFixture("CHECK vedlegg referat.pdf");
  const txt = textFixture("CHECK vedlegg notat.txt");

  try {
    // ════ 0. The file-type detector ════════════════════════════════════
    const detect = (file: Fixture) => detectAttachmentFileType(file.bytes, file.name)?.mimeType ?? "refused";
    expect("type: PNG", detect(png), "image/png");
    expect("type: JPEG", detect(jpeg), "image/jpeg");
    expect("type: WebP", detect(await webpFixture()), "image/webp");
    expect("type: GIF", detect(await gifFixture()), "image/gif");
    expect("type: PDF", detect(pdf), "application/pdf");
    expect("type: DOCX", detect(docxFixture()), attachmentFileType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")!.mimeType);
    expect("type: XLSX", detect(xlsxFixture()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect("type: PPTX", detect(pptxFixture()), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect("type: TXT", detect(txt), "text/plain");
    expect("type: CSV", detect(csvFixture()), "text/csv");
    expect("type: CSV i Windows-1252", detect(latin1CsvFixture()), "text/csv");
    expect("type: WAV", detect(wavFixture()), "audio/wav");
    expect("type: MP3", detect(mp3Fixture()), "audio/mpeg");
    expect("type: M4A", detect(m4aFixture()), "audio/mp4");
    expect("type: innholdet avgjør, ikke navnet (PNG kalt .pdf)", detect({ name: "bilde.pdf", bytes: png.bytes }), "image/png");
    expect("type: HTML kalt .txt avvises", detect(htmlAsTextFixture()), "refused");
    expect("type: SVG avvises", detect(svgFixture()), "refused");
    expect("type: programfil kalt .pdf avvises", detect(executableAsPdfFixture()), "refused");
    expect("type: vanlig zip kalt .docx avvises", detect(zipAsDocxFixture()), "refused");
    expect("type: Word-fil med makroer avvises", detect(macroDocxFixture()), "refused");
    expect("type: DOCX kalt .xlsx avvises", detect({ name: "notat.xlsx", bytes: docxFixture().bytes }), "refused");
    expect("type: video kalt .m4a avvises", detect(videoAsM4aFixture()), "refused");
    expect("type: binærdata kalt .txt avvises", detect(binaryAsTextFixture()), "refused");
    expect("type: tekst kalt .mp3 avvises", detect({ name: "sang.mp3", bytes: txt.bytes }), "refused");
    expect("type: tekst uten kjent endelse avvises", detect({ name: "skript.sh", bytes: txt.bytes }), "refused");
    expect(
      "navn: sti og kontrolltegn fjernes, riktig endelse settes",
      cleanAttachmentName("..\\..\\etc/pass\u0000wd‮.exe", attachmentFileType("application/pdf")!),
      "passwd.pdf",
    );
    expect("navn: tomt navn får et", cleanAttachmentName(".png", attachmentFileType("image/png")!), "fil.png");
    expect("bothHaveWritten: én side er ikke nok", bothHaveWritten([{ authorId: "a", body: "hei" }, { authorId: "a", body: "igjen" }], ["a", "b"]), false);
    expect("bothHaveWritten: tom tekst teller ikke", bothHaveWritten([{ authorId: "a", body: "hei" }, { authorId: "b", body: " \n" }], ["a", "b"]), false);
    expect("bothHaveWritten: begge har skrevet", bothHaveWritten([{ authorId: "a", body: "hei" }, { authorId: "b", body: "hei" }], ["a", "b"]), true);

    // ════ 0b. Image metadata is removed, the picture is not touched ═════
    const holds = (bytes: Uint8Array, value: string) => Buffer.from(bytes).includes(value);
    const pixels = async (bytes: Uint8Array) => sharp(bytes, { animated: true }).raw().toBuffer();
    const phone = await gpsJpegFixture("CHECK vedlegg mobilbilde.jpg");
    const metadataCases: [string, string, Fixture][] = [
      ["JPEG", "image/jpeg", phone],
      ["progressiv JPEG", "image/jpeg", await gpsJpegFixture("p.jpg", true)],
      ["PNG", "image/png", await metadataPngFixture()],
      ["WebP", "image/webp", await metadataWebpFixture()],
    ];
    for (const [label, mime, file] of metadataCases) {
      const before = await sharp(file.bytes).metadata();
      const cleaned = stripImageMetadata(file.bytes, mime)!;
      const after = await sharp(cleaned).metadata();
      expect(`metadata ${label}: testbildet har kamera og GPS`, `${holds(file.bytes, METADATA_SECRET)}/${(before.exif?.length ?? 0) > 200}`, "true/true");
      expect(`metadata ${label}: kamera, GPS og XMP er borte`, `${holds(cleaned, METADATA_SECRET)}/${(after.exif?.length ?? 0) <= 32}/${after.xmp === undefined}`, "false/true/true");
      expect(`metadata ${label}: retningen er beholdt`, `${before.orientation}→${after.orientation}`, "6→6");
      expect(`metadata ${label}: bildet er uendret, piksel for piksel`, (await pixels(file.bytes)).equals(await pixels(cleaned)), true);
      expect(`metadata ${label}: å fjerne to ganger endrer ingenting`, Buffer.from(stripImageMetadata(cleaned, mime)!).equals(Buffer.from(cleaned)), true);
    }
    for (const [label, mime, file] of [
      ["animert GIF", "image/gif", await animatedGifFixture()],
      ["animert WebP", "image/webp", await animatedWebpFixture()],
    ] as [string, string, Fixture][]) {
      const before = await sharp(file.bytes, { animated: true }).metadata();
      const cleaned = stripImageMetadata(file.bytes, mime)!;
      const after = await sharp(cleaned, { animated: true }).metadata();
      expect(`metadata ${label}: kommentar/XMP/EXIF er borte`, `${holds(file.bytes, METADATA_SECRET)}→${holds(cleaned, METADATA_SECRET)}`, "true→false");
      expect(`metadata ${label}: alle bilder, tempo og løkke er beholdt`, `${after.pages}/${after.delay}/${after.loop}`, `${before.pages}/${before.delay}/${before.loop}`);
      expect(`metadata ${label}: bildene er uendret`, (await pixels(file.bytes)).equals(await pixels(cleaned)), true);
    }
    const trailing = new Uint8Array(phone.bytes.length + 40);
    trailing.set(phone.bytes);
    trailing.set(new TextEncoder().encode(`${METADATA_SECRET} etter slutten`), phone.bytes.length);
    expect("metadata: data lagt etter bildets slutt fjernes", holds(stripImageMetadata(trailing, "image/jpeg")!, METADATA_SECRET), false);
    expect("metadata: avkortet JPEG kan ikke skrives om (og avvises da)", stripImageMetadata(phone.bytes.subarray(0, phone.bytes.length - 200), "image/jpeg"), undefined);
    expect("metadata: avkortet PNG kan ikke skrives om", stripImageMetadata(png.bytes.subarray(0, png.bytes.length - 20), "image/png"), undefined);

    // ════ 1. Disposable conversations ══════════════════════════════════
    const ftrOslo = await localGroupId(FTR, "FTR Oslo");
    const tuOslo = await localGroupId(TU, "TU Oslo");
    const ftrGroup = await createGroup(mia, FTR, `${GROUP} FTR`, [id("kristoffer")]);
    const tuGroup = await createGroup(emma, TU, `${GROUP} TU`, [id("adrian")]);
    const ftrPrivate = await createPrivateChannel(mia, ftrOslo, `${CHANNEL} ftr`, [id("kristoffer")]);
    const tuPrivate = await createPrivateChannel(emma, tuOslo, `${CHANNEL} tu`, [id("tu.nymedlem1-dcb8")]);
    const G: Target = { channelId: ftrGroup.channelId };
    const GT: Target = { channelId: tuGroup.channelId };
    const P: Target = { channelId: ftrPrivate };
    const PT: Target = { channelId: tuPrivate };

    // ════ 2. Who may attach, and how much ══════════════════════════════
    // Private groups.
    expect("gruppe: medlem av gruppen", await policy(kristoffer, G), "ok/25/5");
    expect("gruppe: administrator", await policy(mia, G), "ok/25/5");
    expect("gruppe: medlem som ikke er invitert", await policy(linn, G), "not_found/0/0");
    expect("gruppe: moderator som ikke er invitert (ny gruppe)", await policy(amina, G), "not_found/0/0");
    expect("gruppe: administrator i annet fellesskap", await policy(emma, G), "not_found/0/0");
    expect("gruppe TU: medlem av gruppen", await policy(adrian, GT), "ok/25/5");
    expect("gruppe TU: administrator", await policy(emma, GT), "ok/25/5");
    expect("gruppe TU: FTR-administrator", await policy(mia, GT), "not_found/0/0");
    expect("Safe-Space: medlem av gruppen", await policy(kristoffer, { channelId: SAFE_SPACE_CHANNEL }), "ok/25/5");
    expect("Safe-Space: medlem utenfor gruppen", await policy(linn, { channelId: SAFE_SPACE_CHANNEL }), "not_found/0/0");
    expect("Safe-Space: TU-administrator", await policy(emma, { channelId: SAFE_SPACE_CHANNEL }), "not_found/0/0");

    // Private lokallag channels.
    expect("privat kanal: deltaker", await policy(kristoffer, P), "ok/25/5");
    expect("privat kanal: administrator", await policy(mia, P), "ok/25/5");
    expect("privat kanal: medlem av SAMME lokallag uten invitasjon", await policy(test551, P), "not_found/0/0");
    expect("privat kanal: moderator i samme lokallag uten invitasjon", await policy(amina, P), "not_found/0/0");
    expect("privat kanal: annet fellesskap", await policy(emma, P), "not_found/0/0");
    expect("privat kanal TU: deltaker", await policy(nymedlem, PT), "ok/25/5");
    expect("privat kanal TU: FTR-medlem som også er i TU, uten invitasjon", await policy(eli, PT), "not_found/0/0");

    // Everything else takes no files at all.
    expect("åpen kanal: ingen vedlegg", await policy(kristoffer, { channelId: `${FTR}--generelt` }), "unsupported/0/0");
    expect("åpen kanal: heller ikke for administrator", await policy(mia, { channelId: `${FTR}--generelt` }), "unsupported/0/0");
    expect("lokallagets hovedkanal: ingen vedlegg", await policy(kristoffer, { channelId: `${FTR}--lokallag-ftr-oslo` }), "unsupported/0/0");
    expect("UTR åpen kanal: ingen vedlegg", await policy(jonas, { channelId: `${UTR}--generelt` }), "unsupported/0/0");
    expect("kanal som ikke finnes", await policy(kristoffer, { channelId: "finnes-ikke" }), "not_found/0/0");
    expect("uautentisert får ingen policy", (await policy(anon, G)).startsWith("error:"), true);
    expect(
      "message_attachment_policy_for kan ikke kalles av klienter",
      Boolean((await kristoffer.rpc("message_attachment_policy_for", { p_user_id: id("miaminge"), p_channel_id: G.channelId, p_conversation_id: null as unknown as string })).error),
      true,
    );
    expect(
      "åpen kanal: opplasting avvises av databasen",
      refusal(await begin(kristoffer, { channelId: `${FTR}--generelt` }, { name: "a.png", mime: "image/png", size: 100 })),
      "attachment_not_allowed:unsupported",
    );
    expect("åpen kanal: opplasting avvises av ruten", (await httpUpload(kristoffer, FTR, { channelId: `${FTR}--generelt` }, png)).status, 403);

    // ════ 3. Organisational direct messages (FTR, TU) ══════════════════
    // Eli is an ordinary member; Mia is admin and reachable. This is the
    // existing initiation rule, untouched: the same call the app makes.
    const orgDm = await startConversation(eli, FTR, id("miaminge"));
    const O: Target = { conversationId: orgDm };
    expect("org-DM: medlem kan legge ved straks, uten å ha skrevet", await policy(eli, O), "ok/25/5");
    expect("org-DM: representanten kan legge ved straks", await policy(mia, O), "ok/25/5");
    expect("org-DM: tredjepart", await policy(kristoffer, O), "not_found/0/0");
    expect("org-DM: annet fellesskap", await policy(emma, O), "not_found/0/0");
    expect(
      "DM-initiering uendret: medlem kan ikke starte med annet medlem i FTR",
      Boolean((await eli.rpc("start_direct_conversation", { p_community_id: FTR, p_recipient_id: id("kristoffer") })).error),
      true,
    );
    expect(
      "DM-initiering uendret: medlem kan ikke starte med ansatt som ikke tar imot",
      Boolean((await eli.rpc("start_direct_conversation", { p_community_id: FTR, p_recipient_id: id("amina") })).error),
      true,
    );

    const orgPdf = await httpUpload(eli, FTR, O, pdf);
    expect("org-DM: medlem laster opp PDF", `${orgPdf.status}/${orgPdf.attachment?.mimeType}`, "201/application/pdf");
    const orgImage = await httpUpload(eli, FTR, O, jpeg);
    expect("org-DM: medlem laster opp bilde", `${orgImage.status}/${orgImage.attachment?.hasThumbnail}`, "201/true");
    const orgSent = await send(eli, O, `${BODY} til representanten`, [orgPdf.attachment!.id, orgImage.attachment!.id]);
    expect("org-DM: medlem sender PDF og bilde", Boolean(orgSent.id), true);
    expect("org-DM: representanten ser vedleggene", `${await sees(mia, orgPdf.attachment!.id)}/${await sees(mia, orgImage.attachment!.id)}`, "true/true");
    expect("org-DM: representanten forhåndsviser PDF", await httpStatus(mia, FTR, orgPdf.attachment!.id), 200);
    expect("org-DM: representanten laster ned PDF", await httpStatus(mia, FTR, orgPdf.attachment!.id, "?download=1"), 200);
    expect("org-DM: representanten ser miniatyrbildet", await httpStatus(mia, FTR, orgImage.attachment!.id, "?variant=thumb"), 200);
    expect("org-DM: tredjepart ser ingen rad", await sees(kristoffer, orgPdf.attachment!.id), false);
    expect("org-DM: tredjepart får 404", await httpStatus(kristoffer, FTR, orgPdf.attachment!.id), 404);
    expect("org-DM: tredjepart får ikke miniatyrbildet", await httpStatus(kristoffer, FTR, orgImage.attachment!.id, "?variant=thumb"), 404);
    const orgRow = await row(orgPdf.attachment!.id);
    expect("org-DM: tredjepart kan ikke hente objektet fra Storage", await storageDownload(kristoffer, orgRow!.storage_path), false);
    expect("org-DM: deltaker kan (samme policy som ruten)", await storageDownload(mia, orgRow!.storage_path), true);
    const { data: orgMessage } = await admin.from("direct_messages").select("has_attachments, body").eq("id", orgSent.id!).single();
    expect("org-DM: meldingen er merket med vedlegg", orgMessage?.has_attachments, true);
    const orgReply = await upload(mia, O, txt);
    expect("org-DM: representanten svarer med fil", Boolean((await send(mia, O, "", [orgReply.id!])).id), true);
    // The notification names the sender by their profile in this community
    // (never the account), and a message that is only files says so.
    const { data: miaPersona } = await admin.from("community_profiles").select("display_name").eq("community_id", FTR).eq("user_id", id("miaminge")).single();
    const { data: fileNotice } = await admin.from("notifications").select("title, body").eq("user_id", id("elironning")).eq("kind", "direct_message").like("href", `%/messages/${orgDm}`).single();
    expect("org-DM: varselet bruker avsenderens profil i fellesskapet", fileNotice?.title, `Ny melding fra ${miaPersona?.display_name}`);
    expect("org-DM: varsel for melding med bare vedlegg", fileNotice?.body, "Tryggere Ruspolitikk · Vedlegg");
    expect("org-DM: sjette fil i én melding avvises (maks 5)", await (async () => {
      const six: string[] = [];
      for (let i = 0; i < 6; i += 1) six.push((await upload(eli, O, txt)).id!);
      const result = refusal(await send(eli, O, "", six));
      await admin.from("message_attachments").delete().in("id", six);
      return result;
    })(), "attachment_too_many");

    // Spoofing organisational status: a member-to-member conversation in a
    // staff_only community (both demoted, simulated here by a pair that are
    // both ordinary members) gets the member tier, whatever anyone claims.
    const { data: forged } = await admin
      .from("direct_conversations")
      .insert({
        community_id: FTR,
        participant_one_id: [id("elironning"), id("kristoffer")].sort()[0],
        participant_two_id: [id("elironning"), id("kristoffer")].sort()[1],
        created_by: id("elironning"),
      })
      .select("id")
      .single();
    createdConversations.add(forged!.id);
    expect("to vanlige medlemmer i FTR: ikke organisasjonsnivå", await policy(eli, { conversationId: forged!.id }), "needs_mutual/10/3");

    // ════ 4. Member-to-member direct messages (UTR) ════════════════════
    const utrDm = await startConversation(jonas, UTR, id("oskar"));
    const U: Target = { conversationId: utrDm };
    expect("UTR: A har startet samtalen – låst", await policy(jonas, U), "needs_mutual/10/3");
    expect("UTR: låst for B også", await policy(oskar, U), "needs_mutual/10/3");
    expect("UTR: tredjepart", await policy(tobias, U), "not_found/0/0");

    // Direct attempts before the lock opens.
    expect("UTR før: begin avvises", refusal(await begin(jonas, U, { name: "a.png", mime: "image/png", size: 1000 })), "attachment_not_allowed:needs_mutual");
    const lockedUpload = await httpUpload(jonas, UTR, U, png);
    expect("UTR før: opplastingsruten avviser", `${lockedUpload.status}/${lockedUpload.ok}`, "403/false");
    expect("UTR før: avvisningen er på engelsk", /unlocks once you have both sent/.test(lockedUpload.message ?? ""), true);
    expect("UTR før: send med vedlegg avvises", refusal(await send(jonas, U, "hei", ["00000000-0000-4000-8000-000000000000"])), "attachment_not_allowed:needs_mutual");

    expect("UTR: A sender tekst", await say(jonas, utrDm, `${BODY} hei fra A`), null);
    expect("UTR: fortsatt låst etter As melding", await policy(jonas, U), "needs_mutual/10/3");
    expect("UTR: A sender flere meldinger", await say(jonas, utrDm, `${BODY} og én til`), null);
    expect("UTR: flere meldinger fra én person låser ikke opp", `${await policy(jonas, U)}|${await policy(oskar, U)}`, "needs_mutual/10/3|needs_mutual/10/3");
    expect("UTR før: B kan heller ikke laste opp", (await httpUpload(oskar, UTR, U, png)).status, 403);
    expect("UTR før: A kan ikke laste opp selv etter egne meldinger", refusal(await begin(jonas, U, { name: "a.png", mime: "image/png", size: 1000 })), "attachment_not_allowed:needs_mutual");

    // A body the database accepts but that is not text: one line break.
    const blank = await oskar.from("direct_messages").insert({ conversation_id: utrDm, body: "\n" });
    expect("UTR: en melding med bare linjeskift låser ikke opp", `${blank.error ? "avvist" : "lagret"}|${await policy(jonas, U)}`, "lagret|needs_mutual/10/3");
    await admin.from("direct_messages").delete().eq("conversation_id", utrDm).eq("body", "\n");
    // An attachment-only message cannot be forged with a plain insert either.
    expect("UTR: tom melding via vanlig insert avvises", Boolean(await say(oskar, utrDm, "")), true);
    expect(
      "UTR: has_attachments kan ikke settes av klienten",
      Boolean((await oskar.from("direct_messages").insert({ conversation_id: utrDm, body: "", has_attachments: true })).error),
      true,
    );

    expect("UTR: B svarer med tekst", await say(oskar, utrDm, `${BODY} hei fra B`), null);
    expect("UTR: låst opp for A", await policy(jonas, U), "ok/10/3");
    expect("UTR: låst opp for B", await policy(oskar, U), "ok/10/3");
    expect("UTR: tredjepart fortsatt utenfor", await policy(tobias, U), "not_found/0/0");

    const utrImage = await httpUpload(jonas, UTR, U, png);
    expect("UTR etter: A laster opp", `${utrImage.status}/${utrImage.attachment?.mimeType}`, "201/image/png");
    expect("UTR etter: A sender fil uten tekst", Boolean((await send(jonas, U, "", [utrImage.attachment!.id])).id), true);
    const utrReply = await httpUpload(oskar, UTR, U, pdf);
    expect("UTR etter: B laster opp og sender", Boolean((await send(oskar, U, `${BODY} svar`, [utrReply.attachment!.id])).id), true);
    expect("UTR: B forhåndsviser As bilde", await httpStatus(oskar, UTR, utrImage.attachment!.id), 200);
    expect("UTR: A laster ned Bs PDF", await httpStatus(jonas, UTR, utrReply.attachment!.id, "?download=1"), 200);
    expect("UTR: tredjepart får 404", await httpStatus(tobias, UTR, utrImage.attachment!.id), 404);
    expect("UTR: tredjepart ser ingen rad", await sees(tobias, utrImage.attachment!.id), false);

    // The smaller limits, at every door.
    expect("UTR: 10 MiB + 1 byte avvises av databasen", refusal(await begin(jonas, U, { name: "stor.txt", mime: "text/plain", size: 10 * MIB + 1 })), "attachment_too_large");
    expect("UTR: nøyaktig 10 MiB godtas av databasen", Boolean((await begin(jonas, U, { name: `${BODY} grense.txt`, mime: "text/plain", size: 10 * MIB })).id), true);
    expect("UTR: 11 MB avvises av ruten", (await httpUpload(jonas, UTR, U, sizedTextFixture("stor.txt", 11 * MIB))).status, 413);
    const four: string[] = [];
    for (let i = 0; i < 4; i += 1) four.push((await upload(jonas, U, txt)).id!);
    expect("UTR: fire filer i én melding avvises (maks 3)", refusal(await send(jonas, U, "", four)), "attachment_too_many");
    expect("UTR: tre filer går", Boolean((await send(jonas, U, "", four.slice(0, 3))).id), true);
    // A file within the group limit but over this conversation's cannot be
    // smuggled in from an upload made elsewhere.
    const groupOnly = await upload(kristoffer, G, txt);
    expect("vedlegg lastet opp i en gruppe kan ikke sendes i en DM", refusal(await send(kristoffer, O, "", [groupOnly.id!])), "attachment_not_allowed:not_found");

    // ════ 4b. Established eligibility outlives the texts that made it ════
    // Recorded on the conversation when each participant first sends text;
    // editing or deleting those texts later closes nothing again.
    const wrote = async (conversationId: string) => {
      const { data } = await admin.from("direct_conversations").select("participant_one_id, participant_one_wrote, participant_two_wrote").eq("id", conversationId).single();
      return data!;
    };
    const utrFlags = await wrote(utrDm);
    expect("UTR: begge er registrert som skrivende", `${utrFlags.participant_one_wrote}/${utrFlags.participant_two_wrote}`, "true/true");
    const { data: utrTexts } = await admin.from("direct_messages").select("id, author_id").eq("conversation_id", utrDm).like("body", `${BODY}%`);
    const jonasTexts = (utrTexts ?? []).filter((m) => m.author_id === id("jonas")).map((m) => m.id);
    const oskarTexts = (utrTexts ?? []).filter((m) => m.author_id === id("oskar")).map((m) => m.id);
    for (const messageId of jonasTexts) await jonas.rpc("delete_direct_message", { p_message_id: messageId });
    expect("UTR: A sletter alle sine tekster – fortsatt åpent", `${await policy(jonas, U)}|${await policy(oskar, U)}`, "ok/10/3|ok/10/3");
    for (const messageId of oskarTexts) await oskar.rpc("delete_direct_message", { p_message_id: messageId });
    expect("UTR: begge har slettet sine tekster – fortsatt åpent", `${await policy(jonas, U)}|${await policy(oskar, U)}`, "ok/10/3|ok/10/3");
    expect("UTR: ingen tekst står igjen", (await admin.from("direct_messages").select("id").eq("conversation_id", utrDm).like("body", `${BODY} hei%`)).data?.length, 0);
    const afterDelete = await httpUpload(jonas, UTR, U, png);
    expect("UTR: opplasting virker etter slettingen", afterDelete.status, 201);
    await httpDelete(jonas, UTR, afterDelete.attachment!.id);

    // Nobody can write the record themselves.
    const loose = (client: Client) => client as unknown as SupabaseClient;
    const forgedFlag = await loose(tobias).from("direct_conversations").update({ participant_one_wrote: true, participant_two_wrote: true }).eq("id", utrDm);
    expect("forfalsket: medlemmer kan ikke sette registreringen", forgedFlag.error?.code, "42501");
    const lonely = await startConversation(jonas, UTR, id("tobias"));
    const lonelyForge = await loose(jonas).from("direct_conversations").update({ participant_one_wrote: true, participant_two_wrote: true }).eq("id", lonely);
    expect("forfalsket: heller ikke i egen samtale", lonelyForge.error?.code, "42501");
    const insertForge = await loose(jonas).from("direct_conversations").insert({ community_id: UTR, participant_one_id: [id("jonas"), id("oskar")].sort()[0], participant_two_id: [id("jonas"), id("oskar")].sort()[1], participant_one_wrote: true, participant_two_wrote: true });
    expect("forfalsket: kan ikke opprette en samtale som åpen", insertForge.error?.code, "42501");
    const lonelyFlags = await wrote(lonely);
    expect("ny samtale starter lukket", `${lonelyFlags.participant_one_wrote}/${lonelyFlags.participant_two_wrote}`, "false/false");
    const resetFlag = await admin.from("direct_conversations").update({ participant_one_wrote: false }).eq("id", utrDm);
    expect("registreringen kan ikke tilbakestilles, heller ikke av serveren", /direct_conversation_wrote_is_permanent/.test(resetFlag.error?.message ?? ""), true);

    // One side alone, even after deleting what they wrote, opens nothing.
    expect("ensidig: A skriver", await say(jonas, lonely, `${BODY} er du der?`), null);
    const { data: lonelyText } = await admin.from("direct_messages").select("id").eq("conversation_id", lonely).single();
    await jonas.rpc("delete_direct_message", { p_message_id: lonelyText!.id });
    expect("ensidig: fortsatt låst for begge", `${await policy(jonas, { conversationId: lonely })}|${await policy(tobias, { conversationId: lonely })}`, "needs_mutual/10/3|needs_mutual/10/3");
    // The server's own key writing a message records nothing.
    await admin.from("direct_messages").insert({ conversation_id: lonely, author_id: id("tobias"), body: `${BODY} skrevet av serveren` });
    expect("ensidig: en melding skrevet med servernøkkelen teller ikke", await policy(jonas, { conversationId: lonely }), "needs_mutual/10/3");

    // A message with only files does not count as having written.
    const orgFlags = await wrote(orgDm);
    const miaWrote = orgFlags.participant_one_id === id("miaminge") ? orgFlags.participant_one_wrote : orgFlags.participant_two_wrote;
    expect("org-DM: en melding med bare vedlegg registrerer ingenting", miaWrote, false);

    // Membership still decides, whatever was recorded.
    await setMembershipStatus(id("oskar"), UTR, "invited");
    expect("UTR: B er ikke lenger aktiv – A kan ikke laste opp", `${await policy(jonas, U)}|${refusal(await begin(jonas, U, { name: "a.png", mime: "image/png", size: 1000 }))}`, "closed/10/3|attachment_not_allowed:closed");
    expect("UTR: B uten aktivt medlemskap når ikke samtalen", await policy(oskar, U), "not_found/0/0");
    await setMembershipStatus(id("oskar"), UTR, "active");
    expect("UTR: tredjepart fortsatt utenfor etter alt dette", await policy(tobias, U), "not_found/0/0");
    expect("UTR: et annet fellesskaps medlem når ikke samtalen", await policy(eli, U), "not_found/0/0");

    // ════ 5. Upload, association and integrity (private group) ═════════
    const first = await httpUpload(kristoffer, FTR, G, await rotatedJpegFixture("CHECK vedlegg portrett.jpg"));
    expect("gruppe: opplasting gir 201", first.status, 201);
    const pending = first.attachment!;
    const pendingRow = await row(pending.id);
    expect("opplastet: status ready, ikke sendt", `${pendingRow?.status}/${pendingRow?.message_id}`, "ready/null");
    expect("opplastet: opplaster, kanal og fellesskap", `${pendingRow?.uploader_id === id("kristoffer")}/${pendingRow?.channel_id === G.channelId}/${pendingRow?.community_id}`, `true/true/${FTR}`);
    expect("opplastet: type fra innholdet", pendingRow?.mime_type, "image/jpeg");
    expect("opplastet: lagringsnøkkelen er generert, uten filnavn", /^tryggere-ruspolitikk\/[0-9a-f-]{36}\.jpg$/.test(pendingRow?.storage_path ?? ""), true);
    expect("opplastet: nøkkelen røper ikke vedleggets id", pendingRow?.storage_path.includes(pending.id), false);
    expect("opplastet: dreid bilde får visningsmål (800×1200)", `${pendingRow?.width}×${pendingRow?.height}`, "800×1200");
    expect("opplastet: objekt og miniatyr finnes", `${await objectExists(pendingRow!.storage_path)}/${await objectExists(thumbnailPath(pendingRow!.storage_path))}`, "true/true");

    // A phone photo: what is stored — and so what is shown, previewed and
    // downloaded as the original — has no camera, no place and no XMP in it.
    const phoneUpload = await httpUpload(kristoffer, FTR, G, phone);
    expect("mobilbilde: lastes opp", phoneUpload.status, 201);
    const phoneRow = await row(phoneUpload.attachment!.id);
    const phoneOriginal = new Uint8Array(await (await httpGet(kristoffer, FTR, phoneUpload.attachment!.id, "?download=1")).arrayBuffer());
    const phoneMeta = await sharp(phoneOriginal).metadata();
    expect("mobilbilde: nedlastet original er uten kamera, GPS og XMP", `${holds(phoneOriginal, METADATA_SECRET)}/${(phoneMeta.exif?.length ?? 0) <= 32}/${phoneMeta.xmp === undefined}`, "false/true/true");
    expect("mobilbilde: retningen er beholdt i originalen", phoneMeta.orientation, 6);
    expect("mobilbilde: samme piksler som det som ble lastet opp", (await pixels(phone.bytes)).equals(await pixels(phoneOriginal)), true);
    expect("mobilbilde: lagret størrelse er den rensede filens", `${phoneRow?.size_bytes === phoneOriginal.byteLength}/${phoneOriginal.byteLength < phone.bytes.byteLength}`, "true/true");
    const { data: storedPhone } = await admin.storage.from(BUCKET).download(phoneRow!.storage_path);
    expect("mobilbilde: heller ikke i selve bøtta", holds(new Uint8Array(await storedPhone!.arrayBuffer()), METADATA_SECRET), false);
    const phoneThumb = new Uint8Array(await (await httpGet(kristoffer, FTR, phoneUpload.attachment!.id, "?variant=thumb")).arrayBuffer());
    const thumbMeta = await sharp(phoneThumb).metadata();
    expect("mobilbilde: miniatyren er uten metadata og står riktig vei", `${thumbMeta.exif === undefined}/${thumbMeta.width! < thumbMeta.height!}`, "true/true");
    const animated = await httpUpload(kristoffer, FTR, G, { name: "CHECK vedlegg animasjon.gif", bytes: (await animatedGifFixture()).bytes });
    const animatedOriginal = new Uint8Array(await (await httpGet(kristoffer, FTR, animated.attachment!.id)).arrayBuffer());
    expect("animert GIF: fortsatt animert etter opplasting, uten kommentar", `${(await sharp(animatedOriginal, { animated: true }).metadata()).pages}/${holds(animatedOriginal, METADATA_SECRET)}`, "2/false");
    await httpDelete(kristoffer, FTR, phoneUpload.attachment!.id);
    await httpDelete(kristoffer, FTR, animated.attachment!.id);

    // Not a message yet: nobody else sees it, by any route.
    expect("usendt: administrator ser ikke raden", await sees(mia, pending.id), false);
    expect("usendt: administrator får 404", await httpStatus(mia, FTR, pending.id), 404);
    expect("usendt: opplasteren ser sin egen", `${await sees(kristoffer, pending.id)}/${await httpStatus(kristoffer, FTR, pending.id)}`, "true/200");
    expect("usendt: finnes ikke blant kanalens meldinger", await channelMessageCount(G.channelId), 0);

    // Somebody else's upload, another conversation, a made-up id.
    expect("andres opplasting kan ikke legges ved", refusal(await send(mia, G, "kapret", [pending.id])), "attachment_invalid");
    expect("opplasting kan ikke sendes i en annen samtale", refusal(await send(kristoffer, P, "flyttet", [pending.id])), "attachment_invalid");
    expect("oppdiktet id avvises", refusal(await send(kristoffer, G, "x", ["11111111-1111-4111-8111-111111111111"])), "attachment_invalid");
    expect("ingen melding ble skrevet av de avviste forsøkene", `${await channelMessageCount(G.channelId)}/${await channelMessageCount(ftrPrivate)}`, "0/0");
    expect("andres usendte fil kan ikke forkastes", await httpDelete(mia, FTR, pending.id), 404);

    // Clients write nothing directly.
    const forgedRow = await kristoffer.from("message_attachments").insert({
      community_id: FTR, channel_id: G.channelId, uploader_id: id("kristoffer"),
      storage_path: `${FTR}/22222222-2222-4222-8222-222222222222.png`, display_name: "x.png", mime_type: "image/png", size_bytes: 10, status: "ready",
    });
    expect("klient kan ikke sette inn en vedleggsrad", Boolean(forgedRow.error), true);
    const selfReady = await begin(kristoffer, G, { name: `${BODY} kun rad.png`, mime: "image/png", size: 1000 });
    expect("klient kan åpne en opplasting …", Boolean(selfReady.id), true);
    expect("… men ikke fullføre den selv", Boolean((await kristoffer.rpc("complete_message_attachment", { p_attachment_id: selfReady.id! })).error), true);
    expect("… ikke merke den klar", Boolean((await kristoffer.from("message_attachments").update({ status: "ready" }).eq("id", selfReady.id!)).error), true);
    expect("… og ikke sende den uten fil", refusal(await send(kristoffer, G, "", [selfReady.id!])), "attachment_invalid");
    const directPut = await kristoffer.storage.from(BUCKET).upload(selfReady.path!, png.bytes, { contentType: "image/png" });
    expect("klient kan ikke skrive til bøtta direkte", Boolean(directPut.error), true);
    expect("klient kan ikke skrive et fritt valgt navn i bøtta", Boolean((await kristoffer.storage.from(BUCKET).upload(`${FTR}/egen.png`, png.bytes, { contentType: "image/png" })).error), true);
    expect("typen er databasens liste, ikke klientens", refusal(await begin(kristoffer, G, { name: "x.html", mime: "text/html", size: 10 })), "attachment_type");
    expect("navn med skråstrek avvises", refusal(await begin(kristoffer, G, { name: "a/b.png", mime: "image/png", size: 10 })), "attachment_name");
    expect("26 MB avvises av databasen", refusal(await begin(kristoffer, G, { name: "stor.pdf", mime: "application/pdf", size: 25 * MIB + 1 })), "attachment_too_large");
    expect("26 MB avvises av ruten", (await httpUpload(kristoffer, FTR, G, sizedTextFixture("stor.txt", 26 * MIB))).status, 413);
    const big = await httpUpload(kristoffer, FTR, G, sizedTextFixture("CHECK vedlegg stor.txt", 24 * MIB));
    expect("24 MB går gjennom ruten uavkortet", `${big.status}/${(await row(big.attachment?.id ?? ""))?.size_bytes}`, `201/${24 * MIB}`);
    expect("stor fil forkastes igjen", await httpDelete(kristoffer, FTR, big.attachment!.id), 204);

    // The route's own refusals.
    expect("rute: uten innlogging", (await httpUpload(null, FTR, G, png)).status, 401);
    expect("rute: fra et annet nettsted", (await httpUpload(kristoffer, FTR, G, png, { origin: "https://evil.example" })).status, 403);
    expect("rute: uten Origin", (await httpUpload(kristoffer, FTR, G, png, { origin: null })).status, 403);
    expect("rute: uinvitert medlem", (await httpUpload(linn, FTR, G, png)).status, 404);
    expect("rute: annet fellesskap", (await httpUpload(emma, FTR, G, png)).status, 404);
    expect("rute: feil fellesskap i adressen", (await httpUpload(kristoffer, TU, G, png)).status, 404);
    expect("rute: HTML kalt .txt", (await httpUpload(kristoffer, FTR, G, htmlAsTextFixture())).status, 415);
    expect("rute: programfil kalt .pdf", (await httpUpload(kristoffer, FTR, G, executableAsPdfFixture())).status, 415);
    expect("rute: SVG", (await httpUpload(kristoffer, FTR, G, svgFixture())).status, 415);
    expect("rute: Word-fil med makroer", (await httpUpload(kristoffer, FTR, G, macroDocxFixture())).status, 415);
    expect("rute: tom fil", (await httpUpload(kristoffer, FTR, G, { name: "tom.txt", bytes: new Uint8Array(0) })).status, 400);
    const renamed = await httpUpload(kristoffer, FTR, G, { name: "CHECK vedlegg egentlig-bilde.pdf", bytes: png.bytes });
    expect("rute: PNG kalt .pdf lagres som det den er", `${renamed.status}/${renamed.attachment?.mimeType}/${renamed.attachment?.name}`, "201/image/png/CHECK vedlegg egentlig-bilde.png");
    expect("avviste opplastinger etterlot ingen rader hos de avviste", (await admin.from("message_attachments").select("id", { count: "exact", head: true }).in("uploader_id", [id("linn"), id("emmamortensen")])).count, 0);

    // Every supported format through the real route.
    const formats: [string, Fixture, string][] = [
      ["WebP", await webpFixture("CHECK vedlegg.webp"), "image/webp"],
      ["GIF", await gifFixture("CHECK vedlegg.gif"), "image/gif"],
      ["DOCX", docxFixture("CHECK vedlegg.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["XLSX", xlsxFixture("CHECK vedlegg.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["PPTX", pptxFixture("CHECK vedlegg.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["CSV", csvFixture("CHECK vedlegg.csv"), "text/csv"],
      ["MP3", mp3Fixture("CHECK vedlegg.mp3"), "audio/mpeg"],
      ["M4A", m4aFixture("CHECK vedlegg.m4a"), "audio/mp4"],
    ];
    for (const [label, file, mime] of formats) {
      const result = await httpUpload(kristoffer, FTR, G, file);
      expect(`rute: ${label} godtas`, `${result.status}/${result.attachment?.mimeType}`, `201/${mime}`);
      if (result.attachment) await httpDelete(kristoffer, FTR, result.attachment.id);
    }

    // Sending: text + files, files alone, and never twice.
    const doc = await httpUpload(kristoffer, FTR, G, pdf);
    const audio = await httpUpload(kristoffer, FTR, G, wavFixture("CHECK vedlegg opptak.wav"));
    const sent = await send(kristoffer, G, "", [pending.id, renamed.attachment!.id, doc.attachment!.id, audio.attachment!.id]);
    expect("gruppe: melding med bare vedlegg sendes", Boolean(sent.id), true);
    const { data: sentMessage } = await admin.from("messages").select("body, author_id, channel_id").eq("id", sent.id!).single();
    expect("sendt: tom tekst, riktig forfatter og kanal", `[${sentMessage?.body}]/${sentMessage?.author_id === id("kristoffer")}/${sentMessage?.channel_id === G.channelId}`, "[]/true/true");
    const sentRow = await row(pending.id);
    expect("sendt: raden peker på meldingen", `${sentRow?.status}/${sentRow?.message_id === sent.id}`, "sent/true");
    const { data: ordered } = await admin.from("message_attachments").select("id, position").eq("message_id", sent.id!).order("position");
    expect("sendt: rekkefølgen er den som ble sendt", (ordered ?? []).map((entry) => entry.id).join(","), [pending.id, renamed.attachment!.id, doc.attachment!.id, audio.attachment!.id].join(","));
    expect("samme vedlegg kan ikke sendes to ganger", refusal(await send(kristoffer, G, "igjen", [pending.id])), "attachment_invalid");
    expect("to like innsendinger gir én melding", await channelMessageCount(G.channelId), 1);
    const parallel = await Promise.all([1, 2, 3].map(async () => {
      const file = (await upload(kristoffer, G, txt)).id!;
      return file;
    }));
    const race = await Promise.all([send(kristoffer, G, `${BODY} samtidig`, parallel), send(kristoffer, G, `${BODY} samtidig`, parallel)]);
    expect("samtidige innsendinger av samme filer: én vinner", race.filter((result) => result.id).length, 1);
    const withText = await upload(mia, G, txt);
    expect("gruppe: administrator sender tekst og fil", Boolean((await send(mia, G, `${BODY} fra administrator`, [withText.id!])).id), true);
    expect("for lang tekst avvises også med vedlegg", refusal(await send(kristoffer, G, "x".repeat(4001), [(await upload(kristoffer, G, txt)).id!])), "message_too_long");

    // Nothing about a sent attachment can change — for anyone.
    const other = await row(withText.id!);
    expect("uforanderlig: kan ikke flyttes til en annen melding", Boolean((await admin.from("message_attachments").update({ message_id: other!.message_id }).eq("id", pending.id)).error), true);
    expect("uforanderlig: kan ikke gis en annen opplaster", Boolean((await admin.from("message_attachments").update({ uploader_id: id("miaminge") }).eq("id", pending.id)).error), true);
    expect("uforanderlig: kan ikke flyttes til en annen kanal", Boolean((await admin.from("message_attachments").update({ channel_id: ftrPrivate }).eq("id", pending.id)).error), true);
    expect("uforanderlig: kan ikke bytte fil", Boolean((await admin.from("message_attachments").update({ storage_path: other!.storage_path }).eq("id", pending.id)).error), true);
    expect("uforanderlig: kan ikke bytte type eller navn", Boolean((await admin.from("message_attachments").update({ mime_type: "application/pdf", display_name: "annet.pdf" }).eq("id", pending.id)).error), true);
    expect("uforanderlig: kan ikke gjøres usendt", Boolean((await admin.from("message_attachments").update({ status: "ready", message_id: null }).eq("id", pending.id)).error), true);
    expect("uforanderlig: klient kan ikke oppdatere", Boolean((await kristoffer.from("message_attachments").update({ display_name: "x.jpg" }).eq("id", pending.id)).error), true);
    expect("uforanderlig: klient kan ikke slette", Boolean((await kristoffer.from("message_attachments").delete().eq("id", pending.id)).error), true);
    expect("sendt vedlegg kan ikke forkastes av avsenderen", await httpDelete(kristoffer, FTR, pending.id), 404);
    expect("raden er urørt", JSON.stringify(await row(pending.id)), JSON.stringify(sentRow));
    // A message in another channel, by someone else: the guard refuses the link.
    const foreignMessage = await admin.from("messages").insert({ channel_id: ftrPrivate, author_id: id("miaminge"), body: `${BODY} annen kanal` }).select("id").single();
    const spare = await upload(kristoffer, G, txt);
    expect("vedlegg kan ikke knyttes til en melding i en annen kanal", Boolean((await admin.from("message_attachments").update({ message_id: foreignMessage.data!.id, status: "sent" }).eq("id", spare.id!)).error), true);

    // ════ 6. Reading: previews, downloads, thumbnails ══════════════════
    const view = await httpGet(mia, FTR, pending.id);
    await view.arrayBuffer();
    expect("lesing: administrator ser bildet", `${view.status}/${view.headers.get("content-type")}`, "200/image/jpeg");
    expect("lesing: aldri sniffing", view.headers.get("x-content-type-options"), "nosniff");
    expect("lesing: sandkasse uten skript", /default-src 'none'.*sandbox/.test(view.headers.get("content-security-policy") ?? ""), true);
    expect("lesing: privat og alltid revalidert", view.headers.get("cache-control"), "private, no-cache");
    expect("lesing: bilde vises i nettleseren", (view.headers.get("content-disposition") ?? "").startsWith("inline"), true);
    const thumb = await httpGet(mia, FTR, pending.id, "?variant=thumb");
    const thumbBytes = await thumb.arrayBuffer();
    expect("miniatyr: egen WebP, mindre enn originalen", `${thumb.status}/${thumb.headers.get("content-type")}/${thumbBytes.byteLength < sentRow!.size_bytes}`, "200/image/webp/true");
    const download = await httpGet(mia, FTR, doc.attachment!.id, "?download=1");
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect("nedlasting: som vedlegg, aldri lagret", `${(download.headers.get("content-disposition") ?? "").startsWith("attachment")}/${download.headers.get("cache-control")}`, "true/private, no-store");
    expect("nedlasting: originalen byte for byte", Buffer.from(downloaded).equals(Buffer.from(pdf.bytes)), true);
    const docxSent = await upload(mia, G, docxFixture("CHECK vedlegg notat.docx"));
    await send(mia, G, "", [docxSent.id!]);
    const docxView = await httpGet(kristoffer, FTR, docxSent.id!);
    await docxView.arrayBuffer();
    expect("Office-fil serveres aldri inline", (docxView.headers.get("content-disposition") ?? "").startsWith("attachment"), true);
    const ranged = await httpGet(mia, FTR, audio.attachment!.id, "", { Range: "bytes=0-99" });
    const rangedBytes = await ranged.arrayBuffer();
    expect("lyd: delvis henting (Range)", `${ranged.status}/${rangedBytes.byteLength}/${ranged.headers.get("content-range")?.startsWith("bytes 0-99/")}`, "206/100/true");
    const etag = view.headers.get("etag")!;
    const revalidated = await httpGet(mia, FTR, pending.id, "", { "If-None-Match": etag });
    expect("revalidering: 304 til den som har tilgang", revalidated.status, 304);
    const revalidatedOutside = await httpGet(linn, FTR, pending.id, "", { "If-None-Match": etag });
    expect("revalidering: 404 til den som ikke har, selv med riktig ETag", revalidatedOutside.status, 404);

    // Everyone who may not.
    expect("uinvitert medlem: ingen rad", await sees(linn, pending.id), false);
    expect("uinvitert medlem: 404", await httpStatus(linn, FTR, pending.id), 404);
    expect("uinvitert medlem: 404 for miniatyr og nedlasting", `${await httpStatus(linn, FTR, pending.id, "?variant=thumb")}/${await httpStatus(linn, FTR, pending.id, "?download=1")}`, "404/404");
    expect("uinvitert medlem: Storage nekter", await storageDownload(linn, sentRow!.storage_path), false);
    expect("uinvitert medlem: Storage nekter miniatyren", await storageDownload(linn, sentRow!.thumb_path!), false);
    expect("uinvitert medlem: kan ikke liste bøtta", ((await linn.storage.from(BUCKET).list(FTR)).data ?? []).length, 0);
    expect("uinvitert medlem: ingen metadata å telle", (await linn.from("message_attachments").select("id", { count: "exact", head: true }).eq("channel_id", G.channelId)).count, 0);
    expect("moderator utenfor gruppen: 404", await httpStatus(amina, FTR, pending.id), 404);
    expect("annet fellesskap: 404", await httpStatus(emma, FTR, pending.id), 404);
    expect("annet fellesskap: 404 også under eget fellesskap", await httpStatus(emma, TU, pending.id), 404);
    expect("medlem med tilgang: feil fellesskap i adressen gir 404", await httpStatus(mia, TU, pending.id), 404);
    expect("uautentisert: 404", await httpStatus(null, FTR, pending.id), 404);
    expect("uautentisert: ingen rad, ingen fil", `${await sees(anon, pending.id)}/${await storageDownload(anon, sentRow!.storage_path)}`, "false/false");
    expect("ugyldig id: 404", await httpStatus(mia, FTR, "ikke-en-uuid"), 404);
    const signed = await linn.storage.from(BUCKET).createSignedUrl(sentRow!.storage_path, 60);
    expect("uinvitert medlem kan ikke lage signert lenke", Boolean(signed.data?.signedUrl), false);
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(sentRow!.storage_path).data.publicUrl;
    expect("ingen offentlig adresse virker", (await fetch(publicUrl)).ok, false);
    expect("can_read_message_attachment: utenforstående", (await linn.rpc("can_read_message_attachment_object", { p_name: sentRow!.storage_path })).data, false);

    // TU, the same.
    const tuFile = await httpUpload(adrian, TU, GT, png);
    await send(adrian, GT, `${BODY} TU`, [tuFile.attachment!.id]);
    expect("TU-gruppe: administrator ser medlemmets fil", await httpStatus(emma, TU, tuFile.attachment!.id), 200);
    expect("TU-gruppe: FTR-administrator får 404", await httpStatus(mia, TU, tuFile.attachment!.id), 404);
    expect("TU-gruppe: TU-medlem utenfor gruppen får 404", await httpStatus(nymedlem, TU, tuFile.attachment!.id), 404);
    const tuPrivateFile = await httpUpload(nymedlem, TU, PT, pdf);
    await send(nymedlem, PT, "", [tuPrivateFile.attachment!.id]);
    expect("TU privat kanal: administrator laster ned", await httpStatus(emma, TU, tuPrivateFile.attachment!.id, "?download=1"), 200);
    expect("TU privat kanal: medlem av to fellesskap uten invitasjon", await httpStatus(eli, TU, tuPrivateFile.attachment!.id), 404);

    // Private lokallag channel in FTR.
    const privateFile = await httpUpload(kristoffer, FTR, P, png);
    await send(kristoffer, P, `${BODY} privat`, [privateFile.attachment!.id]);
    expect("privat kanal: administrator ser filen", await httpStatus(mia, FTR, privateFile.attachment!.id), 200);
    expect("privat kanal: SAMME lokallag uten invitasjon får 404", await httpStatus(test551, FTR, privateFile.attachment!.id), 404);
    expect("privat kanal: samme lokallag ser ingen rad", await sees(test551, privateFile.attachment!.id), false);
    expect("privat kanal: samme lokallag kan ikke laste opp", (await httpUpload(test551, FTR, P, png)).status, 404);
    expect("privat kanal: annet fellesskap får 404", await httpStatus(emma, FTR, privateFile.attachment!.id), 404);

    // ════ 7. Revocation ════════════════════════════════════════════════
    // Removed from the group: the very next request is refused.
    expect("før fjerning: medlemmet leser", await httpStatus(kristoffer, FTR, withText.id!), 200);
    expect("fjernes fra gruppen", (await mia.rpc("remove_subgroup_member", { p_subgroup_id: ftrGroup.subgroupId, p_user_id: id("kristoffer") })).data, true);
    expect("etter fjerning: 404", await httpStatus(kristoffer, FTR, withText.id!), 404);
    expect("etter fjerning: også egne sendte filer", await httpStatus(kristoffer, FTR, pending.id), 404);
    expect("etter fjerning: miniatyr og nedlasting", `${await httpStatus(kristoffer, FTR, pending.id, "?variant=thumb")}/${await httpStatus(kristoffer, FTR, pending.id, "?download=1")}`, "404/404");
    expect("etter fjerning: ingen rader", await sees(kristoffer, pending.id), false);
    expect("etter fjerning: Storage nekter", await storageDownload(kristoffer, sentRow!.storage_path), false);
    expect("etter fjerning: en ETag fra før hjelper ikke", (await httpGet(kristoffer, FTR, pending.id, "", { "If-None-Match": etag })).status, 404);
    expect("etter fjerning: egen usendt opplasting er også borte", await httpStatus(kristoffer, FTR, spare.id!), 404);
    expect("etter fjerning: kan ikke laste opp", (await httpUpload(kristoffer, FTR, G, png)).status, 404);
    expect("etter fjerning: usendt opplasting kan ikke sendes", refusal(await send(kristoffer, G, "", [spare.id!])), "attachment_not_allowed:not_found");
    expect("legges til igjen", (await mia.rpc("add_subgroup_member", { p_subgroup_id: ftrGroup.subgroupId, p_user_id: id("kristoffer") })).data, true);
    expect("etter gjeninnsetting: leser igjen", await httpStatus(kristoffer, FTR, withText.id!), 200);

    // Removed from the private channel.
    expect("fjernes fra privat kanal", (await mia.rpc("remove_private_channel_participant", { p_channel_id: ftrPrivate, p_user_id: id("kristoffer") })).data, true);
    expect("privat kanal etter fjerning: 404", await httpStatus(kristoffer, FTR, privateFile.attachment!.id), 404);
    expect("privat kanal etter fjerning: Storage nekter", await storageDownload(kristoffer, (await row(privateFile.attachment!.id))!.storage_path), false);
    expect("legges til igjen i privat kanal", (await mia.rpc("add_private_channel_participant", { p_channel_id: ftrPrivate, p_user_id: id("kristoffer") })).data, true);

    // A direct conversation ends for someone who is no longer a member.
    await setMembershipStatus(id("oskar"), UTR, "invited");
    expect("DM: tidligere medlem får 404", await httpStatus(oskar, UTR, utrImage.attachment!.id), 404);
    expect("DM: tidligere medlem ser ingen rad", await sees(oskar, utrImage.attachment!.id), false);
    expect("DM: den som er igjen leser fortsatt", await httpStatus(jonas, UTR, utrImage.attachment!.id), 200);
    expect("DM: men kan ikke sende nye filer", await policy(jonas, U), "closed/10/3");
    expect("DM: opplasting avvises når mottakeren er borte", (await httpUpload(jonas, UTR, U, png)).status, 403);
    await setMembershipStatus(id("oskar"), UTR, "active");
    expect("DM: tilbake som medlem – leser igjen", await httpStatus(oskar, UTR, utrImage.attachment!.id), 200);

    // ════ 8. Archived conversations ════════════════════════════════════
    const beforeArchive = await upload(kristoffer, P, txt);
    expect("privat kanal arkiveres", (await mia.rpc("set_private_channel_archived", { p_channel_id: ftrPrivate, p_archived: true })).data, true);
    expect("arkivert: policy", await policy(kristoffer, P), "archived/25/5");
    expect("arkivert: heller ikke administrator", await policy(mia, P), "archived/25/5");
    expect("arkivert: opplasting avvises av ruten", (await httpUpload(kristoffer, FTR, P, png)).status, 403);
    expect("arkivert: opplasting avvises av databasen", refusal(await begin(kristoffer, P, { name: "a.png", mime: "image/png", size: 100 })), "attachment_not_allowed:archived");
    expect("arkivert: fil lastet opp før arkivering kan ikke sendes", refusal(await send(kristoffer, P, "", [beforeArchive.id!])), "attachment_not_allowed:archived");
    expect("arkivert: historikken kan leses", await httpStatus(kristoffer, FTR, privateFile.attachment!.id), 200);
    expect("arkivert: og lastes ned", await httpStatus(mia, FTR, privateFile.attachment!.id, "?download=1"), 200);
    expect("gjenåpnes", (await mia.rpc("set_private_channel_archived", { p_channel_id: ftrPrivate, p_archived: false })).data, true);
    expect("gjenåpnet: filen fra før kan sendes", Boolean((await send(kristoffer, P, "", [beforeArchive.id!])).id), true);

    expect("gruppen arkiveres", (await mia.rpc("set_subgroup_archived", { p_subgroup_id: ftrGroup.subgroupId, p_archived: true })).data, true);
    expect("arkivert gruppe: policy", await policy(kristoffer, G), "archived/25/5");
    expect("arkivert gruppe: opplasting avvises", (await httpUpload(kristoffer, FTR, G, png)).status, 403);
    expect("arkivert gruppe: send avvises", refusal(await send(kristoffer, G, "", [spare.id!])), "attachment_not_allowed:archived");
    expect("arkivert gruppe: historikken kan leses", await httpStatus(kristoffer, FTR, pending.id), 200);
    expect("gruppen gjenåpnes", (await mia.rpc("set_subgroup_archived", { p_subgroup_id: ftrGroup.subgroupId, p_archived: false })).data, true);
    expect("gjenåpnet gruppe: policy", await policy(kristoffer, G), "ok/25/5");

    // ════ 9. Uploads that are never sent ═══════════════════════════════
    const removed = await httpUpload(kristoffer, FTR, G, png);
    const removedRow = await row(removed.attachment!.id);
    expect("fjernet før sending: 204", await httpDelete(kristoffer, FTR, removed.attachment!.id), 204);
    expect("fjernet før sending: raden er borte", await row(removed.attachment!.id), null);
    expect("fjernet før sending: filen og miniatyren fjernes", await eventually(async () => !(await objectExists(removedRow!.storage_path)) && !(await objectExists(thumbnailPath(removedRow!.storage_path)))), true);
    expect("fjerning fra et annet nettsted avvises", await httpDelete(kristoffer, FTR, spare.id!, "https://evil.example"), 404);

    // At most ten unsent uploads per person and conversation: the oldest go.
    for (let i = 0; i < 12; i += 1) await begin(kristoffer, P, { name: `${BODY} kø ${i}.txt`, mime: "text/plain", size: 10 });
    expect("høyst ti usendte opplastinger per samtale", (await admin.from("message_attachments").select("id", { count: "exact", head: true }).eq("channel_id", ftrPrivate).eq("uploader_id", id("kristoffer")).neq("status", "sent")).count, 10);

    // Abandoned: an old unsent upload is swept, a fresh one is not.
    const stalePath = `${FTR}/${crypto.randomUUID()}.txt`;
    await admin.storage.from(BUCKET).upload(stalePath, txt.bytes, { contentType: "text/plain" });
    const { data: stale } = await admin.from("message_attachments").insert({
      community_id: FTR, channel_id: G.channelId, uploader_id: id("kristoffer"), storage_path: stalePath,
      display_name: `${BODY} forlatt.txt`, mime_type: "text/plain", size_bytes: txt.bytes.byteLength, status: "ready",
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    }).select("id").single();
    const fresh = await upload(kristoffer, G, txt);
    expect("opprydding kan ikke startes av klienter", Boolean((await kristoffer.rpc("sweep_abandoned_message_attachments", { p_older_than: "1 second" })).error), true);
    const swept = await sweepAbandonedAttachments(24);
    expect("forlatt opplasting ryddes", `${swept.swept >= 1}/${await row(stale!.id)}`, "true/null");
    expect("forlatt fil fjernes fra bøtta", await objectExists(stalePath), false);
    expect("fersk opplasting røres ikke", (await row(fresh.id!))?.status, "ready");
    expect("sendte vedlegg røres ikke av opprydding", (await row(pending.id))?.status, "sent");
    expect("køen er ikke lesbar for klienter", Boolean((await kristoffer.from("message_attachment_purges").select("storage_path").limit(1)).error), true);

    // ════ 10. Deletion ═════════════════════════════════════════════════
    // There is no message deletion in the app for channel or direct
    // messages; whatever removes a message, its files follow.
    const doomed = await upload(mia, G, png);
    const doomedMessage = await send(mia, G, `${BODY} slettes`, [doomed.id!]);
    const doomedRow = await row(doomed.id!);
    expect("før sletting: filen finnes", await objectExists(doomedRow!.storage_path), true);
    await admin.from("messages").delete().eq("id", doomedMessage.id!);
    expect("melding slettet: vedleggsraden følger", await row(doomed.id!), null);
    expect("melding slettet: filen står i køen", (await admin.from("message_attachment_purges").select("storage_path").eq("storage_path", doomedRow!.storage_path)).data?.length, 1);
    expect("melding slettet: filen kan ikke lenger leses", await storageDownload(mia, doomedRow!.storage_path), false);
    // Storage refusing a removal: reported, logged, and nothing is forgotten.
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...parts: unknown[]) => void logged.push(parts.join(" "));
    const refused = await purgeAttachmentObjects(200, { remove: async () => ({ error: { message: "simulert Storage-feil" } }) });
    console.error = realError;
    expect("mislykket fjerning: rapporteres med antall", `${refused.removed}/${refused.failed >= 1}/${refused.remaining >= 1}/${Boolean(refused.oldestQueuedAt)}`, "0/true/true/true");
    expect("mislykket fjerning: logges med årsak", logged.some((line) => line.includes("simulert Storage-feil")), true);
    expect("mislykket fjerning: filen står fortsatt i køen", (await admin.from("message_attachment_purges").select("storage_path").eq("storage_path", doomedRow!.storage_path)).data?.length, 1);
    expect("mislykket fjerning: filen er fortsatt uleselig for alle", await storageDownload(mia, doomedRow!.storage_path), false);
    const retried = await purgeAttachmentObjects();
    expect("neste forsøk fjerner den", `${retried.failed}/${retried.remaining}`, "0/0");
    expect("melding slettet: filen er fjernet", await objectExists(doomedRow!.storage_path), false);
    expect("andre meldingers filer er urørt", await objectExists(sentRow!.storage_path), true);

    // A private channel deleted permanently, by the function the app calls.
    const privatePaths = ((await admin.from("message_attachments").select("storage_path").eq("channel_id", ftrPrivate)).data ?? []).map((entry) => entry.storage_path);
    expect("privat kanal har filer før sletting", privatePaths.length > 0, true);
    expect("privat kanal slettes", (await mia.rpc("delete_private_channel", { p_channel_id: ftrPrivate })).data, true);
    expect("kanal slettet: ingen vedleggsrader igjen", (await admin.from("message_attachments").select("id", { count: "exact", head: true }).in("storage_path", privatePaths)).count, 0);
    expect("kanal slettet: tidligere deltaker får 404", await httpStatus(kristoffer, FTR, privateFile.attachment!.id), 404);
    await purgeAttachmentObjects();
    expect("kanal slettet: filene er fjernet", (await Promise.all(privatePaths.map(objectExists))).some(Boolean), false);

    // A group deleted permanently.
    const groupPaths = ((await admin.from("message_attachments").select("storage_path, thumb_path").eq("channel_id", G.channelId)).data ?? []).flatMap((entry) => [entry.storage_path, ...(entry.thumb_path ? [entry.thumb_path] : [])]);
    expect("gruppen har filer før sletting", groupPaths.length > 3, true);
    expect("gruppen slettes", (await mia.rpc("delete_subgroup", { p_subgroup_id: ftrGroup.subgroupId })).data, true);
    expect("gruppe slettet: ingen vedleggsrader igjen", (await admin.from("message_attachments").select("id", { count: "exact", head: true }).eq("channel_id", G.channelId)).count, 0);
    expect("gruppe slettet: 404", await httpStatus(mia, FTR, pending.id), 404);
    await purgeAttachmentObjects();
    expect("gruppe slettet: filer og miniatyrer er fjernet", (await Promise.all(groupPaths.map(objectExists))).some(Boolean), false);
    expect("andre samtalers filer er urørt", await objectExists(orgRow!.storage_path), true);
    expect("TU-filene er urørt", await objectExists((await row(tuFile.attachment!.id))!.storage_path), true);

    // ════ 11. Text-only messaging is what it was ═══════════════════════
    const plain = await adrian.from("messages").insert({ channel_id: GT.channelId, body: `${BODY} bare tekst` }).select("id, body").single();
    expect("kanal: vanlig tekstmelding", plain.data?.body, `${BODY} bare tekst`);
    expect("DM: vanlig tekstmelding", await say(eli, orgDm, `${BODY} bare tekst`), null);
    expect("DM: tom tekstmelding avvises som før", Boolean(await say(eli, orgDm, "   ")), true);
    expect("uinvitert kan fortsatt ikke skrive i gruppen", Boolean((await nymedlem.from("messages").insert({ channel_id: GT.channelId, body: `${BODY} nei` })).error), true);
    const { count: safeSpaceWrites } = await admin.from("message_attachments").select("id", { count: "exact", head: true }).eq("channel_id", SAFE_SPACE_CHANNEL);
    expect("Safe-Space er ikke skrevet til", safeSpaceWrites, 0);
  } finally {
    await cleanup();
  }

  // ════ 12. Nothing left behind ════════════════════════════════════════
  const { count: leftoverRows } = await admin.from("message_attachments").select("id", { count: "exact", head: true }).like("display_name", `${BODY}%`);
  expect("ingen CHECK-vedlegg igjen", leftoverRows, 0);
  const { count: queued } = await admin.from("message_attachment_purges").select("storage_path", { count: "exact", head: true });
  expect("køen er tom", queued, 0);

  // Every remaining object belongs to a row, and every row has its object.
  const { data: rows } = await admin.from("message_attachments").select("storage_path, thumb_path, status");
  const referenced = new Set((rows ?? []).flatMap((entry) => [entry.storage_path, ...(entry.thumb_path ? [entry.thumb_path] : [])]));
  const objects = new Set<string>();
  for (const community of [FTR, TU, UTR]) {
    const { data: listed } = await admin.storage.from(BUCKET).list(community, { limit: 1000 });
    for (const entry of listed ?? []) objects.add(`${community}/${entry.name}`);
  }
  expect("ingen foreldreløse filer i bøtta", [...objects].filter((path) => !referenced.has(path)).length, 0);
  expect("ingen sendte vedlegg uten fil", (rows ?? []).filter((entry) => entry.status === "sent" && !objects.has(entry.storage_path)).length, 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} sjekker feilet`);
    process.exit(1);
  }
  console.log(`✓ ${checks} sjekker: vedlegg følger samtalens tilgang, grenser og livsløp`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
