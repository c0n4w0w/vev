import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The Supabase sign-in credential carried in an approval email, so one email
 * is enough to get from "approved" into the community.
 *
 * What this is: a real Supabase Auth one-time token for exactly one address,
 * minted with `auth.admin.generateLink` and redeemed later with
 * `auth.verifyOtp({ token_hash })` — the same verification a Supabase magic
 * link performs, single-use and expiring after the project's email OTP
 * lifetime. What it is not: a TING invitation token. Membership is still
 * decided by `accept_invitation_token()`, which independently requires the
 * signed-in address to equal the invited one.
 *
 * The cost, agreed before this was built: Supabase can only mint a credential
 * for a user that exists, so for an address with no TING account this creates
 * one now — unconfirmed, with no memberships, visible to nobody — instead of
 * when the person first clicks. Such accounts are tagged in `app_metadata`
 * (writable only with the service role) so they can be told apart later.
 * Nothing here ever deletes an account.
 *
 * Server-only by construction: the caller passes the service-role client,
 * which only server code can create. It is a parameter rather than created
 * here so the checks can exercise this exact function.
 */

/** Seconds a minted sign-in token stays valid: Supabase's email OTP lifetime. */
export function emailSignInLinkLifetimeSeconds(): number {
  // Must match the Supabase project's "Email OTP Expiration" (auth.email
  // .otp_expiry locally). Supabase's default is one hour; an unset value
  // assumes that, so an email never promises longer than the project allows.
  const configured = Number(process.env.SUPABASE_EMAIL_OTP_EXPIRY_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : 3600;
}

export type MintedSignInLink = {
  tokenHash: string;
  /** When the sign-in part stops working. The invitation may outlive it. */
  signInExpiresAt: string;
  /** True when this call created the account (it did not exist before). */
  createdAccount: boolean;
};

export const INVITATION_ACCOUNT_ORIGIN = "invitation";

export async function mintEmailSignInLink(
  admin: SupabaseClient<Database>,
  input: { email: string; communityId: string },
): Promise<MintedSignInLink | null> {
  const email = input.email.trim().toLowerCase();
  const signInExpiresAt = new Date(Date.now() + emailSignInLinkLifetimeSeconds() * 1000).toISOString();

  // Every TING account has a profile row (handle_new_user), so this is the
  // cheap, exact way to ask whether the address already has one.
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) return null;

  if (existing) {
    // An account exists — confirmed, or created earlier and never used. A
    // magic-link token signs into exactly that account and creates nothing.
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash || data.user?.id !== existing.id) return null;
    return { tokenHash, signInExpiresAt, createdAccount: false };
  }

  // No account: an invite-type token, which creates the user unconfirmed.
  // Verifying it later confirms the address — the click is the proof.
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  const tokenHash = data?.properties?.hashed_token;
  const user = data?.user;
  if (error || !tokenHash || !user) return null;

  // Mark the account as made by this flow, merged into what Supabase keeps
  // there. Only the service role can write app_metadata.
  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      ting_account_origin: INVITATION_ACCOUNT_ORIGIN,
      ting_account_origin_community: input.communityId,
    },
  });

  return { tokenHash, signInExpiresAt, createdAccount: true };
}
