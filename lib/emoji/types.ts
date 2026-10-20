/**
 * The emoji catalogue as the picker receives it.
 *
 * Each entry is [emoji, group, label, search text]: a tuple rather than an
 * object because the list has close to two thousand of them and is fetched
 * when a picker first opens.
 */
export type EmojiCatalogEntry = [emoji: string, group: number, label: string, search: string];

export interface EmojiCatalog {
  version: 1;
  entries: EmojiCatalogEntry[];
}

/** Emojibase's groups, minus "component" (2), in the order the picker shows them. */
export const EMOJI_GROUPS = [
  { id: 0, key: "smileys" },
  { id: 1, key: "people" },
  { id: 3, key: "nature" },
  { id: 4, key: "food" },
  { id: 5, key: "travel" },
  { id: 6, key: "activities" },
  { id: 7, key: "objects" },
  { id: 8, key: "symbols" },
  { id: 9, key: "flags" },
] as const;

export type EmojiGroupKey = (typeof EMOJI_GROUPS)[number]["key"];

/**
 * Quick reactions, first in every picker, before the community's own emojis.
 * The same six everywhere; there is no "frequently used" and nothing counts
 * what anyone picks.
 */
export const QUICK_REACTIONS = ["❤️", "👍", "👏", "😂", "🎉", "🔥"] as const;
