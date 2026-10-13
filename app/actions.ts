"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  acceptInvitationToken,
  approveAccessRequest,
  createComment as persistComment,
  createLocalGroup,
  addLocalGroupLeader,
  removeLocalGroupLeader,
  getCommunityPersona,
  createEvent,
  updateEvent,
  cancelEvent,
  restoreEvent,
  deleteEvent,
  removeEventAttendee,
  getEvent,
  createDirectMessage as persistDirectMessage,
  createDirectMessageWithAttachments as persistDirectMessageWithAttachments,
  createMessage as persistMessage,
  createMessageWithAttachments as persistMessageWithAttachments,
  clearCommunityAvatar,
  clearMyCommunityAvatar,
  createCommunityEmoji as persistEmoji,
  addSubgroupMember,
  createSubgroup,
  deleteSubgroup,
  getChannels,
  searchNewSubgroupCandidates,
  setSubgroupArchived,
  setSubgroupDetails,
  setSubgroupManager,
  addPrivateChannelParticipant,
  createPrivateChannel,
  deletePrivateChannel,
  getChannel,
  getLocalGroupChannel,
  removePrivateChannelParticipant,
  searchPrivateChannelCandidates,
  setPrivateChannelArchived,
  setPrivateChannelManager,
  createPost as persistPost,
  removeSubgroupMember,
  deleteComment as removeComment,
  getCommunityById,
  getPortalCommunity,
  getMembership,
  joinEvent,
  leaveEvent,
  markAllNotificationsRead,
  markNotificationRead,
  deleteCommunityEmoji as removeEmoji,
  deletePost as removePost,
  enterCommunityWithEmailLink,
  getAccessRequests,
  redeemInvitationWithEmailLink,
  dismissMyOnboarding,
  rejectAccessRequest,
  renameLocalGroup,
  requestCommunityAccess,
  resendInvitation,
  startDirectConversation,
  startDirectConversationWithOrganizationPerson,
  setAcceptsMemberDms,
  setChannelDetails,
  setCommunityAbout,
  setCommunityAvatar,
  setMyCommunityAvatar,
  setCommunityPersonAccountLink,
  setMembershipRole,
  setLocalGroupActive,
  setMyLocalGroup,
  setPostPinned,
  toggleReaction as togglePostReaction,
  updateComment as editComment,
  updateMyCommunityProfile,
  updatePost as editPost,
} from "@/lib/data";
import type { AccessFormState } from "@/lib/access-form";
import type { NotificationFormState } from "@/lib/notification-form";
import { REQUEST_SENT_KEY, normalizeDisplayName } from "@/lib/access-form";
import type { CommentFormState } from "@/lib/comment-form";
import { normalizeBio, type CommunityProfileFormState } from "@/lib/community-profile-form";
import { normalizeChannelDetails, type ChannelEditFormState } from "@/lib/channel-edit-form";
import { normalizeCommunityAbout, type CommunityAboutFormState } from "@/lib/community-about-form";
import { inspectCommunityAvatar } from "@/lib/community-avatar-image";
import {
  inspectEmojiImage,
  normalizeEmojiName,
  validateEmojiName,
} from "@/lib/emoji-image";
import type { DmSettingFormState } from "@/lib/dm-settings-form";
import type { DirectMessageFormState } from "@/lib/direct-message-form";
import {
  EVENT_CREATE_REFUSED,
  EVENT_FULL,
  RSVP_REFUSED,
  type EventFormState,
  type EventLifecycleFormState,
  type RsvpFormState,
} from "@/lib/event-form";
import {
  ADMIN_REFUSED,
  SELECTION_REFUSED,
  type LocalGroupFormState,
  type LocalGroupLeaderFormState,
} from "@/lib/local-group-form";
import type { MessageFormState } from "@/lib/message-form";
import {
  PRIVATE_CHANNEL_PARTICIPANTS_MAX,
  type PrivateChannelCandidate,
  type PrivateChannelCreateFormState,
  type PrivateChannelFormState,
} from "@/lib/private-channel-form";
import {
  SUBGROUP_MEMBERS_MAX,
  normalizeSubgroupDetails,
  parseContentScope,
  type SubgroupCandidate,
  type SubgroupCreateFormState,
  type SubgroupFormState,
} from "@/lib/subgroup-form";
import type { PostFormState } from "@/lib/post-form";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { mintEmailSignInLink } from "@/lib/email-sign-in-link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purgeAttachmentObjects } from "@/lib/attachment-storage";
import type { InvitationLinkState } from "@/lib/invitation-link-form";
import { osloInstant } from "@/lib/format";
import {
  communityLocale,
  communityTranslator,
  parseLocale,
  PLATFORM_LOCALE,
  translator,
  type MessageKey,
  type Translator,
} from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import { safeInternalPath } from "@/lib/safe-path";
import { siteOrigin } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Words for the person who just submitted a form, in the language of the
 * community the action is about.
 *
 * The community id comes from the form, so a tampered one only changes which
 * language the reply is written in — it is looked up through the same
 * membership-scoped read as everything else, and an unknown or hidden
 * community simply falls back to the platform's language. Locale is
 * presentation; nothing is decided by it.
 */
async function translatorFor(communityId: string): Promise<Translator> {
  const community = communityId ? await getCommunityById(communityId) : undefined;
  return communityTranslator(community);
}

// ── Authentication ──────────────────────────────────────────────────────

/**
 * Sends a sign-in link — the way in that needs no password. Email and password
 * is the other (`signInWithPasswordAction`, app/account-actions.ts); both sign
 * into the same Supabase account, and an account that has never chosen a
 * password still gets in this way.
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") || "/home");
  // Carried back to the sign-in page so it keeps speaking the language of the
  // place the person is heading to. Only ever a same-site path.
  const back = `neste=${encodeURIComponent(safeInternalPath(next))}`;
  if (!email) redirect(`/login?feil=e-post&${back}`);

  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?neste=${encodeURIComponent(next)}`,
    },
  });

  // The same response either way: whether an address has an account here is
  // exactly the kind of thing this platform should not confirm to a stranger.
  if (error) console.error("Kunne ikke sende innloggingslenke:", error.message);
  redirect(`/login?sendt=${encodeURIComponent(email)}&${back}`);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

// ── Membership ──────────────────────────────────────────────────────────

// ── Posts ───────────────────────────────────────────────────────────────
//
// Authorisation lives in row level security, not here. These actions read the
// session, hand the data layer what the person typed, and report back what the
// database decided. They deliberately do not pre-check the caller's role: a
// check here could only ever disagree with the policy, and the policy is the
// one that actually runs.

/** Clears the router cache for every screen that renders posts. */
function revalidatePosts(communityId: string) {
  revalidatePath(`/community/${communityId}/feed`);
  revalidatePath(`/community/${communityId}/lokallag`);
  revalidatePath(`/community/${communityId}`);
  revalidatePath("/home");
}

export async function createPostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await persistPost({
    communityId,
    ...parseContentScope(String(formData.get("scope") ?? "")),
    body: String(formData.get("body") ?? ""),
    title: String(formData.get("title") ?? ""),
    // Whether the caller may publish at all is posts_insert's decision: only an
    // active admin or moderator of this community, announcements included. A
    // member who posts this form by hand reaches a policy that refuses it, as
    // does staff publishing into a lokallag or subgroup they cannot read; a
    // group from another community is refused by the foreign key.
    announcement: formData.get("announcement") === "on",
  });

  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function updatePostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await editPost(String(formData.get("postId") ?? ""), {
    body: String(formData.get("body") ?? ""),
    title: String(formData.get("title") ?? ""),
  });

  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function deletePostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await removePost(String(formData.get("postId") ?? ""));

  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

