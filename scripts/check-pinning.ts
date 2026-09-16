/**
 * Checks who may pin a post, and that pinning actually orders the feed.
 *
 * `posts.pinned` existed from the first migration and the seed set it, but
 * until now nothing wrote it from the product and nothing read it for
 * ordering. Two things were wrong at once:
 *
 *   the badge lied   — the feed was ordered by created_at alone, so the
 *                      "Festet" post sank as soon as anyone posted.
 *   the column was open — `posts_update` lets an author edit their own post
 *                      and its `with check` never mentioned `pinned`, so an
 *                      ordinary member could pin their own post with one
 *                      PostgREST request. That was verified against the
 *                      pre-fix database, and `medlem kan ikke feste eget
 *                      innlegg` below is the regression test for it.
 *
 * Every case runs as a real signed-in caller — a session minted with
 * `admin.generateLink` and redeemed with `verifyOtp`, then writes through
 * PostgREST under row level security, exactly as the application does. A
 * check that used the service role would bypass the rules it claims to test.
 *
 * Whatever it creates it removes again, and every pin it moves is put back.
 *
 * Run with `npm run check:pinning` against the local stack.
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

async function emailFor(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  const { data: user } = await admin.auth.admin.getUserById(data!.id);
  return user.user!.email!;
}

async function profileId(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  return data!.id;
}

/** The pinned flag as the database actually holds it, service role, no RLS. */
async function pinnedState(postId: string): Promise<boolean> {
  const { data } = await admin.from("posts").select("pinned").eq("id", postId).single();
  return data!.pinned;
}

async function postField<K extends "body" | "edited_at" | "community_id">(
  postId: string,
  field: K,
): Promise<unknown> {
  const { data } = await admin.from("posts").select(field).eq("id", postId).single();
  return (data as Record<string, unknown>)[field];
}

/** Posts this run created, so they can be removed again. */
const created: string[] = [];

async function createPostAs(
  client: SupabaseClient<Database>,
  communityId: string,
  body: string,
): Promise<string> {
  const { data, error } = await client
    .from("posts")
    .insert({ community_id: communityId, body })
    .select("id")
    .single();
  if (error) throw new Error(`kunne ikke opprette innlegg: ${error.message}`);
  created.push(data.id);
  return data.id;
}

