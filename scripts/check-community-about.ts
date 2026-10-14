/**
 * Checks `set_community_about()`: who may change the "Om fellesskapet" text,
 * what is rejected, and that nothing crosses from one community into another.
 *
 * Run with `npm run check:community-about` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients signed in as fixture accounts, calling exactly what
 * `updateCommunityAboutAction` calls — `set_community_about()` — so a passing
 * run means the *database* refuses, not that the page hides a pencil.
 *
 * It never writes to a real community. The service role creates two
 * disposable communities, gives existing fixture accounts temporary roles
 * there (admin, moderator, member), runs every check against those, and
 * deletes both — memberships and all — at the end. The real communities'
 * About texts, including anything someone has edited in the app, are only
 * read: once before and once after, to prove the run left them alone.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { communityDefinitions } from "@/lib/bootstrap/definition";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

// Two throwaway communities, unique per run. "A" stands where Under The Rug
// stood in the old version of this check, "B" where Tryggere Ruspolitikk did.
const RUN = Date.now().toString(36);
const A = `sjekk-om-a-${RUN}`;
const B = `sjekk-om-b-${RUN}`;
const TEST_COMMUNITIES = [A, B];

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

/** Fixture accounts and the role each gets in the disposable communities. */
const CAST: Record<string, { admin: string; moderator: string; member: string }> = {
  [A]: { admin: "octavio", moderator: "karimoen", member: "linn" },
  [B]: { admin: "miaminge", moderator: "hanne", member: "adrian" },
};

async function createTestCommunities() {
  const template = communityDefinitions[0].community;
  for (const id of TEST_COMMUNITIES) {
    const { error } = await admin.from("communities").insert({
      ...template,
      id,
      slug: id,
      name: `Sjekk ${id}`,
      about: `Utgangstekst for ${id}`,
    });
    if (error) throw new Error(`kunne ikke opprette testfellesskapet ${id}: ${error.message}`);
    for (const [role, handle] of Object.entries(CAST[id])) {
      const { error: membershipError } = await admin.from("memberships").insert({
        user_id: await profileId(handle),
        community_id: id,
        role: role as "admin" | "moderator" | "member",
        status: "active",
      });
      if (membershipError) throw new Error(`kunne ikke gi ${handle} en rolle i ${id}: ${membershipError.message}`);
    }
  }
}

/** Deletes the disposable communities; their memberships go with them. */
async function removeTestCommunities() {
  await admin.from("communities").delete().in("id", TEST_COMMUNITIES);
}

/** The real communities' About texts, read only. */
async function realAbouts(): Promise<string> {
  const ids = communityDefinitions.map((definition) => definition.community.id);
  const { data, error } = await admin.from("communities").select("id, about").in("id", ids).order("id");
  if (error) throw error;
  return JSON.stringify(data);
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
  const realBefore = await realAbouts();

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const admins: [string, string][] = TEST_COMMUNITIES.map((id) => [id, CAST[id].admin]);
  const adminClients = new Map<string, Client>();
  const moderators = new Map<string, Client>();
  const members = new Map<string, Client>();

  try {
    await createTestCommunities();
    for (const [communityId, handle] of admins) {
      adminClients.set(communityId, await signIn(handle));
      moderators.set(communityId, await signIn(CAST[communityId].moderator));
      members.set(communityId, await signIn(CAST[communityId].member));
    }

    // ── 10: the starting text is stored and readable ──
    for (const communityId of TEST_COMMUNITIES) {
      expect(`${communityId}: utgangsteksten er lagret`, await storedAbout(communityId), `Utgangstekst for ${communityId}`);
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
      const client = adminClients.get(A)!;
      const multiline = "  Første linje\n\nAndre linje  ";
      const result = await setAbout(client, A, multiline);
      expect("ledende/etterfølgende mellomrom trimmes", result.stored, "Første linje\n\nAndre linje");
    }

    // ── 7: overlong input is rejected ──
    {
      const client = adminClients.get(A)!;
      const before = await storedAbout(A);
      const tooLong = "x".repeat(1501);
      const result = await setAbout(client, A, tooLong);
      expect("for lang beskrivelse avvises (ingen verdi returnert)", result.stored, null);
      expect("beskrivelsen er uendret etter avvist forsøk", await storedAbout(A), before);
      const exact = "y".repeat(1500);
      const exactResult = await setAbout(client, A, exact);
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
      const otherAdmin = adminClients.get(B)!;
      const before = await storedAbout(A);
      const crossResult = await setAbout(otherAdmin, A, "Forsøk fra en annen admin");
      expect("admin i ett fellesskap kan ikke endre et annet", crossResult.stored, null);
      expect("beskrivelsen i det andre fellesskapet er uendret", await storedAbout(A), before);
    }

    // ── 6: an inactive former admin cannot write ──
    {
      const { data: row, error } = await admin
        .from("memberships")
        .select("id, status")
        .eq("community_id", B)
        .eq("user_id", await profileId(CAST[B].admin))
        .single();
      if (error) throw error;
      const before = await storedAbout(B);
      try {
        await admin.from("memberships").update({ status: "invited" }).eq("id", row.id);
        const result = await setAbout(adminClients.get(B)!, B, "Forsøk fra inaktiv admin");
        expect("inaktiv tidligere admin kan ikke oppdatere beskrivelsen", result.stored, null);
      } finally {
        await admin.from("memberships").update({ status: row.status }).eq("id", row.id);
      }
      expect("beskrivelsen uendret etter inaktivt forsøk", await storedAbout(B), before);
    }

    // ── the table has no other way in ──
    {
      const before = await storedAbout(A);
      const direct = await adminClients
        .get(A)!
        .from("communities")
        .update({ about: "Direkte tabellskriving" })
        .eq("id", A)
        .select();
      expect("direkte oppdatering av tabellen gir ingen rader", (direct.data ?? []).length, 0);
      expect("tabellen uendret etter direkte forsøk", await storedAbout(A), before);
    }
  } finally {
    await removeTestCommunities();
  }

  expect("testfellesskapene er fjernet", ((await admin.from("communities").select("id").in("id", TEST_COMMUNITIES)).data ?? []).length, 0);
  // Never written to; any edit made in the app is still there.
  expect("de ekte fellesskapenes beskrivelser er urørt", await realAbouts(), realBefore);
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