/**
 * Pins or unpins one post.
 *
 * The form carries the desired state rather than a "toggle", so two clicks
 * racing each other settle on what was actually asked for instead of flipping
 * twice. Whether the caller may do it at all is decided by `set_post_pinned`,
 * which checks the post's own community — a tampered id reaches a function
 * that refuses it.
 */
export async function setPostPinnedAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await setPostPinned(
    String(formData.get("postId") ?? ""),
    formData.get("pinned") === "1",
  );

  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}


// ── Notifications ───────────────────────────────────────────────────────
//
// The unread badge lives in the `(app)` layout, not on any one page, so these
// are the first actions in this file whose visible effect is in the navigation
// shell. That is what the layout-scoped revalidation below is for: without it
// the list updates and the badge keeps its old number until something else
// happens to rebuild the shell.

/** Clears the cached shell (the unread badge) and the notification list. */
function revalidateNotifications() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

/**
 * Marks a single notification read.
 *
 * Called on click, alongside following the notification's link — not from a
 * form — so it takes the id directly rather than FormData.
 *
 * The id is not validated here and does not need to be. `notifications_update`
 * admits only rows belonging to `auth.uid()`, so somebody else's id, or one
 * that does not exist, updates nothing; and a client holds UPDATE on the
 * `read` column alone, so this cannot be turned into a write of anything else.
 * The result is deliberately not reported back to the user: whether a given
 * notification id exists is not theirs to learn.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const changed = await markNotificationRead(notificationId);
  if (changed) revalidateNotifications();
}

/**
 * Marks everything the caller has not yet read.
 *
 * A form action, because it is a real button the user presses.
 */
export async function markAllNotificationsReadAction(
  _prev: NotificationFormState,
  _formData: FormData,
): Promise<NotificationFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const ok = await markAllNotificationsRead();
  if (!ok) {
    return {
      status: "error",
      message: translator(PLATFORM_LOCALE)("err.notificationsFailed"),
    };
  }

  revalidateNotifications();
  return { status: "ok" };
}


// ── Channel messages ────────────────────────────────────────────────────

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The attachment ids a message form carries. Only their shape is checked
 * here, and the list is cut well above any real limit; whose they are, which
 * conversation they belong to and how many a message may have is the
 * database's decision when the message is sent.
 */
function attachmentIdsFrom(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("attachmentIds")
        .map(String)
        .filter((id) => ATTACHMENT_ID.test(id)),
    ),
  ].slice(0, 20);
}

/**
 * Removes the stored files of attachments whose rows have just gone — a
 * deleted group or private channel takes its messages, and with them their
 * attachments, in one cascade that leaves the object names queued. Runs after
 * the response; anything that fails stays queued for the next purge.
 */
function purgeAttachmentsAfterResponse() {
  after(async () => {
    try {
      await purgeAttachmentObjects();
    } catch (error) {
      // Still queued; the next purge or the scheduled sweep removes them.
      console.error("[attachments] purge after deletion failed", error);
    }
  });
}

/**
 * Sends one message to a channel.
 *
 * The channel is the only thing the form carries. Whether the caller may write
 * there — member of the community, and a moderator if the channel is read-only
 * — is decided by `messages_insert`, so a tampered channel id reaches a policy
 * that refuses it rather than a check in this file.
 */
export async function createMessageAction(
  _prev: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const channelId = String(formData.get("channelId") ?? "");
  const body = String(formData.get("body") ?? "");
  // Files, where the channel takes them, were uploaded beforehand and travel
  // as ids. A message without any is the ordinary insert it has always been.
  const attachmentIds = attachmentIdsFrom(formData);
  const result =
    attachmentIds.length > 0
      ? await persistMessageWithAttachments({ channelId, body, attachmentIds })
      : await persistMessage({ channelId, body });

  const communityId = String(formData.get("communityId") ?? "");
  if (!result.ok) {
    return { status: "error", error: (await translatorFor(communityId))(result.error) };
  }

  revalidatePath(`/community/${communityId}/channel/${channelId}`);
  revalidatePath(`/community/${communityId}`);
  return { status: "ok", message: result.message };
}

// ── Direct messages ────────────────────────────────────────────────────

function revalidateDirectMessages(communityId: string, conversationId?: string) {
  revalidatePath(`/community/${communityId}/messages`);
  if (conversationId) revalidatePath(`/community/${communityId}/messages/${conversationId}`);
  revalidatePath("/", "layout");
}

export async function startDirectConversationAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const recipientId = String(formData.get("recipientId") ?? "");
  const result = await startDirectConversation({ communityId, recipientId });

  if (!result.ok) redirect(`/community/${communityId}/messages?feil=start`);
  revalidateDirectMessages(communityId, result.conversationId);
  redirect(`/community/${communityId}/messages/${result.conversationId}`);
}

export async function startOrganizationPersonConversationAction(
  formData: FormData,
): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const fallbackCommunityId = String(formData.get("communityId") ?? "");
  const result = await startDirectConversationWithOrganizationPerson(
    String(formData.get("personId") ?? ""),
  );

  if (!result.ok) redirect(`/community/${fallbackCommunityId}/messages?feil=start`);
  revalidateDirectMessages(result.communityId, result.conversationId);
  redirect(`/community/${result.communityId}/messages/${result.conversationId}`);
}

export async function createDirectMessageAction(
  _prev: DirectMessageFormState,
  formData: FormData,
): Promise<DirectMessageFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const conversationId = String(formData.get("conversationId") ?? "");
  const communityId = String(formData.get("communityId") ?? "");
  const body = String(formData.get("body") ?? "");
  const attachmentIds = attachmentIdsFrom(formData);
  const result =
    attachmentIds.length > 0
      ? await persistDirectMessageWithAttachments({ conversationId, body, attachmentIds })
      : await persistDirectMessage({ conversationId, body });

  if (!result.ok) {
    return { status: "error", error: (await translatorFor(communityId))(result.error) };
  }
  revalidateDirectMessages(communityId, conversationId);
  return { status: "ok", message: result.message };
}

export async function setCommunityPersonAccountLinkAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const rawUserId = String(formData.get("userId") ?? "");
  const userId = rawUserId || null;

  await setCommunityPersonAccountLink({ personId, userId });
  revalidatePath(`/community/${communityId}/members`);
  revalidatePath(`/community/${communityId}/organization-links`);
  revalidatePath(`/community/${communityId}/lokallag`);
}

export async function setMembershipRoleAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (role === "member" || role === "moderator") {
    await setMembershipRole({ membershipId, role });
  }

  revalidatePath(`/community/${communityId}/members`);
}

// ── Comments and reactions ──────────────────────────────────────────────
//
// None of these take a community. A comment or a reaction is authorised by the
// post it belongs to, which the database resolves itself — so there is no
// community id in the form for anyone to tamper with.

/**
 * The community is needed only to refresh the right screens, never to decide
 * whether the write is allowed. Passing a wrong one revalidates a page the
 * caller may not even be able to see; it cannot grant access to anything.
 */
export async function createCommentAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const parentId = String(formData.get("parentId") ?? "");
  const result = await persistComment({
    postId: String(formData.get("postId") ?? ""),
    body: String(formData.get("body") ?? ""),
    parentId: parentId || undefined,
  });

  const communityId = String(formData.get("communityId") ?? "");
  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function updateCommentAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await editComment(
    String(formData.get("commentId") ?? ""),
    String(formData.get("body") ?? ""),
  );

  const communityId = String(formData.get("communityId") ?? "");
  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function deleteCommentAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await removeComment(String(formData.get("commentId") ?? ""));

  const communityId = String(formData.get("communityId") ?? "");
  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function toggleReactionAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await togglePostReaction(String(formData.get("postId") ?? ""), {
    emoji: String(formData.get("emoji") ?? "") || undefined,
    // A custom emoji id is checked against the post's own community by the
    // database; nothing here needs to trust it.
    emojiId: String(formData.get("emojiId") ?? "") || undefined,
  });

  const communityId = String(formData.get("communityId") ?? "");
  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePosts(communityId);
  return { status: "ok" };
}


