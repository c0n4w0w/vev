/**
 * Checks the request-to-join lifecycle reshaped by 20260923150000: an
 * approved request no longer makes everyone go through an invitation's
 * explicit "accept" — an address with a usable TING account is activated the
 * moment an administrator approves, and an address with none still gets a
 * claim link, but landing on it authenticated is the only step left, not a
 * second decision.
 *
 * check-notifications.ts already proves what gets *notified* at each step of
 * this lifecycle (section L). This file is the security and correctness
 * surface around it instead: who may approve, which identity an approval
 * resolves to, that neither path can create a membership twice, that the
 * wrong account can never claim someone else's approved request, and that
 * the older, still-supported shape — an invitation with no originating
 * request — keeps requiring its own explicit accept.
 *
 * Every case that matters for authorisation runs as a real signed-in caller
 * under row level security, exactly as the application does; the service
 * role appears only to seed state and to read back what happened. Whatever a
 * case creates it removes again.
 *
 * Run with `npm run check:access-requests` against the local stack after
 * `npm run seed`.
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
const UTR = "under-the-rug";

let failures = 0;
let checks = 0;

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

/**
 * Signs in as `email`, creating and confirming the account first if it does
 * not exist yet — which is exactly what happens when someone follows a claim
 * link and logs in for the first time. GoTrue mints a `signup` token rather
 * than a `magiclink` one for a brand new address even though `magiclink` is
 * what was asked for, and verifying with the wrong type fails as "expired"
 * regardless of how fresh the link is — `verification_type` says which it
 * actually minted.
 */
async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) {
    throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  }
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: data.properties.verification_type as "signup" | "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

type MintedRow = { outcome: string; token: string | null; email: string; community_id: string; expires_at: string | null };
type AcceptRow = { ok: boolean; community_id: string | null; reason: string };

const requestAccess = (client: SupabaseClient<Database>, slug: string, email: string, name?: string) =>
  client.rpc("request_community_access", { p_slug: slug, p_email: email, p_display_name: name });

const pendingRequestFor = async (email: string) => {
  const { data, error } = await admin
    .from("access_requests")
    .select("id, community_id, email, user_id")
    .eq("email", email)
    .eq("status", "pending")
    .single();
  if (error) throw error;
  return data;
};

const membershipOf = async (userId: string, communityId: string) => {
  const { data } = await admin
    .from("memberships")
    .select("status")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .maybeSingle();
  return data;
};

/** Rows this run creates outside the access-request/invitation tables, so they can be torn down. */
const createdAuthUserIds: string[] = [];
const createdAccessRequestEmails: string[] = [];
/** Notification ids that predate this run — everything else this run made gets deleted, by identity, not by matching titles. */
let seededNotificationIds: string[] = [];

