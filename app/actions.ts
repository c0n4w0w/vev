"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  acceptInvitationToken,
  approveAccessRequest,
  createComment as persistComment,
  createLocalGroup,
  createEvent,
  createMessage as persistMessage,
  createCommunityEmoji as persistEmoji,
  createPost as persistPost,
  deleteComment as removeComment,
  getCommunityById,
  getLocalGroups,
  joinEvent,
  leaveEvent,
  deleteCommunityEmoji as removeEmoji,
  deletePost as removePost,
  rejectAccessRequest,
  renameLocalGroup,
  requestCommunityAccess,
  resendInvitation,
  setAcceptsMemberDms,
  setLocalGroupActive,
  setMyLocalGroup,
  toggleReaction as togglePostReaction,
  updateComment as editComment,
  updatePost as editPost,
} from "@/lib/data";
import type { AccessFormState } from "@/lib/access-form";
import { REQUEST_SENT_MESSAGE } from "@/lib/access-form";
import type { CommentFormState } from "@/lib/comment-form";
import {
  inspectEmojiImage,
  normalizeEmojiName,
  validateEmojiName,
} from "@/lib/emoji-image";
import type { DmSettingFormState } from "@/lib/dm-settings-form";
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
import { getSessionUser } from "@/lib/session";
import { siteOrigin } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── Authentication ──────────────────────────────────────────────────────

/**
 * Sends a sign-in link. No passwords: an organisation's membership list is the
 * sensitive part, and one less credential to leak is one less to protect.
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") || "/home");
  if (!email) redirect(`/login?feil=e-post`);

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
  redirect(`/login?sendt=${encodeURIComponent(email)}`);
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
    body: String(formData.get("body") ?? ""),
    title: String(formData.get("title") ?? ""),
    // A tampered checkbox only reaches a policy that refuses it: publishing an
    // announcement requires can_moderate() in the database.
    announcement: formData.get("announcement") === "on",
  });

  if (!result.ok) return { status: "error", message: result.error };
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

  if (!result.ok) return { status: "error", message: result.error };
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

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePosts(communityId);
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

  if (!result.ok) return { status: "error", error: result.error };

  const communityId = String(formData.get("communityId") ?? "");
  revalidatePath(`/community/${communityId}/channel/${channelId}`);
  revalidatePath(`/community/${communityId}`);
  return { status: "ok", message: result.message };
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

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePosts(String(formData.get("communityId") ?? ""));
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

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePosts(String(formData.get("communityId") ?? ""));
  return { status: "ok" };
}

export async function deleteCommentAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await removeComment(String(formData.get("commentId") ?? ""));

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePosts(String(formData.get("communityId") ?? ""));
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

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePosts(String(formData.get("communityId") ?? ""));
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
    return {
      status: "error",
      error: "Innstillingen kunne ikke endres. Bare administratorer og moderatorer kan endre denne.",
    };
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
    return { status: "error", error: result.error === "full" ? EVENT_FULL : RSVP_REFUSED };
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

  if (!title) return { status: "error", error: "Arrangementet må ha en tittel." };
  if (title.length > 120) return { status: "error", error: "Tittelen kan være høyst 120 tegn." };
  if (!location) return { status: "error", error: "Legg inn et sted." };
  if (location.length > 120) return { status: "error", error: "Stedet kan være høyst 120 tegn." };
  if (description.length > 4000) {
    return { status: "error", error: "Beskrivelsen kan være høyst 4000 tegn." };
  }
  if (!date || !startTime || !endTime) {
    return { status: "error", error: "Fyll inn dato, start og slutt." };
  }

  // Resolved against the community's own zone rather than the server's, so
  // 18:00 means 18:00 in Oslo wherever this happens to be running.
  const startsAt = osloInstant(date, startTime);
  const endsAt = osloInstant(date, endTime);

  if (!startsAt || !endsAt) {
    return { status: "error", error: "Dato eller klokkeslett kunne ikke leses." };
  }
  if (endsAt <= startsAt) {
    return { status: "error", error: "Arrangementet må slutte etter at det har begynt." };
  }

  const rawCapacity = String(formData.get("capacity") ?? "").trim();
  const capacity = rawCapacity ? Number(rawCapacity) : undefined;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    return { status: "error", error: "Antall plasser må være et helt tall, eller stå tomt." };
  }

  const result = await createEvent({
    communityId,
    title,
    description,
    location,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    isPublic: formData.get("isPublic") === "on",
    capacity,
  });

  if (!result.ok) return { status: "error", error: EVENT_CREATE_REFUSED };

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
  if (!ok) return { status: "error", error: SELECTION_REFUSED };

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
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: "Lokallaget må ha et navn." };

  const ok = await createLocalGroup(communityId, name);
  if (!ok) return { status: "error", error: ADMIN_REFUSED };

  revalidateLocalGroups(communityId);
  return { status: "ok" };
}

export async function renameLocalGroupAction(
  _prev: LocalGroupFormState,
  formData: FormData,
): Promise<LocalGroupFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", error: "Lokallaget må ha et navn." };

  const ok = await renameLocalGroup(String(formData.get("localGroupId") ?? ""), name);
  if (!ok) return { status: "error", error: ADMIN_REFUSED };

  revalidateLocalGroups(String(formData.get("communityId") ?? ""));
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

  const ok = await setLocalGroupActive(
    String(formData.get("localGroupId") ?? ""),
    formData.get("active") === "on",
  );
  if (!ok) return { status: "error", error: ADMIN_REFUSED };

  revalidateLocalGroups(String(formData.get("communityId") ?? ""));
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
  const name = normalizeEmojiName(String(formData.get("name") ?? ""));
  const nameError = validateEmojiName(name);
  if (nameError) return { status: "error", message: nameError };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Velg en bildefil." };
  }

  // Decided from the bytes, never from the filename or the declared type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectEmojiImage(bytes);
  if (!image.ok) return { status: "error", message: image.error };

  const result = await persistEmoji({
    communityId,
    name,
    bytes,
    contentType: image.contentType,
    extension: image.extension,
  });

  if (!result.ok) return { status: "error", message: result.error };
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

  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath(`/community/${communityId}/emojis`);
  revalidatePosts(communityId);
  return { status: "ok" };
}


// ── Access requests and invitations ─────────────────────────────────────

/**
 * The public request form.
 *
 * Answers the same way no matter what the database found. The only distinction
 * it draws is a malformed address, which describes the input rather than any
 * person or community.
 */
