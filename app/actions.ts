"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  acceptInvitationToken,
  approveAccessRequest,
  createComment as persistComment,
  createLocalGroup,
  createEvent,
  createDirectMessage as persistDirectMessage,
  createMessage as persistMessage,
  clearCommunityAvatar,
  clearMyCommunityAvatar,
  createCommunityEmoji as persistEmoji,
  createPost as persistPost,
  deleteComment as removeComment,
  getCommunityById,
  getLocalGroups,
  getPortalCommunity,
  getMembership,
  joinEvent,
  leaveEvent,
  markAllNotificationsRead,
  markNotificationRead,
  deleteCommunityEmoji as removeEmoji,
  deletePost as removePost,
  rejectAccessRequest,
  renameLocalGroup,
  requestCommunityAccess,
  resendInvitation,
  startDirectConversation,
  startDirectConversationWithOrganizationPerson,
  setAcceptsMemberDms,
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
  type RsvpFormState,
} from "@/lib/event-form";
import {
  ADMIN_REFUSED,
  SELECTION_REFUSED,
  type LocalGroupFormState,
} from "@/lib/local-group-form";
import type { MessageFormState } from "@/lib/message-form";
import type { PostFormState } from "@/lib/post-form";
import { sendInvitationEmail } from "@/lib/email/invitation";
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
 * Sends a sign-in link. No passwords: an organisation's membership list is the
 * sensitive part, and one less credential to leak is one less to protect.
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
    localGroupId: String(formData.get("localGroupId") ?? "") || undefined,
    body: String(formData.get("body") ?? ""),
    title: String(formData.get("title") ?? ""),
    // A tampered checkbox only reaches a policy that refuses it: publishing an
    // announcement requires can_moderate() in the database.
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
  const result = await persistMessage({
    channelId,
    body: String(formData.get("body") ?? ""),
  });

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
  const result = await persistDirectMessage({
    conversationId,
    body: String(formData.get("body") ?? ""),
  });

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
 * Creates an event.
 *
 * The date and the two times arrive as separate fields because that is how a
 * person fills them in; they are combined here into the instants the column
 * wants. Everything this checks, `events_insert` checks again — this exists to
 * give a person a sentence rather than a failed insert.
 */
export async function createEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  const t = await translatorFor(communityId);

  if (!title) return { status: "error", error: t("err.eventTitleRequired") };
  if (title.length > 120) return { status: "error", error: t("err.eventTitleTooLong") };
  if (!location) return { status: "error", error: t("err.eventLocationRequired") };
  if (location.length > 120) return { status: "error", error: t("err.eventLocationTooLong") };
  if (description.length > 4000) {
    return { status: "error", error: t("err.eventDescriptionTooLong") };
  }
  if (!date || !startTime || !endTime) {
    return { status: "error", error: t("err.eventDatesRequired") };
  }

  // Resolved against the community's own zone rather than the server's, so
  // 18:00 means 18:00 in Oslo wherever this happens to be running.
  const startsAt = osloInstant(date, startTime);
  const endsAt = osloInstant(date, endTime);

  if (!startsAt || !endsAt) {
    return { status: "error", error: t("err.eventDatesUnreadable") };
  }
  if (endsAt <= startsAt) {
    return { status: "error", error: t("err.eventEndsBeforeStart") };
  }

  const rawCapacity = String(formData.get("capacity") ?? "").trim();
  const capacity = rawCapacity ? Number(rawCapacity) : undefined;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    return { status: "error", error: t("err.eventCapacityInvalid") };
  }

  const result = await createEvent({
    communityId,
    localGroupId: String(formData.get("localGroupId") ?? "") || undefined,
    title,
    description,
    location,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    isPublic: formData.get("isPublic") === "on",
    capacity,
  });

  if (!result.ok) return { status: "error", error: t(EVENT_CREATE_REFUSED) };

  revalidateEvents(communityId, result.id);
  return { status: "ok" };
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
 * Approves a request. What happens next depends on what the database found:
 * an address with a usable TING account is activated on the spot, and
 * nothing is sent. An address with no account gets a claim-link email — sent
 * only when the database actually minted a token, so a second click, which
 * finds the request already approved and gets no token back, sends nothing.
 * That is what keeps approval idempotent all the way through to the
 * recipient's inbox.
 */
export async function approveRequestAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const t = await translatorFor(communityId);
  const minted = await approveAccessRequest(String(formData.get("requestId") ?? ""));

  if (!minted) {
    return { status: "error", message: t("err.approveFailed") };
  }

  revalidatePath(`/community/${communityId}/requests`);

  if (minted.outcome === "activated") {
    return {
      status: "ok",
      message: t("ok.approvedActivated", { email: minted.email }),
    };
  }

  if (!minted.token) {
    return { status: "ok", message: t("ok.approvedAlready") };
  }

  const sent = await deliverInvitation(minted, t);
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

  const sent = await deliverInvitation(minted, t);
  return sent.ok
    ? { status: "ok", message: t("ok.resent", { email: minted.email }) }
    : { status: "error", message: sent.message };
}

/**
 * Builds the absolute accept URL and hands the message to the provider. The
 * email is written in the community's language — it is about one community
 * and nothing else.
 */
async function deliverInvitation(
  minted: {
    token: string | null;
    email: string;
    communityId: string;
    expiresAt: string | null;
  },
  t: Translator,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // `expiresAt` is only ever null alongside a null token (the 'activated'
  // outcome, which never reaches this function, and an idempotent replay
  // with no fresh token to send).
  if (!minted.token || !minted.expiresAt) return { ok: false, message: t("err.noInvitation") };

  const community = await getCommunityById(minted.communityId);
  const origin = await siteOrigin();

  const result = await sendInvitationEmail({
    to: minted.email,
    communityName: community?.name ?? t("common.theCommunity"),
    locale: community ? communityLocale(community) : PLATFORM_LOCALE,
    acceptUrl: `${origin}/invitasjon/${minted.token}`,
    expiresAt: minted.expiresAt,
    accent: community?.branding.accent ?? "#1f4a3d",
  });

  // The invitation exists either way; only the delivery failed. Saying so lets
  // an admin resend rather than wonder whether the approval took.
  return result.ok
    ? { ok: true }
    : { ok: false, message: t("err.emailNotSent", { error: result.error }) };
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
  const result = await acceptInvitationToken(String(formData.get("token") ?? ""));
  if (!result.ok) {
    return { status: "error", message: t(invitationFailure(result.reason)) };
  }

  revalidatePath("/home");
  revalidatePath("/communities");

  // Membership already exists at this point — the question that follows cannot
  // withdraw it. Communities that use local groups get one chance to ask, with
  // skipping a single click away; communities that do not are sent straight
  // in, which is how this stays invisible where it does not apply.
  const groups = await getLocalGroups(result.communityId!);
  if (groups.some((group) => group.active)) {
    redirect(`/community/${result.communityId}/lokallag?velkommen=1`);
  }

  redirect(`/community/${result.communityId}`);
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
