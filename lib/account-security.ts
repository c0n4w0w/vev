import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import {
  createClient,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
  type AuthError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { clientIpFrom, trustedProxyCount } from "@/lib/client-ip";
import { emailSignInLinkLifetimeSeconds } from "@/lib/email-sign-in-link";
import { EMAIL_CHANGE_COOLDOWN_HOURS } from "@/lib/password";
import { getSessionUser } from "@/lib/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Passwords and email changes for the signed-in account.
 *
 * Everything here goes through Supabase Auth: it stores and verifies the
 * password, sends the emails, and owns the address. TING keeps no credential.
 * What this module adds is the order things happen in — which proof is asked
 * for before which change — and the database enforces the parts of that order
 * that matter (supabase/migrations/20261025100000_account_security.sql), so a
 * request that skips this module does not skip the rules.
 *
 * None of it touches memberships, profiles or anything a community holds. An
 * account keeps its id through every change here, and the id is what all of
 * that hangs on.
 */

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * A client that keeps nothing: for proving a password or a link without
 * touching this request's own session until the proof is known to be good.
 */
function scratchClient() {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Supabase did not answer, as opposed to refusing. */
function authUnavailable(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500;
}

function rateLimited(error: AuthError): boolean {
  return error.status === 429 || /rate_limit/.test(error.code ?? "");
}

// ── What the account page shows ─────────────────────────────────────────

export type AccountSecurity = {
  userId: string;
  email: string;
  /** A password the owner chose exists. Auth's own random placeholders do not count. */
  hasPassword: boolean;
  passwordSetAt?: string;
  /** Joined through an approval and has not chosen a password yet. */
  passwordSetupRequired: boolean;
  /** An address waiting to be confirmed, while its emailed link can still work. */
  pendingEmail?: string;
  /** When the password is old enough to authorise an email change; absent once it is. */
  emailChangeAvailableAt?: string;
};

/** The signed-in account's own row. Row level security returns nobody else's. */
export const getAccountSecurity = cache(async (): Promise<AccountSecurity | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("account_security")
    .select("password_set_at, password_setup_required_at, email_change_to, email_change_authorized_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const now = Date.now();
  const passwordSetAt = row?.password_set_at ?? undefined;
  const availableAt = passwordSetAt
    ? Date.parse(passwordSetAt) + EMAIL_CHANGE_COOLDOWN_HOURS * 3_600_000
    : undefined;
  // The emailed confirmation lives as long as any other emailed token.
  const pendingUntil = row?.email_change_authorized_at
    ? Date.parse(row.email_change_authorized_at) + emailSignInLinkLifetimeSeconds() * 1000
    : 0;

  return {
    userId: user.id,
    email: user.email ?? "",
    hasPassword: Boolean(passwordSetAt),
    passwordSetAt,
    passwordSetupRequired: Boolean(row?.password_setup_required_at) && !passwordSetAt,
    pendingEmail: row?.email_change_to && pendingUntil > now ? row.email_change_to : undefined,
    emailChangeAvailableAt:
      availableAt && availableAt > now ? new Date(availableAt).toISOString() : undefined,
  };
});

// ── Checking a password ─────────────────────────────────────────────────

type PasswordCheck =
  | { ok: true; userId: string; session: { access_token: string; refresh_token: string } }
  | { ok: false; reason: "credentials" | "rate" | "unavailable" }
  /** Too many tries for this account or from this address; nothing was checked. */
  | { ok: false; reason: "wait"; seconds: number };

/**
 * Every password TING checks goes through here: the sign-in form, and the
 * current password asked for before a password or an address is changed.
 *
 * Supabase Auth does the checking. What happens first is the counting Auth
 * cannot do from where it sits — it sees this server's address for every
 * member — in `begin_password_attempt()`: per account, keyed on the address
 * typed whether or not it has an account, and per network address when the
 * deployment can vouch for one (lib/client-ip.ts). While either says wait,
 * Auth is not asked at all, so not even the right password gets through and a
 * guesser learns nothing from trying.
 *
 * The counters are written with the service role because no client may touch
 * them: anyone able to name an account and an address could lock out whoever
 * they liked. Nothing but the two counters is read or written with it.
 */
async function checkPassword(
  client: SupabaseClient<Database>,
  input: { email: string; password: string },
): Promise<PasswordCheck> {
  const admin = createSupabaseAdminClient();
  const email = input.email.slice(0, 254);
  const ip = clientIpFrom((await headers()).get("x-forwarded-for"), trustedProxyCount()) ?? "";

  const { data: wait, error: uncounted } = await admin.rpc("begin_password_attempt", {
    p_email: email,
    p_ip: ip,
  });
  // No count, no check: guessing must not get easier when the database is unwell.
  if (uncounted || typeof wait !== "number") return { ok: false, reason: "unavailable" };
  if (wait > 0) return { ok: false, reason: "wait", seconds: wait };

  const { data, error } = await client.auth.signInWithPassword(input);
  if (error || !data.session || !data.user) {
    if (error && rateLimited(error)) return { ok: false, reason: "rate" };
    if (error && authUnavailable(error)) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "credentials" };
  }

  await admin.rpc("finish_password_attempt", { p_email: email, p_ip: ip, p_valid: true });
  return {
    ok: true,
    userId: data.user.id,
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
  };
}

// ── Signing in ──────────────────────────────────────────────────────────

export type PasswordSignInOutcome =
  | { status: "signed-in" | "credentials" | "rate" | "unavailable" }
  | { status: "wait"; seconds: number };

/**
 * Email and password, verified by Supabase Auth. Every refusal that is about
 * the credentials — wrong password, no such account, an address that was
 * never confirmed — is the same answer, and so is being asked to wait, so the
 * form cannot be used to ask which addresses have accounts.
 */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<PasswordSignInOutcome> {
  const supabase = await createSupabaseServerClient();
  const checked = await checkPassword(supabase, input);
  if (checked.ok) return { status: "signed-in" };
  return checked.reason === "wait"
    ? { status: "wait", seconds: checked.seconds }
    : { status: checked.reason };
}

// ── Choosing a password ─────────────────────────────────────────────────

export type PasswordFailure =
  | "too-short"
  | "too-long"
  | "pwned"
  | "weak"
  | "same"
  /** The session is over a day old; Auth wants a fresh sign-in first. */
  | "reauth"
  /** Where the project also asks Auth itself to check the current password. */
  | "current"
  | "rate"
  | "unavailable"
  | "failed";

function passwordFailure(error: AuthError): PasswordFailure {
  if (isAuthWeakPasswordError(error)) {
    if (error.reasons.includes("pwned")) return "pwned";
    if (error.reasons.includes("length")) return "too-short";
    return "weak";
  }
  if (error.code === "same_password") return "same";
  if (error.code === "reauthentication_needed") return "reauth";
  // Auth's own check, where the project has "require current password" on.
  if (/^current_password_/.test(error.code ?? "")) return "current";
  if (/longer than/i.test(error.message)) return "too-long";
  if (rateLimited(error)) return "rate";
  if (authUnavailable(error)) return "unavailable";
  return "failed";
}

/**
 * Asks the database to let Auth replace this account's password for the next
 * few minutes. It agrees only for a session that has just proven the current
 * password or has just come from the account's inbox — which the token's
 * signed `amr` claim shows — and the rule on auth.users refuses a replacement
 * that was not agreed to. So this is not a formality the app could skip: a
 * request that goes to Auth without it changes nothing.
 */
async function authorizePasswordChange(supabase: ServerClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("authorize_password_change");
  return !error && data === true;
}

export type SetPasswordOutcome =
  | { ok: true }
  | { ok: false; reason: PasswordFailure | "signed-out" | "use-change" };

/**
 * Sets a password on the signed-in account without asking for a current one:
 * the first password, or a new one straight after an emailed link.
 *
 * `supabase.auth.updateUser({ password })` is Supabase Auth's way of adding a
 * password to an account that signs in by email link — same account, same id.
 * An account that already has a password is sent to `changePassword` unless
 * its session has just come from the inbox, which is what a reset is; that is
 * the database's call (`authorize_password_change`), not this function's.
 */
export async function setPassword(password: string): Promise<SetPasswordOutcome> {
  const security = await getAccountSecurity();
  if (!security) return { ok: false, reason: "signed-out" };

  const supabase = await createSupabaseServerClient();
  if (security.hasPassword && !(await authorizePasswordChange(supabase))) {
    return { ok: false, reason: "use-change" };
  }

  const { error } = await supabase.auth.updateUser({ password });
  return error ? { ok: false, reason: passwordFailure(error) } : { ok: true };
}

export type ChangePasswordOutcome =
  | { ok: true }
  | { ok: false; reason: PasswordFailure | "signed-out" }
  | { ok: false; reason: "wait"; seconds: number };

/**
 * Replaces a password the person knows.
 *
 * The current password is proven by signing in with it, on a client that
 * keeps nothing. Only then does that fresh session become this browser's, and
 * the new password is set on it — so Auth ends every *other* session of the
 * account, including the one this request arrived with.
 */
export async function changePassword(input: {
  current: string;
  next: string;
}): Promise<ChangePasswordOutcome> {
  const security = await getAccountSecurity();
  if (!security) return { ok: false, reason: "signed-out" };

  const proven = await checkPassword(scratchClient(), {
    email: security.email,
    password: input.current,
  });
  if (!proven.ok) {
    if (proven.reason === "wait") return { ok: false, reason: "wait", seconds: proven.seconds };
    return { ok: false, reason: proven.reason === "credentials" ? "current" : proven.reason };
  }
  if (proven.userId !== security.userId) return { ok: false, reason: "current" };

  const supabase = await createSupabaseServerClient();
  const adopted = await supabase.auth.setSession(proven.session);
  if (adopted.error) return { ok: false, reason: "unavailable" };
  if (!(await authorizePasswordChange(supabase))) return { ok: false, reason: "failed" };

  // `current_password` is what Auth itself checks where the project has
  // "require current password" on; it is ignored elsewhere.
  const { error } = await supabase.auth.updateUser({
    password: input.next,
    current_password: input.current,
  });
  return error ? { ok: false, reason: passwordFailure(error) } : { ok: true };
}

// ── Forgotten password ──────────────────────────────────────────────────

/**
 * Asks Supabase Auth to email a reset link. The answer is the same whether
 * or not the address has an account, and whether or not Auth declined to send
 * another one so soon — both would say something about the address.
 */
export async function requestPasswordReset(email: string): Promise<"sent" | "unavailable"> {
  // The emailed link goes to TING's own page (supabase/templates/recovery.html)
  // and is redeemed there by token hash, so no redirect address is passed and
  // the link works in whichever browser the email is opened in.
  const { error } = await scratchClient().auth.resetPasswordForEmail(email);
  if (!error || rateLimited(error)) return "sent";
  if (authUnavailable(error)) return "unavailable";
  console.error("Kunne ikke sende lenke for nytt passord:", error.code ?? error.status);
  return "sent";
}

export type ResetPasswordOutcome =
  | { status: "done" }
  | { status: "link-expired" }
  | { status: "unavailable" }
  /** Signed in by the link, but the password was refused. */
  | { status: "retry"; reason: PasswordFailure };

/**
 * Redeems a reset link and sets the new password in one step.
 *
 * The link is verified on a throwaway client, so a spent or invented token
 * changes nothing about who is signed in here. A good one signs the person in
 * — that is what a recovery link is — and the password is set on that
 * session, which ends every other session of the account.
 */
export async function resetPasswordWithLink(input: {
  tokenHash: string;
  password: string;
}): Promise<ResetPasswordOutcome> {
  const scratch = scratchClient();
  const verified = await scratch.auth.verifyOtp({ type: "recovery", token_hash: input.tokenHash });
  if (verified.error || !verified.data.session) {
    return verified.error && authUnavailable(verified.error)
      ? { status: "unavailable" }
      : { status: "link-expired" };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: current },
  } = await supabase.auth.getUser();
  if (current) await supabase.auth.signOut({ scope: "local" });
  const adopted = await supabase.auth.setSession({
    access_token: verified.data.session.access_token,
    refresh_token: verified.data.session.refresh_token,
  });
  if (adopted.error) return { status: "unavailable" };

  // A session seconds old, straight from the inbox: the proof a reset rests on.
  await authorizePasswordChange(supabase);
  const { error } = await supabase.auth.updateUser({ password: input.password });
  return error ? { status: "retry", reason: passwordFailure(error) } : { status: "done" };
}