export async function requestAccessAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return { status: "error", message: "Skriv inn en gyldig e-postadresse." };
  }

  await requestCommunityAccess({
    slug: String(formData.get("slug") ?? ""),
    email,
    displayName: String(formData.get("displayName") ?? "") || undefined,
  });

  // Note what is *not* branched on: the result. A community that does not take
  // applications, an address that already belongs to a member and a brand new
  // request all end here.
  return { status: "ok", message: REQUEST_SENT_MESSAGE };
}

/**
 * Approves a request, then sends the invitation.
 *
 * The email is sent only when the database actually minted a token. A second
 * click finds the request already approved, gets no token back, and therefore
 * sends nothing — which is what keeps approval idempotent all the way through
 * to the recipient's inbox.
 */
export async function approveRequestAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const minted = await approveAccessRequest(String(formData.get("requestId") ?? ""));

  if (!minted) {
    return { status: "error", message: "Forespørselen kunne ikke godkjennes." };
  }

  revalidatePath(`/community/${communityId}/requests`);

  if (!minted.token) {
    return { status: "ok", message: "Forespørselen var allerede godkjent. Invitasjonen står ved lag." };
  }

  const sent = await deliverInvitation(minted);
  return sent.ok
    ? { status: "ok", message: `Invitasjon sendt til ${minted.email}.` }
    : { status: "error", message: sent.message };
}

export async function rejectRequestAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const ok = await rejectAccessRequest(String(formData.get("requestId") ?? ""));
  revalidatePath(`/community/${communityId}/requests`);

  return ok
    ? { status: "ok", message: "Forespørselen er avslått." }
    : { status: "error", message: "Forespørselen kunne ikke avslås." };
}

export async function resendInvitationAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const communityId = String(formData.get("communityId") ?? "");
  const minted = await resendInvitation(String(formData.get("invitationId") ?? ""));
  revalidatePath(`/community/${communityId}/requests`);

  if (!minted?.token) {
    return { status: "error", message: "Invitasjonen kunne ikke sendes på nytt." };
  }

  const sent = await deliverInvitation(minted);
  return sent.ok
    ? { status: "ok", message: `Ny invitasjon sendt til ${minted.email}.` }
    : { status: "error", message: sent.message };
}

/** Builds the absolute accept URL and hands the message to the provider. */
async function deliverInvitation(minted: {
  token: string | null;
  email: string;
  communityId: string;
  expiresAt: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!minted.token) return { ok: false, message: "Ingen invitasjon å sende." };

  const community = await getCommunityById(minted.communityId);
  const origin = await siteOrigin();

  const result = await sendInvitationEmail({
    to: minted.email,
    communityName: community?.name ?? "fellesskapet",
    acceptUrl: `${origin}/invitasjon/${minted.token}`,
    expiresAt: minted.expiresAt,
    accent: community?.branding.accent ?? "#1f4a3d",
  });

  // The invitation exists either way; only the delivery failed. Saying so lets
  // an admin resend rather than wonder whether the approval took.
  return result.ok
    ? { ok: true }
    : { ok: false, message: `Invitasjonen er opprettet, men e-posten kunne ikke sendes: ${result.error}` };
}

/** Redeems a token for the signed-in account. */
export async function acceptInvitationAction(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await acceptInvitationToken(String(formData.get("token") ?? ""));
  if (!result.ok) {
    return { status: "error", message: invitationFailure(result.reason) };
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

function invitationFailure(reason: string): string {
  switch (reason) {
    case "email-mismatch":
      return "Invitasjonen er sendt til en annen e-postadresse enn den du er logget inn med. Logg inn med adressen invitasjonen ble sendt til.";
    case "already-used":
      return "Denne invitasjonen er allerede brukt.";
    case "expired":
      return "Invitasjonen er utløpt. Be en administrator om å sende en ny.";
    case "revoked":
      return "Invitasjonen er erstattet av en nyere. Bruk den siste lenken du fikk.";
    default:
      return "Invitasjonen er ikke gyldig.";
  }
}
