/**
 * How long a Supabase email sign-in link works, as TING states it to people.
 */

/** Seconds a minted sign-in token stays valid: Supabase's email OTP lifetime. */
export function emailSignInLinkLifetimeSeconds(): number {
  // Must match the Supabase project's "Email OTP Expiration" (auth.email
  // .otp_expiry locally). Supabase's default is one hour; an unset value
  // assumes that, so an email never promises longer than the project allows.
  const configured = Number(process.env.SUPABASE_EMAIL_OTP_EXPIRY_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : 3600;
}
