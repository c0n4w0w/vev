import "server-only";

import { cache } from "react";
import { getCommunityMembers, getMyCommunityPersonas, type CommunityMember } from "@/lib/data";
import { initialsFor } from "@/lib/format";
import { parseLocale } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Collaboration,
  CollaborationPersona,
  CollaborationSponsorshipStatus,
  CollaborationUnit,
  CommunityBranding,
  MyCollaborationSponsorship,
  OrganizerState,
  RepresentedCollaborationUnit,
} from "@/lib/types";

/**
 * The collaboration side of the data seam.
 *
 * Kept apart from `lib/data.ts` because a collaboration is not a community and
 * none of its reads should look like one. Everything runs as the signed-in
 * user: row level security and the Step 1A/1B functions decide what comes
 * back, and nothing here re-implements those rules. Where the interface needs
 * to know "can this person do X", it asks the database.
 *
 * Two things this module never does:
 *
 *   * list anybody's organisation members. Choosing organisers goes through
 *     `getCommunityMembers()` — the representative's existing, RLS-bound view
 *     of their OWN community — so it cannot be pointed at another one;
 *   * fall back to an account name or a community persona for someone on the
 *     team. A person without a collaboration profile is simply not listed.
 */

type CollaborationRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  default_locale: string;
};

function toCollaboration(row: CollaborationRow): Collaboration {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    defaultLocale: parseLocale(row.default_locale),
  };
}

const COLLABORATION_COLUMNS = "id, slug, name, description, default_locale" as const;

/** Every collaboration the caller is related to; RLS decides which. */
export const getVisibleCollaborations = cache(async (): Promise<Collaboration[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaborations")
    .select(COLLABORATION_COLUMNS)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toCollaboration);
});

export const getCollaborationBySlug = cache(
  async (slug: string): Promise<Collaboration | undefined> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("collaborations")
      .select(COLLABORATION_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    return data ? toCollaboration(data) : undefined;
  },
);

export const hasCollaborationAccess = cache(async (collaborationId: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_collaboration_access", {
    p_collaboration_id: collaborationId,
  });
  return !error && data === true;
});

export const isCollaborationManager = cache(async (collaborationId: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("is_collaboration_manager", {
    p_collaboration_id: collaborationId,
  });
  return !error && data === true;
});

/** Names of the units the caller may see in one collaboration. */
export const getCollaborationUnits = cache(
  async (collaborationId: string): Promise<CollaborationUnit[]> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("collaboration_units", {
      p_collaboration_id: collaborationId,
    });
    if (error) return [];
    return (data ?? []).map((row, index) => ({
      // Label-only rows have no participant id; a positional key is enough to
      // render them and deliberately means nothing outside this list.
      key: row.participant_id ?? `label-${index}`,
      participantId: row.participant_id ?? null,
      status: row.status,
      communityId: row.community_id ?? null,
      communityName: row.community_name,
      localGroupId: row.local_group_id ?? undefined,
      localGroupName: row.local_group_name ?? undefined,
      branding: {
        accent: row.accent,
        monogram: row.monogram,
        markStyle: (row.mark_style as CommunityBranding["markStyle"]) ?? "sans",
      },
      represented: row.represented === true,
    }));
  },
);

/** The caller's own sponsorships, every collaboration. RLS returns no one else's. */
export const getMySponsorships = cache(
  async (userId: string): Promise<MyCollaborationSponsorship[]> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("collaboration_member_sponsorships")
      .select("id, collaboration_id, participant_id, status, invited_at")
      .eq("user_id", userId)
      .order("invited_at", { ascending: false });
    return (data ?? []).map((row) => ({
      id: row.id,
      collaborationId: row.collaboration_id,
      participantId: row.participant_id,
      status: row.status,
    }));
  },
);

/** The caller's own team row: whether they joined, and whether they left. */
export const getMyTeamStatus = cache(
  async (collaborationId: string, userId: string): Promise<"active" | "left" | undefined> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("collaboration_members")
      .select("status")
      .eq("collaboration_id", collaborationId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.status;
  },
);

function toCollaborationPersona(row: {
  collaboration_id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
}): CollaborationPersona {
  return {
    id: row.user_id,
    collaborationId: row.collaboration_id,
    name: row.display_name,
    initials: initialsFor(row.display_name),
    bio: row.bio ?? "",
  };
}

/** The caller's own collaboration persona, or nothing yet. */
export const getMyCollaborationPersona = cache(
  async (collaborationId: string, userId: string): Promise<CollaborationPersona | undefined> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("collaboration_profiles")
      .select("collaboration_id, user_id, display_name, bio")
      .eq("collaboration_id", collaborationId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.display_name
      ? toCollaborationPersona({ ...data, display_name: data.display_name })
      : undefined;
  },
);

