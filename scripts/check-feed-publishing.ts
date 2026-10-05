/**
 * Checks the feed's publishing and reading model: who may create a post, where
 * it may be scoped, who may read it, and that members take part through
 * comments and reactions on exactly the posts they can read.
 *
 * The rules under test:
 *
 *   create (20260930120000_feed_posts_staff_only)
 *     feed posts — active admins and moderators of that community only
 *     announcements and pinning — can_moderate(), exactly as before
 *
 *   read (20260930130000_lokallag_post_visibility)
 *     community-wide post — every active member of the community
 *     lokallag post       — active members of that group, and the community's
 *                           active admins and moderators
 *     comments, reactions — follow the post: read and write only where the
 *                           post itself is readable
 *
 * Every case runs as a real signed-in caller — a session minted with
 * `admin.generateLink` and redeemed with `verifyOtp` — reading and writing
 * through PostgREST under row level security, as the application does. Hiding
 * a composer or filtering in a component is not what is tested here; the
 * database refusing is.
 *
 * Whatever it creates or moves it puts back, including the notifications an
 * announcement fans out and every local-group assignment it changes, and it
 * checks that it did.
 *
 * Run with `npm run check:feed-publishing` against the local stack.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) {
    throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  }
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  return data!.id;
}

async function sessionFor(handle: string): Promise<SupabaseClient<Database>> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  return signIn(user.user!.email!);
}

async function groupId(communityId: string, name: string): Promise<string> {
  const { data } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", communityId)
    .eq("name", name)
    .single();
  return data!.id;
}

/** The membership row as the database holds it, service role, no RLS. */
async function membershipOf(handle: string, communityId: string) {
  const { data } = await admin
    .from("memberships")
    .select("id, status, role, local_group_id")
    .eq("user_id", await profileId(handle))
    .eq("community_id", communityId)
    .single();
  return data!;
}

/** The post row as the database holds it, service role, no RLS. */
async function stored(postId: string) {
  const { data } = await admin
    .from("posts")
    .select("body, title, kind, pinned, local_group_id, community_id, author_id, comment_count")
    .eq("id", postId)
    .single();
  return data!;
}

async function postCount(): Promise<number> {
  const { count } = await admin.from("posts").select("*", { count: "exact", head: true });
  return count ?? 0;
}

// Every body this suite writes starts with this, so leftovers are findable.
const MARK = "CHECK feed";
const created: string[] = [];

async function publish(
  client: SupabaseClient<Database>,
  communityId: string,
  fields: { localGroupId?: string | null; kind?: "post" | "announcement"; title?: string } = {},
) {
  const { data, error } = await client
    .from("posts")
    .insert({
      community_id: communityId,
      local_group_id: fields.localGroupId ?? null,
      kind: fields.kind ?? "post",
      // Marked too, so the notification an announcement fans out ("Ny
      // kunngjøring: <title>") can be found and removed.
      title: fields.title ? `${MARK}: ${fields.title}` : null,
      body: `${MARK}: ${fields.title ?? "innlegg"}`,
    })
    .select("id, local_group_id")
    .maybeSingle();
  if (data?.id) created.push(data.id);
  return { id: data?.id ?? null, localGroupId: data?.local_group_id ?? null, error };
}

/** The select the feed issues, read from lib/data.ts so the two cannot drift. */
const dataSource = readFileSync("lib/data.ts", "utf8");
const POST_SELECT = /const POST_SELECT =\s*"([^"]+)"/.exec(dataSource)?.[1] ?? "";

async function feedRow(client: SupabaseClient<Database>, postId: string) {
  const { data } = await client.from("posts").select(POST_SELECT).eq("id", postId).maybeSingle();
  return data as unknown as { id: string; local_group: { id: string; name: string } | null } | null;
}

async function canRead(client: SupabaseClient<Database>, postId: string): Promise<boolean> {
  return Boolean(await feedRow(client, postId));
}

/** getFeed's query, as the caller. */
async function feedIds(client: SupabaseClient<Database>, communityId: string): Promise<string[]> {
  const { data } = await client
    .from("posts")
    .select("id")
    .eq("community_id", communityId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => row.id);
}

/** getHomeFeed's query, as the caller: newest across every community. */
async function homeIds(client: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await client.from("posts").select("id").order("created_at", { ascending: false }).limit(8);
  return (data ?? []).map((row) => row.id);
}

/** The overview's pinned announcement: the first pinned row of getAnnouncements. */
async function overviewPinned(client: SupabaseClient<Database>, communityId: string): Promise<string | null> {
  const { data } = await client
    .from("posts")
    .select("id, pinned")
    .eq("community_id", communityId)
    .eq("kind", "announcement")
    .order("created_at", { ascending: false });
  return (data ?? []).find((row) => row.pinned)?.id ?? null;
}

const TR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