// ── Direct message settings ─────────────────────────────────────────────

/**
 * Sets whether ordinary members of one community may open a DM with the
 * person making the request.
 *
 * The form carries a community and a boolean, and nothing else — no user id,
 * because the database takes the acting person from the session. Submitting
 * another community's id gets the caller's own membership of *that* community
 * checked, which for anyone who is not staff there is a refusal.
 */
export async function setAcceptsMemberDmsAction(
  _prev: DmSettingFormState,
  formData: FormData,
): Promise<DmSettingFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const value = formData.get("value") === "on";

  const stored = await setAcceptsMemberDms(communityId, value);

  // The function reports what is stored, so a refusal shows up as the value
  // not having moved rather than as an exception.
  if (stored !== value) {
    return { status: "error", error: (await translatorFor(communityId))("err.dmSettingFailed") };
  }

  revalidatePath(`/community/${communityId}/settings`);
  return { status: "ok", acceptsMemberDms: stored };
}



// ── Events ──────────────────────────────────────────────────────────────
//
// Neither action carries an identity. Who is signing up and who is hosting
// both come from auth.uid() inside the database, so a tampered form reaches a
// policy that refuses it rather than a check in this file.

function revalidateEvents(communityId: string, eventId?: string) {
  revalidatePath(`/community/${communityId}/events`);
  revalidatePath(`/community/${communityId}/lokallag`);
  if (eventId) revalidatePath(`/community/${communityId}/events/${eventId}`);
  revalidatePath(`/community/${communityId}`);
  revalidatePath("/events");
  revalidatePath("/home");
}

/**
 * Signs the caller up for an event, or withdraws them.
 *
 * One action for both directions: the form says which way it is going, and the
 * database decides whether it may. A full event is reported as its own thing —
 * being turned away because there is no room left is not the same as an error,
 * and the member has done nothing wrong.
 */
export async function rsvpEventAction(
  _prev: RsvpFormState,
  formData: FormData,
): Promise<RsvpFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const eventId = String(formData.get("eventId") ?? "");
  const communityId = String(formData.get("communityId") ?? "");
  const leaving = formData.get("leaving") === "1";

  const result = leaving ? await leaveEvent(eventId) : await joinEvent(eventId);

  if (!result.ok) {
    const t = await translatorFor(communityId);
    return { status: "error", error: t(result.error === "full" ? EVENT_FULL : RSVP_REFUSED) };
  }

  revalidateEvents(communityId, eventId);
  return { status: "ok", attending: !leaving };
}

/**
 * The fields the composer and the edit form share, checked the same way for
 * both. The date and the two times arrive as separate fields because that is
 * how a person fills them in; they are combined here into the instants the
 * columns want. Everything this checks, the events policies check again —
 * this exists to give a person a sentence rather than a failed write.
 *
 * `endDate` is optional and defaults to `date`; the edit form sends it only
 * for an event that already spans more than one day, so saving one cannot
 * quietly fold it into a single day.
 */
function readEventFields(
  formData: FormData,
  t: Translator,
):
  | {
      ok: true;
      fields: {
        title: string;
        description: string;
        location: string;
        startsAt: Date;
        endsAt: Date;
        capacity: number | undefined;
      };
    }
  | { ok: false; error: string } {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const endDate = String(formData.get("endDate") ?? "") || date;
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  if (!title) return { ok: false, error: t("err.eventTitleRequired") };
  if (title.length > 120) return { ok: false, error: t("err.eventTitleTooLong") };
  if (!location) return { ok: false, error: t("err.eventLocationRequired") };
  if (location.length > 120) return { ok: false, error: t("err.eventLocationTooLong") };
  if (description.length > 4000) return { ok: false, error: t("err.eventDescriptionTooLong") };
  if (!date || !startTime || !endTime) return { ok: false, error: t("err.eventDatesRequired") };

  // Resolved against the community's own zone rather than the server's, so
  // 18:00 means 18:00 in Oslo wherever this happens to be running.
  const startsAt = osloInstant(date, startTime);
  const endsAt = osloInstant(endDate, endTime);
  if (!startsAt || !endsAt) return { ok: false, error: t("err.eventDatesUnreadable") };
  if (endsAt <= startsAt) return { ok: false, error: t("err.eventEndsBeforeStart") };

  const rawCapacity = String(formData.get("capacity") ?? "").trim();
  const capacity = rawCapacity ? Number(rawCapacity) : undefined;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    return { ok: false, error: t("err.eventCapacityInvalid") };
  }

  return { ok: true, fields: { title, description, location, startsAt, endsAt, capacity } };
}

/** Creates an event. */
export async function createEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);

  const read = readEventFields(formData, t);
  if (!read.ok) return { status: "error", error: read.error };

  const scope = parseContentScope(String(formData.get("scope") ?? ""));
  const isPublic = formData.get("isPublic") === "on";
  // events_scoped_not_public: a lokallag or group event is private by
  // definition and never appears on the public portal.
  if (isPublic && (scope.localGroupId || scope.subgroupId)) {
    return { status: "error", error: t("err.eventScopedNotPublic") };
  }

  const result = await createEvent({
    communityId,
    ...scope,
    title: read.fields.title,
    description: read.fields.description,
    location: read.fields.location,
    startsAt: read.fields.startsAt.toISOString(),
    endsAt: read.fields.endsAt.toISOString(),
    isPublic,
    capacity: read.fields.capacity,
  });

  if (!result.ok) return { status: "error", error: t(EVENT_CREATE_REFUSED) };

  revalidateEvents(communityId, result.id);
  return { status: "ok" };
}

/**
 * Edits an event's title, description, time, place and capacity.
 *
 * Only those. The form carries no community, host, scope or visibility, and
 * nothing here would send them: an edit cannot move an event to another
 * community or audience, or hand it to someone else. Who may edit is
 * events_update's decision (can_manage_event); capacity below the current
 * RSVPs is refused here with the count, and again by the database.
 */
export async function updateEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const t = await translatorFor(communityId);

  const read = readEventFields(formData, t);
  if (!read.ok) return { status: "error", error: read.error };

  const event = await getEvent(eventId);
  if (!event || event.communityId !== communityId) {
    return { status: "error", error: t("err.eventEditRefused") };
  }
  if (read.fields.capacity !== undefined && read.fields.capacity < event.attendeeCount) {
    return {
      status: "error",
      error: t("err.eventCapacityBelowAttendees", { count: event.attendeeCount }),
    };
  }

  const result = await updateEvent(eventId, {
    title: read.fields.title,
    description: read.fields.description,
    location: read.fields.location,
    startsAt: read.fields.startsAt.toISOString(),
    endsAt: read.fields.endsAt.toISOString(),
    capacity: read.fields.capacity ?? null,
  });
  if (!result.ok) {
    return {
      status: "error",
      error:
        result.error === "capacity"
          ? t("err.eventCapacityBelowAttendees", { count: event.attendeeCount })
          : t("err.eventEditRefused"),
    };
  }

  revalidateEvents(communityId, eventId);
  return { status: "ok" };
}

const LIFECYCLE_ERRORS = {
  refused: "err.eventManageRefused",
  already_cancelled: "err.eventAlreadyCancelled",
  not_cancelled: "err.eventNotCancelled",
  ended: "err.eventAlreadyEnded",
  over_capacity: "err.eventRestoreOverCapacity",
} as const satisfies Record<string, MessageKey>;

