import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { User } from "@/lib/types";

/**
 * Who may open /platform-admin, decided by the database.
 *
 * `my_platform_access()` answers about the signed-in account only, from the
 * JWT PostgREST has verified: its platform role (if any) and whether this
 * session has passed a second factor. Nothing the browser sends — no cookie
 * flag, no query parameter — takes part. This check only decides which page
 * to render; every operation the dashboard performs is authorised again,
 * independently, inside the database function that performs it.
 */
export type PlatformRole = "owner" | "operator";

export interface PlatformAccess {
  user: User;
  role: PlatformRole;
  /** AAL2 on a session that still exists. Required for everything. */
  mfaVerified: boolean;
  /** A second-factor verification in the last ten minutes. Required for privilege changes. */
  mfaRecent: boolean;
  /** The account has a verified TOTP factor (otherwise it must enrol one). */
  hasFactor: boolean;
}

export const getPlatformAccess = cache(async (): Promise<PlatformAccess | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_platform_access");
  if (error) {
    console.error(`[platform-admin] my_platform_access: ${error.code} ${error.message}`);
    return null;
  }
  const row = data?.[0];
  if (!row || (row.role !== "owner" && row.role !== "operator")) return null;
  return {
    user,
    role: row.role,
    mfaVerified: Boolean(row.mfa_verified),
    mfaRecent: Boolean(row.mfa_recent),
    hasFactor: Boolean(row.has_mfa_factor),
  };
});

/**
 * For pages: anyone who is not an operator gets the site's ordinary 404 —
 * signed out, signed in, community administrator alike. The dashboard does
 * not confirm that it exists.
 */
export async function requirePlatformOperator(): Promise<PlatformAccess> {
  const access = await getPlatformAccess();
  if (!access) notFound();
  return access;
}

/** For pages that need the second factor already verified (all but the MFA step). */
export async function requireVerifiedOperator(): Promise<PlatformAccess> {
  const access = await requirePlatformOperator();
  if (!access.mfaVerified) notFound();
  return access;
}
