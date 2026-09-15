/**
 * The local groups each Tryggere organisation actually has, and who in the
 * fixture cast belongs to which.
 *
 * A separate file from `lib/mock/communities.ts` for the same reason
 * `community-policies.ts` is: that file is the organisations' own content,
 * edited by hand, while this is configuration the seed writes into tables the
 * application then reads. The database is authoritative; nothing at runtime
 * reads this module.
 *
 * Under The Rug has no local groups, and that is the whole mechanism by which
 * the feature stays out of its way — not a check against its slug. A community
 * with no rows here simply never shows the local-group navigation.
 *
 * Note what is deliberately absent: there is no "Utlandet" and no "Vet ikke".
 * Neither is a local group. Someone who has none, does not know, or does not
 * want to say is represented by no selection at all — `local_group_id` stays
 * null — which is a permanent, ordinary state rather than an unanswered
 * question.
 */
export interface LocalGroupFixture {
  communityId: string;
  name: string;
  /** Position in the picker. The organisations' own ordering, not alphabetical. */
  sortOrder: number;
}

export const localGroups: LocalGroupFixture[] = [
  // Tryggere Ruspolitikk
  { communityId: "tryggere-ruspolitikk", name: "FTR Oslo", sortOrder: 0 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Akershus", sortOrder: 1 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Trøndelag", sortOrder: 2 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Vestland", sortOrder: 3 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Rogaland", sortOrder: 4 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Agder", sortOrder: 5 },
  { communityId: "tryggere-ruspolitikk", name: "FTR Innlandet", sortOrder: 6 },

  // Tryggere Ungdom. TU UiO is a student group and is listed alongside the
  // county groups rather than underneath Oslo — these are organisational
  // units, not a geographic hierarchy.
  { communityId: "tryggere-ungdom", name: "TU Oslo", sortOrder: 0 },
  { communityId: "tryggere-ungdom", name: "TU Rogaland", sortOrder: 1 },
  { communityId: "tryggere-ungdom", name: "TU Trøndelag", sortOrder: 2 },
  { communityId: "tryggere-ungdom", name: "TU Vestland", sortOrder: 3 },
  { communityId: "tryggere-ungdom", name: "TU UiO", sortOrder: 4 },
];

/**
 * Who belongs where, by fixture user id and community.
 *
 * Kept partial on purpose. Several members of both organisations appear
 * nowhere below, because a member with no local group is the case the feature
 * has to handle gracefully and the demo should show it rather than hide it.
 *
 * The showcase persona (Kari, `demo-tryggere`) is given a group in the parent
 * organisation and left without one in the youth organisation, so a single
 * session demonstrates both states and the fact that the affiliation is
 * per-community rather than per-person.
 */
export interface LocalGroupAssignment {
  userId: string;
  communityId: string;
  localGroupName: string;
}

export const localGroupAssignments: LocalGroupAssignment[] = [
  // Tryggere Ruspolitikk
  { userId: "demo-tryggere", communityId: "tryggere-ruspolitikk", localGroupName: "FTR Trøndelag" },
  { userId: "amina", communityId: "tryggere-ruspolitikk", localGroupName: "FTR Oslo" },
  { userId: "kristoffer", communityId: "tryggere-ruspolitikk", localGroupName: "FTR Oslo" },
  { userId: "petter", communityId: "tryggere-ruspolitikk", localGroupName: "FTR Trøndelag" },
  { userId: "nadia", communityId: "tryggere-ruspolitikk", localGroupName: "FTR Vestland" },
  // linn (Tromsø) and elise are deliberately left without one.

  // Tryggere Ungdom — different people, different groups, and a different
  // answer for anyone who appears in both.
  { userId: "hanne", communityId: "tryggere-ungdom", localGroupName: "TU Oslo" },
  { userId: "mathea", communityId: "tryggere-ungdom", localGroupName: "TU UiO" },
  { userId: "adrian", communityId: "tryggere-ungdom", localGroupName: "TU Vestland" },
  { userId: "petter", communityId: "tryggere-ungdom", localGroupName: "TU Trøndelag" },
  // demo-tryggere is a moderator here with no local group, on purpose.
];
