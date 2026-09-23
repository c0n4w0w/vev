/**
 * Checks the community profile image: who may change it, what may be stored,
 * and that nothing else moves when it does.
 *
 * Run with `npm run check:community-avatar` against the local stack after
 * `npm run seed`. Everything that is a permission check goes through ordinary
 * anon-key clients signed in as fixture accounts, calling exactly what the
 * server action calls — Storage and `set_community_avatar()` — so a passing
 * run means the *database* refuses, not that the UI hides a button. The
 * service role is only used to read state back, to flip one membership to
 * inactive, and to put everything as it was.
 *
 * The images are header-valid rather than decodable pictures: the validators
 * and the bucket read headers and MIME types, not pixels.
 *
 * What cannot be exercised from here is the Next.js action itself (it needs a
 * request and cookies). Its checks — admin-only, unauthenticated redirect —
 * sit in front of the same two database calls and are covered in the browser.
 */
import { config } from "dotenv";
import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { AVATAR_MAX_BYTES, inspectCommunityAvatar } from "@/lib/community-avatar-image";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const BUCKET = "community-avatars";

const UTR = "under-the-rug";
const TR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;

// ── Fixtures ────────────────────────────────────────────────────────────

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A real, decodable solid-colour PNG. */
function png(size = 64): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(Buffer.from(type, "latin1"), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size);
  hv.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = new Uint8Array(1 + size * 3).fill(0x80);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** JPEG with a real frame header (SOF0) of the given size. Not decodable. */
function jpeg(width = 64, height = 64): Uint8Array {
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.set([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], 9);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** Lossy-container WebP (VP8X) header with the given canvas. Not decodable. */
function webp(width = 64, height = 64): Uint8Array {
  const out = Buffer.alloc(30);
  out.write("RIFF", 0);
  out.writeUInt32LE(22, 4);
  out.write("WEBPVP8X", 8);
  out.writeUInt32LE(10, 16);
  out.writeUIntLE(width - 1, 24, 3);
  out.writeUIntLE(height - 1, 27, 3);
  return out;
}

// ── Clients ─────────────────────────────────────────────────────────────

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user!.email!,
  });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

/** The handle of some active member with exactly this role in the community. */
async function handleWithRole(communityId: string, role: "moderator" | "member"): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("profiles!memberships_user_id_fkey(handle)")
    .eq("community_id", communityId)
    .eq("role", role)
    .eq("status", "active")
    .limit(1)
    .single();
  if (error) throw error;
  return (data as unknown as { profiles: { handle: string } }).profiles.handle;
}

// ── Actions under test ──────────────────────────────────────────────────

const pathFor = (communityId: string, extension = "png") => `${communityId}/${randomUUID()}.${extension}`;

const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

async function upload(client: Client, path: string, bytes: Uint8Array, contentType?: string) {
  const extension = path.split(".").pop()!;
  return client.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: contentType ?? mime[extension] ?? "application/octet-stream", upsert: false });
}

async function swap(client: Client, communityId: string, path: string | null) {
  const { data, error } = await client.rpc("set_community_avatar", {
    p_community_id: communityId,
    p_path: path as string,
  });
  return { applied: data?.[0]?.applied === true, previous: (data?.[0]?.previous_path ?? null) as string | null, error };
}

async function storedPath(communityId: string): Promise<string | null> {
  const { data, error } = await admin.from("communities").select("avatar_path").eq("id", communityId).single();
  if (error) throw error;
  return data.avatar_path;
}

async function objectExists(path: string): Promise<boolean> {
  const [folder, name] = path.split("/");
  const { data } = await admin.storage.from(BUCKET).list(folder, { search: name });
  return (data ?? []).some((entry) => entry.name === name);
}

async function portalSnapshot(slug: string): Promise<string> {
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { data, error } = await anon.rpc("portal_by_slug", { p_slug: slug });
  if (error) throw error;
  return JSON.stringify(data);
}

