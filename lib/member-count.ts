import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * How many active members a community has — for someone who may know.
 *
 * Counted from the memberships the caller can read, at the moment of asking.
 * Nothing stores the number, so nothing can let it go stale.
 *
 * `null` means "not yours to see", and the caller shows no number at all. The
 * question is put to the database first — can_view_member_directory(), the
 * rule behind the row level security on `memberships` — because the count
 * alone would mislead: someone who may not list the membership still reads
 * their own row, and would be told the community has one member. In a
 * community with a closed member list that leaves the administrator; in one
 * whose list is open to members, every active member.
 *
 * This asks for nothing the caller could not already fetch as rows. It adds
 * no function and no policy, and takes the client as an argument so the
 * checks can run this exact code as real signed-in people.
 */
export async function countActiveMembers(
  client: SupabaseClient<Database>,
  communityId: string,
): Promise<number | null> {
  const { data: allowed, error: refused } = await client.rpc("can_view_member_directory", { cid: communityId });
  if (refused || allowed !== true) return null;

  const { count, error } = await client
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("community_id", communityId)
    .eq("status", "active");
  return error || typeof count !== "number" ? null : count;
}
