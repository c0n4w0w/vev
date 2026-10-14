/**
 * Checks the "Kom i gang" welcome card's state: one flag per membership,
 * visible only to someone who became an active member after the feature, and
 * dismissible only by that person, for that one community.
 *
 * Run with `npm run check:onboarding` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients calling exactly what the app calls — `my_onboarding_visible()` and
 * `dismiss_my_onboarding()` — so a pass means the *database* refuses. New
 * members are made the real way: an access request approved by that
 * community's own administrator, and an invitation token redeemed by its
 * recipient. The service role only reads state back, constructs one
 * invitation row (as check:access-requests does), and removes everything this
 * run created. No fixture membership, role or community is changed.
 */
import { config } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { onboardingSteps, pickIntroductionChannel } from "@/lib/onboarding";
import { users } from "@/lib/mock/users";
import { demoPersonas } from "@/lib/mock/demo-personas";
import type { Channel, LocalGroup } from "@/lib/types";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

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
type MembershipRow = Database["public"]["Tables"]["memberships"]["Row"];

async function signInEmail(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: data.properties.verification_type as "signup" | "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`ukjent handle ${handle}: ${error.message}`);
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  return signInEmail(data.user!.email!);
}

const visible = async (client: Client, communityId: string) => {
  const { data, error } = await client.rpc("my_onboarding_visible", { p_community_id: communityId });
  return !error && data === true;
};

const dismiss = async (client: Client, communityId: string) => {
  const { data, error } = await client.rpc("dismiss_my_onboarding", { p_community_id: communityId });
  return !error && data === true;
};

async function membership(userId: string, communityId: string): Promise<MembershipRow | null> {
  const { data } = await admin
    .from("memberships")
    .select("*")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .maybeSingle();
  return data;
}

/** Everything about a membership except the welcome card's own column. */
function authorityFields(row: MembershipRow | null) {
  if (!row) return "none";
  const { onboarding_dismissed_at: _ignored, ...rest } = row;
  return JSON.stringify(rest);
}

async function slugOf(id: string) {
  return (await admin.from("communities").select("slug").eq("id", id).single()).data!.slug;
}

const created = { users: [] as string[], emails: [] as string[], invitations: [] as string[] };
const started = new Date().toISOString();

