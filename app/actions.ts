"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  acceptInvitation as acceptCommunityInvitation,
  approveMembership,
  createPost as persistPost,
  declineInvitation as declineCommunityInvitation,
  deletePost as removePost,
  getMembership,
  rejectMembership,
  requestAccess as createAccessRequest,
  updatePost as editPost,
} from "@/lib/data";
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
