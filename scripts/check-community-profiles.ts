/**
 * Checks community profiles: one account, a separate display name, bio and
 * photo per community — and that none of it crosses from one community into
 * another, or from anyone's hands into someone else's profile.
 *
 * Run with `npm run check:community-profiles` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients signed in as fixture accounts, calling exactly what the server
 * actions call — `update_my_community_profile()`, Storage, and
 * `set_my_community_avatar()` — so a passing run means the *database*
 * refuses, not that a page hides a button. The service role only reads state
 * back, creates one throwaway account, flips one membership to inactive, and
 * puts everything back as the seed left it.
 *
 * The numbered comments follow the checklist the feature was specified with.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { avatarPng } from "@/lib/mock/community-profiles";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const BUCKET = "member-avatars";

const UTR = "under-the-rug";
const FTR = "tryggere-ruspolitikk";
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
type ProfileRow = Database["public"]["Tables"]["community_profiles"]["Row"];

// ── Clients ─────────────────────────────────────────────────────────────

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`ukjent handle ${handle}: ${error.message}`);
  return data.id;
}

async function signInEmail(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

async function signIn(handle: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  return signInEmail(data.user!.email!);
}

// ── State helpers (service role, reads only unless noted) ───────────────

async function row(communityId: string, userId: string): Promise<ProfileRow | null> {
  const { data } = await admin
    .from("community_profiles")
    .select("*")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

/** What a client can see of one person, across every community. */
async function visibleRows(client: Client, userId: string): Promise<ProfileRow[]> {
  const { data } = await client.from("community_profiles").select("*").eq("user_id", userId);
  return data ?? [];
}

async function update(client: Client, communityId: string, displayName: string, bio: string) {
  const { data, error } = await client.rpc("update_my_community_profile", {
    p_community_id: communityId,
    p_display_name: displayName,
    p_bio: bio,
  });
  return !error && data === true;
}

const avatarPath = (communityId: string, userId: string) =>
  `${communityId}/${userId}/${randomUUID()}.png`;

async function upload(client: Client, path: string) {
  return client.storage
    .from(BUCKET)
    .upload(path, avatarPng([10, 20, 30], [200, 210, 220], 64), { contentType: "image/png", upsert: false });
}

async function swap(client: Client, communityId: string, path: string | null) {
  const { data, error } = await client.rpc("set_my_community_avatar", {
    p_community_id: communityId,
    p_path: path as string,
  });
  return {
    applied: !error && data?.[0]?.applied === true,
    previous: (data?.[0]?.previous_path ?? null) as string | null,
  };
}

async function canDownload(client: Client, path: string): Promise<boolean> {
  const { data, error } = await client.storage.from(BUCKET).download(path);
  return !error && Boolean(data);
}

/**
 * A lower bound for "notifications created from now on". The database stamps
 * created_at with its own clock, which in the local Docker stack can run a few
 * milliseconds behind this process; a small margin keeps a notification made
 * right after this call from falling before it.
 */
function notificationsFromNow(): string {
  return new Date(Date.now() - 2000).toISOString();
}