/** Cancels an event. It stays, with every RSVP; sign-ups close. */
export async function cancelEventAction(
  _prev: EventLifecycleFormState,
  formData: FormData,
): Promise<EventLifecycleFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const t = await translatorFor(communityId);

  const result = await cancelEvent(eventId);
  if (result !== "ok") return { status: "error", error: t(LIFECYCLE_ERRORS[result]) };

  revalidateEvents(communityId, eventId);
  return { status: "ok", message: t("events.manage.cancelledNotice") };
}

/** Restores a cancelled event — a separate, explicit action, never a side effect of editing. */
export async function restoreEventAction(
  _prev: EventLifecycleFormState,
  formData: FormData,
): Promise<EventLifecycleFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const t = await translatorFor(communityId);

  const result = await restoreEvent(eventId);
  if (result !== "ok") return { status: "error", error: t(LIFECYCLE_ERRORS[result]) };

  revalidateEvents(communityId, eventId);
  return { status: "ok", message: t("events.manage.restoredNotice") };
}

/**
 * Takes one person's registration off an event (organisers only —
 * remove_event_attendee decides). Only ids travel in the form; the person is
 * told by an in-app notification written in the same transaction. The name in
 * the success message is the community display name the caller already sees
 * on the roster.
 */
export async function removeEventAttendeeAction(
  _prev: EventLifecycleFormState,
  formData: FormData,
): Promise<EventLifecycleFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const t = await translatorFor(communityId);

  const result = await removeEventAttendee(eventId, userId);
  if (result !== "ok") {
    const key = {
      refused: "err.attendeeRemoveRefused",
      cancelled: "err.attendeeRemoveCancelled",
      ended: "err.eventAlreadyEnded",
      not_attending: "err.attendeeRemoveNotAttending",
    } as const satisfies Record<Exclude<typeof result, "ok">, MessageKey>;
    return { status: "error", error: t(key[result]) };
  }

  const person = await getCommunityPersona(communityId, userId);
  revalidateEvents(communityId, eventId);
  return { status: "ok", message: t("events.roster.removed", { name: person.name }) };
}

/**
 * Permanently deletes an event and its RSVPs. Admins of its community only —
 * events_delete decides. The form must also carry the second, explicit
 * acknowledgement; without it nothing is sent to the database.
 */
export async function deleteEventAction(
  _prev: EventLifecycleFormState,
  formData: FormData,
): Promise<EventLifecycleFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const t = await translatorFor(communityId);
  if (formData.get("acknowledged") !== "on") {
    return { status: "error", error: t("err.eventDeleteUnconfirmed") };
  }

  const ok = await deleteEvent(eventId);
  if (!ok) return { status: "error", error: t("err.eventDeleteRefused") };

  revalidateEvents(communityId);
  redirect(`/community/${communityId}/events`);
}

// ── Subgroups (teams) ───────────────────────────────────────────────────
//
// Only ids travel in the form. Whether the caller may manage this subgroup
// (community admin or explicit manager), whether the person is an active member
// of the same community, and whether they are already in it, is decided by
// add_subgroup_member() / remove_subgroup_member() from auth.uid(). Neither
// touches anyone's community role, lokallag or authored content.

const SUBGROUP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidateSubgroups(communityId: string) {
  revalidatePath(`/community/${communityId}/grupper`);
  revalidatePath(`/community/${communityId}`, "layout");
}

export async function addSubgroupMemberAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: t("err.subgroupPickMember") };

  const ok = await addSubgroupMember(String(formData.get("subgroupId") ?? ""), userId);
  if (!ok) return { status: "error", error: t("err.subgroupAddRefused") };

  revalidateSubgroups(communityId);
  return { status: "ok" };
}

export async function removeSubgroupMemberAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const ok = await removeSubgroupMember(
    String(formData.get("subgroupId") ?? ""),
    String(formData.get("userId") ?? ""),
  );
  if (!ok) return { status: "error", error: (await translatorFor(communityId))("err.subgroupRemoveRefused") };

  revalidateSubgroups(communityId);
  return { status: "ok" };
}

/**
 * Creates a private group and opens its chat.
 *
 * The members are the ids the form collected; `create_subgroup()` refuses the
 * whole request if any of them is not an active member of this community, and
 * refuses anyone who is not an admin or moderator of it, so nothing is created
 * half-way and nothing here decides who may.
 */
export async function createSubgroupAction(
  _prev: SubgroupCreateFormState,
  formData: FormData,
): Promise<SubgroupCreateFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);

  const input = normalizeSubgroupDetails(
    String(formData.get("name") ?? ""),
    String(formData.get("description") ?? ""),
    t,
  );
  if (!input.ok) return { status: "error", error: input.message };

  const memberIds = [
    ...new Set(formData.getAll("memberIds").map(String).filter((id) => SUBGROUP_UUID.test(id))),
  ].slice(0, SUBGROUP_MEMBERS_MAX);

  const result = await createSubgroup({
    communityId,
    name: input.name,
    description: input.description,
    memberIds,
  });
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidateSubgroups(communityId);
  // The creator is a member, so `channels_select` returns the new chat.
  const channel = (await getChannels(communityId)).find((c) => c.subgroupId === result.subgroupId);
  redirect(
    channel
      ? `/community/${communityId}/channel/${channel.id}`
      : `/community/${communityId}/grupper`,
  );
}

/**
 * The member search behind the create form. Called from the browser as the
 * person types, so every argument is treated as text from a stranger; the
 * database answers only someone who may create a group in that community,
 * with at most ten display names.
 */
export async function searchNewSubgroupCandidatesAction(input: {
  communityId: string;
  query: string;
}): Promise<SubgroupCandidate[]> {
  const user = await getSessionUser();
  if (!user) return [];

  return searchNewSubgroupCandidates(
    String(input?.communityId ?? "").slice(0, 120),
    String(input?.query ?? "").slice(0, 80),
  );
}

export async function updateSubgroupDetailsAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const input = normalizeSubgroupDetails(
    String(formData.get("name") ?? ""),
    String(formData.get("description") ?? ""),
    t,
  );
  if (!input.ok) return { status: "error", error: input.message };

  const ok = await setSubgroupDetails(String(formData.get("subgroupId") ?? ""), input.name, input.description);
  if (!ok) return { status: "error", error: t("err.subgroupEditRefused") };

  revalidateSubgroups(communityId);
  return { status: "ok" };
}

/** Community admins only; the database refuses everyone else. */
export async function setSubgroupManagerAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const ok =
    SUBGROUP_UUID.test(userId) &&
    (await setSubgroupManager(
      String(formData.get("subgroupId") ?? ""),
      userId,
      formData.get("isManager") === "true",
    ));
  if (!ok) return { status: "error", error: (await translatorFor(communityId))("err.subgroupManagerRefused") };

  revalidateSubgroups(communityId);
  return { status: "ok" };
}

/** Archives or reopens. Nothing is deleted either way. */
export async function setSubgroupArchivedAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const ok = await setSubgroupArchived(
    String(formData.get("subgroupId") ?? ""),
    formData.get("archived") === "true",
  );
  if (!ok) return { status: "error", error: (await translatorFor(communityId))("err.subgroupArchiveRefused") };

  revalidateSubgroups(communityId);
  return { status: "ok" };
}

/**
 * Permanently deletes a group with its chat and messages.
 *
 * `delete_subgroup()` decides everything: that the caller may manage the
 * group, and that no post or event is still scoped to it — in which case
 * nothing is deleted and the dialog says why. "Deleted" is only ever shown
 * once the database has confirmed.
 */
