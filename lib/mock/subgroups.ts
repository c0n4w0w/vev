/**
 * Private organisational subgroups ("grupper") and who is in them.
 *
 * A subgroup is not a lokallag: membership is a separate row per person, added
 * by someone who may manage the group, and it sits alongside whatever lokallag
 * the person has chosen. Kristoffer is FTR Oslo *and* Safe-Space, which is the
 * combination the model exists to allow.
 *
 * Keys are slugs, never display names. The database creates each subgroup's
 * chat channel itself (community_subgroups trigger).
 *
 * Access to a subgroup's content does not come only from these rows: the
 * community's admins read it too, and — for a group with `moderatorsRead` —
 * its moderators. Mia is listed as a member all the same so the roster shows
 * her, and Erlend's management right comes from the explicit manager row, not
 * from being a moderator.
 *
 * `moderatorsRead` is true for Safe-Space because it predates group creation
 * in the product (20261022100000 keeps that rule for every group that existed
 * then). A group created with `create_subgroup()` gets false.
 */
export interface SubgroupFixture {
  communityId: string;
  slug: string;
  name: string;
  description: string;
  moderatorsRead: boolean;
}

export const subgroups: SubgroupFixture[] = [
  {
    communityId: "tryggere-ruspolitikk",
    slug: "safe-space-frivillige",
    name: "Safe-Space frivillige",
    description: "Frivillige i Safe-Space-arbeidet.",
    moderatorsRead: true,
  },
];

export interface SubgroupMemberFixture {
  communityId: string;
  subgroupSlug: string;
  userId: string;
}

export const subgroupMembers: SubgroupMemberFixture[] = [
  { communityId: "tryggere-ruspolitikk", subgroupSlug: "safe-space-frivillige", userId: "mia-minge" },
  { communityId: "tryggere-ruspolitikk", subgroupSlug: "safe-space-frivillige", userId: "erlend-thonstad" },
  { communityId: "tryggere-ruspolitikk", subgroupSlug: "safe-space-frivillige", userId: "kristoffer" },
];

export const subgroupManagers: SubgroupMemberFixture[] = [
  { communityId: "tryggere-ruspolitikk", subgroupSlug: "safe-space-frivillige", userId: "erlend-thonstad" },
];