async function latestNotification(userId: string, kind: "direct_message" | "announcement", since: string) {
  const { data } = await admin
    .from("notifications")
    .select("title, body")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ── Checks ──────────────────────────────────────────────────────────────

const started = new Date().toISOString();
const created = {
  posts: [] as string[],
  messages: [] as string[],
  comments: [] as string[],
  conversations: [] as string[],
  users: [] as string[],
  emails: [] as string[],
};
let snapshot: ProfileRow[] = [];
let snapshotUsers: string[] = [];

/**
 * The app removes a replaced photo right after the swap. The check does the
 * same for files it uploaded itself, but leaves the seed's photos in place so
 * cleanup can point the fixture rows back at them.
 */
async function tidyReplaced(client: Client, path: string | null) {
  if (!path || snapshot.some((original) => original.avatar_path === path)) return;
  await client.storage.from(BUCKET).remove([path]);
}
let inactiveRestore: { userId: string; communityId: string } | undefined;

async function main() {
  const ids = {
    kari: await profileId("karimoen"),
    ingrid: await profileId("ingrid"),
    jonas: await profileId("jonas"),
    amina: await profileId("amina"),
    kristoffer: await profileId("kristoffer"),
    miaminge: await profileId("miaminge"),
    octavio: await profileId("octavio"),
    adrian: await profileId("adrian"),
    eli: await profileId("elironning"),
  };

  snapshotUsers = Object.values(ids);
  snapshot = (await admin.from("community_profiles").select("*").in("user_id", snapshotUsers)).data ?? [];

  const kari = await signIn("karimoen");
  const ingrid = await signIn("ingrid");
  const jonas = await signIn("jonas");
  const amina = await signIn("amina");
  const kristoffer = await signIn("kristoffer");
  const miaminge = await signIn("miaminge");
  const octavio = await signIn("octavio");
  const adrian = await signIn("adrian");
  const eli = await signIn("elironning");
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  // ── Seeded shape: one account, different faces ──
  expect("seed: Kari i FTR", (await row(FTR, ids.kari))?.display_name, "Kari Moen");
  expect("seed: Kari i TU", (await row(TU, ids.kari))?.display_name, "Kari");
  expect("seed: Kari har ingen UTR-profil", await row(UTR, ids.kari), null);
  expect("seed: Ingrid i UTR bruker pseudonym", (await row(UTR, ids.ingrid))?.display_name, "Lavfrekvens");
  // In a fresh seed the two counts are equal: every active membership has a
  // profile and there is no other profile. `expect` prints the membership count
  // as "fikk" and the profile count as "forventet", so name them on failure.
  const activeMembershipCount = (
    await admin.from("memberships").select("id", { count: "exact", head: true }).eq("status", "active")
  ).count;
  const communityProfileCount = (
    await admin.from("community_profiles").select("user_id", { count: "exact", head: true })
  ).count;
  expect("seed: alle aktive medlemskap har en fellesskapsprofil", activeMembershipCount, communityProfileCount);
  if (activeMembershipCount !== communityProfileCount) {
    console.error(
      `    aktive medlemskap:    ${activeMembershipCount}\n    fellesskapsprofiler:  ${communityProfileCount}`,
    );
  }

  // The invariant itself, pair by pair, so a missing profile cannot be hidden
  // by an unrelated extra one. Only this direction: a profile may outlive its
  // membership, because content written under it keeps its author's name.
  const { data: activeMemberships } = await admin
    .from("memberships")
    .select("community_id, user_id")
    .eq("status", "active");
  const { data: communityProfiles } = await admin.from("community_profiles").select("community_id, user_id");
  const profileKeys = new Set((communityProfiles ?? []).map((p) => `${p.community_id}/${p.user_id}`));
  const missingProfiles = (activeMemberships ?? []).filter(
    (m) => !profileKeys.has(`${m.community_id}/${m.user_id}`),
  );
  expect("seed: hvert aktivt medlemskap har en fellesskapsprofil (par for par)", missingProfiles.length, 0);
  for (const m of missingProfiles) {
    console.error(`    mangler fellesskapsprofil: community_id=${m.community_id} user_id=${m.user_id}`);
  }

  // ── 1: a member can read the profiles a community needs ──
  // Open registry (UTR): every active member's UTR profile.
  const { count: utrMembers } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("community_id", UTR)
    .eq("status", "active");
  const { data: jonasSees } = await jonas.from("community_profiles").select("*").eq("community_id", UTR);
  expect("1: UTR-medlem ser alle UTR-profiler (åpen medlemsliste)", (jonasSees ?? []).length, utrMembers);
  // Closed registry (FTR): the author of a post the member can read. Kari's
  // only FTR content is FTR Trøndelag (posts and a hosted event), so a fellow
  // Trøndelag member sees her and an Oslo member does not.
  const petter = await signIn("petter");
  expect(
    "1: FTR-medlem ser FTR-profilen til en som har skrevet et innlegg",
    (await visibleRows(petter, ids.kari)).map((r) => `${r.community_id}:${r.display_name}`).join(","),
    `${FTR}:Kari Moen`,
  );
  expect(
    "1: Oslo-medlem ser ikke profilen til en som bare har skrevet for Trøndelag",
    (await visibleRows(kristoffer, ids.kari)).filter((r) => r.community_id === FTR).length,
    0,
  );
  expect("1: egen profil er alltid synlig", (await visibleRows(eli, ids.eli)).length, 2);

  // ── 2: nothing from another community ──
  const { data: jonasAll } = await jonas.from("community_profiles").select("community_id");
  expect(
    "2: UTR-medlem ser ingen profiler fra FTR eller TU",
    (jonasAll ?? []).filter((r) => r.community_id !== UTR).length,
    0,
  );
  const { data: kristofferAll } = await kristoffer.from("community_profiles").select("community_id");
  expect(
    "2: FTR-medlem ser ingen profiler fra UTR eller TU",
    (kristofferAll ?? []).filter((r) => r.community_id !== FTR).length,
    0,
  );
  expect(
    "2: UTR ser Ingrid bare som pseudonymet",
    (await visibleRows(jonas, ids.ingrid)).map((r) => r.display_name).join(","),
    "Lavfrekvens",
  );
  expect(
    "2: FTR ser aldri UTR-pseudonymet",
    (await visibleRows(kristoffer, ids.ingrid)).some((r) => r.display_name === "Lavfrekvens"),
    false,
  );
  const { data: explicitProbe } = await jonas
    .from("community_profiles")
    .select("*")
    .eq("community_id", FTR)
    .eq("user_id", ids.ingrid);
  expect("2: UTR-medlem kan ikke slå opp Ingrids FTR-profil direkte", (explicitProbe ?? []).length, 0);
  const { data: rpcProbe } = await jonas.rpc("can_view_community_profile", {
    p_community_id: FTR,
    p_user_id: ids.ingrid,
  });
  expect("2: synlighetsfunksjonen svarer nei på tvers av fellesskap", rpcProbe, false);

  // The account row underneath is closed: otherwise it would undo every pseudonym.
  const { data: accountProbe } = await jonas.from("profiles").select("name, email").eq("id", ids.ingrid);
  expect("2: kontoen (navn, e-post) er ikke lesbar for andre", (accountProbe ?? []).length, 0);
  const { data: ownAccount } = await jonas.from("profiles").select("id");
  expect("2: bare egen konto er lesbar", (ownAccount ?? []).map((r) => r.id).join(","), ids.jonas);

  // ── 3, 5, 6, 8: editing, one community at a time ──
  const kariAccountBefore = (await admin.from("profiles").select("*").eq("id", ids.kari).single()).data!;
  expect("3: Kari kan endre sin FTR-profil", await update(kari, FTR, "Kari M. Moen", "Ny FTR-bio."), true);
  expect("3: FTR-navn lagret", (await row(FTR, ids.kari))?.display_name, "Kari M. Moen");
  expect("3: FTR-bio lagret", (await row(FTR, ids.kari))?.bio, "Ny FTR-bio.");
  expect("5: Kari kan bruke et annet navn i TU", await update(kari, TU, "K. (TU)", "TU-bio."), true);
  expect("6: TU-endringen rørte ikke FTR", (await row(FTR, ids.kari))?.display_name, "Kari M. Moen");
  expect("6: FTR-endringen rørte ikke TU", (await row(TU, ids.kari))?.bio, "TU-bio.");
  const kariAccountAfter = (await admin.from("profiles").select("*").eq("id", ids.kari).single()).data!;
  expect("8: kontoprofilen er uendret etter FTR-endring", JSON.stringify(kariAccountAfter), JSON.stringify(kariAccountBefore));

  // Validation, at the boundary a direct caller cannot skip.
  expect("tomt visningsnavn avvises", await update(kari, FTR, "   ", ""), false);
  expect("usynlig visningsnavn avvises", await update(kari, FTR, "​ ", ""), false);
  expect("for langt visningsnavn avvises", await update(kari, FTR, "x".repeat(81), ""), false);
  expect("for lang bio avvises", await update(kari, FTR, "Kari", "x".repeat(501)), false);
  expect("navn trimmes", await update(kari, FTR, "  Kari M. Moen​ ", "Ny FTR-bio."), true);
  expect("trimmet navn lagret", (await row(FTR, ids.kari))?.display_name, "Kari M. Moen");
  expect("ingen profil i et fellesskap man ikke er med i", await update(kari, UTR, "Inntrenger", ""), false);
  expect("ingen UTR-rad opprettet for Kari", await row(UTR, ids.kari), null);

  // ── 4, 11, 12: nobody edits anyone else's profile ──
  const aminaBefore = await row(FTR, ids.amina);
  const direct = await kari.from("community_profiles").update({ display_name: "Kapret" }).eq("user_id", ids.amina);
  expect("4: vanlig tabelloppdatering er ikke tillatt", direct.error !== null, true);
  const directInsert = await kari
    .from("community_profiles")
    .insert({ community_id: FTR, user_id: ids.amina, display_name: "Kapret" });
  expect("4: vanlig tabellinnsetting er ikke tillatt", directInsert.error !== null, true);
  const modAttempt = await amina
    .from("community_profiles")
    .update({ display_name: "Moderert" })
    .eq("community_id", FTR)
    .eq("user_id", ids.kristoffer);
  expect("11: moderator kan ikke endre en annens profil", modAttempt.error !== null, true);
  const adminAttempt = await miaminge
    .from("community_profiles")
    .update({ bio: "Admin skrev dette" })
    .eq("community_id", FTR)
    .eq("user_id", ids.kari);
  expect("12: administrator kan ikke endre en annens profil", adminAttempt.error !== null, true);
  const adminDelete = await miaminge.from("community_profiles").delete().eq("user_id", ids.kari);
  expect("12: administrator kan ikke slette en annens profil", adminDelete.error !== null, true);
  expect("4/11/12: Aminas profil uendret", JSON.stringify(await row(FTR, ids.amina)), JSON.stringify(aminaBefore));
  expect("12: Karis FTR-profil uendret av admin", (await row(FTR, ids.kari))?.bio, "Ny FTR-bio.");

  // A moderator or administrator's photo attempts on someone else.
  const modUpload = await upload(amina, avatarPath(FTR, ids.kristoffer));
  expect("11: moderator kan ikke laste opp i en annens mappe", modUpload.error !== null, true);
  const adminUpload = await upload(miaminge, avatarPath(FTR, ids.kari));
  expect("12: administrator kan ikke laste opp i en annens mappe", adminUpload.error !== null, true);

  // ── 16: storage is scoped to your own folder in communities you are in ──
  const kariFtrPath = avatarPath(FTR, ids.kari);
  expect("16: Kari kan laste opp i egen FTR-mappe", (await upload(kari, kariFtrPath)).error, null);
  expect("16: Kari kan ikke laste opp i UTR (ikke medlem)", (await upload(kari, avatarPath(UTR, ids.kari))).error !== null, true);
  expect("16: Kari kan ikke laste opp i Aminas mappe", (await upload(kari, avatarPath(FTR, ids.amina))).error !== null, true);
  expect("16: feil form avvises (flat sti)", (await upload(kari, `${FTR}/${randomUUID()}.png`)).error !== null, true);
  expect(
    "16: feil form avvises (dypere sti)",
    (await upload(kari, `${FTR}/${ids.kari}/x/${randomUUID()}.png`)).error !== null,
    true,
  );
  expect(
    "16: feil filtype avvises",
    (
      await kari.storage
        .from(BUCKET)
        .upload(`${FTR}/${ids.kari}/${randomUUID()}.svg`, Buffer.from("<svg/>"), { contentType: "image/svg+xml" })
    ).error !== null,
    true,
  );
  expect("16: FTR-fil kan ikke brukes i TU", (await swap(kari, TU, kariFtrPath)).applied, false);
  expect("16: fil som ikke finnes kan ikke brukes", (await swap(kari, FTR, avatarPath(FTR, ids.kari))).applied, false);
  expect("16: en annens fil kan ikke brukes", (await swap(amina, FTR, kariFtrPath)).applied, false);
  const kariFtrOld = (await row(FTR, ids.kari))?.avatar_path ?? null;
  const kariSet = await swap(kari, FTR, kariFtrPath);
  expect("16: Kari kan bruke egen fil i FTR", kariSet.applied, true);
  expect("16: forrige bilde rapporteres", kariSet.previous, kariFtrOld);
  await tidyReplaced(kari, kariSet.previous);
  const aminaDelete = await amina.storage.from(BUCKET).remove([kariFtrPath]);
  expect(
    "16: moderator kan ikke slette Karis bilde",
    (aminaDelete.data ?? []).length === 0 && (await canDownload(kari, kariFtrPath)),
    true,
  );

  // ── 7: a new UTR photo moves nothing in FTR or TU ──
  const ingridBefore = {
    ftr: (await row(FTR, ids.ingrid))?.avatar_path ?? null,
    tu: (await row(TU, ids.ingrid))?.avatar_path ?? null,
    utr: (await row(UTR, ids.ingrid))?.avatar_path ?? null,
  };
  const ingridNew = avatarPath(UTR, ids.ingrid);
  expect("7: Ingrid kan laste opp nytt UTR-bilde", (await upload(ingrid, ingridNew)).error, null);
  const ingridSwap = await swap(ingrid, UTR, ingridNew);
  expect("7: Ingrid bytter UTR-bilde", ingridSwap.applied, true);
  expect("7: FTR-bildet er uendret", (await row(FTR, ids.ingrid))?.avatar_path ?? null, ingridBefore.ftr);
  expect("7: TU-bildet er uendret", (await row(TU, ids.ingrid))?.avatar_path ?? null, ingridBefore.tu);

  // Who may read which photo object.
  expect("UTR-medlem kan lese Ingrids nåværende UTR-bilde", await canDownload(jonas, ingridNew), true);
  expect("FTR-medlem kan ikke lese Ingrids UTR-bilde", await canDownload(kristoffer, ingridNew), false);
  expect("uautentisert kan ikke lese Ingrids UTR-bilde", await canDownload(anon, ingridNew), false);
  if (ingridBefore.utr) {
    expect("et erstattet bilde er ikke lesbart for andre", await canDownload(jonas, ingridBefore.utr), false);
    expect("eieren kan fortsatt lese sitt erstattede bilde", await canDownload(ingrid, ingridBefore.utr), true);
  }

  // ── 17: removing the photo restores the fallback ──
  const cleared = await swap(kari, FTR, null);
  expect("17: Kari kan fjerne FTR-bildet", cleared.applied, true);
  expect("17: FTR-profilen har ikke lenger bilde (initialer vises)", (await row(FTR, ids.kari))?.avatar_path ?? null, null);
  expect("17: navnet er uendret når bildet fjernes", (await row(FTR, ids.kari))?.display_name, "Kari M. Moen");
  expect("17: TU-bildet er uberørt", Boolean((await row(TU, ids.kari))?.avatar_path), true);
  await tidyReplaced(kari, cleared.previous);

  // ── 9: an inactive membership cannot edit ──
  inactiveRestore = { userId: ids.eli, communityId: TU };
  await admin.from("memberships").update({ status: "invited" }).eq("user_id", ids.eli).eq("community_id", TU);
  const eliBefore = await row(TU, ids.eli);
  expect("9: inaktivt medlemskap kan ikke endre navn", await update(eli, TU, "Inaktiv", ""), false);
  expect("9: inaktivt medlemskap kan ikke laste opp bilde", (await upload(eli, avatarPath(TU, ids.eli))).error !== null, true);
  expect("9: inaktivt medlemskap kan ikke sette bilde", (await swap(eli, TU, null)).applied, false);
  expect("9: profilen er uendret", JSON.stringify(await row(TU, ids.eli)), JSON.stringify(eliBefore));
  expect("9: samme person kan fortsatt endre der hun er aktiv", await update(eli, FTR, "Eli R.", ""), true);
  await admin.from("memberships").update({ status: "active" }).eq("user_id", ids.eli).eq("community_id", TU);
  inactiveRestore = undefined;
  expect("9: reaktivering overskriver ikke profilen", JSON.stringify(await row(TU, ids.eli)), JSON.stringify(eliBefore));

  // ── 10: anonymous callers get nothing ──
  const anonRows = await anon.from("community_profiles").select("*");
  expect("10: uautentisert leser ingen profiler", (anonRows.data ?? []).length, 0);
  const anonRpc = await anon.rpc("can_view_community_profile", { p_community_id: UTR, p_user_id: ids.ingrid });
  expect("10: uautentisert kan ikke kalle synlighetsfunksjonen", anonRpc.error !== null, true);
  const anonUpdate = await anon.rpc("update_my_community_profile", {
    p_community_id: UTR,
    p_display_name: "x",
    p_bio: "",
  });
  expect("10: uautentisert kan ikke endre", anonUpdate.data === true, false);

  // ── 13–15: access requests name the profile, per community, once ──
  const email = `check.profile.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  created.emails.push(email);
  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: "Kontonavn Kontroll", handle: `kontroll-${randomUUID().slice(0, 6)}` },
  });
  if (createError) throw createError;
  const newId = createdUser.user!.id;
  created.users.push(newId);
  await admin.from("profiles").update({ bio: "Kontobio som ikke skal følge med." }).eq("id", newId);
  const applicant = await signInEmail(email);

  const slugOf = async (id: string) => (await admin.from("communities").select("slug").eq("id", id).single()).data!.slug;
  const requestId = async (communityId: string) =>
    (await admin.from("access_requests").select("id").eq("community_id", communityId).eq("email", email).single()).data!.id;

  const asked = await applicant.rpc("request_community_access", {
    p_slug: await slugOf(UTR),
    p_email: email,
    p_display_name: "  Night Owl ",
  });
  expect("13: forespørsel til UTR sendt", asked.data, true);
  const utrRequest = await requestId(UTR);
  const approved = await octavio.rpc("approve_access_request", { p_request_id: utrRequest });
  expect("13: UTR-admin godkjenner (aktiveres direkte)", approved.data?.[0]?.outcome, "activated");
  expect("13: UTR-profilen heter det forespørselen sa", (await row(UTR, newId))?.display_name, "Night Owl");
  expect("13: pseudonymet får ikke kontobioen", (await row(UTR, newId))?.bio, "");

  await applicant.rpc("request_community_access", {
    p_slug: await slugOf(FTR),
    p_email: email,
    p_display_name: "Omar Kontroll",
  });
  await miaminge.rpc("approve_access_request", { p_request_id: await requestId(FTR) });
  expect("14: FTR-profilen heter det FTR-forespørselen sa", (await row(FTR, newId))?.display_name, "Omar Kontroll");
  expect("14: FTR-forespørselen overskrev ikke UTR", (await row(UTR, newId))?.display_name, "Night Owl");

  expect("15: søkeren endrer UTR-navnet", await update(applicant, UTR, "Night Owl II", ""), true);
  const replay = await octavio.rpc("approve_access_request", { p_request_id: utrRequest });
  expect("15: gjentatt godkjenning er ufarlig", replay.data?.[0]?.outcome, "activated");
  expect("15: gjentatt godkjenning overskriver ikke profilen", (await row(UTR, newId))?.display_name, "Night Owl II");
  const { count: newRows } = await admin
    .from("community_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", newId);
  expect("15: én profil per fellesskap", newRows, 2);

  // Without a request, the account is the fallback — never another community.
  await admin.from("memberships").insert({ user_id: newId, community_id: TU, role: "member", status: "active" });
  expect("fallback: uten forespørsel brukes kontonavnet", (await row(TU, newId))?.display_name, "Kontonavn Kontroll");
  expect("fallback: aldri et navn fra et annet fellesskap", (await row(TU, newId))?.display_name === "Night Owl II", false);

  const utrAdminNotice = await admin
    .from("notifications")
    .select("title")
    .eq("user_id", ids.octavio)
    .gte("created_at", started)
    .ilike("title", "%ba om tilgang")
    .limit(1)
    .maybeSingle();
  expect("13: administratorvarselet bruker navnet fra forespørselen", utrAdminNotice.data?.title, "Night Owl ba om tilgang");

  // ── Account row: server-written only ──
  const accountOf = async (id: string) =>
    (await admin.from("profiles").select("*").eq("id", id).single()).data!;
  const kariAccount = await accountOf(ids.kari);
  const emailRewrite = await kari.from("profiles").update({ email: "kapret@example.com" }).eq("id", ids.kari).select("id");
  expect("konto 1: kan ikke endre egen e-post direkte", emailRewrite.error !== null || (emailRewrite.data ?? []).length === 0, true);
  const nameRewrite = await kari.from("profiles").update({ name: "Nytt kontonavn", handle: "kapret" }).eq("id", ids.kari).select("id");
  expect("konto 1: kan ikke endre kontonavn eller handle direkte", nameRewrite.error !== null || (nameRewrite.data ?? []).length === 0, true);
  const idRewrite = await kari.from("profiles").update({ id: randomUUID() }).eq("id", ids.kari).select("id");
  expect("konto 1: kan ikke endre id", idRewrite.error !== null || (idRewrite.data ?? []).length === 0, true);
  const upsertRewrite = await kari.from("profiles").upsert({ ...kariAccount, email: "kapret@example.com" });
  expect("konto 1: kan ikke omgå med upsert", upsertRewrite.error !== null, true);
  const otherRewrite = await kari.from("profiles").update({ email: "kapret@example.com" }).eq("id", ids.amina).select("id");
  expect("konto 2: kan ikke endre en annens kontorad", otherRewrite.error !== null || (otherRewrite.data ?? []).length === 0, true);
  const forged = await kari.from("profiles").insert({ id: randomUUID(), name: "x", handle: `x-${randomUUID().slice(0, 6)}`, initials: "X", email: "x@example.com" });
  expect("konto 2: kan ikke opprette kontorader", forged.error !== null, true);
  const deleted = await kari.from("profiles").delete().eq("id", ids.kari).select("id");
  expect("konto 2: kan ikke slette sin egen kontorad", deleted.error !== null || (deleted.data ?? []).length === 0, true);
  const anonAccount = await anon.from("profiles").select("id");
  expect("konto: uautentisert leser ingen kontorader", (anonAccount.data ?? []).length, 0);
  expect("konto 1/2: Karis kontorad er uendret", JSON.stringify(await accountOf(ids.kari)), JSON.stringify(kariAccount));
  expect("konto 2: Aminas e-post er uendret", (await accountOf(ids.amina)).email.includes("kapret"), false);

  // 7: presentation edits in every community leave the account alone.
  const ingridAccount = await accountOf(ids.ingrid);
  expect("konto 7: Ingrid endrer FTR-navn", await update(ingrid, FTR, "Ingrid H.", ""), true);
  expect("konto 7: Ingrid endrer TU-navn", await update(ingrid, TU, "Ingrid T.", ""), true);
  expect("konto 7: Ingrid endrer UTR-navn", await update(ingrid, UTR, "Lavfrekvens II", ""), true);
  const ingridAfter = await accountOf(ids.ingrid);
  expect("konto 7: kontoens e-post er uendret", ingridAfter.email, ingridAccount.email);
  expect("konto 7: kontonavnet er uendret", ingridAfter.name, ingridAccount.name);
  expect("konto 7: kontobioen er uendret", ingridAfter.bio, ingridAccount.bio);
  for (const original of snapshot.filter((r) => r.user_id === ids.ingrid)) {
    await update(ingrid, original.community_id, original.display_name, original.bio);
  }

  // Email follows Auth, and only Auth: a server-side address change reaches the copy.
  const movedEmail = `check.profile.moved.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  const moved = await admin.auth.admin.updateUserById(newId, { email: movedEmail, email_confirm: true });
  expect("e-post: Auth-endring lykkes", moved.error, null);
  expect("e-post: kontoradens e-post følger Auth", (await accountOf(newId)).email, movedEmail);

  // ── 8: request identity is the session's own confirmed address ──
  const other = `check.profile.other.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  created.emails.push(other);
  await applicant.rpc("request_community_access", {
    p_slug: await slugOf(TU),
    p_email: other,
    p_display_name: "Annen adresse",
  });
  const foreign = await admin.from("access_requests").select("user_id").eq("email", other).eq("community_id", TU).single();
  expect("8: forespørsel for en annen adresse bindes ikke til innlogget konto", foreign.data?.user_id ?? null, null);
  expect("8: ingen TU-profil med det navnet", (await row(TU, newId))?.display_name === "Annen adresse", false);

  // ── community_member_accounts: the admin's picker, and nothing more ──
  const accountsFor = async (client: Client, communityId: string) => {
    const { data, error } = await client.rpc("community_member_accounts", { p_community_id: communityId });
    return { rows: data ?? [], error };
  };
  const activeIn = async (communityId: string) =>
    (await admin.from("memberships").select("user_id").eq("community_id", communityId).eq("status", "active")).data!.map((m) => m.user_id).sort();
  const ftrAccounts = await accountsFor(miaminge, FTR);
  expect("admin 4: FTR-admin får kontoene til FTRs aktive medlemmer", ftrAccounts.rows.map((r) => r.user_id).sort().join(","), (await activeIn(FTR)).join(","));
  expect(
    "admin 4: bare feltene koblingsverktøyet trenger",
    [...new Set(ftrAccounts.rows.flatMap((r) => Object.keys(r)))].sort().join(","),
    "email,handle,user_id",
  );
  expect("admin 5: FTR-admin får ingenting fra UTR", (await accountsFor(miaminge, UTR)).rows.length, 0);
  expect("admin 5: FTR-admin får ingenting fra TU", (await accountsFor(miaminge, TU)).rows.length, 0);
  expect("admin 5: UTR-admin får ingenting fra FTR", (await accountsFor(octavio, FTR)).rows.length, 0);
  expect("moderator 3: FTR-moderator får ingen e-poster", (await accountsFor(amina, FTR)).rows.length, 0);
  expect("moderator 3: TU-moderator (Kari) får ingen e-poster", (await accountsFor(kari, TU)).rows.length, 0);
  expect("moderator 3: vanlig medlem får ingen e-poster", (await accountsFor(kristoffer, FTR)).rows.length, 0);
  expect("admin: uautentisert kan ikke kalle funksjonen", (await accountsFor(anon, FTR)).error !== null, true);
  const { data: adminProfiles } = await miaminge.from("profiles").select("id");
  expect("admin: funksjonen åpner ikke profiles-tabellen", (adminProfiles ?? []).map((r) => r.id).join(","), ids.miaminge);

  // ── 20: the member-directory privacy is exactly as before ──
  // The applicant joined FTR above and has not taken part in anything there.
  const silentFtr = newId;
  const { data: kristofferMemberships } = await kristoffer.from("memberships").select("user_id").eq("community_id", FTR);
  expect("20: FTR-medlem ser bare sitt eget medlemskap", (kristofferMemberships ?? []).length, 1);
  const { data: aminaMemberships } = await amina.from("memberships").select("user_id").eq("community_id", FTR);
  expect("20: FTR-moderator ser bare sitt eget medlemskap", (aminaMemberships ?? []).length, 1);
  expect(
    "20: FTR-medlem ser ikke profilen til et medlem som aldri har deltatt",
    (await visibleRows(kristoffer, silentFtr)).length,
    0,
  );
  expect("20: FTR-admin ser profilen (administrerer medlemslisten)", (await visibleRows(miaminge, silentFtr)).length >= 1, true);
  const { count: utrMembersNow } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("community_id", UTR)
    .eq("status", "active");
  const { data: jonasMemberships } = await jonas.from("memberships").select("user_id").eq("community_id", UTR);
  expect("20: UTR-medlem ser fortsatt hele medlemslisten", (jonasMemberships ?? []).length, utrMembersNow);

  // ── 19: post, comment and channel message use that community's persona ──
  // Adrian is only in TU, whose registry is closed. Kari has written nothing
  // there, so he cannot see her yet; once she takes part, he sees exactly her
  // TU persona and nothing else.
  expect("19: før deltakelse ser TU-medlem ikke Kari", (await visibleRows(adrian, ids.kari)).length, 0);
  // A community-wide channel: lokallag channels admit only their own group.
  const { data: tuChannel } = await admin
    .from("channels")
    .select("id")
    .eq("community_id", TU)
    .eq("read_only", false)
    .is("local_group_id", null)
    .order("position", { ascending: true })
    .limit(1)
    .single();
  const tuMessage = await kari.from("messages").insert({ channel_id: tuChannel!.id, body: "Kontroll: kanalmelding" }).select("id").single();
  expect("19: Kari skriver i en TU-kanal", tuMessage.error, null);
  if (tuMessage.data) created.messages.push(tuMessage.data.id);
  expect(
    "19: kanalmelding i TU viser TU-profilen, ingenting annet",
    (await visibleRows(adrian, ids.kari)).map((r) => `${r.community_id}:${r.display_name}`).join(","),
    `${TU}:K. (TU)`,
  );

  const since = notificationsFromNow();
  const tuPost = await kari
    .from("posts")
    .insert({ community_id: TU, body: "Kontroll: kunngjøring", kind: "announcement" })
    .select("id")
    .single();
  expect("19: Kari publiserer en kunngjøring i TU", tuPost.error, null);
  if (tuPost.data) created.posts.push(tuPost.data.id);
  const announcement = await latestNotification(ids.adrian, "announcement", since);
  expect("19: kunngjøringsvarselet navngir TU-profilen", announcement?.body.startsWith("K. (TU) publiserte"), true);
  expect("19: kunngjøringsvarselet nevner ikke kontonavnet", announcement?.body.includes("Kari Moen"), false);

  // A community-wide post: the silent member belongs to no local group or
  // team, and a lokallag or team post is readable only by that group and staff.
  const { data: ftrPost } = await admin
    .from("posts")
    .select("id")
    .eq("community_id", FTR)
    .is("local_group_id", null)
    .is("subgroup_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  const silentClient = applicant;
  const comment = await silentClient.from("comments").insert({ post_id: ftrPost!.id, body: "Kontroll: kommentar" }).select("id").single();
  expect("19: taust FTR-medlem kommenterer", comment.error, null);
  if (comment.data) created.comments.push(comment.data.id);
  expect(
    "19: etter en kommentar ser FTR-medlem kommentatorens FTR-profil",
    (await visibleRows(kristoffer, silentFtr)).map((r) => r.community_id).join(","),
    FTR,
  );

  // ── 18: DMs use the conversation's community persona ──
  const utrConversation = await jonas.rpc("start_direct_conversation", {
    p_community_id: UTR,
    p_recipient_id: ids.ingrid,
  });
  expect("18: UTR-samtale kan startes", utrConversation.error, null);
  if (utrConversation.data) created.conversations.push(utrConversation.data);
  const dmSince = notificationsFromNow();
  await ingrid.from("direct_messages").insert({ conversation_id: utrConversation.data!, body: "Kontroll: DM" });
  const utrDm = await latestNotification(ids.jonas, "direct_message", dmSince);
  expect("18: UTR-DM-varsel bruker UTR-pseudonymet", utrDm?.title, "Ny melding fra Lavfrekvens");
  expect(
    "18: UTR-motparten ser bare pseudonymet",
    (await visibleRows(jonas, ids.ingrid)).map((r) => r.display_name).join(","),
    "Lavfrekvens",
  );

  const tuConversation = await ingrid.rpc("start_direct_conversation", {
    p_community_id: TU,
    p_recipient_id: ids.kari,
  });
  expect("18: TU-samtale kan startes mellom moderatorer", tuConversation.error, null);
  if (tuConversation.data) created.conversations.push(tuConversation.data);
  const tuDmSince = notificationsFromNow();
  await kari.from("direct_messages").insert({ conversation_id: tuConversation.data!, body: "Kontroll: TU-DM" });
  const tuDm = await latestNotification(ids.ingrid, "direct_message", tuDmSince);
  expect("18: TU-DM-varsel bruker Karis TU-profil", tuDm?.title, "Ny melding fra K. (TU)");

}

async function cleanup() {
  if (inactiveRestore) {
    await admin
      .from("memberships")
      .update({ status: "active" })
      .eq("user_id", inactiveRestore.userId)
      .eq("community_id", inactiveRestore.communityId);
  }
  if (created.comments.length) await admin.from("comments").delete().in("id", created.comments);
  if (created.posts.length) await admin.from("posts").delete().in("id", created.posts);
  if (created.messages.length) await admin.from("messages").delete().in("id", created.messages);
  if (created.conversations.length) await admin.from("direct_conversations").delete().in("id", created.conversations);
  await admin.from("notifications").delete().gte("created_at", started);
  for (const email of created.emails) await admin.from("access_requests").delete().eq("email", email);
  for (const id of created.users) {
    for (const community of [UTR, FTR, TU]) {
      const { data } = await admin.storage.from(BUCKET).list(`${community}/${id}`);
      const paths = (data ?? []).map((entry) => `${community}/${id}/${entry.name}`);
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    }
    await admin.auth.admin.deleteUser(id);
  }

  // Put the fixture profiles back exactly as the seed left them — the seed's
  // photos were never deleted — and remove every file this run uploaded.
  if (snapshot.length) {
    const referenced = new Set<string>();
    for (const original of snapshot) {
      if (original.avatar_path) referenced.add(original.avatar_path);
      await admin
        .from("community_profiles")
        .update({ display_name: original.display_name, bio: original.bio, avatar_path: original.avatar_path })
        .eq("community_id", original.community_id)
        .eq("user_id", original.user_id);
    }
    for (const user of snapshotUsers) {
      for (const community of [UTR, FTR, TU]) {
        const { data } = await admin.storage.from(BUCKET).list(`${community}/${user}`);
        const orphans = (data ?? [])
          .map((entry) => `${community}/${user}/${entry.name}`)
          .filter((path) => !referenced.has(path));
        if (orphans.length) await admin.storage.from(BUCKET).remove(orphans);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} profilkontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} profilkontroller passerte`);
  });