export async function deleteSubgroupAction(
  _prev: SubgroupFormState,
  formData: FormData,
): Promise<SubgroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await deleteSubgroup(String(formData.get("subgroupId") ?? ""));
  if (!result.ok) return { status: "error", error: (await translatorFor(communityId))(result.error) };

  purgeAttachmentsAfterResponse();
  revalidateSubgroups(communityId);
  return { status: "ok" };
}

// ── Private lokallag channels ───────────────────────────────────────────
//
// Only ids and the two text fields travel in the forms. Whether the caller may
// create a channel under this lokallag (community admin, or its
// lokallagsleder), whether they may manage this channel, and whether each
// person is an active member of the channel's lokallag, is decided by the
// database functions from auth.uid(). A tampered id reaches a function that
// refuses it, not a check in this file.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidatePrivateChannel(communityId: string, channelId: string) {
  revalidatePath(`/community/${communityId}/channel/${channelId}`);
  // The channel list is in the sidebar (layout).
  revalidatePath(`/community/${communityId}`, "layout");
}

/**
 * Creates a private channel under a lokallag and opens it.
 *
 * The participants are the ids the form collected; `create_private_channel()`
 * refuses the whole request if any of them is not an active member of that
 * lokallag, so nothing is created half-way.
 */
export async function createPrivateChannelAction(
  _prev: PrivateChannelCreateFormState,
  formData: FormData,
): Promise<PrivateChannelCreateFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);

  const input = normalizeChannelDetails(
    String(formData.get("name") ?? ""),
    String(formData.get("purpose") ?? ""),
    t,
  );
  if (!input.ok) return { status: "error", error: input.message };

  const participantIds = [
    ...new Set(formData.getAll("participantIds").map(String).filter((id) => UUID.test(id))),
  ].slice(0, PRIVATE_CHANNEL_PARTICIPANTS_MAX);

  const result = await createPrivateChannel({
    localGroupId: String(formData.get("localGroupId") ?? ""),
    name: input.name,
    purpose: input.purpose,
    participantIds,
  });
  if (!result.ok) return { status: "error", error: t(result.error) };

  revalidatePath(`/community/${communityId}`, "layout");
  redirect(`/community/${communityId}/channel/${result.channelId}`);
}

/**
 * The participant search behind the create form and the channel's participant
 * list. Called from the browser as the person types, so every argument is
 * treated as text from a stranger; the database answers only someone who may
 * create a channel under that lokallag or manage that channel, with at most
 * ten display names.
 */
export async function searchPrivateChannelCandidatesAction(input: {
  localGroupId: string;
  query: string;
  channelId?: string;
}): Promise<PrivateChannelCandidate[]> {
  const user = await getSessionUser();
  if (!user) return [];

  const localGroupId = String(input?.localGroupId ?? "");
  if (!UUID.test(localGroupId)) return [];

  return searchPrivateChannelCandidates(
    localGroupId,
    String(input?.query ?? "").slice(0, 80),
    input?.channelId ? String(input.channelId) : undefined,
  );
}

export async function addPrivateChannelParticipantAction(
  _prev: PrivateChannelFormState,
  formData: FormData,
): Promise<PrivateChannelFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const ok = UUID.test(userId) && (await addPrivateChannelParticipant(channelId, userId));
  if (!ok) return { status: "error", error: (await translatorFor(communityId))("err.privateChannelAddRefused") };

  revalidatePrivateChannel(communityId, channelId);
  return { status: "ok" };
}

export async function removePrivateChannelParticipantAction(
  _prev: PrivateChannelFormState,
  formData: FormData,
): Promise<PrivateChannelFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const ok = UUID.test(userId) && (await removePrivateChannelParticipant(channelId, userId));
  if (!ok) {
    return { status: "error", error: (await translatorFor(communityId))("err.privateChannelRemoveRefused") };
  }

  revalidatePrivateChannel(communityId, channelId);
  return { status: "ok" };
}

/** Community admins only; the database refuses everyone else. */
export async function setPrivateChannelManagerAction(
  _prev: PrivateChannelFormState,
  formData: FormData,
): Promise<PrivateChannelFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const ok =
    UUID.test(userId) &&
    (await setPrivateChannelManager(channelId, userId, formData.get("isManager") === "true"));
  if (!ok) {
    return { status: "error", error: (await translatorFor(communityId))("err.privateChannelManagerRefused") };
  }

  revalidatePrivateChannel(communityId, channelId);
  return { status: "ok" };
}

/** Archives or reopens. No message is deleted either way. */
export async function setPrivateChannelArchivedAction(
  _prev: PrivateChannelFormState,
  formData: FormData,
): Promise<PrivateChannelFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");
  const ok = await setPrivateChannelArchived(channelId, formData.get("archived") === "true");
  if (!ok) {
    return { status: "error", error: (await translatorFor(communityId))("err.privateChannelArchiveRefused") };
  }

  revalidatePrivateChannel(communityId, channelId);
  return { status: "ok" };
}

/**
 * Permanently deletes a private lokallag channel and lands on its lokallag's
 * main chat.
 *
 * `delete_private_channel()` decides everything: that the channel is a private
 * one, and that the caller may manage it — an admin of its community, or a
 * lokallagsleder who manages it. Nothing here does. The channel is read first
 * only to know where to go afterwards; a channel the caller cannot read gives
 * no destination and no deletion either. The redirect happens only once the
 * database has confirmed, so there is never a "deleted" on screen for a
 * channel that is still there.
 */
export async function deletePrivateChannelAction(
  _prev: PrivateChannelFormState,
  formData: FormData,
): Promise<PrivateChannelFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");

  const channel = await getChannel(channelId);
  const main =
    channel?.isPrivate && channel.localGroupId
      ? await getLocalGroupChannel(channel.communityId, channel.localGroupId)
      : undefined;

  const ok = channel?.isPrivate === true && (await deletePrivateChannel(channel.id));
  if (!ok || !channel) {
    return { status: "error", error: (await translatorFor(communityId))("err.privateChannelDeleteRefused") };
  }

  purgeAttachmentsAfterResponse();
  // The channel was in the sidebar (layout) of everyone who could read it.
  revalidatePath(`/community/${channel.communityId}`, "layout");
  redirect(
    main
      ? `/community/${channel.communityId}/channel/${main.id}`
      : `/community/${channel.communityId}`,
  );
}

// ── Local groups ────────────────────────────────────────────────────────
//
// None of these carry a user id. Which membership is being changed, and
// whether the caller administers the community, is decided inside the database
// from auth.uid(), so a tampered field reaches a function that refuses it
// rather than a check in this file.

function revalidateLocalGroups(communityId: string) {
  revalidatePath(`/community/${communityId}/lokallag`);
  revalidatePath(`/community/${communityId}`);
}

/**
 * The member's own choice: a group, or none.
 *
 * An empty value is not a failed submission — it is "Jeg vil ikke velge
 * lokallag nå", and it clears the selection.
 */
export async function setMyLocalGroupAction(
  _prev: LocalGroupFormState,
  formData: FormData,
): Promise<LocalGroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");

  // The clear button carries its own field rather than an empty localGroupId,
  // because a radio may well be checked at the same moment and would win. When
  // it is present the selection goes, whatever else the form said.
  const clearing = formData.get("clear") === "1";
  const raw = clearing ? "" : String(formData.get("localGroupId") ?? "");

  const ok = await setMyLocalGroup(communityId, raw || null);
  if (!ok) return { status: "error", error: (await translatorFor(communityId))(SELECTION_REFUSED) };

  revalidateLocalGroups(communityId);
  // Declining the first choice returns to this community's Overview.
  if (clearing && formData.get("skipTo") === "overview") redirect(`/community/${communityId}`);
  // The on-demand editor ends at the canonical page, without its `?endre=1`.
  if (formData.get("returnTo") === "lokallag") redirect(`/community/${communityId}/lokallag`);
  return { status: "ok" };
}