// ── Changing the email address ──────────────────────────────────────────

export type EmailChangeRequestOutcome =
  | { status: "sent" | "signed-out" | "password" | "invalid" | "same" | "no-password" | "cooldown" }
  | { status: "rate" | "unavailable" | "failed" }
  | { status: "wait"; seconds: number };

/**
 * Starts an email change: proves the current password, records which address
 * the owner asked for, and has Supabase Auth email a confirmation to it.
 *
 * It all runs on a throwaway session created by signing in with the password
 * just typed. That session is what `authorize_email_change()` inspects — it
 * accepts only one that proved the password moments ago — so the long-lived
 * session this request arrived with is never the proof. The old inbox is not
 * involved at any point.
 *
 * An address that already belongs to another account answers `sent` like any
 * other; Auth refuses it and nothing is emailed.
 */
export async function requestEmailChange(input: {
  currentPassword: string;
  newEmail: string;
}): Promise<EmailChangeRequestOutcome> {
  const security = await getAccountSecurity();
  if (!security) return { status: "signed-out" };
  if (!security.hasPassword) return { status: "no-password" };

  const scratch = scratchClient();
  const proven = await checkPassword(scratch, {
    email: security.email,
    password: input.currentPassword,
  });
  if (!proven.ok) {
    if (proven.reason === "wait") return { status: "wait", seconds: proven.seconds };
    return { status: proven.reason === "credentials" ? "password" : proven.reason };
  }

  try {
    if (proven.userId !== security.userId) return { status: "password" };

    const { data: verdict, error: refused } = await scratch.rpc("authorize_email_change", {
      p_new_email: input.newEmail,
    });
    if (refused) return { status: "failed" };
    switch (verdict) {
      case "authorized":
        break;
      case "invalid":
      case "same":
      case "no-password":
      case "cooldown":
        return { status: verdict };
      default:
        return { status: "failed" };
    }

    const { error } = await scratch.auth.updateUser({ email: input.newEmail });
    if (!error || error.code === "email_exists") return { status: "sent" };
    if (rateLimited(error)) return { status: "rate" };
    if (isAuthRetryableFetchError(error)) return { status: "unavailable" };
    console.error("Kunne ikke starte e-postendring:", error.code ?? error.status);
    return { status: "failed" };
  } finally {
    // The proof has done its job; it is revoked rather than left lying around.
    await scratch.auth.signOut({ scope: "local" });
  }
}

