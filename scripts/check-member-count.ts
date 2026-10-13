/**
 * Checks who is told how many members a community has, and that the number
 * is the true one.
 *
 * The count is not stored anywhere (20261027100000): lib/member-count.ts
 * counts the active memberships a caller can read, and only for a caller who
 * may list the membership at all. This runs that exact function as real
 * signed-in people, and goes behind it to see that the API has no other way
 * to the number — not for a visitor, an ordinary member of a community with a
 * closed member list, a moderator, or an administrator of somewhere else.
 *
 * Run with `npm run check:member-count` against the local stack after
 * `npm run seed`. Adds one membership for the account that has none, and
 * removes it again.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { countActiveMembers } from "@/lib/member-count";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk"; // member list: administrators only
const TU = "tryggere-ungdom"; // member list: administrators only
const UTR = "under-the-rug"; // member list: open to members

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;

function anonymous(): Client {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = anonymous();
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw verifyError;
  return client;
}

/** The truth, read with the server's key. */
async function actual(communityId: string): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("community_id", communityId)
    .eq("status", "active");
  if (error || count === null) throw error ?? new Error("ingen telling");
  return count;
}

/** What a caller gets by counting the rows themselves, ignoring the app. */
async function rowsReadable(client: Client, communityId: string): Promise<string> {
  // Not a HEAD request: a refusal there has no body, and so no code to show.
  const { count, error } = await client
    .from("memberships")
    .select("id", { count: "exact" })
    .eq("community_id", communityId)
    .range(0, 0);
  return error ? (error.code ?? "feil") : String(count);
}

let addedFor: string | undefined;

async function main() {
  const [ftr, tu, utr] = await Promise.all([actual(FTR), actual(TU), actual(UTR)]);
  expect("fixturen har medlemmer å telle", ftr > 2 && tu > 2 && utr > 2, true);

  // ── Nothing stores the number, and the portal does not say it ──────────
  const stored = await (admin as unknown as SupabaseClient).from("communities").select("member_count").limit(1);
  expect("communities har ingen lagret telling", stored.error?.code, "42703");

  const visitor = anonymous();
  const portal = await visitor.rpc("portal_by_slug", { p_slug: FTR });
  const portalRow = (portal.data ?? [])[0] as Record<string, unknown> | undefined;
  expect("portalen svarer en besøkende", Boolean(portalRow?.name), true);
  expect("portalen sier ingenting om antall medlemmer", Object.keys(portalRow ?? {}).filter((key) => /member|count|medlem/i.test(key)).join(","), "");
  expect("en besøkende får ikke noe tall", await countActiveMembers(visitor, FTR), null);
  expect("en besøkende kan ikke lese medlemskap", await rowsReadable(visitor, FTR), "42501");
  expect(
    "en besøkende kan ikke spørre om lokallagstall",
    (await visitor.rpc("local_group_member_counts", { p_community_id: FTR })).error?.code,
    "42501",
  );

  // ── A closed member list: the administrator, and nobody else ───────────
  const mia = await signIn("miaminge"); // FTR admin
  const amina = await signIn("amina"); // FTR moderator
  const linn = await signIn("linn"); // FTR member
  const emma = await signIn("emmamortensen"); // TU admin
  const jonas = await signIn("jonas"); // UTR member
  const sofie = await signIn("sofie"); // no membership

  expect("FTR: administratoren får det sanne tallet", await countActiveMembers(mia, FTR), ftr);
  expect("FTR: en moderator får ikke noe tall", await countActiveMembers(amina, FTR), null);
  expect("FTR: et medlem får ikke noe tall", await countActiveMembers(linn, FTR), null);
  // Behind the function: all either of them can read is their own row.
  expect("FTR: en moderator leser bare sitt eget medlemskap", await rowsReadable(amina, FTR), 1);
  expect("FTR: et medlem leser bare sitt eget medlemskap", await rowsReadable(linn, FTR), 1);
  expect("TU: administratoren får det sanne tallet", await countActiveMembers(emma, TU), tu);

  // ── Never across communities ───────────────────────────────────────────
  expect("TUs administrator får ikke FTRs tall", await countActiveMembers(emma, FTR), null);
  expect("TUs administrator leser ingen medlemskap i FTR", await rowsReadable(emma, FTR), 0);
  expect("FTRs administrator får ikke UTRs tall", await countActiveMembers(mia, UTR), null);
  expect("et UTR-medlem får ikke FTRs tall", await countActiveMembers(jonas, FTR), null);
  expect("et UTR-medlem leser ingen medlemskap i FTR", await rowsReadable(jonas, FTR), 0);
  for (const community of [FTR, TU, UTR]) {
    expect(`en konto uten medlemskap får ikke noe tall for ${community}`, await countActiveMembers(sofie, community), null);
    expect(`… og leser ingen medlemskap i ${community}`, await rowsReadable(sofie, community), 0);
  }

  // ── An open member list: every member, the same true number ────────────
  expect("UTR: et medlem får det sanne tallet", await countActiveMembers(jonas, UTR), utr);
  expect("UTR: administratoren får det samme", await countActiveMembers(await signIn("octavio"), UTR), utr);

  // ── Lokallag counts are who they were for (20261019100000) ─────────────
  const forAdmin = await mia.rpc("local_group_member_counts", { p_community_id: FTR });
  const forMember = await linn.rpc("local_group_member_counts", { p_community_id: FTR });
  const forModerator = await amina.rpc("local_group_member_counts", { p_community_id: FTR });
  expect("lokallag: administratoren ser tall", (forAdmin.data ?? []).length > 0, true);
  expect("lokallag: et medlem ser ingen", (forMember.data ?? []).length, 0);
  expect("lokallag: en moderator ser ingen", (forModerator.data ?? []).length, 0);

  // ── The number follows the memberships, with nothing to update ─────────
  const sofieId = await profileId("sofie");
  addedFor = sofieId;
  const invited = await admin.from("memberships").insert({ user_id: sofieId, community_id: FTR, role: "member", status: "invited" });
  if (invited.error) throw invited.error;
  expect("en invitert som ikke har takket ja, telles ikke", await countActiveMembers(mia, FTR), ftr);
  expect("… og får selv ikke noe tall", await countActiveMembers(sofie, FTR), null);

  const activated = await admin.from("memberships").update({ status: "active" }).eq("user_id", sofieId).eq("community_id", FTR);
  if (activated.error) throw activated.error;
  expect("et nytt aktivt medlem telles med det samme", await countActiveMembers(mia, FTR), ftr + 1);
  expect("… uten selv å få se tallet", await countActiveMembers(sofie, FTR), null);
  expect("… og uten at et annet fellesskaps tall rører seg", await countActiveMembers(emma, TU), tu);

  await cleanUp();
  expect("når medlemskapet er borte, er tallet tilbake", await countActiveMembers(mia, FTR), ftr);
}

async function cleanUp() {
  if (!addedFor) return;
  await admin.from("memberships").delete().eq("user_id", addedFor).eq("community_id", FTR);
  // The membership made a community profile (memberships_ensure_community_profile).
  await admin.from("community_profiles").delete().eq("user_id", addedFor).eq("community_id", FTR);
  addedFor = undefined;
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanUp();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} medlemstall-kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} medlemstall-kontroller passerte`);
  });
