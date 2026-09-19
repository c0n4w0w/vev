/**
 * Checks local-group content scope under real authenticated sessions.
 *
 * This is deliberately about scope, not a new access-control model: members
 * still read parent-community content through the existing post/event policies.
 * The new things to prove are that selected-group filters work, cross-community
 * local_group_id values are refused, null remains valid, and the membership
 * table still has no broad update path.
 *
 * Run with `npm run check:local-content` against the local stack.
 */
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

async function userIdFor(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  return data!.id;
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

const createdPostIds: string[] = [];
const createdEventIds: string[] = [];

async function insertPost(
  client: SupabaseClient<Database>,
  communityId: string,
  localGroupId: string | null,
) {
  const { data, error } = await client
    .from("posts")
    .insert({
      community_id: communityId,
      local_group_id: localGroupId,
      body: "CHECK lokalt innhold",
    })
    .select("id")
    .maybeSingle();
  if (data?.id) createdPostIds.push(data.id);
  return { id: data?.id ?? null, error };
}

async function insertEvent(
  client: SupabaseClient<Database>,
  communityId: string,
  localGroupId: string | null,
) {
  const starts = new Date(Date.now() + 35 * 24 * 3600 * 1000);
  const ends = new Date(starts.getTime() + 2 * 3600 * 1000);
  const { data, error } = await client
    .from("events")
    .insert({
      community_id: communityId,
      local_group_id: localGroupId,
      title: "CHECK lokalt arrangement",
      description: "Opprettet av check:local-content",
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location: "Oslo",
    })
    .select("id")
    .maybeSingle();
  if (data?.id) createdEventIds.push(data.id);
  return { id: data?.id ?? null, error };
}

async function main() {
  const [kari, hanne, robin] = await Promise.all([
    emailFor("karimoen").then(signIn),
    emailFor("hanne").then(signIn),
    emailFor("robinsaether").then(signIn),
  ]);
  const anon = anonymous();
  const kariId = await userIdFor("karimoen");

  const ftrTrondelag = await groupId("tryggere-ruspolitikk", "FTR Trøndelag");
  const tuOslo = await groupId("tryggere-ungdom", "TU Oslo");

  const { data: kariTr } = await kari
    .from("memberships")
    .select("community_id, local_group_id")
    .eq("community_id", "tryggere-ruspolitikk")
    .eq("user_id", kariId)
    .single();
  expect("Kari har FTR Trøndelag valgt", kariTr?.local_group_id, ftrTrondelag);

  const { data: kariTu } = await kari
    .from("memberships")
    .select("community_id, local_group_id")
    .eq("community_id", "tryggere-ungdom")
    .eq("user_id", kariId)
    .single();
  expect("Kari har ikke lokallag i TU", kariTu?.local_group_id ?? null, null);

  const { data: localPosts } = await kari
    .from("posts")
    .select("id, local_group_id")
    .eq("community_id", "tryggere-ruspolitikk")
    .eq("local_group_id", ftrTrondelag);
  expect("FTR Trøndelag har lokale innlegg", (localPosts ?? []).length >= 2, true);
  expect(
    "lokal postspørring returnerer bare valgt gruppe",
    (localPosts ?? []).every((post) => post.local_group_id === ftrTrondelag),
    true,
  );

  const { data: localEvents } = await kari
    .from("events")
    .select("id, local_group_id")
    .eq("community_id", "tryggere-ruspolitikk")
    .eq("local_group_id", ftrTrondelag);
  expect("FTR Trøndelag har lokalt arrangement", (localEvents ?? []).length >= 1, true);

  const ftrPostWithTuGroup = await insertPost(kari, "tryggere-ruspolitikk", tuOslo);
  expect("FTR-innlegg kan ikke bruke TU-lokallag", ftrPostWithTuGroup.error ? "avvist" : "tillatt", "avvist");

  const tuPostWithFtrGroup = await insertPost(hanne, "tryggere-ungdom", ftrTrondelag);
  expect("TU-innlegg kan ikke bruke FTR-lokallag", tuPostWithFtrGroup.error ? "avvist" : "tillatt", "avvist");

  const ftrEventWithTuGroup = await insertEvent(kari, "tryggere-ruspolitikk", tuOslo);
  expect("FTR-arrangement kan ikke bruke TU-lokallag", ftrEventWithTuGroup.error ? "avvist" : "tillatt", "avvist");

  const tuEventWithFtrGroup = await insertEvent(hanne, "tryggere-ungdom", ftrTrondelag);
  expect("TU-arrangement kan ikke bruke FTR-lokallag", tuEventWithFtrGroup.error ? "avvist" : "tillatt", "avvist");

  const nationalPost = await insertPost(kari, "tryggere-ruspolitikk", null);
  expect("community-wide innlegg med null lokallag er gyldig", nationalPost.error?.message ?? "ok", "ok");

  const nationalEvent = await insertEvent(kari, "tryggere-ruspolitikk", null);
  expect("community-wide arrangement med null lokallag er gyldig", nationalEvent.error?.message ?? "ok", "ok");

  const { data: anonPosts } = await anon.from("posts").select("id").eq("local_group_id", ftrTrondelag);
  expect("anonym ser ikke private lokale innlegg", (anonPosts ?? []).length, 0);

  const { data: utrGroups } = await robin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", "under-the-rug");
  expect("UTR har ingen lokallags-UI-data", (utrGroups ?? []).length, 0);

  const { data: utrScopedPosts } = await robin
    .from("posts")
    .select("id")
    .eq("community_id", "under-the-rug")
    .not("local_group_id", "is", null);
  expect("UTR har ikke lokalt skopede innlegg", (utrScopedPosts ?? []).length, 0);

  const roleUpdate = await kari
    .from("memberships")
    .update({ role: "admin" })
    .eq("community_id", "tryggere-ungdom")
    .select("id");
  expect("ingen bred membership update-policy finnes", (roleUpdate.data ?? []).length, 0);

  if (createdPostIds.length > 0) {
    await admin.from("posts").delete().in("id", createdPostIds);
  }
  if (createdEventIds.length > 0) {
    await admin.from("events").delete().in("id", createdEventIds);
  }

  const leftovers = await admin.from("posts").select("id").eq("body", "CHECK lokalt innhold");
  expect("ingen testinnlegg ligger igjen", (leftovers.data ?? []).length, 0);
  const eventLeftovers = await admin.from("events").select("id").like("title", "CHECK lokalt%");
  expect("ingen testarrangementer ligger igjen", (eventLeftovers.data ?? []).length, 0);

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
    process.exit(1);
  }

  console.log(`✓ ${checks} kontroller passerte`);
  console.log("  lokalt innhold, null-scope, kryssfellesskap og membership-RLS");
}

void main();
