import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoDeployment } from "@/lib/environment";
import { showcases, tokenEnvName, type Showcase } from "@/lib/demo/showcase";

/**
 * Showcase entry.
 *
 * A prospect follows one link and is inside the product. No password to show
 * them, no account to create, no email to wait for, and no list of demo
 * identities anywhere a stranger could find one.
 *
 * How the session is made, and why this way:
 *
 * Supabase offers three ways to sign someone in. A password would mean a
 * shared secret that has to live somewhere and would be typed into a real
 * login form — that is the mechanism this replaces. An emailed magic link
 * needs a mailbox the visitor does not have. The third is
 * `admin.generateLink()`, which mints the *same* one-time token the magic-link
 * email would have carried, and hands it back to the server instead of
 * sending it. The server redeems it immediately with `verifyOtp`, the session
 * cookies are set, and the token is spent before it ever leaves this process.
 *
 * So the visitor never holds a credential, the service-role key never leaves
 * the server, and no new authentication path exists — this is the ordinary
 * magic-link flow with the email step removed.
 */

const MINIMUM_TOKEN_LENGTH = 24;

export type EntryResult =
  | { ok: true; showcase: Showcase; landing: string }
  | { ok: false; reason: "disabled" | "unknown-token" | "misconfigured" | "sign-in-failed" };

/** Constant-time compare that does not leak length through early return. */
function tokensMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong length is not measurably faster.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Resolves a token to a showcase, or nothing.
 *
 * Every rejection returns the same shape. The caller turns all of them into a
 * 404, so the route cannot be used to learn whether demo mode is on, whether a
 * showcase exists, or whether a token was close.
 */
function resolveShowcase(token: string): Showcase | undefined {
  let matched: Showcase | undefined;

  // No early exit: check every showcase so timing does not reveal which one
  // a guess was nearest to.
  for (const showcase of showcases) {
    const expected = process.env[tokenEnvName(showcase)];
    if (!expected || expected.length < MINIMUM_TOKEN_LENGTH) continue;
    if (tokensMatch(token, expected)) matched = showcase;
  }
  return matched;
}

/**
 * Signs the visitor in as the showcase persona.
 *
 * Refuses outright unless this deployment has declared itself a demo. That
 * check is first and is not negotiable: production never sets `TING_MODE`, so
 * a production deployment rejects every token, including a real one that leaked
 * from the demo environment.
 */
export async function enterShowcase(token: string): Promise<EntryResult> {
  if (!isDemoDeployment()) return { ok: false, reason: "disabled" };
  if (!token || token.length < MINIMUM_TOKEN_LENGTH) return { ok: false, reason: "unknown-token" };

  const showcase = resolveShowcase(token);
  if (!showcase) return { ok: false, reason: "unknown-token" };

  const admin = createSupabaseAdminClient();

  // Mint the one-time token that a magic-link email would have contained.
  // `generateLink` does not send anything; it returns the token to us.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: showcase.personaEmail,
  });

  if (error || !data.properties?.hashed_token) {
    console.error(
      `[demo] Could not mint a session for ${showcase.id}: ${error?.message ?? "no token returned"}. ` +
        `Has the demo database been seeded?`,
    );
    return { ok: false, reason: "misconfigured" };
  }

  // Redeem it on the request-scoped client so the session cookies land on this
  // response. The token is single-use and is now spent.
  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });

  if (verifyError) {
    console.error(`[demo] Session exchange failed for ${showcase.id}: ${verifyError.message}`);
    return { ok: false, reason: "sign-in-failed" };
  }

  return { ok: true, showcase, landing: showcase.landing };
}