async function newAccount(label: string): Promise<{ id: string; email: string; client: Client }> {
  const email = `check.onboarding.${label}.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  created.emails.push(email);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: `Ny ${label}`, handle: `ny-${label}-${randomUUID().slice(0, 6)}` },
  });
  if (error) throw error;
  created.users.push(data.user!.id);
  // An account that is activated on approval is one that has chosen a
  // password; one that has not gets an invitation instead (the "første gang"
  // case below, and `npm run check:account-security`).
  const client = await signInEmail(email);
  await client.auth.updateUser({ password: `${randomUUID()} passfrase` });
  return { id: data.user!.id, email, client };
}

/** Joins the way a real applicant does: request, then that community's admin approves. */
async function joinByRequest(applicant: { email: string; client: Client }, communityId: string, approver: Client) {
  const asked = await applicant.client.rpc("request_community_access", {
    p_slug: await slugOf(communityId),
    p_email: applicant.email,
    p_display_name: "Ny Person",
  });
  if (asked.data !== true) throw new Error(`forespørsel til ${communityId} feilet: ${asked.error?.message}`);
  const { data: request } = await admin
    .from("access_requests")
    .select("id")
    .eq("community_id", communityId)
    .eq("email", applicant.email)
    .single();
  const approved = await approver.rpc("approve_access_request", { p_request_id: request!.id });
  return { requestId: request!.id, outcome: approved.data?.[0]?.outcome };
}

async function main() {
  const ids = {
    mia: await profileId("miaminge"),
    emma: await profileId("emmamortensen"),
    octavio: await profileId("octavio"),
    eli: await profileId("elironning"),
  };
  const mia = await signIn("miaminge"); // FTR admin
  const emma = await signIn("emmamortensen"); // TU admin
  const octavio = await signIn("octavio"); // UTR admin
  const eli = await signIn("elironning");
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  // ── Existing members: the backfill ──────────────────────────────────────
  // Established memberships are the seeded ones: every fixture account's
  // active membership. Anyone else in the local database — a presenter's
  // disposable account, a QA identity that has not dismissed its card yet —
  // is a genuinely new member, which is exactly who the card is for, however
  // many days ago they joined.
  const fixtureIds = (
    await admin.from("profiles").select("id").in("handle", [...users, ...demoPersonas].map((person) => person.handle))
  ).data!.map((row) => row.id);
  const { count: fixtureActive } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .in("user_id", fixtureIds);
  expect("backfill: fixture-kontoene har aktive medlemskap å sjekke", (fixtureActive ?? 0) > 0, true);
  const { count: establishedVisible } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .in("user_id", fixtureIds)
    .is("onboarding_dismissed_at", null);
  expect("backfill: ingen etablerte medlemskap har synlig velkomst", establishedVisible, 0);

  for (const [name, client, communities] of [
    ["Mia", mia, [FTR, TU]],
    ["Emma", emma, [TU, FTR]],
    ["Octavio", octavio, [UTR]],
    ["Eli", eli, [FTR, TU, UTR]],
  ] as const) {
    for (const communityId of communities) {
      expect(`eksisterende: ${name} ser ikke velkomst i ${communityId}`, await visible(client, communityId), false);
    }
  }

  // The column is private: not even your own row exposes it to a client.
  const leak = await eli.from("memberships").select("onboarding_dismissed_at").limit(1);
  expect("kolonnen kan ikke leses av klienter", leak.error !== null, true);

  // ── A genuinely new TU member ───────────────────────────────────────────
  const nora = await newAccount("nora");
  expect("før medlemskap: ingen velkomst i TU", await visible(nora.client, TU), false);
  expect("før medlemskap: kan ikke avvise i TU", await dismiss(nora.client, TU), false);

  const tuJoin = await joinByRequest(nora, TU, emma);
  expect("TU: godkjent forespørsel aktiverer direkte", tuJoin.outcome, "activated");
  expect("TU: ny aktiv medlem ser velkomst", await visible(nora.client, TU), true);
  expect("TU: ingen velkomst i FTR uten medlemskap", await visible(nora.client, FTR), false);
  expect("TU: ingen velkomst i UTR uten medlemskap", await visible(nora.client, UTR), false);

  // ── Same account joins FTR: a separate welcome ──────────────────────────
  const ftrJoin = await joinByRequest(nora, FTR, mia);
  expect("FTR: godkjent forespørsel aktiverer direkte", ftrJoin.outcome, "activated");
  expect("FTR: egen velkomst", await visible(nora.client, FTR), true);

  // ── Unauthorized dismissal ──────────────────────────────────────────────
  const tuBefore = await membership(nora.id, TU);
  const outsider = await newAccount("utenfor");
  expect("utenforstående kan ikke avvise i TU", await dismiss(outsider.client, TU), false);
  expect("utenforstående kan ikke avvise i FTR", await dismiss(outsider.client, FTR), false);
  const anonDismiss = await anon.rpc("dismiss_my_onboarding", { p_community_id: TU });
  expect("uautentisert får ikke kalle dismiss", anonDismiss.data === true, false);
  const anonVisible = await anon.rpc("my_onboarding_visible", { p_community_id: TU });
  expect("uautentisert får ikke kalle visible", anonVisible.data === true, false);
  // An existing TU member dismissing in TU touches only their own row.
  expect("Emma kan kalle dismiss på sin egen TU-rad", await dismiss(emma, TU), true);
  expect("Emmas kall endret ikke Noras TU-tilstand", await visible(nora.client, TU), true);
  // The function has no argument that names a person.
  const forged = await emma.rpc("dismiss_my_onboarding", {
    p_community_id: TU,
    p_user_id: nora.id,
  } as never);
  expect("dismiss tar ikke imot en bruker-id", forged.error !== null, true);
  expect("Noras TU-rad er urørt", (await membership(nora.id, TU))?.onboarding_dismissed_at, null);

  // No UPDATE path on memberships for clients: not this column, not role.
  await nora.client.from("memberships").update({ onboarding_dismissed_at: new Date().toISOString() } as never).eq("user_id", nora.id);
  await nora.client.from("memberships").update({ role: "admin" }).eq("user_id", nora.id);
  await emma.from("memberships").update({ onboarding_dismissed_at: new Date().toISOString() } as never).eq("user_id", nora.id);
  expect("direkte UPDATE endrer ikke kolonnen", (await membership(nora.id, TU))?.onboarding_dismissed_at, null);
  expect("direkte UPDATE endrer ikke rollen", (await membership(nora.id, TU))?.role, "member");
  expect("medlemskapet er uendret etter forsøkene", authorityFields(await membership(nora.id, TU)), authorityFields(tuBefore));

  // ── Dismissal: own row, one community, persistent, idempotent ──────────
  expect("Nora avviser i TU", await dismiss(nora.client, TU), true);
  expect("TU skjult etter avvisning", await visible(nora.client, TU), false);
  expect("FTR fortsatt synlig (uavhengig)", await visible(nora.client, FTR), true);
  const firstStamp = (await membership(nora.id, TU))?.onboarding_dismissed_at;
  expect("tidspunkt lagret", firstStamp !== null, true);
  expect("gjentatt avvisning er ufarlig", await dismiss(nora.client, TU), true);
  expect("gjentatt avvisning beholder første tidspunkt", (await membership(nora.id, TU))?.onboarding_dismissed_at, firstStamp);
  expect("dismiss endret ingen tilgangsfelt", authorityFields(await membership(nora.id, TU)), authorityFields(tuBefore));

  // A new session (another device) reads the same state.
  const noraElsewhere = await signInEmail(nora.email);
  expect("ny økt: TU forblir skjult", await visible(noraElsewhere, TU), false);
  expect("ny økt: FTR forblir synlig", await visible(noraElsewhere, FTR), true);

  // ── Nothing else resets it ──────────────────────────────────────────────
  await nora.client.rpc("update_my_community_profile", {
    p_community_id: TU,
    p_display_name: "Nora Ny",
    p_bio: "Hei!",
  });
  const { data: tuGroup } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", TU)
    .eq("active", true)
    .limit(1)
    .single();
  const chose = await nora.client.rpc("set_my_local_group", { p_community_id: TU, p_local_group_id: tuGroup!.id });
  expect("valgte lokallag (frivillig, men mulig)", chose.data, true);
  expect("profil- og lokallagsendring nullstiller ikke", await visible(nora.client, TU), false);

  // Replaying the approval re-runs the activation upsert on an active row.
  const replay = await emma.rpc("approve_access_request", { p_request_id: tuJoin.requestId });
  expect("gjentatt godkjenning er fortsatt 'activated'", replay.data?.[0]?.outcome, "activated");
  expect("gjentatt godkjenning nullstiller ikke", await visible(nora.client, TU), false);

  // Inactive and back (the shape check:community-profiles uses).
  await admin.from("memberships").update({ status: "requested" }).eq("user_id", nora.id).eq("community_id", TU);
  expect("inaktiv: ingen velkomst", await visible(nora.client, TU), false);
  expect("inaktiv: kan ikke avvise", await dismiss(nora.client, TU), false);
  await admin.from("memberships").update({ status: "active" }).eq("user_id", nora.id).eq("community_id", TU);
  expect("tilbake etter inaktivitet: fortsatt avvist", await visible(nora.client, TU), false);

  // Rejoining after the membership is gone is a new membership. There is no
  // removal path in the product today; deleting the row is what one would do.
  await admin.from("memberships").delete().eq("user_id", nora.id).eq("community_id", FTR);
  await admin.from("access_requests").delete().eq("email", nora.email).eq("community_id", FTR);
  expect("uten medlemskap: ingen FTR-velkomst", await visible(nora.client, FTR), false);
  const rejoin = await joinByRequest(nora, FTR, mia);
  expect("nytt medlemskap i FTR aktiveres", rejoin.outcome, "activated");
  expect("nytt medlemskap får ny velkomst", await visible(nora.client, FTR), true);
  expect("TU er fortsatt avvist", await visible(nora.client, TU), false);

  // ── The first-time journey: no account until after approval (TU) ────────
  // A stranger asks from the portal without signing in; the admin approves
  // before any account exists, so approval mints an invitation instead of a
  // membership. The account is created afterwards (by the first sign-in link)
  // and the invitation is redeemed with it.
  const firstEmail = `check.onboarding.first.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  created.emails.push(firstEmail);
  const asked = await anon.rpc("request_community_access", {
    p_slug: await slugOf(TU),
    p_email: firstEmail,
    p_display_name: "Første Gang",
  });
  expect("første gang: forespørsel uten konto godtas", asked.data, true);
  const { data: firstRequest } = await admin
    .from("access_requests")
    .select("id")
    .eq("community_id", TU)
    .eq("email", firstEmail)
    .single();
  const minted = await emma.rpc("approve_access_request", { p_request_id: firstRequest!.id });
  expect("første gang: godkjenning uten konto gir invitasjon", minted.data?.[0]?.outcome, "invited");
  const firstToken = minted.data?.[0]?.token;
  expect("første gang: invitasjonen har en lenke", Boolean(firstToken), true);

  const { data: firstUser, error: firstUserError } = await admin.auth.admin.createUser({
    email: firstEmail,
    email_confirm: true,
  });
  if (firstUserError) throw firstUserError;
  created.users.push(firstUser.user!.id);
  const first = await signInEmail(firstEmail);
  expect("første gang: ny konto er ikke medlem før invitasjonen tas i bruk", await visible(first, TU), false);
  // No membership — and so no welcome — before the account has a password.
  const early = await first.rpc("accept_invitation_token", { p_token: firstToken! });
  expect("første gang: uten passord aktiverer ikke invitasjonen", (early.data as { reason: string }[] | null)?.[0]?.reason, "password-required");
  expect("første gang: fortsatt ikke medlem", await visible(first, TU), false);
  await first.auth.updateUser({ password: `${randomUUID()} passfrase` });
  const redeemed = await first.rpc("accept_invitation_token", { p_token: firstToken! });
  expect("første gang: invitasjonen tas i bruk", (redeemed.data as { reason: string }[] | null)?.[0]?.reason, "joined");
  expect("første gang: aktivt TU-medlem", (await membership(firstUser.user!.id, TU))?.status, "active");
  expect("første gang: velkomstkortet vises", await visible(first, TU), true);
  expect(
    "første gang: fellesskapsprofilen bruker navnet fra forespørselen",
    (await admin.from("community_profiles").select("display_name").eq("community_id", TU).eq("user_id", firstUser.user!.id).single()).data?.display_name,
    "Første Gang",
  );
  const reused = await first.rpc("accept_invitation_token", { p_token: firstToken! });
  expect("første gang: lenken kan ikke brukes to ganger", (reused.data as { ok: boolean }[] | null)?.[0]?.ok === true && (reused.data as { reason: string }[])[0].reason === "joined", false);

  // ── Invitation token path (UTR) ─────────────────────────────────────────
  const sol = await newAccount("sol");
  const token = "sjekkonboarding" + randomUUID().replace(/-/g, "");
  const { data: invitation, error: invitationError } = await admin
    .from("invitations")
    .insert({
      community_id: UTR,
      email: sol.email,
      token_hash: createHash("sha256").update(token).digest("hex"),
      request_id: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (invitationError) throw invitationError;
  created.invitations.push(invitation.id);
  const accepted = await sol.client.rpc("accept_invitation_token", { p_token: token });
  expect("UTR: invitasjon tatt i bruk", (accepted.data as { reason: string }[] | null)?.[0]?.reason, "joined");
  expect("UTR: ny medlem via invitasjon ser velkomst", await visible(sol.client, UTR), true);
  expect("UTR: Sol avviser", await dismiss(sol.client, UTR), true);
  expect("UTR: skjult etterpå", await visible(sol.client, UTR), false);

  // ── Destinations ────────────────────────────────────────────────────────
  for (const communityId of [TU, FTR, UTR]) {
    const { data: channelRows } = await admin.from("channels").select("*").eq("community_id", communityId);
    const { data: groupRows } = await admin.from("community_local_groups").select("*").eq("community_id", communityId);
    const channels: Channel[] = (channelRows ?? []).map((row) => ({
      id: row.id,
      communityId: row.community_id,
      groupId: row.group_id ?? undefined,
      sectionId: row.section_id ?? undefined,
      position: row.position,
      archived: row.archived_at ? true : undefined,
      name: row.name,
      purpose: row.purpose,
      readOnly: row.read_only,
      localGroupId: row.local_group_id ?? undefined,
      subgroupId: row.subgroup_id ?? undefined,
    }));
    const localGroups = (groupRows ?? []).map((row) => ({ id: row.id, active: row.active })) as LocalGroup[];
    const steps = onboardingSteps({ communityId, localGroups, channels });
    const byKind = Object.fromEntries(steps.map((step) => [step.kind, step]));

    expect(`${communityId}: profil peker på fellesskapsprofilen`, byKind.profile?.href, `/community/${communityId}/profile/edit`);
    const hasGroups = localGroups.some((group) => group.active);
    expect(
      `${communityId}: lokallag bare når fellesskapet har lokallag`,
      byKind.lokallag?.href ?? "ingen",
      hasGroups ? `/community/${communityId}/lokallag` : "ingen",
    );
    const intro = byKind.introductions as { href: string; channelName: string } | undefined;
    const target = channels.find((channel) => intro?.href === `/community/${communityId}/channel/${channel.id}`);
    expect(`${communityId}: presentasjonskanalen finnes og tilhører fellesskapet`, target?.communityId, communityId);
    expect(`${communityId}: det er #presentasjoner`, target?.name, "presentasjoner");
  }

  // A community with no channels at all — how every community starts. No
  // link to a channel that is not there: a member is sent to the feed, an
  // administrator is offered to create the first channel.
  const bare = onboardingSteps({ communityId: "x", localGroups: [], channels: [] });
  expect("uten lokallag og kanaler: profil og feed", bare.map((step) => step.kind).join(","), "profile,feed");
  expect("uten kanaler: feeden er fellesskapets egen", bare.find((step) => step.kind === "feed")?.href, "/community/x/feed");
  const bareAdmin = onboardingSteps({ communityId: "x", localGroups: [], channels: [], viewerIsAdmin: true });
  expect("uten kanaler, administrator: opprett den første", bareAdmin.map((step) => step.kind).join(","), "profile,createChannel");
  expect("uten kanaler, administrator: til kanalsiden", bareAdmin.find((step) => step.kind === "createChannel")?.href, "/community/x/kanaler?ny=kanal");
  expect("ingen steg peker på en kanal som ikke finnes", [...bare, ...bareAdmin].some((step) => step.href.includes("/channel/")), false);
  const retired = onboardingSteps({
    communityId: "x",
    localGroups: [{ active: false } as LocalGroup],
    channels: [],
  });
  expect("bare nedlagte lokallag: ingen lokallag-lenke", retired.some((step) => step.kind === "lokallag"), false);

  const channel = (over: Partial<Channel>): Channel => ({
    id: randomUUID(),
    communityId: "x",
    position: 0,
    name: "x",
    purpose: "",
    ...over,
  });
  expect(
    "ingen navn antas: uten introduksjonskanal ingen introduksjon",
    pickIntroductionChannel([channel({ name: "kunngjoringer", readOnly: true }), channel({ name: "generelt" })]),
    undefined,
  );
  const firstOpen = onboardingSteps({
    communityId: "x",
    localGroups: [],
    channels: [channel({ name: "beskjeder", readOnly: true }), channel({ id: "x--styret", name: "styret" }), channel({ name: "prat" })],
  });
  expect("ellers første kanal man kan skrive i", firstOpen.map((step) => `${step.kind}:${"channelName" in step ? step.channelName : ""}`).join(","), "profile:,channel:styret");
  expect(
    "arkiverte kanaler foreslås ikke",
    onboardingSteps({ communityId: "x", localGroups: [], channels: [channel({ name: "velkommen", archived: true })] })
      .map((step) => step.kind)
      .join(","),
    "profile,feed",
  );
  expect(
    "gjenkjenner introduksjon fra formålet",
    pickIntroductionChannel([channel({ name: "generelt" }), channel({ name: "hei", purpose: "Ny her? Skriv om deg selv." })])?.name,
    "hei",
  );
  expect(
    "skrivebeskyttet, lokallag- og gruppekanaler brukes ikke",
    pickIntroductionChannel([
      channel({ name: "presentasjoner", readOnly: true }),
      channel({ name: "velkommen", localGroupId: "g" }),
      channel({ name: "introductions", subgroupId: "s" }),
    ]),
    undefined,
  );

  // ── Fixture accounts untouched ──────────────────────────────────────────
  for (const [name, id] of Object.entries(ids)) {
    const { data } = await admin
      .from("memberships")
      .select("community_id, onboarding_dismissed_at")
      .eq("user_id", id)
      .eq("status", "active");
    expect(`${name}: alle medlemskap fortsatt avvist`, (data ?? []).every((row) => row.onboarding_dismissed_at !== null), true);
  }
}

async function cleanup() {
  if (created.invitations.length) await admin.from("invitations").delete().in("id", created.invitations);
  for (const email of created.emails) {
    await admin.from("invitations").delete().eq("email", email);
    await admin.from("access_requests").delete().eq("email", email);
  }
  // Everything this run caused, including the "… ba om tilgang" notices the
  // administrators received — the same rule the other checks clean up by.
  await admin.from("notifications").delete().gte("created_at", started);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} velkomstkontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} velkomstkontroller passerte`);
  });
