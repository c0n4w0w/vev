import type { RoleId } from "@/lib/types";

/**
 * Per-community privacy settings.
 *
 * Kept separate from `lib/mock/communities.ts` on purpose. That file is the
 * organisations' own copy — name, description, branding — and is edited by
 * hand. This is configuration: which capabilities each community switches on.
 *
 * The database is authoritative. These values are what the seed writes into
 * `communities.member_directory_visibility` and `communities.dm_policy`; the
 * application never reads them at runtime and never branches on a community's
 * name or slug.
 */
export type MemberDirectoryVisibility = "admin_only" | "members";
export type DmPolicy = "staff_only" | "members";
/** Who may see who reacted in the community's own channels and community-wide posts. */
export type ReactionAuthorVisibility = "moderators" | "channel";

export interface CommunityPolicy {
  communityId: string;
  /**
   * `admin_only` — only administrators may list the membership. Moderators are
   * not included: moderation is about content, not about who is on the list.
   */
  memberDirectoryVisibility: MemberDirectoryVisibility;
  /** `staff_only` — only admins and moderators may message one another. */
  dmPolicy: DmPolicy;
  /**
   * `moderators` — in channels the whole community can read, only admins and
   * moderators see who reacted; members see counts. Administrators can change
   * it under Innstillinger.
   */
  reactionAuthorVisibility: ReactionAuthorVisibility;
  /** Why this community chose these settings. Documentation, not logic. */
  rationale: string;
}

export const communityPolicies: CommunityPolicy[] = [
  {
    communityId: "tryggere-ruspolitikk",
    memberDirectoryVisibility: "admin_only",
    dmPolicy: "staff_only",
    reactionAuthorVisibility: "moderators",
    rationale:
      "Arbeider på rusfeltet, der det å vite hvem som er involvert er den følsomme opplysningen. Medlemslisten er derfor ikke tilgjengelig for medlemmer eller moderatorer, og medlemmer kan ikke kontakte hverandre direkte.",
  },
  {
    communityId: "tryggere-ungdom",
    memberDirectoryVisibility: "admin_only",
    dmPolicy: "staff_only",
    reactionAuthorVisibility: "moderators",
    rationale:
      "Ungdomsorganisasjon med mange mindreårige medlemmer. Samme begrunnelse som moderorganisasjonen, og direktemeldinger mellom medlemmer er bevisst ikke tilgjengelig.",
  },
  {
    communityId: "under-the-rug",
    memberDirectoryVisibility: "members",
    dmPolicy: "members",
    reactionAuthorVisibility: "channel",
    rationale:
      "Et kulturkollektiv der medlemmene samarbeider om arrangementer og trenger å finne hverandre. Medlemslisten er åpen for medlemmer, og de kan kontakte hverandre direkte.",
  },
];

/** Roles that count as staff under a `staff_only` policy. */
export const staffRoles: RoleId[] = ["admin", "moderator"];