async function main() {
  // Roles and local groups, from the seed:
  //   larsbror    — admin, TR, no local group
  //   amina       — moderator, TR, FTR Oslo
  //   nadia       — moderator, TR, FTR Vestland
  //   ingrid      — moderator in TR (no group) and TU, ordinary member in UTR
  //   kristoffer  — member, TR, FTR Oslo
  //   petter      — member, TR, FTR Trøndelag (and member of TU, TU Trøndelag)
  //   elironning  — member, TR, FTR Trøndelag (the ordinary-member showcase)
  //   linn        — member, TR, no local group
  //   emma        — admin, TU
  //   hanne       — moderator, TU, TU Oslo
  //   adrian      — member, TU, TU Vestland
  //   octavio     — admin, UTR
  //   marte       — moderator, UTR
  //   sofie       — no memberships; given an inactive one below
  const handles = [
    "larsbror",
    "amina",
    "nadia",
    "ingrid",
    "kristoffer",
    "petter",
    "elironning",
    "linn",
    "emmamortensen",
    "hanne",
    "adrian",
    "octavio",
    "marte",
    "sofie",
  ] as const;
  const sessions = await Promise.all(handles.map(sessionFor));
  const [lars, amina, nadia, ingrid, kristoffer, petter, eli, linn, emma, hanne, adrian, octavio, marte, sofie] =
    sessions;
  const anon = anonymous();

  const ftrOslo = await groupId(TR, "FTR Oslo");
  const ftrTrondelag = await groupId(TR, "FTR Trøndelag");
  const tuOslo = await groupId(TU, "TU Oslo");
  const tuUio = await groupId(TU, "TU UiO");

  // Preconditions the visibility cases rest on. If the seed moves, these say
  // so first instead of every later case failing for an unclear reason.
  expect("forutsetning: Kristoffer er i FTR Oslo", (await membershipOf("kristoffer", TR)).local_group_id, ftrOslo);
  expect("forutsetning: Petter er i FTR Trøndelag", (await membershipOf("petter", TR)).local_group_id, ftrTrondelag);
  expect("forutsetning: Linn har ikke lokallag", (await membershipOf("linn", TR)).local_group_id, null);
  expect("forutsetning: Lars er ikke i FTR Oslo", (await membershipOf("larsbror", TR)).local_group_id !== ftrOslo, true);
  expect("forutsetning: Nadia er ikke i FTR Oslo", (await membershipOf("nadia", TR)).local_group_id !== ftrOslo, true);

  const postsBefore = await postCount();
  const { count: notificationsBefore } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  const kristofferMembership = await membershipOf("kristoffer", TR);
  const adrianMembership = await membershipOf("adrian", TU);

  // An inactive membership that carries the highest role and the Oslo group.
  // If status were not part of either rule, this is the row that would slip
  // through.
  const sofieId = await profileId("sofie");
  const inactive = await admin
    .from("memberships")
    .insert({ user_id: sofieId, community_id: TR, role: "admin", status: "invited", local_group_id: ftrOslo })
    .select("id")
    .single();
  if (inactive.error) throw new Error(`kunne ikke lage inaktivt medlemskap: ${inactive.error.message}`);

  let sameNameGroup: string | null = null;

  try {
    // ── Post creation ──────────────────────────────────────────────────
    const adminPost = await publish(lars, TR, { title: "administrator, hele fellesskapet" });
    expect("P1. administrator kan publisere til hele fellesskapet", adminPost.error?.message ?? "ok", "ok");
    expect("P1. og innlegget er ikke lokalt", adminPost.localGroupId, null);

    const modPost = await publish(amina, TR, { title: "moderator, hele fellesskapet" });
    expect("P2. moderator kan publisere til hele fellesskapet", modPost.error?.message ?? "ok", "ok");

    const countBeforeRefusals = await postCount();

    const memberPost = await publish(linn, TR, { title: "medlem prøver" });
    expect("P3. vanlig medlem kan ikke publisere", memberPost.error !== null, true);
    expect(
      "P3. avvist av row level security (ikke av noe annet)",
      /row-level security/.test(memberPost.error?.message ?? ""),
      true,
    );
    const memberLocal = await publish(kristoffer, TR, { localGroupId: ftrOslo, title: "medlem, eget lokallag" });
    expect("P3. vanlig medlem kan ikke publisere i sitt eget lokallag heller", memberLocal.error !== null, true);

    const inactivePost = await publish(sofie, TR, { title: "inaktiv administrator" });
    expect("P4. inaktivt medlemskap kan ikke publisere, selv med administratorrolle", inactivePost.error !== null, true);

    const anonPost = await publish(anon, TR, { title: "utlogget" });
    expect("P5. utlogget kan ikke publisere", anonPost.error !== null, true);

    const foreignAdmin = await publish(octavio, TR, { title: "UTR-administrator i TR" });
    expect("P6. administrator i et annet fellesskap kan ikke publisere her", foreignAdmin.error !== null, true);
    const foreignAdminTu = await publish(emma, TR, { title: "TU-administrator i TR" });
    expect("P6. TU-administrator kan ikke publisere i FTR", foreignAdminTu.error !== null, true);

    const foreignMod = await publish(marte, TR, { title: "UTR-moderator i TR" });
    expect("P7. moderator i et annet fellesskap kan ikke publisere her", foreignMod.error !== null, true);
    const foreignModTu = await publish(hanne, TR, { title: "TU-moderator i TR" });
    expect("P7. TU-moderator kan ikke publisere i FTR", foreignModTu.error !== null, true);

    // Elevated in one community, ordinary in another: the role does not travel.
    const ingridInUtr = await publish(ingrid, UTR, { title: "moderator i TR, medlem i UTR" });
    expect("P7. moderatorrolle i TR gir ingen publiseringsrett i UTR", ingridInUtr.error !== null, true);

    expect("ingen av de avviste forsøkene la igjen en rad", await postCount(), countBeforeRefusals);

    // ── Local-group scope on create ────────────────────────────────────
    const osloPost = await publish(lars, TR, { localGroupId: ftrOslo, title: "administrator, FTR Oslo" });
    expect("P8. administrator kan publisere til FTR Oslo", osloPost.error?.message ?? "ok", "ok");
    expect("P11. lokallaget er lagret som valgt", osloPost.localGroupId, ftrOslo);
    expect("P11. og står slik i databasen", (await stored(osloPost.id!)).local_group_id, ftrOslo);

    // A moderator publishing to a group they are not in: nadia is Vestland.
    const trondelagPost = await publish(nadia, TR, {
      localGroupId: ftrTrondelag,
      title: "moderator, FTR Trøndelag",
    });
    expect("P9. moderator kan publisere til et lokallag hun ikke selv er i", trondelagPost.error?.message ?? "ok", "ok");
    expect("P11. lokallaget er lagret som valgt", trondelagPost.localGroupId, ftrTrondelag);

    // ingrid moderates both TR and TU, so role cannot be what refuses these —
    // only the group's community can.
    const trWithTu = await publish(ingrid, TR, { localGroupId: tuOslo, title: "FTR-innlegg med TU-lokallag" });
    expect("P10. lokallag fra et annet fellesskap avvises", trWithTu.error !== null, true);
    // The posts_local_group_active trigger runs before the composite foreign
    // key and refuses first; either way it is a message postWriteError in
    // lib/data.ts recognises and turns into err.localGroupSelectionRefused.
    expect(
      "P10. avvist av lokallagsregelen, med en feil dataskiktet oversetter",
      /Lokallaget finnes ikke|posts_local_group_fkey/.test(trWithTu.error?.message ?? ""),
      true,
    );
    const tuWithFtr = await publish(ingrid, TU, { localGroupId: ftrOslo, title: "TU-innlegg med FTR-lokallag" });
    expect("P10. og motsatt vei", tuWithFtr.error !== null, true);
    const tuModIntoFtrOslo = await publish(hanne, TR, { localGroupId: ftrOslo, title: "TU-moderator i FTR Oslo" });
    expect("P10. TU-moderator kan ikke publisere i FTR Oslo", tuModIntoFtrOslo.error !== null, true);
    const ftrModIntoTu = await publish(amina, TU, { localGroupId: tuOslo, title: "FTR-moderator i TU Oslo" });
    expect("P10. FTR-moderator kan ikke publisere i TU", ftrModIntoTu.error !== null, true);

    const scopeMove = await lars
      .from("posts")
      .update({ local_group_id: ftrTrondelag })
      .eq("id", osloPost.id!)
      .select("id");
    expect("P11. lokallaget kan ikke flyttes etterpå", scopeMove.error !== null, true);
    expect("P11. og står fortsatt på FTR Oslo", (await stored(osloPost.id!)).local_group_id, ftrOslo);

    // ── Reading: community-wide ────────────────────────────────────────
    expect("1. vanlig medlem leser innlegg for hele fellesskapet", await canRead(linn, adminPost.id!), true);
    expect("1. også et medlem i et lokallag", await canRead(petter, adminPost.id!), true);
    expect("2. administrator leser det", await canRead(lars, adminPost.id!), true);
    expect("3. moderator leser det", await canRead(nadia, adminPost.id!), true);
    expect("4. UTR-administrator leser det ikke", await canRead(octavio, adminPost.id!), false);
    expect("4. TU-moderator leser det ikke", await canRead(hanne, adminPost.id!), false);
    expect("4. inaktivt medlemskap leser det ikke", await canRead(sofie, adminPost.id!), false);
    expect("4. utlogget leser det ikke", await canRead(anon, adminPost.id!), false);

    // ── Reading: lokallag ──────────────────────────────────────────────
    expect("5. medlem i FTR Oslo leser Oslo-innlegget", await canRead(kristoffer, osloPost.id!), true);
    expect("6. medlem i FTR Trøndelag leser ikke Oslo-innlegget", await canRead(petter, osloPost.id!), false);
    expect("6. heller ikke showcase-medlemmet i Trøndelag", await canRead(eli, osloPost.id!), false);
    expect("7. medlem uten lokallag leser ikke Oslo-innlegget", await canRead(linn, osloPost.id!), false);
    expect("8. administrator leser Oslo-innlegget uten å være i Oslo", await canRead(lars, osloPost.id!), true);
    expect("9. moderator leser Oslo-innlegget uten å være i Oslo", await canRead(nadia, osloPost.id!), true);
    expect("9. også moderator uten lokallag", await canRead(ingrid, osloPost.id!), true);
    expect("10. TU-administrator leser ikke FTR Oslo", await canRead(emma, osloPost.id!), false);
    expect("10. TU-moderator i TU Oslo leser ikke FTR Oslo", await canRead(hanne, osloPost.id!), false);
    expect("10. TU-medlem leser ikke FTR Oslo", await canRead(adrian, osloPost.id!), false);
    expect("10. UTR-administrator leser ikke FTR Oslo", await canRead(octavio, osloPost.id!), false);
    expect("10. utlogget leser ikke FTR Oslo", await canRead(anon, osloPost.id!), false);

    expect("11. medlem i Trøndelag leser Trøndelag-innlegget", await canRead(petter, trondelagPost.id!), true);
    expect("11. showcase-medlemmet i Trøndelag også", await canRead(eli, trondelagPost.id!), true);
    expect("12. medlem bare i Oslo leser ikke Trøndelag-innlegget", await canRead(kristoffer, trondelagPost.id!), false);

    const { data: seededTrondelag } = await linn
      .from("posts")
      .select("id")
      .eq("community_id", TR)
      .eq("local_group_id", ftrTrondelag);
    expect("7. medlem uten lokallag ser ingen av de seedede Trøndelag-innleggene", (seededTrondelag ?? []).length, 0);

    // ── Comments ───────────────────────────────────────────────────────
    const before = await stored(osloPost.id!);

    const comment = await kristoffer
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: Oslo-medlemmets kommentar` })
      .select("id")
      .maybeSingle();
    expect("13. Oslo-medlem kan kommentere Oslo-innlegget", comment.error?.message ?? "ok", "ok");

    const petterComment = await petter
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: Trøndelag prøver` })
      .select("id");
    expect("14. Trøndelag-medlem kan ikke kommentere Oslo-innlegget", petterComment.error !== null, true);
    const linnComment = await linn
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: uten lokallag prøver` })
      .select("id");
    expect("14. medlem uten lokallag kan ikke kommentere det", linnComment.error !== null, true);
    const petterReply = await petter
      .from("comments")
      .insert({ post_id: osloPost.id!, parent_id: comment.data?.id, body: `${MARK}: svar utenfra` })
      .select("id");
    expect("14. og kan ikke svare på en kommentar der", petterReply.error !== null, true);

    const { data: petterSeesComments } = await petter.from("comments").select("id").eq("post_id", osloPost.id!);
    expect("14. Trøndelag-medlem leser ikke kommentarene på Oslo-innlegget", (petterSeesComments ?? []).length, 0);
    const { data: kristofferSeesComments } = await kristoffer.from("comments").select("id").eq("post_id", osloPost.id!);
    expect("13. Oslo-medlem leser kommentaren", (kristofferSeesComments ?? []).length, 1);

    const adminComment = await lars
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: administratoren svarer` })
      .select("id")
      .maybeSingle();
    expect("15. administrator kan kommentere Oslo-innlegget", adminComment.error?.message ?? "ok", "ok");
    const modReply = await nadia
      .from("comments")
      .insert({ post_id: osloPost.id!, parent_id: comment.data?.id, body: `${MARK}: moderatoren svarer` })
      .select("id")
      .maybeSingle();
    expect("15. moderator utenfor Oslo kan svare der", modReply.error?.message ?? "ok", "ok");
    const modDelete = await nadia.from("comments").delete().eq("id", modReply.data!.id).select("id");
    expect("15. og moderere (slette) i tråden", (modDelete.data ?? []).length, 1);
    const petterDelete = await petter.from("comments").delete().eq("id", comment.data!.id).select("id");
    expect("14. Trøndelag-medlem kan ikke slette kommentaren", (petterDelete.data ?? []).length, 0);

    // Community-wide posts are still open to every member's comments.
    const linnOnWide = await linn
      .from("comments")
      .insert({ post_id: adminPost.id!, body: `${MARK}: medlem på hele fellesskapet` })
      .select("id");
    expect("medlem uten lokallag kan kommentere innlegg for hele fellesskapet", linnOnWide.error?.message ?? "ok", "ok");

    // ── Reactions ──────────────────────────────────────────────────────
    const reaction = await kristoffer
      .from("post_reactions")
      .insert({ post_id: osloPost.id!, emoji: "👍" })
      .select("post_id");
    expect("16. Oslo-medlem kan reagere på Oslo-innlegget", reaction.error?.message ?? "ok", "ok");
    const petterReaction = await petter
      .from("post_reactions")
      .insert({ post_id: osloPost.id!, emoji: "👀" })
      .select("post_id");
    expect("17. Trøndelag-medlem kan ikke reagere på det", petterReaction.error !== null, true);
    const linnReaction = await linn
      .from("post_reactions")
      .insert({ post_id: osloPost.id!, emoji: "👀" })
      .select("post_id");
    expect("17. medlem uten lokallag kan ikke reagere på det", linnReaction.error !== null, true);
    const tuReaction = await hanne
      .from("post_reactions")
      .insert({ post_id: osloPost.id!, emoji: "👀" })
      .select("post_id");
    expect("17. TU-moderator kan ikke reagere på det", tuReaction.error !== null, true);
    const { data: petterSeesReactions } = await petter.from("post_reactions").select("post_id").eq("post_id", osloPost.id!);
    expect("17. Trøndelag-medlem leser ikke reaksjonene", (petterSeesReactions ?? []).length, 0);
    const withdraw = await kristoffer
      .from("post_reactions")
      .delete()
      .eq("post_id", osloPost.id!)
      .eq("emoji", "👍")
      .select("post_id");
    expect("16. og kan trekke reaksjonen tilbake", (withdraw.data ?? []).length, 1);
    const wideReaction = await linn
      .from("post_reactions")
      .insert({ post_id: adminPost.id!, emoji: "🙏" })
      .select("post_id");
    expect("medlem uten lokallag kan reagere på innlegg for hele fellesskapet", wideReaction.error?.message ?? "ok", "ok");

    // Comments and reactions change nothing about the post but its counter.
    const after = await stored(osloPost.id!);
    expect("kommentartelleren teller det som faktisk står", after.comment_count, before.comment_count + 2);
    expect("teksten i innlegget er urørt", after.body, before.body);
    expect("typen er urørt", after.kind, before.kind);
    expect("festingen er urørt", after.pinned, before.pinned);
    expect("lokallaget er urørt", after.local_group_id, before.local_group_id);

    const memberEdit = await kristoffer
      .from("posts")
      .update({ body: `${MARK}: medlem omskriver` })
      .eq("id", osloPost.id!)
      .select("id");
    expect("Oslo-medlem kan ikke endre andres innlegg", (memberEdit.data ?? []).length, 0);
    const memberCount = await kristoffer
      .from("posts")
      .update({ comment_count: 999 })
      .eq("id", osloPost.id!)
      .select("id");
    expect("Oslo-medlem kan ikke sette kommentartelleren", (memberCount.data ?? []).length, 0);
    const memberDelete = await kristoffer.from("posts").delete().eq("id", osloPost.id!).select("id");
    expect("Oslo-medlem kan ikke slette andres innlegg", (memberDelete.data ?? []).length, 0);
    const moveComment = await kristoffer
      .from("comments")
      .update({ post_id: adminPost.id! })
      .eq("id", comment.data!.id)
      .select("id");
    expect("en kommentar kan ikke flyttes til et annet innlegg", moveComment.error !== null, true);
    expect("innlegget er fortsatt uendret", JSON.stringify(await stored(osloPost.id!)), JSON.stringify(after));

    // ── Home, feed and overview ────────────────────────────────────────
    //
    // An Oslo announcement, pinned: it is the newest post anywhere and the
    // newest pinned announcement in TR, so if any surface leaked it, it would
    // be first in line.
    const osloAnnouncement = await publish(lars, TR, {
      kind: "announcement",
      localGroupId: ftrOslo,
      title: "Oslo, festet kunngjøring",
    });
    expect("administrator kan kunngjøre til FTR Oslo", osloAnnouncement.error?.message ?? "ok", "ok");
    const pin = await amina.rpc("set_post_pinned", { p_post_id: osloAnnouncement.id!, p_pinned: true });
    expect("moderator kan feste den", pin.data, true);

    expect("18. Oslo-kunngjøringen står øverst i Oslo-medlemmets hjemfeed", (await homeIds(kristoffer))[0], osloAnnouncement.id);
    expect("18. og mangler i Trøndelag-medlemmets hjemfeed", (await homeIds(petter)).includes(osloAnnouncement.id!), false);
    expect("18. og hos medlemmet uten lokallag", (await homeIds(linn)).includes(osloAnnouncement.id!), false);
    expect("18. Oslo-innlegget mangler også i hjemfeeden", (await homeIds(petter)).includes(osloPost.id!), false);
    expect("18. hjemfeeden er ikke tom for det", (await homeIds(petter)).length > 0, true);

    const petterFeed = await feedIds(petter, TR);
    expect("19. Oslo-innleggene mangler i Trøndelag-medlemmets feed", [osloPost.id, osloAnnouncement.id].some((id) => petterFeed.includes(id!)), false);
    expect("19. mens Trøndelag-innleggene er der", petterFeed.includes(trondelagPost.id!), true);
    expect("19. og innleggene for hele fellesskapet", petterFeed.includes(adminPost.id!), true);
    const kristofferFeed = await feedIds(kristoffer, TR);
    expect("19. Oslo-medlemmets feed har Oslo-kunngjøringen øverst", kristofferFeed[0], osloAnnouncement.id);
    expect("19. og ikke Trøndelag-innlegget", kristofferFeed.includes(trondelagPost.id!), false);
    const larsFeed = await feedIds(lars, TR);
    expect(
      "19. administratorens feed har alle lokallagene",
      [osloPost.id, osloAnnouncement.id, trondelagPost.id].every((id) => larsFeed.includes(id!)),
      true,
    );

    expect("20. Oslo-medlemmet får Oslo-kunngjøringen som festet kunngjøring", await overviewPinned(kristoffer, TR), osloAnnouncement.id);
    const petterPinned = await overviewPinned(petter, TR);
    expect("20. Trøndelag-medlemmet får den ikke", petterPinned === osloAnnouncement.id, false);
    expect("20. men får fortsatt den festede kunngjøringen for alle", petterPinned !== null, true);
    expect("20. siste aktivitet (feeden uten den festede) har ikke Oslo", petterFeed.slice(0, 3).includes(osloPost.id!), false);

    // The fan-out follows the same rule: the group and the staff are told,
    // nobody else sees the title in a notification.
    const { data: fanOut } = await admin
      .from("notifications")
      .select("user_id")
      .eq("kind", "announcement")
      .like("title", `%${MARK}: Oslo, festet kunngjøring%`);
    const notified = new Set((fanOut ?? []).map((row) => row.user_id));
    expect("varsel: Oslo-medlemmet får varsel", notified.has(await profileId("kristoffer")), true);
    expect("varsel: moderator utenfor Oslo får varsel", notified.has(await profileId("nadia")), true);
    expect("varsel: moderator i Oslo får varsel", notified.has(await profileId("amina")), true);
    expect("varsel: Trøndelag-medlemmet får ikke varsel", notified.has(await profileId("petter")), false);
    expect("varsel: medlem uten lokallag får ikke varsel", notified.has(await profileId("linn")), false);
    expect("varsel: forfatteren får ikke varsel", notified.has(await profileId("larsbror")), false);
    expect("varsel: inaktivt medlemskap får ikke varsel", notified.has(sofieId), false);

    // ── Membership changes ─────────────────────────────────────────────
    //
    // Through set_my_local_group, the member's own real path. Nothing about the
    // posts changes; only the membership row does.
    const linnJoins = await linn.rpc("set_my_local_group", { p_community_id: TR, p_local_group_id: ftrOslo });
    expect("22. Linn velger FTR Oslo", linnJoins.data, true);
    expect("22. og leser Oslo-innlegget med en gang", await canRead(linn, osloPost.id!), true);
    const linnLeaves = await linn.rpc("set_my_local_group", { p_community_id: TR, p_local_group_id: null as unknown as string });
    expect("21. Linn fjerner lokallaget", linnLeaves.data, true);
    expect("21. og leser det ikke lenger", await canRead(linn, osloPost.id!), false);

    const moves = await kristoffer.rpc("set_my_local_group", { p_community_id: TR, p_local_group_id: ftrTrondelag });
    expect("21. Kristoffer flytter fra Oslo til Trøndelag", moves.data, true);
    expect("21. og mister Oslo-innlegget", await canRead(kristoffer, osloPost.id!), false);
    expect("22. og får Trøndelag-innlegget", await canRead(kristoffer, trondelagPost.id!), true);
    expect("21. uten at innlegget er endret", (await stored(osloPost.id!)).local_group_id, ftrOslo);
    await kristoffer.rpc("set_my_local_group", { p_community_id: TR, p_local_group_id: ftrOslo });
    expect("tilbake i Oslo", await canRead(kristoffer, osloPost.id!), true);

    // A membership that stops being active stops qualifying on the next query,
    // group or no group.
    await admin.from("memberships").update({ status: "requested" }).eq("id", kristofferMembership.id);
    expect("23. Oslo-medlem med inaktivt medlemskap leser ikke Oslo-innlegget", await canRead(kristoffer, osloPost.id!), false);
    expect("23. og heller ikke innlegg for hele fellesskapet", await canRead(kristoffer, adminPost.id!), false);
    await admin.from("memberships").update({ status: "active" }).eq("id", kristofferMembership.id);
    expect("23. aktivt igjen: leser igjen", await canRead(kristoffer, osloPost.id!), true);
    expect("23. inaktiv administrator med Oslo valgt leser ikke Oslo-innlegget", await canRead(sofie, osloPost.id!), false);
    const sofieComment = await sofie
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: inaktiv` })
      .select("id");
    expect("23. og kan ikke kommentere", sofieComment.error !== null, true);

    // ── Across tenants ─────────────────────────────────────────────────
    //
    // A TU group given the very same name as FTR's, with a TU member in it:
    // the name means nothing, only the group id and its community do.
    const twin = await admin
      .from("community_local_groups")
      .insert({ community_id: TU, name: "FTR Oslo", slug: "check-feed-ftr-oslo", sort_order: 99 })
      .select("id")
      .single();
    sameNameGroup = twin.data!.id;
    await admin.from("memberships").update({ local_group_id: sameNameGroup }).eq("id", adrianMembership.id);
    expect("24. TU-medlem i en TU-gruppe som heter «FTR Oslo» leser ikke FTRs Oslo-innlegg", await canRead(adrian, osloPost.id!), false);

    const forgedAssignment = await admin
      .from("memberships")
      .update({ local_group_id: ftrOslo })
      .eq("id", adrianMembership.id)
      .select("id");
    expect("24. et TU-medlemskap kan ikke peke på FTRs gruppe, selv med tjenesterollen", forgedAssignment.error !== null, true);
    const forgedRpc = await adrian.rpc("set_my_local_group", { p_community_id: TU, p_local_group_id: ftrOslo });
    expect("24. og ikke via set_my_local_group", forgedRpc.data, false);
    const forgedRpcOther = await adrian.rpc("set_my_local_group", { p_community_id: TR, p_local_group_id: ftrOslo });
    expect("24. og ikke ved å oppgi FTR som fellesskap", forgedRpcOther.data, false);
    expect("24. fortsatt ingen tilgang", await canRead(adrian, osloPost.id!), false);

    // Present in the generated types (the generator ignores grants), refused
    // by the database: execute is revoked from every API role.
    const askForOthers = await adrian.rpc("post_scope_admits", {
      p_user_id: await profileId("kristoffer"),
      p_community_id: TR,
      p_local_group_id: ftrOslo,
    });
    expect("24. den interne regelen kan ikke kalles for en annen bruker", askForOthers.error !== null, true);
    const askForSelf = await hanne.rpc("can_read_post_scope", { p_community_id: TR, p_local_group_id: ftrOslo });
    expect("24. TU-moderator får nei når hun spør om FTR Oslo", askForSelf.data, false);

    const tuUioPost = await publish(hanne, TU, { localGroupId: tuUio, title: "TU UiO" });
    expect("25. TU-moderator leser TU UiO uten å være i UiO", await canRead(hanne, tuUioPost.id!), true);
    expect("25. TU-administrator leser TU UiO", await canRead(emma, tuUioPost.id!), true);
    expect("25. moderator i både TR og TU leser TU UiO", await canRead(ingrid, tuUioPost.id!), true);
    expect("25. FTR-administrator leser ikke TU UiO", await canRead(lars, tuUioPost.id!), false);
    expect("25. FTR-moderator leser ikke TU UiO", await canRead(nadia, tuUioPost.id!), false);
    expect("25. TU-medlem utenfor UiO leser ikke TU UiO", await canRead(adrian, tuUioPost.id!), false);
    const crossPin = await hanne.rpc("set_post_pinned", { p_post_id: osloPost.id!, p_pinned: true });
    expect("25. TU-moderator kan ikke feste FTRs Oslo-innlegg", crossPin.data, null);
    const crossComment = await hanne
      .from("comments")
      .insert({ post_id: osloPost.id!, body: `${MARK}: TU-moderator` })
      .select("id");
    expect("25. og ikke kommentere det", crossComment.error !== null, true);
    const crossDelete = await hanne.from("posts").delete().eq("id", osloPost.id!).select("id");
    expect("25. og ikke slette det", (crossDelete.data ?? []).length, 0);
    const utrMemberModElsewhere = await ingrid.from("posts").select("id").eq("community_id", UTR);
    expect(
      "25. moderatorrolle i TR gir ingen ekstra lesing i UTR (ingrid ser bare UTRs vanlige feed)",
      (utrMemberModElsewhere.data ?? []).length,
      (await feedIds(marte, UTR)).length,
    );

    // ── Badge data ─────────────────────────────────────────────────────
    expect("POST_SELECT henter lokallaget i samme spørring", POST_SELECT.includes("community_local_groups"), true);
    const osloRow = await feedRow(kristoffer, osloPost.id!);
    expect("B17. FTR Oslo-innlegg får etiketten FTR Oslo", osloRow?.local_group?.name, "FTR Oslo");
    expect("B17. og riktig id", osloRow?.local_group?.id, ftrOslo);
    const trondelagRow = await feedRow(petter, trondelagPost.id!);
    expect("B18. FTR Trøndelag-innlegg får etiketten FTR Trøndelag", trondelagRow?.local_group?.name, "FTR Trøndelag");
    const { data: seededForPetter } = await petter
      .from("posts")
      .select(POST_SELECT)
      .eq("community_id", TR)
      .eq("local_group_id", ftrTrondelag)
      .not("body", "like", `${MARK}%`);
    const seededRows = (seededForPetter ?? []) as unknown as { local_group: { name: string } | null }[];
    expect("B18. seedede Trøndelag-innlegg finnes for Trøndelag", seededRows.length >= 2, true);
    expect("B18. og alle løses til FTR Trøndelag", seededRows.every((row) => row.local_group?.name === "FTR Trøndelag"), true);
    expect("B19. innlegg for hele fellesskapet har ikke noe lokallag", (await feedRow(linn, adminPost.id!))?.local_group, null);
    const tuPost = await publish(emma, TU, { localGroupId: tuOslo, title: "TU Oslo" });
    const tuRow = await feedRow(hanne, tuPost.id!);
    expect("B20. TU-lokallag løses til TU Oslo", tuRow?.local_group?.name, "TU Oslo");
    expect("B20. med TU-prefiks, ikke FTR", /^TU /.test(tuRow?.local_group?.name ?? ""), true);
    expect("B20. TU UiO løses til TU UiO", (await feedRow(emma, tuUioPost.id!))?.local_group?.name, "TU UiO");

    // Every post read in the data layer uses the select that carries the
    // group, so no screen renders a scoped post without its badge.
    for (const fn of ["getFeed", "getAnnouncements", "getRecentLocalGroupPosts", "getHomeFeed"]) {
      const start = dataSource.indexOf(`export async function ${fn}(`);
      const body = dataSource.slice(start, dataSource.indexOf("\n}\n", start));
      expect(`${fn} bruker POST_SELECT`, start >= 0 && body.includes(".select(POST_SELECT)"), true);
    }

    // ── Announcements ──────────────────────────────────────────────────
    const modAnnouncement = await publish(amina, TR, { kind: "announcement", title: "moderator, kunngjøring" });
    expect("A21. moderator kan kunngjøre", modAnnouncement.error?.message ?? "ok", "ok");
    const memberAnnouncement = await publish(linn, TR, { kind: "announcement", title: "medlem, kunngjøring" });
    expect("A21. medlem kan ikke kunngjøre", memberAnnouncement.error !== null, true);

    // A post a member wrote before this rule is still theirs to edit, and
    // editing is still not a way into an announcement.
    const legacy = await admin
      .from("posts")
      .insert({ community_id: TR, body: `${MARK}: eldre medlemsinnlegg`, author_id: await profileId("linn") })
      .select("id")
      .single();
    created.push(legacy.data!.id);
    const legacyEdit = await linn
      .from("posts")
      .update({ body: `${MARK}: eldre medlemsinnlegg, rettet` })
      .eq("id", legacy.data!.id)
      .select("id");
    expect("A21. medlem kan fortsatt rette sitt eget eldre innlegg", (legacyEdit.data ?? []).length, 1);
    const promote = await linn
      .from("posts")
      .update({ kind: "announcement" })
      .eq("id", legacy.data!.id)
      .select("id");
    expect("A21. medlem kan ikke gjøre det om til kunngjøring", promote.error !== null, true);
    expect("A21. typen står", (await stored(legacy.data!.id)).kind, "post");

    // ── Pinning ────────────────────────────────────────────────────────
    const memberPin = await kristoffer.rpc("set_post_pinned", { p_post_id: osloPost.id!, p_pinned: true });
    expect("A22. medlem kan ikke feste, heller ikke i eget lokallag", memberPin.data, null);
    const memberSelfPin = await linn
      .from("posts")
      .update({ pinned: true })
      .eq("id", legacy.data!.id)
      .select("id");
    expect("A22. medlem kan ikke feste sitt eget eldre innlegg", memberSelfPin.error !== null, true);
    const modPin = await nadia.rpc("set_post_pinned", { p_post_id: osloPost.id!, p_pinned: true });
    expect("A22. moderator utenfor Oslo kan feste Oslo-innlegget", modPin.data, true);
    const adminUnpin = await lars.rpc("set_post_pinned", { p_post_id: osloPost.id!, p_pinned: false });
    expect("A22. administrator kan løsne", adminUnpin.data, false);
    expect("A22. festingen står som administratoren satte den", (await stored(osloPost.id!)).pinned, false);
  } finally {
    // ── Tidy up ────────────────────────────────────────────────────────
    //
    // Assignments first, so the twin group can be deleted. Posts cascade to
    // their comments and reactions. Announcement fan-out notifications
    // reference no post, so they are removed by their title.
    await admin
      .from("memberships")
      .update({ status: kristofferMembership.status, local_group_id: kristofferMembership.local_group_id })
      .eq("id", kristofferMembership.id);
    await admin.from("memberships").update({ local_group_id: adrianMembership.local_group_id }).eq("id", adrianMembership.id);
    await admin.from("memberships").update({ local_group_id: null }).eq("user_id", await profileId("linn")).eq("community_id", TR);
    if (sameNameGroup) {
      // Every group gets a lokallag chat channel, and a group with a channel
      // cannot be deleted (that protects chat history), so the channel goes first.
      await admin.from("channels").delete().eq("local_group_id", sameNameGroup);
      await admin.from("community_local_groups").delete().eq("id", sameNameGroup);
    }
    for (const id of created) await admin.from("posts").delete().eq("id", id);
    await admin.from("posts").delete().like("body", `${MARK}%`);
    await admin.from("notifications").delete().like("title", `%${MARK}%`);
    await admin.from("memberships").delete().eq("id", inactive.data.id);
  }

  expect("innleggene er tilbake til utgangspunktet", await postCount(), postsBefore);
  const { count: notificationsAfter } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  expect("varslene er tilbake til utgangspunktet", notificationsAfter, notificationsBefore);
  const { count: sofieRows } = await admin
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("user_id", sofieId);
  expect("det midlertidige medlemskapet er borte", sofieRows, 0);
  expect("Kristoffer er tilbake i Oslo, aktiv", JSON.stringify(await membershipOf("kristoffer", TR)), JSON.stringify(kristofferMembership));
  expect("Adrian er tilbake i sitt lokallag", (await membershipOf("adrian", TU)).local_group_id, adrianMembership.local_group_id);
  expect("Linn har fortsatt ikke lokallag", (await membershipOf("linn", TR)).local_group_id, null);
  const { count: twins } = await admin
    .from("community_local_groups")
    .select("*", { count: "exact", head: true })
    .eq("slug", "check-feed-ftr-oslo");
  expect("tvillinggruppen er borte", twins, 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} kontroller passerte`);
  console.log("  staben publiserer; lokallagsinnlegg leses bare av lokallaget og staben");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
