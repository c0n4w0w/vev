"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  acceptInvitationToken,
  approveAccessRequest,
  createComment as persistComment,
  createCommunityEmoji as persistEmoji,
  createPost as persistPost,
  deleteComment as removeComment,
  getCommunityById,
  deleteCommunityEmoji as removeEmoji,
  deletePost as removePost,
  rejectAccessRequest,
  requestCommunityAccess,
  resendInvitation,
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
import type { PostFormState } from "@/lib/post-form";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { getSessionUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { demoLoginEnabled } from "@/lib/supabase/env";

// ── Authentication ──────────────────────────────────────────────────────

/**
 * Sends a sign-in link. No passwords: an organisation's membership list is the
 * sensitive part, and one less credential to leak is one less to protect.
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") || "/home");
  if (!email) redirect(`/login?feil=e-post`);

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
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

/**
 * Password sign-in for the seeded demo accounts. Only available when
 * NEXT_PUBLIC_ENABLE_DEMO_LOGIN is on, so a real deployment cannot be entered
 * by picking a name off a list.
 */
export async function signInAsDemoUser(formData: FormData) {
  if (!demoLoginEnabled()) redirect("/login");

  const email = String(formData.get("email") ?? "");
  const next = String(formData.get("next") || "/home");
  const password = process.env.DEMO_ACCOUNT_PASSWORD ?? "";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?feil=${encodeURIComponent(error.message)}`);

  redirect(next);
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
  revalidatePath(`/community/${communityId}/announcements`);
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
  const header = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${header.get("x-forwarded-proto") ?? "http"}://${header.get("host") ?? "localhost:3000"}`;

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
