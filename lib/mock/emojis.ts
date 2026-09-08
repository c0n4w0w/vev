/**
 * Custom emojis for the seeded communities.
 *
 * `file` names an image in `lib/mock/emoji-art/`. The seed uploads it to the
 * private `community-emoji` bucket under the owning community's path prefix.
 *
 * Note `:party:` deliberately appearing twice. Two communities, two unrelated
 * emojis, two different images — that is the whole point of scoping them, and
 * `scripts/check-content.ts` asserts the pair stays here.
 */
export interface SeedEmoji {
  communityId: string;
  name: string;
  file: string;
  /** Must be a moderator or admin of that community. */
  createdBy: string;
}

export const customEmojis: SeedEmoji[] = [
  {
    communityId: "tryggere-ruspolitikk",
    name: "harmreduction",
    file: "harmreduction.png",
    createdBy: "amina",
  },
  {
    communityId: "tryggere-ruspolitikk",
    name: "tryggere",
    file: "tryggere.png",
    createdBy: "ingrid",
  },
  {
    communityId: "tryggere-ruspolitikk",
    name: "party",
    file: "tryggere.png",
    createdBy: "amina",
  },

  { communityId: "tryggere-ungdom", name: "ungdom", file: "ungdom.png", createdBy: "hanne" },
  {
    communityId: "tryggere-ungdom",
    name: "solidaritet",
    file: "solidaritet.png",
    createdBy: "mathea",
  },

  { communityId: "under-the-rug", name: "utr", file: "utr.png", createdBy: "marte" },
  { communityId: "under-the-rug", name: "rave", file: "rave.png", createdBy: "eirik" },
  // Same name as the Tryggere Ruspolitikk one above, different image, no relation.
  { communityId: "under-the-rug", name: "party", file: "rave.png", createdBy: "marte" },
];