export async function createLocalGroupAction(
  _prev: LocalGroupFormState,
  formData: FormData,
): Promise<LocalGroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: t("err.localGroupNameRequired") };

  const ok = await createLocalGroup(communityId, name);
  if (!ok) return { status: "error", error: t(ADMIN_REFUSED) };

  revalidateLocalGroups(communityId);
  return { status: "ok" };
}

export async function renameLocalGroupAction(
  _prev: LocalGroupFormState,
  formData: FormData,
): Promise<LocalGroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: t("err.localGroupNameRequired") };

  const ok = await renameLocalGroup(String(formData.get("localGroupId") ?? ""), name);
  if (!ok) return { status: "error", error: t(ADMIN_REFUSED) };

  revalidateLocalGroups(communityId);
  return { status: "ok" };
}

/**
 * Retires or reinstates a group. Never deletes it, and never moves the people
 * attached to it — they keep the affiliation they chose.
 */
export async function setLocalGroupActiveAction(
  _prev: LocalGroupFormState,
  formData: FormData,
): Promise<LocalGroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const ok = await setLocalGroupActive(
    String(formData.get("localGroupId") ?? ""),
    formData.get("active") === "on",
  );
  if (!ok) return { status: "error", error: (await translatorFor(communityId))(ADMIN_REFUSED) };

  revalidateLocalGroups(communityId);
  return { status: "ok" };
}

// ── Lokallagsledere ─────────────────────────────────────────────────────
//
// Only ids travel in the form. Whether the caller is an active admin of the
// lokallag's community, and whether the person is an active member of exactly
// that lokallag, is decided by add_local_group_manager() and
// remove_local_group_manager() from auth.uid() — hiding these controls from
// everyone else is presentation, not the check.

function revalidateLeadership(communityId: string) {
  revalidateLocalGroups(communityId);
  // A leader's event composer and roster access follow the appointment.
  revalidatePath(`/community/${communityId}/events`, "layout");
}

export async function addLocalGroupLeaderAction(
  _prev: LocalGroupLeaderFormState,
  formData: FormData,
): Promise<LocalGroupLeaderFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: t("err.localGroupLeaderPick") };

  const ok = await addLocalGroupLeader(String(formData.get("localGroupId") ?? ""), userId);
  if (!ok) return { status: "error", error: t("err.localGroupLeaderAddRefused") };

  const person = await getCommunityPersona(communityId, userId);
  revalidateLeadership(communityId);
  return { status: "ok", message: t("lokallag.leaders.appointed", { name: person.name }) };
}

export async function removeLocalGroupLeaderAction(
  _prev: LocalGroupLeaderFormState,
  formData: FormData,
): Promise<LocalGroupLeaderFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const userId = String(formData.get("userId") ?? "");

  const ok = await removeLocalGroupLeader(String(formData.get("localGroupId") ?? ""), userId);
  if (!ok) return { status: "error", error: t("err.localGroupLeaderRemoveRefused") };

  const person = await getCommunityPersona(communityId, userId);
  revalidateLeadership(communityId);
  return { status: "ok", message: t("lokallag.leaders.removed", { name: person.name }) };
}

// ── Custom emojis ───────────────────────────────────────────────────────
//
// Authorisation is the database's, twice over: the storage policies require
// can_moderate() on the community in the object path, and the table policy
// requires it again for the metadata row. What happens here is validation of
// the file itself, which no policy can do — Storage checks size and declared
// MIME type, but it cannot tell a 4000-pixel image from an emoji, nor a PNG
// that has been renamed to .gif.

export async function createEmojiAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const name = normalizeEmojiName(String(formData.get("name") ?? ""));
  const nameError = validateEmojiName(name, t);
  if (nameError) return { status: "error", message: nameError };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: t("err.chooseFile") };
  }

  // Decided from the bytes, never from the filename or the declared type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectEmojiImage(bytes, t);
  if (!image.ok) return { status: "error", message: image.error };

  const result = await persistEmoji({
    communityId,
    name,
    bytes,
    contentType: image.contentType,
    extension: image.extension,
  });

  if (!result.ok) return { status: "error", message: t(result.error, { name }) };
  revalidatePath(`/community/${communityId}/emojis`);
  revalidatePosts(communityId);
  return { status: "ok" };
}

export async function deleteEmojiAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const result = await removeEmoji(String(formData.get("emojiId") ?? ""));

  if (!result.ok) {
    return { status: "error", message: (await translatorFor(communityId))(result.error) };
  }
  revalidatePath(`/community/${communityId}/emojis`);
  revalidatePosts(communityId);
  return { status: "ok" };
}


// ── Community profile image ─────────────────────────────────────────────
//
// The image shown for a community inside the signed-in app. Only the
// community's active administrator may change it. The check here exists to
// give a clear answer before any bytes are read; it is not what protects the
// data — the storage policies and set_community_avatar() each require
// is_admin() on their own, and the community id a caller sends is only ever an
// argument to those, never proof of anything.

const AVATAR_ADMIN_ONLY = "err.avatarAdminOnly" as const;

async function isActiveAdmin(userId: string, communityId: string) {
  const membership = await getMembership(userId, communityId);
  return membership?.role === "admin" && membership.status === "active";
}

export async function setCommunityAvatarAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  if (!(await isActiveAdmin(user.id, communityId))) {
    return { status: "error", message: t(AVATAR_ADMIN_ONLY) };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: t("err.chooseFile") };
  }

  // Decided from the bytes, never from the filename or the declared type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectCommunityAvatar(bytes, t);
  if (!image.ok) return { status: "error", message: image.error };

  const result = await setCommunityAvatar({
    communityId,
    bytes,
    contentType: image.contentType,
    extension: image.extension,
  });
  if (!result.ok) return { status: "error", message: t(result.error) };

  // The image appears in the shell of every signed-in page, so the whole app
  // layout is refreshed rather than a list of routes.
  revalidatePath("/", "layout");
  return { status: "ok", message: t("ok.avatarUpdated") };
}

export async function removeCommunityAvatarAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  if (!(await isActiveAdmin(user.id, communityId))) {
    return { status: "error", message: t(AVATAR_ADMIN_ONLY) };
  }

  const result = await clearCommunityAvatar(communityId);
  if (!result.ok) return { status: "error", message: t(result.error) };

  revalidatePath("/", "layout");
  return { status: "ok", message: t("ok.avatarRemoved") };
}

// ── Your profile in a community ─────────────────────────────────────────
//
// Name, bio and photo for one community. The membership check here only
// gives a clear answer early; what actually protects the data is that the
// database functions and storage policies take the person from auth.uid()
// and require an active membership themselves. There is no user id in any of
// these forms, so nobody — an administrator included — can aim one at
// somebody else's profile.

const PROFILE_INACTIVE = "err.profileInactive" as const;

async function isActiveMember(userId: string, communityId: string) {
  return (await getMembership(userId, communityId))?.status === "active";
}

export async function updateCommunityProfileAction(
  _prev: CommunityProfileFormState,
  formData: FormData,
): Promise<CommunityProfileFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  if (!(await isActiveMember(user.id, communityId))) {
    return { status: "error", message: t(PROFILE_INACTIVE) };
  }

  const name = normalizeDisplayName(String(formData.get("displayName") ?? ""), t);
  if (!name.ok) return { status: "error", message: name.message };
  const bio = normalizeBio(String(formData.get("bio") ?? ""), t);
  if (!bio.ok) return { status: "error", message: bio.message };

  const result = await updateMyCommunityProfile({
    communityId,
    displayName: name.value,
    bio: bio.value,
  });
  if (!result.ok) return { status: "error", message: t(result.error) };

  // The name appears on every screen of the community and in the shell.
  revalidatePath("/", "layout");
  return { status: "ok", message: t("ok.profileSaved") };
}