/** The feed's own ordering, as lib/data.ts getFeed issues it. */
async function feedOrder(
  client: SupabaseClient<Database>,
  communityId: string,
): Promise<{ id: string; pinned: boolean; created_at: string }[]> {
  const { data } = await client
    .from("posts")
    .select("id, pinned, created_at")
    .eq("community_id", communityId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

const TR = "tryggere-ruspolitikk";
const UTR = "under-the-rug";

async function main() {
  // Roles used below, from the seed:
  //   ingrid  — admin in TR, moderator in Tryggere Ungdom, plain member in UTR
  //   nadia   — moderator in TR
  //   linn    — ordinary member in TR
  //   marte   — admin in UTR
  const [ingrid, nadia, linn, marte] = await Promise.all([
    signIn(await emailFor("ingrid")),
    signIn(await emailFor("nadia")),
    signIn(await emailFor("linn")),
    signIn(await emailFor("marte")),
  ]);

  const seededPin = (await admin
    .from("posts")
    .select("id")
    .eq("community_id", TR)
    .eq("pinned", true)
    .single()).data!.id;

  // ── 1. The column is not writable by an ordinary member ───────────────
  //
  // This is the case that passed before the fix. A member could set pinned on
  // their own post through the plain table API, because posts_update only ever
  // checked authorship.
  const linnPost = await createPostAs(linn, TR, "Sjekk: medlemmets eget innlegg");

  const selfPin = await linn.from("posts").update({ pinned: true }).eq("id", linnPost).select("id");
  expect("medlem kan ikke feste eget innlegg — avvist", selfPin.error !== null, true);
  expect("medlem kan ikke feste eget innlegg — feltet står", await pinnedState(linnPost), false);

  const otherPin = await linn
    .from("posts")
    .update({ pinned: false })
    .eq("id", seededPin)
    .select("id");
  // Not the author, so row level security matches nothing: no error, no rows.
  expect("medlem kan ikke løsne andres innlegg", (otherPin.data ?? []).length, 0);
  expect("medlem kan ikke løsne andres innlegg — feltet står", await pinnedState(seededPin), true);

  const memberRpc = await linn.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: true });
  expect("medlem kan ikke feste via funksjonen", memberRpc.data, null);
  expect("medlem kan ikke feste via funksjonen — feltet står", await pinnedState(linnPost), false);

  const memberUnpinRpc = await linn.rpc("set_post_pinned", {
    p_post_id: seededPin,
    p_pinned: false,
  });
  expect("medlem kan ikke løsne via funksjonen", memberUnpinRpc.data, null);
  expect("medlem kan ikke løsne via funksjonen — feltet står", await pinnedState(seededPin), true);

  // An ordinary member editing their own post must still work, and must not be
  // collateral damage of the new trigger clause.
  const edit = await linn
    .from("posts")
    .update({ body: "Sjekk: medlemmet endrer sitt eget innlegg" })
    .eq("id", linnPost)
    .select("id");
  expect("medlem kan fortsatt endre eget innlegg", (edit.data ?? []).length, 1);

  // ── 2. Staff can pin, on their own posts and other people's ───────────
  const modPin = await nadia.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: true });
  expect("moderator kan feste andres innlegg", modPin.data, true);
  expect("moderator kan feste andres innlegg — lagret", await pinnedState(linnPost), true);

  const adminUnpin = await ingrid.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: false });
  expect("administrator kan løsne", adminUnpin.data, false);
  expect("administrator kan løsne — lagret", await pinnedState(linnPost), false);

  // Pinning is not an edit: it must not stamp edited_at, or every pinned post
  // would start claiming it had been changed.
  const before = await postField(linnPost, "edited_at");
  await nadia.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: true });
  expect("festing markerer ikke innlegget som endret", await postField(linnPost, "edited_at"), before);
  expect("festing endrer ikke teksten", await postField(linnPost, "body"), "Sjekk: medlemmet endrer sitt eget innlegg");

  // Idempotent: pinning an already-pinned post is not an error.
  const again = await nadia.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: true });
  expect("å feste et allerede festet innlegg er greit", again.data, true);

  // ── 3. Ordering ───────────────────────────────────────────────────────
  //
  // linnPost is pinned and is the newest post in TR. To prove the ordering is
  // the pin's doing and not recency, add a newer ordinary post and check the
  // pinned one still leads.
  const newer = await createPostAs(linn, TR, "Sjekk: nyeste vanlige innlegg");
  const order = await feedOrder(ingrid, TR);
  // The seeded announcement is pinned too, so the pinned group holds both it
  // and linnPost; `newer` is the first unpinned row.
  const firstUnpinned = order.find((post) => !post.pinned);

  expect("festet innlegg ligger først", order[0]?.id, linnPost);
  expect("det nyeste vanlige innlegget ligger bak de festede", firstUnpinned?.id, newer);
  expect(
    "og det er faktisk nyere enn innlegget som ligger foran det",
    Date.parse(firstUnpinned!.created_at) > Date.parse(order[0]!.created_at),
    true,
  );

  // Several pins at once: the model is a plain boolean, so this is allowed,
  // and within the pinned group the newest still comes first.
  await nadia.rpc("set_post_pinned", { p_post_id: newer, p_pinned: true });
  const twoPinned = await feedOrder(ingrid, TR);
  expect("to festede innlegg ligger begge foran", twoPinned[0]!.pinned && twoPinned[1]!.pinned, true);
  expect("nyeste festede først", twoPinned[0]?.id, newer);
  expect("ingen ufestede foran et festet", twoPinned.findIndex((p) => !p.pinned) > 1, true);
  await nadia.rpc("set_post_pinned", { p_post_id: newer, p_pinned: false });

  // Unpinning the only pinned post leaves a feed that is simply chronological,
  // with nothing in a broken state.
  await ingrid.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: false });
  await ingrid.rpc("set_post_pinned", { p_post_id: seededPin, p_pinned: false });
  const nonePinned = await feedOrder(ingrid, TR);
  expect("uten festede innlegg står feeden kronologisk", nonePinned.every((p) => !p.pinned), true);
  expect(
    "kronologisk rekkefølge er intakt",
    nonePinned.map((p) => p.created_at).join() ===
      [...nonePinned].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((p) => p.created_at).join(),
    true,
  );
  await ingrid.rpc("set_post_pinned", { p_post_id: seededPin, p_pinned: true });

  // ── 4. Community isolation ────────────────────────────────────────────
  //
  // ingrid administers TR and is an ordinary member of UTR. Her rights do not
  // travel with her.
  const utrPin = (await admin
    .from("posts")
    .select("id")
    .eq("community_id", UTR)
    .eq("pinned", true)
    .single()).data!.id;

  const crossUnpin = await ingrid.rpc("set_post_pinned", { p_post_id: utrPin, p_pinned: false });
  expect("administrator i ett fellesskap kan ikke løsne i et annet", crossUnpin.data, null);
  expect("kryssforsøket endret ingenting", await pinnedState(utrPin), true);

  const crossPin = await nadia.rpc("set_post_pinned", { p_post_id: utrPin, p_pinned: false });
  expect("moderator i ett fellesskap kan ikke røre et annet", crossPin.data, null);

  // And the other way: UTR's admin cannot reach into Tryggere.
  const backwards = await marte.rpc("set_post_pinned", { p_post_id: seededPin, p_pinned: false });
  expect("UTR-administrator kan ikke løsne i Tryggere", backwards.data, null);
  expect("og innlegget står fortsatt festet", await pinnedState(seededPin), true);

  // A post id that does not exist is refused exactly like one the caller may
  // not touch — the refusal cannot be used to probe which ids are real.
  const madeUp = await ingrid.rpc("set_post_pinned", {
    p_post_id: "00000000-0000-0000-0000-000000000000",
    p_pinned: true,
  });
  expect("oppdiktet innleggs-id gir samme svar", madeUp.data, crossUnpin.data);

  // Pinning in one community leaves the other's feed untouched.
  const utrBefore = (await feedOrder(marte, UTR)).map((p) => `${p.id}:${p.pinned}`).join();
  await nadia.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: true });
  const utrAfter = (await feedOrder(marte, UTR)).map((p) => `${p.id}:${p.pinned}`).join();
  expect("festing i Tryggere rører ikke UTR", utrAfter, utrBefore);
  await nadia.rpc("set_post_pinned", { p_post_id: linnPost, p_pinned: false });

  // A UTR member never sees Tryggere rows at all, pinned or not.
  const utrFeedIds = (await feedOrder(marte, TR)).length;
  expect("UTR-administrator ser ingen Tryggere-innlegg", utrFeedIds, 0);

  // ── 5. Identity cannot be forged ──────────────────────────────────────
  const forgedAuthor = await linn
    .from("posts")
    .insert({ community_id: TR, body: "Sjekk: forfalsket forfatter", author_id: await profileId("ingrid") })
    .select("id");
  expect("kan ikke skrive innlegg i andres navn", forgedAuthor.error !== null, true);

  const reassign = await linn
    .from("posts")
    .update({ author_id: await profileId("ingrid") })
    .eq("id", linnPost)
    .select("id");
  expect("kan ikke omskrive forfatteren", reassign.error !== null, true);

  const moveCommunity = await linn
    .from("posts")
    .update({ community_id: UTR })
    .eq("id", linnPost)
    .select("id");
  expect("kan ikke flytte innlegget til et annet fellesskap", moveCommunity.error !== null, true);
  expect("innlegget ligger fortsatt i Tryggere", await postField(linnPost, "community_id"), TR);

  // ── 6. Signed out ─────────────────────────────────────────────────────
  const anon = anonymous();
  const anonRpc = await anon.rpc("set_post_pinned", { p_post_id: seededPin, p_pinned: false });
  expect("utlogget kan ikke kalle funksjonen", anonRpc.error !== null, true);
  expect("utlogget endret ingenting", await pinnedState(seededPin), true);

  // ── 7. Deleting a pinned post ─────────────────────────────────────────
  //
  // Nothing references `pinned` from another table, so the only question is
  // whether the row goes cleanly and the feed is still well-ordered after.
  const doomed = await createPostAs(nadia, TR, "Sjekk: festet innlegg som slettes");
  await nadia.rpc("set_post_pinned", { p_post_id: doomed, p_pinned: true });
  expect("festet før sletting", await pinnedState(doomed), true);

  const removed = await nadia.from("posts").delete().eq("id", doomed).select("id");
  expect("moderator kan slette et festet innlegg", (removed.data ?? []).length, 1);
  const { count: ghost } = await admin
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("id", doomed);
  expect("raden er borte", ghost, 0);

  const afterDelete = await feedOrder(ingrid, TR);
  expect("feeden er fortsatt riktig sortert etter sletting", afterDelete[0]?.id, seededPin);
  expect("og det festede innlegget er fortsatt festet", afterDelete[0]?.pinned, true);

  // ── 8. The service role is still able to maintain data ────────────────
  //
  // The trigger clause polices people, not the seed. An earlier draft policed
  // everyone, which left `npm run seed` and every maintenance script unable to
  // move a pin — and silently, because a refused PostgREST update comes back
  // as an error object that a script has to remember to read.
  const beforeMaintenance = await pinnedState(seededPin);
  const maintenance = await admin.from("posts").update({ pinned: false }).eq("id", seededPin);
  expect("tjenesterollen kan vedlikeholde festemarkeringer", maintenance.error, null);
  expect("og endringen slo gjennom", await pinnedState(seededPin), false);
  await admin.from("posts").update({ pinned: beforeMaintenance }).eq("id", seededPin);
  expect("satt tilbake", await pinnedState(seededPin), beforeMaintenance);

  // ── 9. The application query actually asks for this order ─────────────
  //
  // Everything above proves the database answers correctly when asked for
  // pinned-first. This is what proves the feed asks. Reverting getFeed to
  // created_at alone would leave every check above passing.
  const dataSource = readFileSync("lib/data.ts", "utf8");
  const getFeedBody = dataSource.slice(
    dataSource.indexOf("export async function getFeed("),
    dataSource.indexOf("export async function getAnnouncements("),
  );
  expect(
    "getFeed sorterer festede innlegg først",
    /\.order\(\s*"pinned",\s*\{\s*ascending:\s*false/.test(getFeedBody),
    true,
  );
  expect(
    "getFeed sorterer deretter på tid",
    /\.order\(\s*"created_at",\s*\{\s*ascending:\s*false/.test(getFeedBody),
    true,
  );

  // ── Tidy up ───────────────────────────────────────────────────────────
  for (const id of created) await admin.from("posts").delete().eq("id", id);

  const { count: remaining } = await admin
    .from("posts")
    .select("*", { count: "exact", head: true });
  expect("innleggene er tilbake til utgangspunktet", remaining, 16);

  const { count: stillPinned } = await admin
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("pinned", true);
  expect("og de tre seedede festede innleggene står", stillPinned, 3);

  if (failures > 0) {
    console.error(`\n${failures} av ${checks} kontroller feilet.`);
    process.exit(1);
  }
  console.log(`✓ ${checks} kontroller passerte`);
  console.log("  festing er rollestyrt, fellesskapsavgrenset og sorterer feeden");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
