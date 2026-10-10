/**
 * Checks the one-email approval flow: the approval email's Supabase sign-in
 * token, the invitation it travels with, and everything they must not do.
 *
 * Run with `npm run check:invitation-link` against the local stack. People are
 * made the real way — a public request, approved by that community's own
 * administrator — and the sign-in token is minted by the exact function the
 * approval action uses (`mintEmailSignInLink`). Redemption is done the way the
 * invitation page's button does it: `verifyOtp({ token_hash })`, then
 * `accept_invitation_token()` on the same session. The service role only
 * reads state back, ages one invitation, and removes everything this run made.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { INVITATION_ACCOUNT_ORIGIN, mintEmailSignInLink } from "@/lib/email-sign-in-link";
import { EMAIL_LOGO, buildInvitationEmail } from "@/lib/email/invitation";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const MAILPIT = process.env.LOCAL_MAIL_CATCHER_URL;

let failures = 0;
let checks = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
const fresh = (): Client => createClient<Database>(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } });

async function signInHandle(handle: string): Promise<Client> {
  const { data: profile } = await admin.from("profiles").select("id").eq("handle", handle).single();
  const { data } = await admin.auth.admin.getUserById(profile!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user!.email! });
  const client = fresh();
  await client.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  return client;
}

const started = new Date().toISOString();
const emails: string[] = [];
const address = (label: string) => {
  const email = `check.link.${label}.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  emails.push(email);
  return email;
};
const slugOf = async (id: string) => (await admin.from("communities").select("slug").eq("id", id).single()).data!.slug;

/** A public request (no session needed), approved by that community's admin. */
async function requestAndApprove(email: string, communityId: string, approver: Client, name = "Ny Person") {
  const asked = await fresh().rpc("request_community_access", {
    p_slug: await slugOf(communityId),
    p_email: email,
    p_display_name: name,
  });
  if (asked.data !== true) throw new Error(`forespørsel feilet: ${asked.error?.message}`);
  const { data: request } = await admin
    .from("access_requests")
    .select("id")
    .eq("community_id", communityId)
    .eq("email", email)
    .eq("status", "pending")
    .single();
  const { data } = await approver.rpc("approve_access_request", { p_request_id: request!.id });
  return data?.[0];
}

