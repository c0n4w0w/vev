/**
 * Checks what the community Overview's post cards rely on.
 *
 * The Overview renders the same interactive PostCard as the feed, so the
 * write path is shared: comments and reactions are authorised by the post, in
 * the database. This exercises that path as the personas who use it — an
 * ordinary member on the pinned announcement and on a recent post, a custom
 * emoji reaction, and a member and a moderator against a local-group post —
 * and confirms a member outside that group can neither see nor touch it.
 *
 * Run with `npm run check:overview-interaction` against the local stack after
 * `npm run seed`. Service role only looks up fixtures and cleans up.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const TR = "tryggere-ruspolitikk";
let failures = 0;
let checks = 0;
const commentIds: string[] = [];
const reactionIds: string[] = [];

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

async function signIn(handle: string): Promise<{ client: SupabaseClient<Database>; id: string }> {
  const { data: profile, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  const { data: user } = await admin.auth.admin.getUserById(profile.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link!.properties!.hashed_token,
  });
  if (verifyError) throw verifyError;
  return { client, id: profile.id };
}

type Person = Awaited<ReturnType<typeof signIn>>;

async function comment(who: Person, postId: string, body: string) {
  const { data, error } = await who.client.from("comments").insert({ post_id: postId, body }).select("id").maybeSingle();
  if (data) commentIds.push(data.id);
  return { id: data?.id, error };
}

async function react(who: Person, postId: string, choice: { emoji?: string; emoji_id?: string }) {
  const { data, error } = await who.client
    .from("post_reactions")
    .insert({ post_id: postId, user_id: who.id, ...choice })
    .select("id")
    .maybeSingle();
  if (data) reactionIds.push(data.id);
  return { id: data?.id, error };
}

async function main() {
  const kristoffer = await signIn("kristoffer"); // ordinary member, FTR Oslo
  const petter = await signIn("petter"); // ordinary member, FTR Trøndelag
  const ingrid = await signIn("ingrid"); // moderator
  const larsbror = await signIn("larsbror"); // admin

  const { data: posts } = await admin
    .from("posts")
    .select("id, pinned, kind, local_group_id, title")
    .eq("community_id", TR);
  const pinned = posts!.find((post) => post.pinned)!;
  const recent = posts!.find((post) => !post.pinned && !post.local_group_id && post.kind === "post")!;
  const trondelag = posts!.find((post) => post.local_group_id)!;
  const { data: emoji } = await admin.from("community_emojis").select("id").eq("community_id", TR).eq("name", "tryggere").single();

  // What the Overview shows an ordinary member: the pinned card and a recent card.
  const seenByKristoffer = await kristoffer.client.from("posts").select("id").in("id", [pinned.id, recent.id, trondelag.id]);
  const seen = new Set(seenByKristoffer.data?.map((row) => row.id));
  expect("medlem ser festet kunngjøring", seen.has(pinned.id), true);
  expect("medlem ser siste aktivitet", seen.has(recent.id), true);
  expect("medlem utenfor lokallaget ser ikke lokallagsinnlegget", seen.has(trondelag.id), false);

  // Reactions from the Overview cards.
  expect("standardreaksjon på festet innlegg", (await react(kristoffer, pinned.id, { emoji: "👍" })).error?.message ?? "ok", "ok");
  expect("standardreaksjon på nyere innlegg", (await react(kristoffer, recent.id, { emoji: "🎉" })).error?.message ?? "ok", "ok");
  expect("egen emoji på festet innlegg", (await react(kristoffer, pinned.id, { emoji_id: emoji!.id })).error?.message ?? "ok", "ok");
  const aggregate = await kristoffer.client.from("posts").select("reactions").eq("id", pinned.id).single();
  expect(
    "reaksjonene vises på kortet",
    JSON.stringify(aggregate.data?.reactions).includes(kristoffer.id),
    true,
  );
  expect("samme reaksjon to ganger avvises", !!(await react(kristoffer, pinned.id, { emoji: "👍" })).error, true);

  // Comments from the Overview cards.
  const first = await comment(kristoffer, pinned.id, "Overview-sjekk: første kommentar");
  expect("medlem kan kommentere festet innlegg", first.error?.message ?? "ok", "ok");
  expect("medlem kan kommentere nyere innlegg", (await comment(kristoffer, recent.id, "Overview-sjekk: nyere")).error?.message ?? "ok", "ok");
  const readBack = await kristoffer.client.from("comments").select("body").eq("post_id", pinned.id);
  expect("kommentaren blir værende og kan leses", readBack.data?.some((row) => row.body === "Overview-sjekk: første kommentar"), true);
  const count = await kristoffer.client.from("posts").select("comment_count").eq("id", pinned.id).single();
  expect("kommentartallet på kortet øker", Number(count.data?.comment_count) >= 1, true);

  // Local-group post: the group, staff, and nobody else.
  expect("lokallagsmedlem kan kommentere", (await comment(petter, trondelag.id, "Overview-sjekk: lokallag")).error?.message ?? "ok", "ok");
  expect("lokallagsmedlem kan reagere", (await react(petter, trondelag.id, { emoji: "😮" })).error?.message ?? "ok", "ok");
  expect("moderator kan kommentere lokallagsinnlegg", (await comment(ingrid, trondelag.id, "Overview-sjekk: moderator")).error?.message ?? "ok", "ok");
  expect("admin kan reagere på lokallagsinnlegg", (await react(larsbror, trondelag.id, { emoji: "🎉" })).error?.message ?? "ok", "ok");
  expect("medlem utenfor lokallaget kan ikke kommentere", !!(await comment(kristoffer, trondelag.id, "skal avvises")).error, true);
  expect("medlem utenfor lokallaget kan ikke reagere", !!(await react(kristoffer, trondelag.id, { emoji: "👍" })).error, true);
  const hiddenComments = await kristoffer.client.from("comments").select("id").eq("post_id", trondelag.id);
  expect("medlem utenfor lokallaget leser ingen kommentarer der", hiddenComments.data?.length ?? 0, 0);

  // Staff-only publishing is unchanged: a member may not post to the feed.
  const memberPost = await kristoffer.client
    .from("posts")
    .insert({ community_id: TR, body: "skal avvises", kind: "post" })
    .select("id");
  expect("vanlig medlem kan fortsatt ikke publisere", !!memberPost.error || (memberPost.data?.length ?? 0) === 0, true);
  if (memberPost.data?.[0]) await admin.from("posts").delete().eq("id", memberPost.data[0].id);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    if (reactionIds.length) await admin.from("post_reactions").delete().in("id", reactionIds);
    if (commentIds.length) await admin.from("comments").delete().in("id", commentIds);
    if (failures > 0) {
      console.error(`\n${failures} av ${checks} sjekker feilet.`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av Overview-interaksjon passerte`);
  });
