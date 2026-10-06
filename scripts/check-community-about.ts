/**
 * Checks `set_community_about()`: who may change the "Om fellesskapet" text,
 * what is rejected, and that nothing crosses from one community into another.
 *
 * Run with `npm run check:community-about` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients signed in as fixture accounts, calling exactly what
 * `updateCommunityAboutAction` calls — `set_community_about()` — so a passing
 * run means the *database* refuses, not that the page hides a pencil. The
 * service role is only used to read state back, flip one membership to
 * inactive, and restore the seeded text afterwards.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { communities } from "@/lib/mock/communities";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

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

async function storedAbout(communityId: string): Promise<string> {
  const { data, error } = await admin.from("communities").select("about").eq("id", communityId).single();
  if (error) throw error;
  return data.about;
}

async function setAbout(client: Client, communityId: string, about: string) {
  const { data, error } = await client.rpc("set_community_about", {
    p_community_id: communityId,
    p_about: about,
  });
  return { stored: data as string | null, error };
}

async function main() {
  const seeded = new Map(communities.map((community) => [community.id, community.about]));

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const admins: [string, string][] = [
    [UTR, "octavio"],
    [TR, "miaminge"],
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

  try {
    // ── 10: seeded descriptions render as the fixture wrote them ──
    for (const [communityId, text] of seeded) {
      expect(`${communityId}: sådd beskrivelse er lagret`, await storedAbout(communityId), text);
    }

    // ── 1, 8, 9: each admin updates their own community, and only their own ──
    const updated = new Map<string, string>();
    for (const [communityId] of admins) {
      const client = adminClients.get(communityId)!;
      const next = `Oppdatert av testen ${communityId} ${Date.now()}`;
      const result = await setAbout(client, communityId, next);
      expect(`${communityId}: admin kan oppdatere beskrivelsen`, result.stored, next);
      expect(`${communityId}: den nye teksten er lagret`, await storedAbout(communityId), next);
      updated.set(communityId, next);
    }
    for (const [communityId] of admins) {
      expect(
        `${communityId}: uendret av at de andre fellesskapene ble oppdatert`,
        await storedAbout(communityId),
        updated.get(communityId),
      );
    }

    // ── whitespace is trimmed, internal line breaks survive ──
    {
      const client = adminClients.get(UTR)!;
      const multiline = "  Første linje\n\nAndre linje  ";
      const result = await setAbout(client, UTR, multiline);
      expect("ledende/etterfølgende mellomrom trimmes", result.stored, "Første linje\n\nAndre linje");
    }

    // ── 7: overlong input is rejected ──
    {
      const client = adminClients.get(UTR)!;
      const before = await storedAbout(UTR);
      const tooLong = "x".repeat(1501);
      const result = await setAbout(client, UTR, tooLong);
      expect("for lang beskrivelse avvises (ingen verdi returnert)", result.stored, null);
      expect("beskrivelsen er uendret etter avvist forsøk", await storedAbout(UTR), before);
      const exact = "y".repeat(1500);
      const exactResult = await setAbout(client, UTR, exact);
      expect("beskrivelse på nøyaktig grensen godtas", exactResult.stored, exact);
    }

    // ── 2, 3, 4, 5, 11: everyone who must not be able to write ──
    for (const [communityId] of admins) {
      const before = await storedAbout(communityId);
      const attempt = "Uautorisert forsøk";

      const moderatorResult = await setAbout(moderators.get(communityId)!, communityId, attempt);
      expect(`${communityId}: moderator kan ikke oppdatere beskrivelsen`, moderatorResult.stored, null);

      const memberResult = await setAbout(members.get(communityId)!, communityId, attempt);
      expect(`${communityId}: medlem kan ikke oppdatere beskrivelsen`, memberResult.stored, null);

      const anonResult = await setAbout(anon, communityId, attempt);
      expect(`${communityId}: uautentisert kan ikke oppdatere beskrivelsen`, anonResult.stored, null);

      expect(`${communityId}: beskrivelsen uendret etter uautoriserte forsøk`, await storedAbout(communityId), before);
    }

    // ── 4: an admin of a different community cannot write here ──
    {
      const miaminge = adminClients.get(TR)!;
      const before = await storedAbout(UTR);
      const crossResult = await setAbout(miaminge, UTR, "Forsøk fra en annen admin");
      expect("admin i ett fellesskap kan ikke endre et annet", crossResult.stored, null);
      expect("beskrivelsen i det andre fellesskapet er uendret", await storedAbout(UTR), before);
    }

    // ── 6: an inactive former admin cannot write ──
    {
      const { data: row, error } = await admin
        .from("memberships")
        .select("id, status")
        .eq("community_id", TR)
        .eq("user_id", await profileId("miaminge"))
        .single();
      if (error) throw error;
      const before = await storedAbout(TR);
      try {
        await admin.from("memberships").update({ status: "invited" }).eq("id", row.id);
        const result = await setAbout(adminClients.get(TR)!, TR, "Forsøk fra inaktiv admin");
        expect("inaktiv tidligere admin kan ikke oppdatere beskrivelsen", result.stored, null);
      } finally {
        await admin.from("memberships").update({ status: row.status }).eq("id", row.id);
      }
      expect("beskrivelsen uendret etter inaktivt forsøk", await storedAbout(TR), before);
    }

    // ── the table has no other way in ──
    {
      const before = await storedAbout(UTR);
      const direct = await adminClients
        .get(UTR)!
        .from("communities")
        .update({ about: "Direkte tabellskriving" })
        .eq("id", UTR)
        .select();
      expect("direkte oppdatering av tabellen gir ingen rader", (direct.data ?? []).length, 0);
      expect("tabellen uendret etter direkte forsøk", await storedAbout(UTR), before);
    }
  } finally {
    // Restore exactly what the seed wrote, whatever the tests above did.
    for (const [communityId, text] of seeded) {
      await admin.from("communities").update({ about: text }).eq("id", communityId);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av "om fellesskapet" passerte`);
  });