/**
 * The organiser team, as collaboration personas and nothing else.
 *
 * RLS returns member and profile rows only to someone with effective access,
 * and only for others who have it too. A joined person who has not yet set up
 * a collaboration profile is left out rather than shown under any other name —
 * there is no fallback to the account or a community persona, by design.
 */
export async function getCollaborationTeam(collaborationId: string): Promise<CollaborationPersona[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data: members }, { data: profiles }] = await Promise.all([
    supabase
      .from("collaboration_members")
      .select("user_id")
      .eq("collaboration_id", collaborationId)
      .eq("status", "active"),
    supabase
      .from("collaboration_profiles")
      .select("collaboration_id, user_id, display_name, bio")
      .eq("collaboration_id", collaborationId),
  ]);
  const joined = new Set((members ?? []).map((row) => row.user_id));
  return (profiles ?? [])
    .filter((row) => joined.has(row.user_id) && row.display_name)
    .map((row) => toCollaborationPersona({ ...row, display_name: row.display_name! }))
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

// ── Choosing organisers ─────────────────────────────────────────────────

export interface OrganizerCandidate extends CommunityMember {
  /** The latest sponsorship this unit issued to the person in this collaboration. */
  sponsorship?: { id: string; status: CollaborationSponsorshipStatus };
  /** Where they stand now, as far as this unit may know. */
  state: OrganizerState;
}

/**
 * Joined or left, for one ACCEPTED sponsorship this unit issued. Asked of
 * `collaboration_sponsored_team_state()`, which answers only the issuing
 * unit's own representative; the team list itself stays closed to them.
 */
async function sponsoredTeamState(sponsorshipId: string): Promise<OrganizerState> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("collaboration_sponsored_team_state", {
    p_sponsorship_id: sponsorshipId,
  });
  if (error || !data) return "accepted";
  return data === "joined" ? "joined" : data === "left" ? "left" : "accepted";
}

/**
 * The people a representative may pick from for ONE unit they represent.
 *
 * This is the representative's ordinary view of their own community's
 * registry (`getCommunityMembers()`, bound by the `memberships` and
 * `community_profiles` policies), narrowed to the unit: everyone active for a
 * whole-community unit, or those whose own membership names this local group.
 * Called for a unit the viewer does not represent, it has nothing to read —
 * another organisation's registry is invisible to them in the first place.
 *
 * The status comes from sponsorships this unit issued, which only the unit's
 * own representative (and each person themselves) can read, and — for accepted
 * ones — from the narrow joined/left helper above.
 */
export async function getOrganizerCandidates(
  unit: RepresentedCollaborationUnit,
): Promise<OrganizerCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const [members, { data: sponsorships }] = await Promise.all([
    getCommunityMembers(unit.communityId),
    supabase
      .from("collaboration_member_sponsorships")
      .select("id, user_id, status, invited_at")
      .eq("participant_id", unit.participantId)
      .order("invited_at", { ascending: false }),
  ]);

  const latest = new Map<string, { id: string; status: CollaborationSponsorshipStatus }>();
  for (const row of sponsorships ?? []) {
    if (!latest.has(row.user_id)) latest.set(row.user_id, { id: row.id, status: row.status });
  }

  const inUnit = members.filter(
    (member) => !unit.localGroupId || member.membership.localGroupId === unit.localGroupId,
  );
  return Promise.all(
    inUnit.map(async (member) => {
      const sponsorship = latest.get(member.membership.userId);
      const state: OrganizerState = !sponsorship
        ? "none"
        : sponsorship.status === "accepted"
          ? await sponsoredTeamState(sponsorship.id)
          : sponsorship.status;
      return { ...member, sponsorship, state };
    }),
  );
}

// ── Starting points for a collaboration persona ─────────────────────────

export interface PersonaStartingPoint {
  communityId: string;
  communityName: string;
  displayName: string;
  bio: string;
}

/**
 * Community profiles the caller may choose to START a collaboration persona
 * from: only their own, and only in communities through which they are
 * sponsored into THIS collaboration right now (an accepted sponsorship from an
 * active unit of that community). A local-group unit offers the parent
 * community's profile — groups have none of their own.
 *
 * Nothing here is sent anywhere unless the person picks it; the page reads the
 * chosen one to pre-fill a form, and saving writes an independent copy.
 */