async function clearBucket() {
  for (const communityId of [UTR, TR, TU]) {
    const { data } = await admin.storage.from(BUCKET).list(communityId);
    const paths = (data ?? []).map((entry) => `${communityId}/${entry.name}`);
    if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
    await admin.from("communities").update({ avatar_path: null }).eq("id", communityId);
  }
}

// ── Checks ──────────────────────────────────────────────────────────────

async function main() {
  await clearBucket();

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const admins: [string, string][] = [
    [UTR, "octavio"],
    [TR, "larsbror"],
    [TU, "emmamortensen"],
  ];
  const adminClients = new Map<string, Client>();
  const moderators = new Map<string, Client>();
  const members = new Map<string, Client>();
  for (const [communityId, handle] of admins) {
    adminClients.set(communityId, await signIn(handle));
    moderators.set(communityId, await signIn(await handleWithRole(communityId, "moderator")));
    members.set(communityId, await signIn(await handleWithRole(communityId, "member")));
  }

  const portalsBefore = await Promise.all([UTR, TR, TU].map(portalSnapshot));

  // ── The validators ──
  // The server-side check decides from bytes: format, size, header dimensions.
  expect("gyldig PNG godtas", inspectCommunityAvatar(png()).ok, true);
  expect("gyldig JPEG godtas", inspectCommunityAvatar(jpeg()).ok, true);
  expect("gyldig WebP godtas", inspectCommunityAvatar(webp()).ok, true);
  expect("PNG gir filendelse png", (inspectCommunityAvatar(png()) as { extension?: string }).extension, "png");
  expect("JPEG gir filendelse jpg", (inspectCommunityAvatar(jpeg()) as { extension?: string }).extension, "jpg");
  expect("WebP gir filendelse webp", (inspectCommunityAvatar(webp()) as { extension?: string }).extension, "webp");
  expect("GIF avvises", inspectCommunityAvatar(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)])).ok, false);
  expect("SVG avvises", inspectCommunityAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok, false);
  expect("HTML avvises", inspectCommunityAvatar(Buffer.from("<html><script>alert(1)</script>")).ok, false);
  expect("tom fil avvises", inspectCommunityAvatar(new Uint8Array(0)).ok, false);
  expect("for stort bilde avvises", inspectCommunityAvatar(Buffer.concat([png(), Buffer.alloc(AVATAR_MAX_BYTES)])).ok, false);
  expect("for store dimensjoner avvises", inspectCommunityAvatar(jpeg(9000, 9000)).ok, false);
  expect("for lite bilde avvises", inspectCommunityAvatar(jpeg(16, 16)).ok, false);
  expect("PNG med feil filnavn godtas etter innhold", inspectCommunityAvatar(png()).ok, true);
  expect("avkuttet PNG avvises", inspectCommunityAvatar(png().subarray(0, 20)).ok, false);
  expect("avkuttet JPEG avvises", inspectCommunityAvatar(jpeg().subarray(0, 8)).ok, false);

  // ── 1–3, 11–13: each administrator changes their own community's image ──
  const formats: [string, string, Uint8Array][] = [
    [UTR, "png", png()],
    [TR, "jpg", jpeg()],
    [TU, "webp", webp()],
  ];
  for (const [communityId, extension, bytes] of formats) {
    const client = adminClients.get(communityId)!;
    const path = pathFor(communityId, extension);
    const uploaded = await upload(client, path, bytes);
    expect(`${communityId}: admin kan laste opp ${extension}`, uploaded.error, null);
    const result = await swap(client, communityId, path);
    expect(`${communityId}: admin kan bytte profilbilde`, result.applied, true);
    expect(`${communityId}: referansen lagres`, await storedPath(communityId), path);
  }

  // ── 4: an administrator cannot touch another community ──
  const larsbror = adminClients.get(TR)!;
  const utrBefore = await storedPath(UTR);
  const crossUpload = await upload(larsbror, pathFor(UTR), png());
  expect("admin kan ikke laste opp til et annet fellesskap", crossUpload.error !== null, true);
  const ownPath = (await storedPath(TR))!;
  const crossSwap = await swap(larsbror, UTR, ownPath);
  expect("admin kan ikke endre et annet fellesskaps referanse", crossSwap.applied, false);
  const crossClear = await swap(larsbror, UTR, null);
  expect("admin kan ikke fjerne et annet fellesskaps bilde", crossClear.applied, false);
  expect("annet fellesskap urørt etter kryssforsøk", await storedPath(UTR), utrBefore);
  const crossRead = await larsbror.storage.from(BUCKET).download(utrBefore!);
  expect("admin kan ikke lese et annet fellesskaps bilde", crossRead.error !== null, true);
  const crossDelete = await larsbror.storage.from(BUCKET).remove([utrBefore!]);
  expect("admin kan ikke slette et annet fellesskaps fil", (crossDelete.data ?? []).length, 0);
  expect("annet fellesskaps fil finnes fortsatt", await objectExists(utrBefore!), true);

  // ── 5–7: moderator, member, unauthenticated ──
  for (const [communityId] of admins) {
    const current = await storedPath(communityId);
    const adminUpload = await upload(adminClients.get(communityId)!, pathFor(communityId), png());
    expect(`${communityId}: admin kan forberede en fil`, adminUpload.error, null);
    const parked = (await admin.storage.from(BUCKET).list(communityId)).data!
      .map((entry) => `${communityId}/${entry.name}`)
      .find((path) => path !== current)!;

    for (const [who, clients] of [["moderator", moderators], ["medlem", members]] as const) {
      const client = clients.get(communityId)!;
      const denied = await upload(client, pathFor(communityId), png());
      expect(`${communityId}: ${who} kan ikke laste opp`, denied.error !== null, true);
      const swapped = await swap(client, communityId, parked);
      expect(`${communityId}: ${who} kan ikke bytte profilbilde`, swapped.applied, false);
      const cleared = await swap(client, communityId, null);
      expect(`${communityId}: ${who} kan ikke fjerne profilbildet`, cleared.applied, false);
      const removed = await client.storage.from(BUCKET).remove([current!]);
      expect(`${communityId}: ${who} kan ikke slette filen`, (removed.data ?? []).length, 0);
      const read = await client.storage.from(BUCKET).download(current!);
      expect(`${communityId}: ${who} kan lese bildet (medlemmer ser det)`, read.error, null);
    }

    const anonUpload = await upload(anon, pathFor(communityId), png());
    expect(`${communityId}: uautentisert kan ikke laste opp`, anonUpload.error !== null, true);
    const anonSwap = await anon.rpc("set_community_avatar", { p_community_id: communityId, p_path: parked });
    expect(`${communityId}: uautentisert kan ikke kalle funksjonen`, anonSwap.error !== null, true);
    const anonRead = await anon.storage.from(BUCKET).download(current!);
    expect(`${communityId}: uautentisert kan ikke lese bildet`, anonRead.error !== null, true);
    expect(`${communityId}: referansen uendret etter forsøkene`, await storedPath(communityId), current);
    await admin.storage.from(BUCKET).remove([parked]);
  }

  // ── 8: an inactive membership cannot change it ──
  // The administrator's own row, briefly demoted to "invited": same person,
  // same session, no longer active.
  {
    const { data: row, error } = await admin
      .from("memberships")
      .select("id, status")
      .eq("community_id", TR)
      .eq("user_id", await profileId("larsbror"))
      .single();
    if (error) throw error;
    const current = (await storedPath(TR))!;
    try {
      await admin.from("memberships").update({ status: "invited" }).eq("id", row.id);
      const denied = await upload(larsbror, pathFor(TR), png());
      expect("inaktivt medlemskap kan ikke laste opp", denied.error !== null, true);
      const swapped = await swap(larsbror, TR, current);
      expect("inaktivt medlemskap kan ikke bytte", swapped.applied, false);
      const cleared = await swap(larsbror, TR, null);
      expect("inaktivt medlemskap kan ikke fjerne", cleared.applied, false);
      const read = await larsbror.storage.from(BUCKET).download(current);
      expect("inaktivt medlemskap kan ikke lese bildet", read.error !== null, true);
    } finally {
      await admin.from("memberships").update({ status: row.status }).eq("id", row.id);
    }
    expect("referansen uendret etter inaktivt forsøk", await storedPath(TR), current);
  }

  // ── 9, 10, 19: what the bucket itself refuses ──
  const utrAdmin = adminClients.get(UTR)!;
  const gif = await upload(utrAdmin, pathFor(UTR, "png"), png(), "image/gif");
  expect("bøtta avviser image/gif", gif.error !== null, true);
  const svg = await upload(utrAdmin, pathFor(UTR, "png"), Buffer.from("<svg/>"), "image/svg+xml");
  expect("bøtta avviser image/svg+xml", svg.error !== null, true);
  const html = await upload(utrAdmin, pathFor(UTR, "png"), Buffer.from("<html/>"), "text/html");
  expect("bøtta avviser text/html", html.error !== null, true);
  const oversized = await upload(
    utrAdmin,
    pathFor(UTR, "png"),
    Buffer.concat([png(), Buffer.alloc(AVATAR_MAX_BYTES)]),
  );
  expect("bøtta avviser fil over 5 MB", oversized.error !== null, true);

  // Only the exact object-name shape is writable, even for the administrator.
  const badNames = [
    `${UTR}/avatar.png`,
    `${UTR}/${randomUUID()}.gif`,
    `${UTR}/${randomUUID()}.svg`,
    `${UTR}/sub/${randomUUID()}.png`,
    `${UTR}/${randomUUID().toUpperCase()}.png`,
    `${UTR}/${randomUUID()}.png.png`,
    `${UTR}/../${TR}/${randomUUID()}.png`,
  ];
  for (const name of badNames) {
    const attempt = await utrAdmin.storage
      .from(BUCKET)
      .upload(name, png(), { contentType: "image/png", upsert: false });
    expect(`ugyldig objektnavn avvises: ${name.replace(UTR, "…")}`, attempt.error !== null, true);
  }

  // Overwriting an existing object is not possible (no update policy).
  const current = (await storedPath(UTR))!;
  const overwrite = await utrAdmin.storage
    .from(BUCKET)
    .upload(current, png(80), { contentType: "image/png", upsert: true });
  expect("eksisterende fil kan ikke overskrives", overwrite.error !== null, true);

  // The function only accepts a path that is well-formed, in this community,
  // and already stored in this bucket.
  const ghost = await swap(utrAdmin, UTR, pathFor(UTR));
  expect("referanse til fil som ikke finnes avvises", ghost.applied, false);
  const malformed = await swap(utrAdmin, UTR, `${UTR}/not-a-uuid.png`);
  expect("referanse med feil format avvises", malformed.applied, false);
  const traversal = await swap(utrAdmin, UTR, `${TR}/../${UTR}/x.png`);
  expect("referanse med sti-triks avvises", traversal.applied, false);
  const emojiObject = await admin.storage.from("community-emoji").list(UTR);
  const emojiPath = `${UTR}/${emojiObject.data?.[0]?.name ?? "x.png"}`;
  const wrongBucket = await swap(utrAdmin, UTR, emojiPath);
  expect("referanse til fil i en annen bøtte avvises", wrongBucket.applied, false);
  expect("referansen er uendret etter avviste bytter", await storedPath(UTR), current);

  // ── 20: the table has no other way in ──
  const direct = await utrAdmin.from("communities").update({ avatar_path: null }).eq("id", UTR).select();
  expect("direkte oppdatering av tabellen gir ingen rader", (direct.data ?? []).length, 0);
  const directInsert = await utrAdmin
    .from("communities")
    .update({ avatar_path: pathFor(UTR) })
    .eq("id", UTR)
    .select();
  expect("direkte skriving av referanse gir ingen rader", (directInsert.data ?? []).length, 0);
  expect("tabellen uendret etter direkte forsøk", await storedPath(UTR), current);
  const moderatorDirect = await moderators
    .get(UTR)!
    .from("communities")
    .update({ avatar_path: null })
    .eq("id", UTR)
    .select();
  expect("moderator kan ikke oppdatere tabellen direkte", (moderatorDirect.data ?? []).length, 0);

  // ── 14, 15, 16: replacement, repeated replacement, removal ──
  {
    const client = adminClients.get(TU)!;
    const first = (await storedPath(TU))!;
    const seen: string[] = [first];
    for (const [index, extension] of (["png", "jpg", "webp", "png"] as const).entries()) {
      const next = pathFor(TU, extension);
      const bytes = extension === "png" ? png(64 + index) : extension === "jpg" ? jpeg() : webp();
      expect(`erstatning ${index + 1}: opplasting`, (await upload(client, next, bytes)).error, null);
      const result = await swap(client, TU, next);
      expect(`erstatning ${index + 1}: byttet`, result.applied, true);
      expect(`erstatning ${index + 1}: forrige sti returneres`, result.previous, seen.at(-1));
      expect(`erstatning ${index + 1}: ny referanse lagret`, await storedPath(TU), next);
      // Cleanup only after the swap, and only by the administrator.
      const removed = await client.storage.from(BUCKET).remove([result.previous!]);
      expect(`erstatning ${index + 1}: forrige fil ryddes`, (removed.data ?? []).length, 1);
      expect(`erstatning ${index + 1}: forrige fil er borte`, await objectExists(result.previous!), false);
      expect(`erstatning ${index + 1}: nytt bilde finnes`, await objectExists(next), true);
      seen.push(next);
    }
    const listed = (await admin.storage.from(BUCKET).list(TU)).data ?? [];
    expect("gjentatt erstatning etterlater én fil", listed.length, 1);

    // ── 17: the other communities did not move ──
    expect("UTR uberørt av endringer i TU", await storedPath(UTR), current);
    expect("FTR uberørt av endringer i TU", await storedPath(TR), ownPath);

    // A cleanup that fails must leave the new image working. Here the file is
    // already gone (as if a previous cleanup had run): the reference stays put.
    const stale = pathFor(TU);
    const gone = await client.storage.from(BUCKET).remove([stale]);
    expect("opprydding av manglende fil feiler ikke fatalt", gone.error, null);
    expect("referansen er intakt etter mislykket opprydding", await storedPath(TU), seen.at(-1));

    const cleared = await swap(client, TU, null);
    expect("admin kan fjerne profilbildet", cleared.applied, true);
    expect("fjerning nullstiller referansen", await storedPath(TU), null);
    expect("fjerning returnerer forrige sti", cleared.previous, seen.at(-1));
    const again = await swap(client, TU, null);
    expect("fjerning to ganger er ufarlig", again.applied, true);
    expect("fjerning to ganger gir ingen forrige sti", again.previous, null);
    await client.storage.from(BUCKET).remove([cleared.previous!]);
    expect("TU: fil ryddet etter fjerning", await objectExists(cleared.previous!), false);
    expect("UTR uberørt av fjerning i TU", await storedPath(UTR), current);
  }

  // ── 18: the public portals did not change ──
  const portalsAfter = await Promise.all([UTR, TR, TU].map(portalSnapshot));
  expect("portalene er uendret", portalsAfter.join("|"), portalsBefore.join("|"));
  expect("portalen viser ikke profilbilde", portalsAfter.some((snapshot) => snapshot.includes("avatar")), false);
  const anonCommunities = await anon.from("communities").select("id");
  expect("uautentisert kan ikke lese fellesskapstabellen", (anonCommunities.data ?? []).length, 0);

  // ── Consistency, in the spirit of check:storage ──
  for (const communityId of [UTR, TR, TU]) {
    const path = await storedPath(communityId);
    if (path) expect(`${communityId}: referansen peker på en fil som finnes`, await objectExists(path), true);
    const files = ((await admin.storage.from(BUCKET).list(communityId)).data ?? []).map(
      (entry) => `${communityId}/${entry.name}`,
    );
    const orphans = files.filter((file) => file !== path);
    expect(`${communityId}: ingen foreldreløse filer`, orphans.length, 0);
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    // Leave the stack as the seed made it: no custom images anywhere.
    await clearBucket();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} avatarkontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} avatarkontroller passerte`);
  });