export type EmailChangeConfirmOutcome =
  | { status: "done"; email: string }
  | { status: "signed-out" }
  | { status: "none" }
  | { status: "half" }
  | { status: "expired" }
  | { status: "failed" };

/**
 * Completes an email change from the link sent to the new address.
 *
 * Two things have to be true at once: this request carries the account's own
 * session, which arms the change for a moment (`arm_email_change()`), and the
 * emailed token is good. The database lets Auth complete the change only then,
 * so neither a forwarded link nor a stolen session is enough by itself. The
 * account keeps its id; only the address it signs in with moves.
 */
export async function confirmEmailChange(tokenHash: string): Promise<EmailChangeConfirmOutcome> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const { data: armed } = await supabase.rpc("arm_email_change");
  if (armed !== true) return { status: "none" };

  const scratch = scratchClient();
  const verified = await scratch.auth.verifyOtp({ type: "email_change", token_hash: tokenHash });
  if (verified.error) {
    // A token for some other account ends here too: its change was never
    // armed, so the database refuses and Auth reports a failure.
    return (verified.error.status ?? 0) >= 500 || isAuthRetryableFetchError(verified.error)
      ? { status: "failed" }
      : { status: "expired" };
  }
  // Verifying hands back a session; this request already has the owner's.
  if (verified.data.session) await scratch.auth.signOut({ scope: "local" });
  // Where a project asks both addresses to confirm, the first link answers
  // with a notice rather than an account, and nothing has changed yet.
  const changed = verified.data.user;
  if (!changed?.id) return { status: "half" };
  if (changed.id !== user.id) return { status: "failed" };

  // A new access token, so this browser's session names the new address.
  await supabase.auth.refreshSession();
  return { status: "done", email: changed.email ?? "" };
}

/** Withdraws the signed-in account's pending change; the emailed link stops working. */
export async function cancelEmailChange(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("cancel_email_change");
  return !error && data === true;
}