/**
 * Dismisses the "Kom i gang" welcome card for the caller's own membership in
 * one community — from either "Hopp over" or the close icon.
 *
 * The community id is the only input, and it is not trusted for anything but
 * naming the row: `dismiss_my_onboarding()` takes the user from auth.uid(),
 * touches only that membership's dismissal timestamp, and refuses a community
 * the caller is not an active member of. Repeating it is harmless.
 */
export async function dismissOnboardingAction(communityId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (typeof communityId !== "string" || communityId === "") return { ok: false };

  const ok = await dismissMyOnboarding(communityId);
  if (ok) revalidatePath(`/community/${communityId}`);
  return { ok };
}

/**
 * Updates the "Om fellesskapet" text on the community overview page.
 *
 * Visibility of the pencil that opens this form is decided by role, in the
 * page — but that is presentation only. Whether the write actually happens is
 * decided again here, from scratch, by `set_community_about()`: the function
 * reads `auth.uid()` itself and refuses anyone who is not an active admin of
 * exactly this community, so a forged request to this action gets the same
 * refusal a forged request straight to the database would.
 */
export async function updateCommunityAboutAction(
  _prev: CommunityAboutFormState,
  formData: FormData,
): Promise<CommunityAboutFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);

  const about = normalizeCommunityAbout(String(formData.get("about") ?? ""), t);
  if (!about.ok) return { status: "error", message: about.message };

  const result = await setCommunityAbout(communityId, about.value);
  if (!result.ok) return { status: "error", message: t(result.error) };

  revalidatePath(`/community/${communityId}`);
  revalidatePath(`/community/${communityId}/settings`);
  return { status: "ok", about: result.about };
}

/**
 * Updates a channel's display name and description.
 *
 * The pencil is shown to admins only (and, on a private lokallag channel, to
 * whoever manages it), but that is presentation: the write is decided again by
 * `set_channel_details()`, which checks that the caller may edit this channel
 * and that the channel is in this community.
 */
export async function updateChannelDetailsAction(
  _prev: ChannelEditFormState,
  formData: FormData,
): Promise<ChannelEditFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const channelId = String(formData.get("channelId") ?? "");
  const t = await translatorFor(communityId);

  const input = normalizeChannelDetails(
    String(formData.get("name") ?? ""),
    String(formData.get("purpose") ?? ""),
    t,
  );
  if (!input.ok) return { status: "error", message: input.message };

  const result = await setChannelDetails(communityId, channelId, input.name, input.purpose);
  if (!result.ok) return { status: "error", message: t(result.error) };

  // The name is in the sidebar (layout) as well as the channel page.
  revalidatePath("/", "layout");
  return { status: "ok", name: result.name, purpose: result.purpose };
}

export async function setMyCommunityAvatarAction(
  _prev: CommunityProfileFormState,
  formData: FormData,
): Promise<CommunityProfileFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  if (!(await isActiveMember(user.id, communityId))) {
    return { status: "error", message: t(PROFILE_INACTIVE) };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: t("err.chooseFile") };
  }

  // Same validator as the community image: decided from the bytes.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectCommunityAvatar(bytes, t);
  if (!image.ok) return { status: "error", message: image.error };

  const result = await setMyCommunityAvatar({
    communityId,
    userId: user.id,
    bytes,
    contentType: image.contentType,
    extension: image.extension,
  });
  if (!result.ok) return { status: "error", message: t(result.error) };

  revalidatePath("/", "layout");
  return { status: "ok", message: t("ok.avatarUpdated") };
}

export async function removeMyCommunityAvatarAction(
  _prev: CommunityProfileFormState,
  formData: FormData,
): Promise<CommunityProfileFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  if (!(await isActiveMember(user.id, communityId))) {
    return { status: "error", message: t(PROFILE_INACTIVE) };
  }

  const result = await clearMyCommunityAvatar(communityId);
  if (!result.ok) return { status: "error", message: t(result.error) };

  revalidatePath("/", "layout");
  return { status: "ok", message: t("ok.avatarRemovedInitials") };
}

// ── Access requests and invitations ─────────────────────────────────────

/**
 * The public request form.
 *
 * Answers the same way no matter what the database found. The only distinctions
 * it draws are a malformed address and a missing or unusable name, which
 * describe the input rather than any person or community.
 */
export async function requestAccessAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  // The reply is written in the language of the portal being asked. A portal's
  // slug is public, so this reveals nothing the page itself does not.
  const slug = String(formData.get("slug") ?? "");
  const portal = slug ? await getPortalCommunity(slug) : undefined;
  const t = communityTranslator(portal);

  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return { status: "error", message: t("err.emailInvalid") };
  }

  // A name or pseudonym is required for every community. Empty and
  // whitespace-only values are rejected here as well as in the form, and the
  // trimmed value is what gets sent on. `request_community_access()` enforces
  // the same rule for anyone who bypasses this action entirely. Like the
  // address check above, this describes the input and nothing about any
  // community or its members.
  const name = normalizeDisplayName(String(formData.get("displayName") ?? ""), t);
  if (!name.ok) {
    return { status: "error", message: name.message };
  }

  const accepted = await requestCommunityAccess({
    slug,
    email,
    displayName: name.value,
  });

  // `false` only ever means the request was not usable as submitted — input the
  // database refused, or a failed call — never something about a community or
  // its members. Every valid submission answers `true`, whatever became of it.
  if (!accepted) {
    return { status: "error", message: t("err.requestFailed") };
  }

  // Note what is *not* branched on: which valid outcome this was. A community
  // that does not take applications, an address that already belongs to a
  // member and a brand new request all end here.
  return { status: "ok", message: t(REQUEST_SENT_KEY) };
}

/**
 * Approves a request, then sends the one email the person needs.
 *
 * What the database decided shapes the email, never the other way round:
 *
 * - `invited` (no usable TING account): the email carries the invitation and a
 *   Supabase sign-in token, so a single click signs the person in and accepts.
 *   Minting that token creates the account now, unconfirmed and with no
 *   memberships (see lib/email-sign-in-link.ts).
 * - `activated` (an existing account): access is already active. The email is
 *   a convenient way in, not a condition — if it cannot be sent, the
 *   membership stands and the admin is told the mail failed.
 *
 * Only a request that was still pending sends anything, so a second click or
 * a stale page cannot mail the same person twice.
 */
export async function approveRequestAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  const t = await translatorFor(communityId);
  const wasPending = (await getAccessRequests(communityId)).some((request) => request.id === requestId);
  const minted = await approveAccessRequest(requestId);

  if (!minted) {
    return { status: "error", message: t("err.approveFailed") };
  }

  revalidatePath(`/community/${communityId}/requests`);

  if (minted.outcome === "activated") {
    if (!wasPending) return { status: "ok", message: t("ok.approvedAlready") };
    const sent = await deliverApprovalEmail({ ...minted, kind: "existing" }, t);
    return {
      status: "ok",
      message: sent.ok
        ? t("ok.approvedActivatedSent", { email: minted.email })
        : t("ok.approvedActivatedMailFailed", { email: minted.email }),
    };
  }

  if (!minted.token) {
    return { status: "ok", message: t("ok.approvedAlready") };
  }

  const sent = await deliverApprovalEmail({ ...minted, kind: "new" }, t);
  return sent.ok
    ? { status: "ok", message: t("ok.approvedSent", { email: minted.email }) }
    : { status: "error", message: sent.message };
}

