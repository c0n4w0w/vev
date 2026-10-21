import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Same bucket as members' own photos (lib/data.ts). */
const MEMBER_AVATAR_BUCKET = "member-avatars";

/**
 * A visible poll voter's community photo, for the signed-in viewer.
 *
 * Voting on a visible poll shows one's community name and photo to the other
 * voters — also where the member directory is closed, so the ordinary photo
 * route (which follows can_view_community_profile) would refuse it. Here the
 * database decides instead: channel_poll_voter_avatar_path() answers only for
 * a visible poll the viewer may see the voters of (they can read the channel
 * and voted, or it closed), a voter still in that channel, and the opaque
 * vote ref — never an account id from the browser. Only then is that one
 * object read, with the service role, since the storage policy follows the
 * directory rule. Nothing else about the voter is opened.
 */
export async function downloadPollVoterAvatar(
  viewerId: string,
  messageId: string,
  voterRef: string,
): Promise<{ blob: Blob; path: string } | undefined> {
  const admin = createSupabaseAdminClient();
  const { data: path, error } = await admin.rpc("channel_poll_voter_avatar_path", {
    p_viewer: viewerId,
    p_message_id: messageId,
    p_voter_ref: voterRef,
  });
  if (error || typeof path !== "string" || !path) return undefined;
  const { data: blob } = await admin.storage.from(MEMBER_AVATAR_BUCKET).download(path);
  return blob ? { blob, path } : undefined;
}