export async function getPersonaStartingPoints(
  collaborationId: string,
  userId: string,
): Promise<PersonaStartingPoint[]> {
  const [sponsorships, units, personas] = await Promise.all([
    getMySponsorships(userId),
    getCollaborationUnits(collaborationId),
    getMyCommunityPersonas(userId),
  ]);
  const sponsoringCommunities = new Map<string, string>();
  for (const sponsorship of sponsorships) {
    if (sponsorship.collaborationId !== collaborationId || sponsorship.status !== "accepted") continue;
    const unit = units.find(
      (candidate) => candidate.participantId === sponsorship.participantId && candidate.status === "active",
    );
    if (unit?.communityId) sponsoringCommunities.set(unit.communityId, unit.communityName);
  }
  return [...sponsoringCommunities]
    .map(([communityId, communityName]) => {
      const persona = personas.get(communityId);
      return persona
        ? { communityId, communityName, displayName: persona.name, bio: persona.bio }
        : undefined;
    })
    .filter((point): point is PersonaStartingPoint => Boolean(point));
}

// ── Writes (each one a Step 1A/1B function; the database decides) ───────

async function rpcBoolean(
  name:
    | "accept_collaboration_sponsorship_and_join"
    | "decline_collaboration_participant_invite"
    | "leave_collaboration_as_participant"
    | "revoke_collaboration_sponsorship"
    | "join_collaboration"
    | "leave_collaboration",
  args: Record<string, string>,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  return !error && data === true;
}

export async function createCollaboration(input: {
  communityId: string;
  localGroupId: string | null;
  name: string;
  slug: string | null;
  description: string | null;
}): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_collaboration", {
    p_source_community_id: input.communityId,
    // Postgres accepts null for these; generated argument types do not record nullability.
    p_source_local_group_id: input.localGroupId as unknown as string,
    p_name: input.name,
    p_slug: input.slug as unknown as string,
    p_description: input.description as unknown as string,
  });
  return !error && typeof data === "string" ? data : null;
}

/** Read back after creation, as the creator (a representative of the source unit). */
export async function getCollaborationSlug(collaborationId: string): Promise<string | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("collaborations")
    .select("slug")
    .eq("id", collaborationId)
    .maybeSingle();
  return data?.slug;
}

export async function inviteOrganizationBySlug(
  collaborationId: string,
  slug: string,
): Promise<{ participantId: string; communityName: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("invite_collaboration_participant_by_slug", {
    p_collaboration_id: collaborationId,
    p_slug: slug,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.participant_id || !row.community_name) return null;
  return { participantId: row.participant_id, communityName: row.community_name };
}

export async function acceptOrganizationInvite(
  participantId: string,
  localGroupId: string | null,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_collaboration_participant_invite", {
    p_participant_id: participantId,
    p_local_group_id: localGroupId as unknown as string,
  });
  return !error && data === true;
}

export const declineOrganizationInvite = (participantId: string) =>
  rpcBoolean("decline_collaboration_participant_invite", { p_participant_id: participantId });

export const withdrawUnit = (participantId: string) =>
  rpcBoolean("leave_collaboration_as_participant", { p_participant_id: participantId });

export async function sponsorOrganizer(input: {
  collaborationId: string;
  participantId: string;
  userId: string;
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("invite_collaboration_member", {
    p_collaboration_id: input.collaborationId,
    p_participant_id: input.participantId,
    p_target_user_id: input.userId,
  });
  return !error && typeof data === "string";
}

export const revokeSponsorship = (sponsorshipId: string) =>
  rpcBoolean("revoke_collaboration_sponsorship", { p_sponsorship_id: sponsorshipId });

export const acceptAndJoin = (sponsorshipId: string) =>
  rpcBoolean("accept_collaboration_sponsorship_and_join", { p_sponsorship_id: sponsorshipId });

export async function declineSponsorship(sponsorshipId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("respond_to_collaboration_sponsorship", {
    p_sponsorship_id: sponsorshipId,
    p_accept: false,
  });
  return !error && data === true;
}

export const rejoinCollaboration = (collaborationId: string) =>
  rpcBoolean("join_collaboration", { p_collaboration_id: collaborationId });

export const leaveCollaboration = (collaborationId: string) =>
  rpcBoolean("leave_collaboration", { p_collaboration_id: collaborationId });

export async function upsertMyCollaborationProfile(input: {
  collaborationId: string;
  displayName: string;
  bio: string;
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_my_collaboration_profile", {
    p_collaboration_id: input.collaborationId,
    p_display_name: input.displayName,
    p_bio: input.bio,
  });
  return !error && data === true;
}
