import "server-only";

import { cache } from "react";
import { getUser } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { User } from "@/lib/types";

/**
 * The signed-in account.
 *
 * `getUser()` (rather than `getSession()`) is deliberate: it revalidates the
 * token with Supabase instead of trusting whatever the cookie claims, which is
 * the difference between an authenticated user and a forged one.
 *
 * Cached per request, because the layout, the page and any server action in the
 * same render all ask for it.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  // A profile row is created by a trigger on sign-up, so this should always
  // resolve; if it somehow does not, the caller is treated as signed out.
  return (await getUser(user.id)) ?? null;
});

export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}
