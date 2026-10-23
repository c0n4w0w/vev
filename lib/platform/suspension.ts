import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The communities TING has suspended that the signed-in person belongs to.
 *
 * Only for presentation: so a member sees "suspended" instead of a community
 * that looks empty or broken. What makes a suspension real is in the
 * database — no predicate grants anything in a suspended community, and every
 * write into one fails (20261113100000_platform_administration.sql).
 */
export const getMySuspendedCommunityIds = cache(async (): Promise<ReadonlySet<string>> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_suspended_community_ids");
  if (error) {
    console.error(`[suspension] my_suspended_community_ids: ${error.code} ${error.message}`);
    return new Set();
  }
  return new Set(data ?? []);
});
