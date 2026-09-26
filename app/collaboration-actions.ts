"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  acceptAndJoin,
  acceptOrganizationInvite,
  createCollaboration,
  declineOrganizationInvite,
  declineSponsorship,
  getCollaborationSlug,
  inviteOrganizationBySlug,
  leaveCollaboration,
  rejoinCollaboration,
  revokeSponsorship,
  sponsorOrganizer,
  upsertMyCollaborationProfile,
  withdrawUnit,
} from "@/lib/collaboration-data";
import { normalizeDisplayName } from "@/lib/access-form";
import { PUBLIC_HOST } from "@/lib/brand";
import { parseCollaborationTarget } from "@/lib/collaboration-target";
import {
  COLLABORATION_DESCRIPTION_MAX,
  COLLABORATION_NAME_MAX,
  decodeUnit,
  slugFromName,
  type CollaborationFormState,
} from "@/lib/collaboration-form";
import { normalizeBio } from "@/lib/community-profile-form";
import { parseLocale, translator, type Translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import { siteOrigin } from "@/lib/site-url";

/**
 * Server actions for collaborations.
 *
 * Each one confirms there is a session and then calls exactly one Step 1A/1B
 * database function as the signed-in user. None of them decides who may do
 * what — the functions do, from auth.uid() and current rows. The checks here
 * only turn input into the shape those functions take and a refusal into
 * words.
 *
 * `locale` travels in the form so the reply is in the language of the screen
 * it came from (the hub speaks the platform's, a collaboration its own). A
 * tampered value changes the language of an error and nothing else.
 */

type State = CollaborationFormState;

async function session(formData: FormData): Promise<Translator> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return translator(parseLocale(formData.get("locale")));
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/** Only a plain slug may be used to build a path. */
function slugOf(formData: FormData): string | undefined {
  const slug = field(formData, "slug");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}

function refresh(slug?: string) {
  revalidatePath("/collaborations");
  if (slug) revalidatePath(`/collaboration/${slug}`, "layout");
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createCollaborationAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);

  const name = normalizeDisplayName(field(formData, "name"), t);
  if (!name.ok) return { status: "error", message: t("collab.err.nameRequired") };
  if (Array.from(name.value).length > COLLABORATION_NAME_MAX) {
    return { status: "error", message: t("collab.err.nameTooLong", { max: COLLABORATION_NAME_MAX }) };
  }
  const description = field(formData, "description").trim();
  if (Array.from(description).length > COLLABORATION_DESCRIPTION_MAX) {
    return {
      status: "error",
      message: t("collab.err.descriptionTooLong", { max: COLLABORATION_DESCRIPTION_MAX }),
    };
  }
  const unit = decodeUnit(field(formData, "unit"));
  if (!unit) return { status: "error", message: t("collab.err.chooseUnit") };

  const id = await createCollaboration({
    communityId: unit.communityId,
    localGroupId: unit.localGroupId,
    name: name.value,
    // People do not design URLs. A name that yields no usable slug gets a
    // neutral one; the database adds a suffix if it is taken.
    slug: slugFromName(name.value) ?? "samarbeid",
    description: description || null,
  });
  if (!id) return { status: "error", message: t("collab.err.createRefused") };

  const slug = await getCollaborationSlug(id);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}` : "/collaborations");
}

// ── Organisations ───────────────────────────────────────────────────────

export async function inviteOrganizationAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const collaborationId = field(formData, "collaborationId");

  const allowedHosts = [PUBLIC_HOST, `www.${PUBLIC_HOST}`];
  try {
    allowedHosts.push(new URL(await siteOrigin()).host);
  } catch {
    // No usable origin: only the public host counts as TING.
  }
  const target = parseCollaborationTarget(field(formData, "target"), allowedHosts);

  // One answer for every failure — malformed, foreign URL, unknown slug, not a
  // manager, already invited. Anything more specific would turn this form into
  // a way to test which organisations exist.
  const invited = target.ok ? await inviteOrganizationBySlug(collaborationId, target.slug) : null;
  if (!invited) return { status: "error", message: t("collab.invite.failed") };

  refresh(slugOf(formData));
  return { status: "ok", message: t("collab.invite.sent", { name: invited.communityName }) };
}

export async function acceptOrganizationInviteAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const unit = decodeUnit(field(formData, "unit"));
  if (!unit) return { status: "error", message: t("collab.err.chooseUnit") };

  const ok = await acceptOrganizationInvite(field(formData, "participantId"), unit.localGroupId);
  if (!ok) return { status: "error", message: t("collab.orgInvite.acceptFailed") };

  // The invitation card disappears once answered, so the confirmation is
  // shown where the organisation now is: inside the collaboration.
  const slug = slugOf(formData);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}?deltar=1` : "/collaborations");
}

