/**
 * Checks moderator management through the narrow RPC.
 *
 * Run with `npm run check:role-management` against the local stack after
 * `npm run seed`. Service role only reads fixture ids and restores rows; all
 * permission checks use ordinary anon-key clients.
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
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

let failures = 0;
let checks = 0;

type MembershipSnapshot = Database["public"]["Tables"]["memberships"]["Row"];
const touched = new Map<string, MembershipSnapshot>();

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function emailFor(handle: string): Promise<string> {
  const { data: user, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  return user.user!.email!;
}

async function signIn(handle: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: await emailFor(handle),
  });
  if (error || !data.properties) {
    throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  }

  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

async function membership(userHandle: string, communityId: string): Promise<MembershipSnapshot> {
  const { data, error } = await admin
    .from("memberships")
    .select("*")
    .eq("user_id", await profileId(userHandle))
    .eq("community_id", communityId)
    .single();
  if (error) throw error;
  return data;
}

async function remember(row: MembershipSnapshot) {
  if (!touched.has(row.id)) touched.set(row.id, row);
}

async function restore() {
  for (const row of [...touched.values()].reverse()) {
    await admin
      .from("memberships")
      .update({
        role: row.role,
        status: row.status,
        joined_at: row.joined_at,
        title: row.title,
        invited_by: row.invited_by,
        local_group_id: row.local_group_id,
        accepts_member_dms: row.accepts_member_dms,
      })
      .eq("id", row.id);
  }
}

function unchangedExceptRole(before: MembershipSnapshot, after: MembershipSnapshot) {
  return (
    before.id === after.id &&
    before.user_id === after.user_id &&
    before.community_id === after.community_id &&
    before.status === after.status &&
    before.joined_at === after.joined_at &&
    before.title === after.title &&
    before.invited_by === after.invited_by &&
    before.local_group_id === after.local_group_id &&
    before.accepts_member_dms === after.accepts_member_dms
  );
}

async function main() {
  const anon = anonymous();
  const kristoffer = await signIn("kristoffer");
  const nadia = await signIn("nadia");
  const mia = await signIn("miaminge");

  const kristofferMembership = await membership("kristoffer", TR);
  const nadiaMembership = await membership("nadia", TR);
  const miaMembership = await membership("miaminge", TR);
  const adrianMembership = await membership("adrian", TU);

  await remember(kristofferMembership);
  await remember(nadiaMembership);

  const anonAttempt = await anon.rpc("set_membership_role", {
    p_membership_id: kristofferMembership.id,
    p_role: "moderator",
  });
  expect("anonym kan ikke endre rolle", anonAttempt.error !== null, true);

  const memberAttempt = await kristoffer.rpc("set_membership_role", {
    p_membership_id: nadiaMembership.id,
    p_role: "member",
  });
  expect("medlem kan ikke endre rolle", memberAttempt.data, false);

  const moderatorAttempt = await nadia.rpc("set_membership_role", {
    p_membership_id: kristofferMembership.id,
    p_role: "moderator",
  });
  expect("moderator kan ikke endre rolle", moderatorAttempt.data, false);

  const promote = await mia.rpc("set_membership_role", {
    p_membership_id: kristofferMembership.id,
    p_role: "moderator",
  });
  expect("admin kan gjøre medlem til moderator", promote.data, true);
  const promoted = await membership("kristoffer", TR);
  expect("rollen ble moderator", promoted.role, "moderator");
  expect("bare role ble endret ved promotering", unchangedExceptRole(kristofferMembership, promoted), true);

  const demote = await mia.rpc("set_membership_role", {
    p_membership_id: nadiaMembership.id,
    p_role: "member",
  });
  expect("admin kan gjøre moderator til vanlig medlem", demote.data, true);
  const demoted = await membership("nadia", TR);
  expect("rollen ble medlem", demoted.role, "member");
  expect("bare role ble endret ved demotering", unchangedExceptRole(nadiaMembership, demoted), true);

  const assignAdmin = await mia.rpc("set_membership_role", {
    p_membership_id: kristofferMembership.id,
    p_role: "admin",
  });
  expect("admin kan ikke tildele admin", assignAdmin.data, false);

  const demoteAdmin = await mia.rpc("set_membership_role", {
    p_membership_id: miaMembership.id,
    p_role: "member",
  });
  expect("admin kan ikke demotere admin via moderator-RPC", demoteAdmin.data, false);

  const crossCommunity = await mia.rpc("set_membership_role", {
    p_membership_id: adrianMembership.id,
    p_role: "moderator",
  });
  expect("admin kan ikke endre annet fellesskap", crossCommunity.data, false);

  await remember(adrianMembership);
  await admin.from("memberships").update({ status: "requested" }).eq("id", adrianMembership.id);
  const inactive = await mia.rpc("set_membership_role", {
    p_membership_id: adrianMembership.id,
    p_role: "moderator",
  });
  expect("inaktivt mål kan ikke endres", inactive.data, false);

  const broadUpdate = await kristoffer
    .from("memberships")
    .update({ role: "admin" })
    .eq("id", kristofferMembership.id)
    .select("id");
  expect("ingen bred memberships UPDATE-policy finnes", (broadUpdate.data ?? []).length, 0);

  const { data: allMemberships } = await admin
    .from("memberships")
    .select("community_id, role, status, profiles!memberships_user_id_fkey!inner(handle)");
  const expectedAdmins = new Map([
    [UTR, "octavio"],
    [TR, "miaminge"],
    [TU, "emmamortensen"],
  ]);
  for (const communityId of [UTR, TR, TU]) {
    const admins = (allMemberships as unknown as {
      community_id: string;
      role: string;
      status: string;
      profiles: { handle: string };
    }[]).filter(
      (row) => row.community_id === communityId && row.status === "active" && row.role === "admin",
    );
    expect(`${communityId}: nøyaktig én seedet admin`, admins.length, 1);
    expect(`${communityId}: riktig seedet admin`, admins[0]?.profiles.handle, expectedAdmins.get(communityId));
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} rollekontroller feilet.\n`);
    return;
  }

  console.log(`✓ ${checks} rollekontroller passerte`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await restore();
    if (failures > 0) process.exit(1);
  });
