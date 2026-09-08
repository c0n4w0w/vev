"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  acceptInvitation as acceptCommunityInvitation,
  approveMembership,
  createComment as persistComment,
  createCommunityEmoji as persistEmoji,
  createPost as persistPost,
  declineInvitation as declineCommunityInvitation,
  deleteComment as removeComment,
  deleteCommunityEmoji as removeEmoji,
  deletePost as removePost,
  getMembership,
  rejectMembership,
  requestAccess as createAccessRequest,
  toggleReaction as togglePostReaction,
  updateComment as editComment,
  updatePost as editPost,
} from "@/lib/data";
import type { CommentFormState } from "@/lib/comment-form";
import {
  inspectEmojiImage,
  normalizeEmojiName,
  validateEmojiName,
} from "@/lib/emoji-image";
import type { PostFormState } from "@/lib/post-form";
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

/** Accepts an open invitation and drops the user straight into the community. */
export async function acceptInvitation(formData: FormData) {
  const communityId = String(formData.get("communityId") ?? "");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (await acceptCommunityInvitation(communityId)) {
    redirect(`/community/${communityId}`);
  }
  redirect("/home");
}

/** Turns down an invitation. The community is then simply gone from view. */
export async function declineInvitation(formData: FormData) {
  const communityId = String(formData.get("communityId") ?? "");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await declineCommunityInvitation(communityId);
  redirect("/home");
}

/** Sends an access request from a community's public portal. */
export async function requestAccess(formData: FormData) {
  const communityId = String(formData.get("communityId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await createAccessRequest(communityId);
  redirect(`/${slug}`);
}

/**
 * Admin decisions on the members screen.
 *
 * The database function checks administrator rights itself; this check only
 * keeps a non-admin from reaching a page state that implies they can act.
 */
async function requireAdmin(communityId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const membership = await getMembership(user.id, communityId);
  if (membership?.status !== "active" || membership.role !== "admin") {
    redirect(`/community/${communityId}`);
  }
}

export async function approveMember(formData: FormData) {
  const communityId = String(formData.get("communityId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  await requireAdmin(communityId);

  await approveMembership(communityId, userId);
  redirect(`/community/${communityId}/members`);
}

export async function rejectMember(formData: FormData) {
  const communityId = String(formData.get("communityId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  await requireAdmin(communityId);

  await rejectMembership(communityId, userId);
  redirect(`/community/${communityId}/members`);
}

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