export async function declineOrganizationInviteAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await declineOrganizationInvite(field(formData, "participantId"));
  if (!ok) return { status: "error", message: t("collab.err.refused") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("collab.orgInvite.declined") };
}

export async function withdrawUnitAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await withdrawUnit(field(formData, "participantId"));
  if (!ok) return { status: "error", message: t("collab.err.refused") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("collab.unit.withdrawn") };
}

// ── Organisers ──────────────────────────────────────────────────────────

export async function sponsorOrganizerAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await sponsorOrganizer({
    collaborationId: field(formData, "collaborationId"),
    participantId: field(formData, "participantId"),
    userId: field(formData, "userId"),
  });
  if (!ok) return { status: "error", message: t("collab.organizers.inviteFailed") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

export async function revokeSponsorshipAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await revokeSponsorship(field(formData, "sponsorshipId"));
  if (!ok) return { status: "error", message: t("collab.err.refused") };
  refresh(slugOf(formData));
  return { status: "ok" };
}

// ── The person invited ──────────────────────────────────────────────────

export async function acceptAndJoinAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await acceptAndJoin(field(formData, "sponsorshipId"));
  if (!ok) return { status: "error", message: t("collab.personInvite.acceptFailed") };
  const slug = slugOf(formData);
  refresh(slug);
  // Joining is not finished until the person has chosen how they appear here.
  redirect(slug ? `/collaboration/${slug}/profile` : "/collaborations");
}

export async function declineSponsorshipAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await declineSponsorship(field(formData, "sponsorshipId"));
  if (!ok) return { status: "error", message: t("collab.err.refused") };
  refresh(slugOf(formData));
  return { status: "ok", message: t("collab.personInvite.declined") };
}

export async function rejoinCollaborationAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await rejoinCollaboration(field(formData, "collaborationId"));
  if (!ok) return { status: "error", message: t("collab.personInvite.acceptFailed") };
  const slug = slugOf(formData);
  refresh(slug);
  redirect(slug ? `/collaboration/${slug}` : "/collaborations");
}

export async function leaveCollaborationAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const ok = await leaveCollaboration(field(formData, "collaborationId"));
  if (!ok) return { status: "error", message: t("collab.err.refused") };
  refresh(slugOf(formData));
  redirect("/collaborations");
}

// ── Collaboration persona ───────────────────────────────────────────────

export async function saveCollaborationProfileAction(_prev: State, formData: FormData): Promise<State> {
  const t = await session(formData);
  const name = normalizeDisplayName(field(formData, "displayName"), t);
  if (!name.ok) return { status: "error", message: name.message };
  const bio = normalizeBio(field(formData, "bio"), t);
  if (!bio.ok) return { status: "error", message: bio.message };

  const ok = await upsertMyCollaborationProfile({
    collaborationId: field(formData, "collaborationId"),
    displayName: name.value,
    bio: bio.value,
  });
  if (!ok) return { status: "error", message: t("collab.profile.saveFailed") };

  const slug = slugOf(formData);
  refresh(slug);
  if (formData.get("onboarding") === "1" && slug) redirect(`/collaboration/${slug}`);
  return { status: "ok", message: t("ok.profileSaved") };
}