export async function rejectRequestAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const ok = await rejectAccessRequest(String(formData.get("requestId") ?? ""));
  revalidatePath(`/community/${communityId}/requests`);

  return ok
    ? { status: "ok", message: t("ok.rejected") }
    : { status: "error", message: t("err.rejectFailed") };
}

/**
 * Issues a fresh invitation and a fresh sign-in token, and revokes the old
 * invitation. The account an earlier approval created is reused as it is —
 * resending never deletes or recreates anyone.
 */
export async function resendInvitationAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const minted = await resendInvitation(String(formData.get("invitationId") ?? ""));
  revalidatePath(`/community/${communityId}/requests`);

  if (!minted?.token) {
    return { status: "error", message: t("err.resendFailed") };
  }

  const sent = await deliverApprovalEmail({ ...minted, kind: "new" }, t);
  return sent.ok
    ? { status: "ok", message: t("ok.resent", { email: minted.email }) }
    : { status: "error", message: sent.message };
}

/**
 * Mints the sign-in token and hands the one approval email to the provider,
 * in the community's language.
 *
 * Runs only after the database has authorised the approval or resend for the
 * caller, and only for the address the database returned. The service-role
 * client is created here, on the server, for `generateLink` alone; it never
 * reaches a browser. If Supabase cannot mint a token, the email still goes
 * out and the page falls back to asking for a sign-in link — slower, but the
 * approval is never lost to an auth hiccup.
 */
async function deliverApprovalEmail(
  minted: {
    kind: "new" | "existing";
    token: string | null;
    email: string;
    communityId: string;
    expiresAt: string | null;
  },
  t: Translator,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (minted.kind === "new" && (!minted.token || !minted.expiresAt)) {
    return { ok: false, message: t("err.noInvitation") };
  }

  const community = await getCommunityById(minted.communityId);
  const origin = await siteOrigin();
  const signIn = await mintEmailSignInLink(createSupabaseAdminClient(), {
    email: minted.email,
    communityId: minted.communityId,
  }).catch(() => null);

  const params = new URLSearchParams();
  if (signIn) params.set("innlogging", signIn.tokenHash);
  let acceptUrl: string;
  if (minted.kind === "new") {
    acceptUrl = `${origin}/invitasjon/${minted.token}${params.size ? `?${params}` : ""}`;
  } else if (signIn && community) {
    params.set("f", community.slug);
    acceptUrl = `${origin}/velkommen?${params}`;
  } else {
    acceptUrl = `${origin}/login?neste=${encodeURIComponent(`/community/${minted.communityId}`)}`;
  }

  const result = await sendInvitationEmail({
    to: minted.email,
    kind: minted.kind,
    origin,
    communityName: community?.name ?? t("common.theCommunity"),
    locale: community ? communityLocale(community) : PLATFORM_LOCALE,
    acceptUrl,
    signInExpiresAt: signIn
      ? // Never promise sign-in past the invitation's own expiry.
        minted.expiresAt && minted.expiresAt < signIn.signInExpiresAt
        ? minted.expiresAt
        : signIn.signInExpiresAt
      : undefined,
    invitationExpiresAt: minted.expiresAt ?? undefined,
    accent: community?.branding.accent ?? "#1f4a3d",
  });

  // The approval stands either way; only the delivery failed. Saying so lets
  // an admin resend rather than wonder whether the approval took.
  return result.ok
    ? { ok: true }
    : { ok: false, message: t("err.emailNotSent", { error: result.error }) };
}

/**
 * The button on the invitation page an approval email opens: signs in with
 * the email's Supabase token (or uses the session already here, if it is the
 * invited account) and accepts the invitation, then goes straight to the
 * community's Overview.
 *
 * A POST, deliberately: the page's GET only renders, so a mail scanner or link
 * preview that fetches the URL spends neither token. `switch` is set only by
 * the explicit "sign out and continue as …" button; without it, a different
 * account's session is refused, never replaced.
 */
export async function redeemInvitationLinkAction(
  _prev: InvitationLinkState,
  formData: FormData,
): Promise<InvitationLinkState> {
  const token = String(formData.get("token") ?? "");
  const tokenHash = String(formData.get("innlogging") ?? "") || undefined;
  const t = translator(parseLocale(formData.get("locale")));

  const outcome = await redeemInvitationWithEmailLink({
    token,
    tokenHash,
    switchAccount: formData.get("switch") === "1",
  });

  switch (outcome.status) {
    case "joined":
      revalidatePath("/", "layout");
      redirect(`/community/${outcome.communityId}`);
    case "mismatch":
      return { status: "mismatch" };
    case "link-expired":
      return { status: "link-expired" };
    case "unavailable":
      return { status: "error", message: t("err.authUnavailable") };
    case "refused":
      if (outcome.reason === PASSWORD_REQUIRED) {
        revalidatePath("/", "layout");
        redirect(passwordSetupPath(token));
      }
      return { status: "error", message: t(invitationFailure(outcome.reason)) };
  }
}

/**
 * The existing-account variant (`/velkommen`): signs in with the email's
 * token and goes to the community. Access was activated at approval; this
 * grants nothing, and the destination comes from the database.
 */
export async function enterCommunityLinkAction(
  _prev: InvitationLinkState,
  formData: FormData,
): Promise<InvitationLinkState> {
  const t = translator(parseLocale(formData.get("locale")));
  const outcome = await enterCommunityWithEmailLink({
    tokenHash: String(formData.get("innlogging") ?? ""),
    communitySlug: String(formData.get("f") ?? ""),
  });

  if (outcome.status === "entered") {
    revalidatePath("/", "layout");
    redirect(outcome.path);
  }
  return outcome.status === "unavailable"
    ? { status: "error", message: t("err.authUnavailable") }
    : { status: "link-expired" };
}

/** Redeems a token for the signed-in account. */
export async function acceptInvitationAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // The invitation page tells the form which language it is in. It only
  // chooses the words of a refusal; the token and the address match are what
  // decide whether anything is granted.
  const t = translator(parseLocale(formData.get("locale")));
  const token = String(formData.get("token") ?? "");
  const result = await acceptInvitationToken(token);
  if (!result.ok) {
    if (result.reason === PASSWORD_REQUIRED) redirect(passwordSetupPath(token));
    return { status: "error", message: t(invitationFailure(result.reason)) };
  }

  revalidatePath("/home");
  revalidatePath("/communities");

  // Straight to the Overview. A newly active membership is welcomed there by
  // the "Kom i gang" card, which is also where choosing a lokallag is offered
  // — optional, alongside the other first steps, rather than as a detour
  // before the person has seen the community at all.
  redirect(`/community/${result.communityId}`);
}

/** `accept_invitation_token()`'s answer to an account that has no password yet. */
const PASSWORD_REQUIRED = "password-required";

/**
 * Where an invitation sends an account that has signed in but not chosen a
 * password: the password step, and from there straight back to the
 * invitation. Nothing has been joined yet — the database will not activate a
 * membership for an account without a password — so there is nothing to use
 * in the meantime, whichever way someone tries.
 */
function passwordSetupPath(token: string): string {
  return `/opprett-passord?neste=${encodeURIComponent(`/invitasjon/${encodeURIComponent(token)}`)}`;
}

function invitationFailure(reason: string): MessageKey {
  switch (reason) {
    case "email-mismatch":
      return "err.invitation.mismatch";
    case "already-used":
      return "err.invitation.used";
    case "expired":
      return "err.invitation.expired";
    case "revoked":
      return "err.invitation.revoked";
    default:
      return "err.invitation.invalid";
  }
}