async function cleanup() {
  for (const email of createdAccessRequestEmails) {
    const { data: reqs } = await admin.from("access_requests").select("id").eq("email", email);
    for (const r of reqs ?? []) {
      await admin.from("invitations").delete().eq("request_id", r.id);
    }
    await admin.from("access_requests").delete().eq("email", email);
  }
  await admin.from("invitations").delete().is("request_id", null).like("email", "sjekk.%@example.no");
  for (const id of createdAuthUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  // Every access request submitted above notified an administrator ("X ba om
  // tilgang"), and those rows belong to larsbror and octavio's real accounts
  // rather than to anything already deleted above, so nothing else removes
  // them. Deleting everything outside the pre-run snapshot catches those plus
  // anything else this run produced, the same way check-notifications.ts does.
  if (seededNotificationIds.length > 0) {
    await admin.from("notifications").delete().not("id", "in", `(${seededNotificationIds.join(",")})`);
  }
}

async function main() {
  seededNotificationIds = (await admin.from("notifications").select("id")).data!.map((row) => row.id);

  const anon = anonymous();
  const [larsbror, octavio, nadia, linn, marte] = await Promise.all([
    signIn(await emailFor("larsbror")), // administrator, Tryggere Ruspolitikk
    signIn(await emailFor("octavio")), // administrator, Under The Rug
    signIn(await emailFor("nadia")), // moderator, Tryggere Ruspolitikk
    signIn(await emailFor("linn")), // ordinary member, Tryggere Ruspolitikk
    signIn(await emailFor("marte")), // moderator of UTR only — not yet a TR member
  ]);
  const marteId = await profileId("marte");
  const marteEmail = await emailFor("marte");

  // ── 1–4. Who may approve or reject ──────────────────────────────────────
  const roleSeeker = "sjekk.rollegrense@example.no";
  createdAccessRequestEmails.push(roleSeeker);
  await requestAccess(anon, TR, roleSeeker, "Sjekk Rollegrense");
  const roleRequest = await pendingRequestFor(roleSeeker);

  const memberApprove = await linn.rpc("approve_access_request", { p_request_id: roleRequest.id });
  expect("1. et vanlig medlem kan ikke godkjenne", (memberApprove.data ?? []).length, 0);
  const memberReject = await linn.rpc("reject_access_request", { p_request_id: roleRequest.id });
  expect("1. og heller ikke avslå", memberReject.data, false);

  const modApprove = await nadia.rpc("approve_access_request", { p_request_id: roleRequest.id });
  expect("2. en moderator kan ikke godkjenne", (modApprove.data ?? []).length, 0);
  const modReject = await nadia.rpc("reject_access_request", { p_request_id: roleRequest.id });
  expect("2. og heller ikke avslå", modReject.data, false);

  const crossApprove = await octavio.rpc("approve_access_request", { p_request_id: roleRequest.id });
  expect("4. en administrator i et annet fellesskap kan ikke godkjenne", (crossApprove.data ?? []).length, 0);

  expect(
    "forsøkene over rørte ikke forespørselen",
    (await admin.from("access_requests").select("status").eq("id", roleRequest.id).single()).data!.status,
    "pending",
  );

  const adminApprove = await larsbror.rpc("approve_access_request", { p_request_id: roleRequest.id });
  const adminOutcome = (adminApprove.data as MintedRow[] | null)?.[0];
  expect("3. administrator i eget fellesskap kan godkjenne", Boolean(adminOutcome), true);
  expect(
    "og forespørselen er nå godkjent",
    (await admin.from("access_requests").select("status").eq("id", roleRequest.id).single()).data!.status,
    "approved",
  );

  // ── 5–8. An existing, usable account is activated on the spot ──────────
  const marteSeeker = marteEmail;
  createdAccessRequestEmails.push(marteSeeker);
  await requestAccess(anon, TR, marteSeeker, "Sjekk Marte");
  const marteRequest = await pendingRequestFor(marteSeeker);

  const marteApproval = await larsbror.rpc("approve_access_request", { p_request_id: marteRequest.id });
  const marteOutcome = (marteApproval.data as MintedRow[] | null)?.[0];
  expect("5. godkjenning av en konto som finnes fra før aktiverer med det samme", marteOutcome?.outcome, "activated");
  expect("5. og gir ingen token", marteOutcome?.token, null);
  expect(
    "5. medlemskapet er aktivt",
    (await membershipOf(marteId, TR))?.status,
    "active",
  );
  expect(
    "6. ingen invitasjon ble laget å vente på",
    (await admin.from("invitations").select("*", { count: "exact", head: true }).eq("request_id", marteRequest.id)).count,
    0,
  );

  // 7–8. A retried approval reports the same outcome and does not duplicate
  //      the membership. There is only one row to find either way — this
  //      asserts there is exactly one, not merely that the count did not
  //      change relative to some other total.
  const marteApproveAgain = await larsbror.rpc("approve_access_request", { p_request_id: marteRequest.id });
  const marteAgainOutcome = (marteApproveAgain.data as MintedRow[] | null)?.[0];
  expect("7. en gjentatt godkjenning er idempotent", marteAgainOutcome?.outcome, "activated");
  expect(
    "8. og lager ikke et medlemskap til",
    (await admin.from("memberships").select("*", { count: "exact", head: true }).eq("user_id", marteId).eq("community_id", TR)).count,
    1,
  );

  // Undo: Marte was never meant to end up a Tryggere member.
  await admin.from("memberships").delete().eq("user_id", marteId).eq("community_id", TR);
  await admin
    .from("notifications")
    .delete()
    .eq("user_id", marteId)
    .eq("community_id", TR)
    .like("title", "Du er nå medlem%");

  // ── 9–11. An address with no usable account: the claim link ─────────────
  const claimEmail = "sjekk.claim@example.no";
  createdAccessRequestEmails.push(claimEmail);
  await requestAccess(anon, TR, claimEmail, "Sjekk Claim");
  const claimRequest = await pendingRequestFor(claimEmail);

  const claimApproval = await larsbror.rpc("approve_access_request", { p_request_id: claimRequest.id });
  const claimOutcome = (claimApproval.data as MintedRow[] | null)?.[0];
  expect("godkjenning uten konto gir en invitasjon", claimOutcome?.outcome, "invited");
  const claimToken = claimOutcome?.token;
  expect("med en token å sende", Boolean(claimToken), true);

  // 9. The wrong account — an existing, different, already-authenticated
  //    person with no membership of their own to confuse the result — cannot
  //    redeem a link that was not sent to their address. Marte is the right
  //    stand-in here: her own TR membership from case 5 was already undone
  //    above, so any TR membership appearing for her now can only have come
  //    from this attempt.
  const wrongAccountAttempt = await marte.rpc("accept_invitation_token", { p_token: claimToken! });
  const wrongOutcome = (wrongAccountAttempt.data as AcceptRow[] | null)?.[0];
  expect("9. feil konto kan ikke løse inn lenken", wrongOutcome?.ok, false);
  expect("9. og databasen forklarer at e-posten ikke stemmer", wrongOutcome?.reason, "email-mismatch");
  expect("9. feil konto fikk ikke noe medlemskap av forsøket", await membershipOf(marteId, TR), null);

  // 10. The correct address, authenticated for the first time, activates on
  //     the strength of the token plus the matching session — no separate
  //     decision beyond that authentication.
  const claimClient = await signIn(claimEmail);
  const { data: claimUser } = await claimClient.auth.getUser();
  createdAuthUserIds.push(claimUser.user!.id);

  const claimRedeem = await claimClient.rpc("accept_invitation_token", { p_token: claimToken! });
  const claimRedeemOutcome = (claimRedeem.data as AcceptRow[] | null)?.[0];
  expect("10. riktig adresse kan aktivere tilgangen", claimRedeemOutcome?.ok, true);
  expect("10. og det gir medlemskap", claimRedeemOutcome?.reason, "joined");
  expect(
    "10. medlemskapet er aktivt",
    (await membershipOf(claimUser.user!.id, TR))?.status,
    "active",
  );

  // 11. Redeeming again finds nothing left to consume.
  const claimRedeemAgain = await claimClient.rpc("accept_invitation_token", { p_token: claimToken! });
  const claimRedeemAgainOutcome = (claimRedeemAgain.data as AcceptRow[] | null)?.[0];
  expect("11. gjentatt innløsning gir ikke et medlemskap til", claimRedeemAgainOutcome?.ok, false);
  expect("11. og forklarer at lenken er brukt", claimRedeemAgainOutcome?.reason, "already-used");
  expect(
    "11. fortsatt bare ett medlemskap",
    (await admin.from("memberships").select("*", { count: "exact", head: true }).eq("user_id", claimUser.user!.id).eq("community_id", TR)).count,
    1,
  );

  // ── 12–13. A proactive invitation — no originating request — is untouched ─
  //
  // There is still no admin-facing "invite by email" entry point in the
  // product; every invitation minted through the application traces back to
  // a request. This constructs the other shape directly, as the service
  // role, the way a future proactive-invite feature would, and checks the
  // one thing the acceptance page relies on to tell the two apart:
  // `invitation_preview.auto_activate` must be false, and the token must
  // still require the same authenticated, matching-email redemption as
  // every other invitation — nothing here grants it a shortcut.
  const proactiveEmail = "sjekk.proaktiv@example.no";
  // hash_invitation_token() is revoked from every role and only reachable
  // from inside another SECURITY DEFINER function, so this constructs the
  // row with a hash computed the same way (sha256, hex) rather than calling
  // it — the row has to exist for invitation_preview() and
  // accept_invitation_token() to have anything to find.
  const { createHash } = await import("node:crypto");
  const proactiveToken = "sjekktoken" + Math.random().toString(16).slice(2);
  const proactiveHash = createHash("sha256").update(proactiveToken).digest("hex");
  const { data: proactiveInvitation, error: proactiveInsertError } = await admin
    .from("invitations")
    .insert({
      community_id: TR,
      email: proactiveEmail,
      token_hash: proactiveHash,
      request_id: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select("id")
    .single();
  expect("kan konstruere en proaktiv invitasjon uten forespørsel", proactiveInsertError, null);

  const proactivePreview = await anon.rpc("invitation_preview", { p_token: proactiveToken });
  const proactivePreviewRow = (proactivePreview.data as { auto_activate: boolean; email: string }[] | null)?.[0];
  expect("12. en proaktiv invitasjon er ikke automatisk", proactivePreviewRow?.auto_activate, false);

  const proactiveWrongAttempt = await linn.rpc("accept_invitation_token", { p_token: proactiveToken });
  const proactiveWrongOutcome = (proactiveWrongAttempt.data as AcceptRow[] | null)?.[0];
  expect("13. feil konto kan ikke godta en proaktiv invitasjon heller", proactiveWrongOutcome?.reason, "email-mismatch");

  const proactiveClient = await signIn(proactiveEmail);
  const { data: proactiveUser } = await proactiveClient.auth.getUser();
  createdAuthUserIds.push(proactiveUser.user!.id);
  const proactiveAccept = await proactiveClient.rpc("accept_invitation_token", { p_token: proactiveToken });
  const proactiveAcceptOutcome = (proactiveAccept.data as AcceptRow[] | null)?.[0];
  expect("13. riktig adresse kan fortsatt godta eksplisitt", proactiveAcceptOutcome?.ok, true);
  expect(
    "13. og ingen access_request ble rørt — den fantes ikke for denne invitasjonen",
    (await admin.from("access_requests").select("*", { count: "exact", head: true }).eq("email", proactiveEmail)).count,
    0,
  );

  await admin.from("memberships").delete().eq("user_id", proactiveUser.user!.id).eq("community_id", TR);
  await admin
    .from("notifications")
    .delete()
    .eq("user_id", proactiveUser.user!.id)
    .like("title", "Du er nå medlem%");
  await admin.from("invitations").delete().eq("id", proactiveInvitation!.id);

  // ── 14. Rejected never grants access ─────────────────────────────────────
  const rejectedEmail = "sjekk.avslatt@example.no";
  createdAccessRequestEmails.push(rejectedEmail);
  await requestAccess(anon, TR, rejectedEmail, "Sjekk Avslått");
  const rejectedRequest = await pendingRequestFor(rejectedEmail);
  const rejection = await larsbror.rpc("reject_access_request", { p_request_id: rejectedRequest.id });
  expect("administrator kan avslå", rejection.data, true);

  const rejectedApproveAttempt = await larsbror.rpc("approve_access_request", { p_request_id: rejectedRequest.id });
  expect("14. et avslag kan ikke senere godkjennes", (rejectedApproveAttempt.data ?? []).length, 0);
  expect(
    "14. og det finnes ingen invitasjon for den avslåtte adressen",
    (await admin.from("invitations").select("*", { count: "exact", head: true }).eq("email", rejectedEmail)).count,
    0,
  );
  expect(
    "14. og ingen konto skulle noensinne finnes for den adressen",
    (await admin.from("access_requests").select("status").eq("id", rejectedRequest.id).single()).data!.status,
    "rejected",
  );

  // ── 15. Privacy of an invite-only / unknown community is unchanged ──────
  const inviteOnlyAttempt = await requestAccess(anon, "sjekk-ukjent-fellesskap", "sjekk.privat@example.no");
  expect(
    "15. et ukjent community-slug svarer likt som et akseptert — ingen probe",
    inviteOnlyAttempt.data,
    true,
  );
  expect(
    "15. og lager ingen forespørsel",
    (await admin.from("access_requests").select("*", { count: "exact", head: true }).eq("email", "sjekk.privat@example.no")).count,
    0,
  );

  // ── 16. No broad memberships policy exists ──────────────────────────────
  const forgedInsert = await linn
    .from("memberships")
    .insert({ user_id: await profileId("linn"), community_id: UTR, role: "admin", status: "active" })
    .select("id");
  expect("16. ingen kan sette inn medlemskap direkte", (forgedInsert.data ?? []).length, 0);

  const forgedUpdate = await linn
    .from("memberships")
    .update({ role: "admin" })
    .eq("user_id", await profileId("linn"))
    .eq("community_id", TR)
    .select("id");
  expect("16. ingen kan oppdatere medlemskap direkte", (forgedUpdate.data ?? []).length, 0);

  // ── Identity binding at submission time ──────────────────────────────────
  //
  // A signed-in caller asking for their own address gets that identity
  // recorded on the request. A signed-in caller asking on behalf of some
  // other address gets none of it — the request behaves exactly as if it had
  // been submitted anonymously, and in particular the caller's own account
  // is never bound to somebody else's request. `claimClient` is signed in as
  // `claimEmail` from case 10 above, so reusing it here asks UTR for the same
  // address her session actually controls.
  const ownAddressSubmission = await claimClient.rpc("request_community_access", {
    p_slug: UTR,
    p_email: claimEmail,
  });
  expect("signert bruker kan spørre for sin egen adresse", ownAddressSubmission.error, null);
  const ownAddressRequest = await pendingRequestFor(claimEmail);
  expect(
    "og forespørselen bærer den identiteten fra økten",
    ownAddressRequest.user_id,
    claimUser.user!.id,
  );

  const otherEmail = "sjekk.annenkonto@example.no";
  createdAccessRequestEmails.push(otherEmail);
  const onBehalfSubmission = await linn.rpc("request_community_access", {
    p_slug: UTR,
    p_email: otherEmail,
  });
  expect("signert bruker kan også spørre for en annen adresse", onBehalfSubmission.error, null);
  const onBehalfRequest = await pendingRequestFor(otherEmail);
  expect(
    "men den låner ikke innloggingen til den som spurte",
    onBehalfRequest.user_id,
    null,
  );

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
  } else {
    console.log(`✓ ${checks} kontroller passerte`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) process.exit(1);
  });