const authUser = async (email: string) =>
  (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((user) => user.email === email);
const memberships = async (userId: string) =>
  (await admin.from("memberships").select("community_id, status, role, onboarding_dismissed_at").eq("user_id", userId)).data ?? [];
const accept = async (client: Client, token: string) => {
  const { data } = await client.rpc("accept_invitation_token", { p_token: token });
  return (data as { ok: boolean; reason: string; community_id: string | null }[] | null)?.[0];
};
const visible = async (client: Client, communityId: string) =>
  (await client.rpc("my_onboarding_visible", { p_community_id: communityId })).data === true;

async function main() {
  const emma = await signInHandle("emmamortensen"); // TU admin
  const mia = await signInHandle("miaminge"); // FTR admin
  const octavio = await signInHandle("octavio"); // UTR admin
  const { data: emmaProfile } = await admin.from("profiles").select("id").eq("handle", "emmamortensen").single();

  // ── 1. New address: one email, one click ────────────────────────────────
  const newEmail = address("ny");
  expect("ny: ingen konto før godkjenning", await authUser(newEmail), undefined);
  const approved = await requestAndApprove(newEmail, TU, emma, "Ny Medlem");
  expect("ny: godkjenning uten konto gir invitasjon", approved?.outcome, "invited");
  const invitation = approved!.token!;

  const minted = await mintEmailSignInLink(admin, { email: newEmail, communityId: TU });
  expect("ny: innloggingstoken laget", Boolean(minted?.tokenHash), true);
  expect("ny: kontoen ble opprettet nå", minted?.createdAccount, true);
  const lifetimeHours = (Date.parse(minted!.signInExpiresAt) - Date.now()) / 3_600_000;
  expect("ny: innloggingen varer ~24 t lokalt", lifetimeHours > 23.9 && lifetimeHours <= 24, true);

  const pre = (await authUser(newEmail))!;
  expect("ny: forhåndsopprettet konto er ubekreftet", pre.email_confirmed_at ?? null, null);
  expect("ny: forhåndsopprettet konto er aldri brukt", pre.last_sign_in_at ?? null, null);
  expect("ny: merket som laget av invitasjonsflyten", pre.app_metadata?.ting_account_origin, INVITATION_ACCOUNT_ORIGIN);
  expect("ny: ingen medlemskap før lenken brukes", (await memberships(pre.id)).length, 0);
  // Invisible: a TU admin cannot see the dormant account's profile or any membership.
  expect("ny: TU-admin ser ikke profilen", ((await emma.from("profiles").select("id").eq("id", pre.id)).data ?? []).length, 0);
  expect("ny: TU-admin ser ingen medlemskapsrad", ((await emma.from("memberships").select("id").eq("user_id", pre.id)).data ?? []).length, 0);
  expect("ny: ingen fellesskapsprofil før lenken brukes", ((await admin.from("community_profiles").select("user_id").eq("user_id", pre.id)).data ?? []).length, 0);
  // A second token for the same, still unconfirmed account (a resend, say)
  // reuses it. GoTrue keeps both outstanding until one is used; using either
  // spends the other.
  const sameAgain = await mintEmailSignInLink(admin, { email: newEmail, communityId: TU });
  expect("ny: ny token gjenbruker kontoen", sameAgain?.createdAccount, false);

  // Signed in but invitation not yet accepted: still no access to private content.
  const page = fresh();
  const signedIn = await page.auth.verifyOtp({ type: "email", token_hash: minted!.tokenHash });
  expect("ny: gyldig token gir innlogging", Boolean(signedIn.data?.session), true);
  const sibling = await fresh().auth.verifyOtp({ type: "email", token_hash: sameAgain!.tokenHash });
  expect("ny: den andre utestående tokenen er brukt opp samtidig", Boolean(sibling.data?.session), false);
  expect("ny: innlogget som riktig adresse", signedIn.data?.user?.email, newEmail);
  expect("ny: e-posten er bekreftet ved klikket", Boolean((await authUser(newEmail))?.email_confirmed_at), true);
  expect("ny: innlogget uten invitasjon er ikke medlem", (await page.rpc("is_member", { cid: TU })).data, false);
  expect("ny: ser ingen TU-kanaler før aksept", ((await page.from("channels").select("id").eq("community_id", TU)).data ?? []).length, 0);
  expect("ny: ser ingen TU-innlegg før aksept", ((await page.from("posts").select("id").eq("community_id", TU)).data ?? []).length, 0);
  const replay = await fresh().auth.verifyOtp({ type: "email", token_hash: minted!.tokenHash });
  expect("ny: token kan ikke brukes to ganger", Boolean(replay.data?.session), false);

  const joined = await accept(page, invitation);
  expect("ny: invitasjonen godtas", joined?.reason, "joined");
  expect("ny: aktivt TU-medlem", (await memberships(pre.id)).map((m) => `${m.community_id}:${m.status}:${m.role}`).join(), `${TU}:active:member`);
  expect("ny: velkomstkortet vises", await visible(page, TU), true);
  expect("ny: ser TU-kanaler etter aksept", ((await page.from("channels").select("id").eq("community_id", TU)).data ?? []).length > 0, true);
  const again = await accept(page, invitation);
  expect("ny: invitasjonen kan ikke brukes igjen", again?.ok && again.reason === "joined", false);
  expect("ny: fortsatt nøyaktig ett medlemskap", (await memberships(pre.id)).length, 1);

  // ── 2. Existing account, another community: activated, link only signs in ─
  const tuProfileBefore = (await admin.from("community_profiles").select("display_name, bio").eq("user_id", pre.id).eq("community_id", TU).single()).data;
  await page.rpc("dismiss_my_onboarding", { p_community_id: TU });
  const ftr = await requestAndApprove(newEmail, FTR, mia, "Annet Navn");
  expect("eksisterende: godkjenning aktiverer med en gang", ftr?.outcome, "activated");
  expect("eksisterende: FTR aktiv før e-posten brukes", (await memberships(pre.id)).find((m) => m.community_id === FTR)?.status, "active");
  const existingLink = await mintEmailSignInLink(admin, { email: newEmail, communityId: FTR });
  expect("eksisterende: ingen ny konto", existingLink?.createdAccount, false);
  const usersNamed = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((user) => user.email === newEmail);
  expect("eksisterende: fortsatt én konto for adressen", usersNamed.length, 1);
  const device2 = fresh();
  const entered = await device2.auth.verifyOtp({ type: "email", token_hash: existingLink!.tokenHash });
  expect("eksisterende: lenken logger inn samme konto (annen enhet)", entered.data?.user?.id, pre.id);
  expect("eksisterende: FTR-kortet vises", await visible(device2, FTR), true);
  expect("eksisterende: TU er fortsatt avvist", await visible(device2, TU), false);
  const tuProfileAfter = (await admin.from("community_profiles").select("display_name, bio").eq("user_id", pre.id).eq("community_id", TU).single()).data;
  expect("eksisterende: TU-profilen er uendret", JSON.stringify(tuProfileAfter), JSON.stringify(tuProfileBefore));
  expect(
    "eksisterende: FTR-profilen er sin egen",
    (await admin.from("community_profiles").select("display_name").eq("user_id", pre.id).eq("community_id", FTR).single()).data?.display_name,
    "Annet Navn",
  );
  expect("eksisterende: ingen UTR-medlemskap", (await memberships(pre.id)).some((m) => m.community_id === UTR), false);

  // ── 3. Exact email binding ──────────────────────────────────────────────
  const bEmail = address("b");
  const bApproved = await requestAndApprove(bEmail, TU, emma);
  const cEmail = address("c");
  await requestAndApprove(cEmail, TU, emma);
  const cLink = await mintEmailSignInLink(admin, { email: cEmail, communityId: TU });
  const cClient = fresh();
  await cClient.auth.verifyOtp({ type: "email", token_hash: cLink!.tokenHash });
  const crossed = await accept(cClient, bApproved!.token!);
  expect("binding: annen adresses invitasjon avvises", crossed?.reason, "email-mismatch");
  const cUser = (await authUser(cEmail))!;
  expect("binding: ingen medlemskap for feil konto", (await memberships(cUser.id)).length, 0);

  // ── 4. Wrong account signed in (an established member) ──────────────────
  const wrong = await accept(emma, bApproved!.token!);
  expect("feil konto: Emma kan ikke ta Bs invitasjon", wrong?.reason, "email-mismatch");
  expect("feil konto: Emmas TU-medlemskap uendret", (await memberships(emmaProfile!.id)).find((m) => m.community_id === TU)?.role, "admin");

  // ── 5. Concurrent redemption ────────────────────────────────────────────
  // Two simultaneous verifications of one token: GoTrue may let both through
  // (a race in Supabase itself), but only ever as the token's own account.
  // Membership is TING's to protect, and that stays exactly-once.
  const bLink = await mintEmailSignInLink(admin, { email: bEmail, communityId: TU });
  const tabs = [fresh(), fresh()];
  const verified = await Promise.all(
    tabs.map((tab) => tab.auth.verifyOtp({ type: "email", token_hash: bLink!.tokenHash })),
  );
  const sessions = verified.filter((v) => v.data?.session);
  expect("samtidig: minst én innlogging", sessions.length >= 1, true);
  expect("samtidig: alle innlogginger er samme, riktige konto", sessions.every((v) => v.data.user?.email === bEmail), true);
  const signedTabs = tabs.filter((_, index) => verified[index].data?.session);
  const [a1, a2] = await Promise.all([
    accept(signedTabs[0], bApproved!.token!),
    accept(signedTabs[signedTabs.length - 1], bApproved!.token!),
  ]);
  expect("samtidig: nøyaktig én aksept", [a1, a2].filter((a) => a?.reason === "joined").length, 1);
  expect("samtidig: den andre får 'brukt'", [a1, a2].some((a) => a?.reason === "already-used" || a?.reason === "already-member"), true);
  const bUser = (await authUser(bEmail))!;
  expect("samtidig: ett medlemskap", (await memberships(bUser.id)).length, 1);

  // ── 6. Revoked (resend) and expired invitations ─────────────────────────
  const dEmail = address("d");
  const dApproved = await requestAndApprove(dEmail, TU, emma);
  const dFirstLink = await mintEmailSignInLink(admin, { email: dEmail, communityId: TU });
  const dAccountId = (await authUser(dEmail))!.id;
  const { data: dInvitation } = await admin.from("invitations").select("id").eq("email", dEmail).is("revoked_at", null).single();
  const resent = await emma.rpc("resend_invitation", { p_invitation_id: dInvitation!.id });
  const dNewToken = resent.data?.[0]?.token;
  expect("sendt på nytt: ny invitasjon", Boolean(dNewToken), true);
  const dSecondLink = await mintEmailSignInLink(admin, { email: dEmail, communityId: TU });
  expect("sendt på nytt: kontoen gjenbrukes, ikke slettet", (await authUser(dEmail))?.id, dAccountId);
  expect("sendt på nytt: ingen ny konto", dSecondLink?.createdAccount, false);
  // The old email still holds a usable Supabase token for this unconfirmed
  // account, but its invitation is revoked, and the page checks the
  // invitation before it verifies anything — so the old link signs nobody in.
  const dClient = fresh();
  const dSignedIn = await dClient.auth.verifyOtp({ type: "email", token_hash: dSecondLink!.tokenHash });
  expect("sendt på nytt: ny lenke logger inn", Boolean(dSignedIn.data?.session), true);
  expect("sendt på nytt: gammel token brukt opp av den nye", Boolean((await fresh().auth.verifyOtp({ type: "email", token_hash: dFirstLink!.tokenHash })).data?.session), false);
  expect("tilbakekalt: gammel invitasjon har ingen forhåndsvisning", ((await fresh().rpc("invitation_preview", { p_token: dApproved!.token! })).data ?? []).length, 0);
  expect("tilbakekalt: gammel invitasjon avvises", (await accept(dClient, dApproved!.token!))?.reason, "revoked");
  expect("tilbakekalt: ingen medlemskap", (await memberships(dAccountId)).length, 0);
  await admin.from("invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("email", dEmail).is("revoked_at", null);
  expect("utløpt: ingen forhåndsvisning", ((await fresh().rpc("invitation_preview", { p_token: dNewToken! })).data ?? []).length, 0);
  expect("utløpt: avvises", (await accept(dClient, dNewToken!))?.reason, "expired");
  expect("utløpt: ingen medlemskap", (await memberships(dAccountId)).length, 0);
  // Approved but never redeemed: the account stays dormant and powerless.
  const eEmail = address("aldri");
  await requestAndApprove(eEmail, TU, emma);
  await mintEmailSignInLink(admin, { email: eEmail, communityId: TU });
  const dormant = (await authUser(eEmail))!;
  expect("aldri brukt: kontoen er ubekreftet", dormant.email_confirmed_at ?? null, null);
  expect("aldri brukt: aldri innlogget", dormant.last_sign_in_at ?? null, null);
  expect("aldri brukt: ingen medlemskap", (await memberships(dormant.id)).length, 0);
  expect("aldri brukt: usynlig for TU-admin", ((await emma.from("profiles").select("id").eq("id", dormant.id)).data ?? []).length, 0);

  // ── 7. Existing members untouched ───────────────────────────────────────
  expect("etablert: Emma ser ikke TU-kortet", await visible(emma, TU), false);
  expect("etablert: Mia ser ikke FTR-kortet", await visible(mia, FTR), false);
  expect("etablert: Octavio ser ikke UTR-kortet", await visible(octavio, UTR), false);

  // ── 8. Ordinary passwordless sign-in is unchanged ───────────────────────
  const plainEmail = address("vanlig");
  const otp = await fresh().auth.signInWithOtp({ email: plainEmail });
  expect("vanlig innlogging: lenke sendes uten feil", otp.error, null);
  const plainUser = await authUser(plainEmail);
  expect("vanlig innlogging: ikke merket som invitasjonskonto", plainUser?.app_metadata?.ting_account_origin, undefined);
  expect("vanlig innlogging: ingen medlemskap", (await memberships(plainUser!.id)).length, 0);
  if (MAILPIT) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const found = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${plainEmail}`)}`).then((r) => r.json());
    expect("vanlig innlogging: e-posten kom fram lokalt", (found.messages ?? []).length, 1);
  }

  // ── 9. The email ────────────────────────────────────────────────────────
  const signInUntil = new Date(Date.now() + 86_400_000).toISOString();
  const inviteUntil = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const tuMail = buildInvitationEmail({
    to: "x@example.com", communityName: "Tryggere Ungdom", acceptUrl: "https://example.test/invitasjon/t?innlogging=h",
    kind: "new", signInExpiresAt: signInUntil, invitationExpiresAt: inviteUntil, accent: "#000", locale: "nb",
    origin: "http://localhost:3000",
  });
  expect("e-post: emne", tuMail.subject, "Velkommen til Tryggere Ungdom – tilgangen din er godkjent");
  expect("e-post: øverst", tuMail.text.startsWith("TING\n\nVelkommen til Tryggere Ungdom!"), true);
  const logoTags = tuMail.html.match(/<img\b[^>]*>/g) ?? [];
  expect("e-post: ett bilde, TING-logoen", logoTags.length, 1);
  expect("e-post: offisiell logo, absolutt adresse", logoTags[0]?.includes(`src="http://localhost:3000${EMAIL_LOGO.path}"`), true);
  expect("e-post: logoen vises 170 px bred", logoTags[0]?.includes("width:170px;") && logoTags[0]?.includes('width="170" height="46"'), true);
  expect("e-post: logoens størrelse og alt-tekst", logoTags[0]?.includes(`width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="TING"`), true);
  expect("e-post: ingen tekst-eyebrow lenger", tuMail.html.includes("TING · "), false);
  expect("e-post: brødtekst nevner fellesskapet", tuMail.text.includes("Søknaden din om tilgang til Tryggere Ungdom er godkjent. Du kan nå bli med i fellesskapet vårt på TING."), true);
  expect("e-post: én knapp", (tuMail.html.match(/<a /g) ?? []).length, 1);
  expect("e-post: knapp", tuMail.html.includes("Kom i gang med TING →"), true);
  expect("e-post: begge utløp, på én linje", /Lenken er personlig og gir direkte innlogging frem til .+ kl\. .+\. Invitasjonen er gyldig til .+\./.test(tuMail.text), true);
  expect("e-post: avslutning", tuMail.text.trimEnd().endsWith("Har du ikke bedt om tilgang? Se bort fra denne e-posten."), true);
  expect("e-post: ingen kontoforklaring", /opprettes|ingen konto/.test(tuMail.text), false);
  expect("e-post: ingen TING-forklaring", tuMail.text.includes("egen digital plattform"), false);
  expect("e-post: nevner bare ett fellesskap", /Ruspolitikk|Under The Rug/.test(tuMail.text), false);
  const existingMail = buildInvitationEmail({
    to: "x@example.com", communityName: "Tryggere Ruspolitikk", acceptUrl: "https://example.test/velkommen", kind: "existing",
    signInExpiresAt: signInUntil, accent: "#000", locale: "nb", origin: "http://localhost:3000",
  });
  expect("e-post (eksisterende): sier at tilgangen allerede er aktiv", existingMail.text.includes("allerede aktiv"), true);
  expect("e-post (eksisterende): nevner fellesskapet", existingMail.text.includes("Søknaden din om tilgang til Tryggere Ruspolitikk er godkjent"), true);
  expect("e-post (eksisterende): samme logo", existingMail.html.includes(`src="http://localhost:3000${EMAIL_LOGO.path}"`), true);
  expect("e-post (eksisterende): ingen invitasjonsfrist", existingMail.text.includes("Invitasjonen"), false);
  expect("e-post (eksisterende): direkte innlogging", existingMail.text.includes("gir direkte innlogging frem til"), true);
  const utrMail = buildInvitationEmail({
    to: "x@example.com", communityName: "Under The Rug", acceptUrl: "https://example.test", kind: "new",
    signInExpiresAt: signInUntil, invitationExpiresAt: inviteUntil, accent: "#000", locale: "en",
    origin: "http://localhost:3000",
  });
  expect("e-post (UTR): engelsk", utrMail.subject, "Welcome to Under The Rug – your access has been approved");
  expect("e-post (UTR): brødtekst", utrMail.text.includes("Your request for access to Under The Rug has been approved. You can now join our community on TING."), true);
  expect("e-post (UTR): TING-logoen øverst", utrMail.html.includes(`alt="TING"`) && utrMail.html.includes(EMAIL_LOGO.path), true);
}

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const email of emails) {
    await admin.from("invitations").delete().eq("email", email);
    await admin.from("access_requests").delete().eq("email", email);
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
  }
  await admin.from("notifications").delete().gte("created_at", started);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} lenkekontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} lenkekontroller passerte`);
  });
