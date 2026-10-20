import type { EmojiCatalogEntry } from "@/lib/emoji/types";

/**
 * Emoji search: every word of the query must start a word of the entry's
 * label or keywords (in the screen's language and English), or match the
 * emoji itself. Best first: the label itself, a whole word of it, the label's
 * start, the start of a word of it, then a keyword — each time a whole
 * keyword before a mere prefix; among keyword matches an English label before
 * a keyword; among equals the shorter label ("rødt hjerte" before
 * "hjerte med pil"), then the catalogue's order.
 */
export function searchEmojiEntries(
  entries: readonly EmojiCatalogEntry[],
  query: string,
  limit = 120,
): EmojiCatalogEntry[] {
  const q = query.trim().toLocaleLowerCase("nb");
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored: { entry: EmojiCatalogEntry; score: number; position: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const [emoji, , label, search] = entry;
    if (emoji === q) {
      scored.push({ entry, score: -1, position: 0, index });
      return;
    }
    const words = search.split(" ");
    if (!terms.every((term) => words.some((word) => word.startsWith(term)))) return;
    const lowerLabel = label.toLocaleLowerCase("nb");
    const labelWords = lowerLabel.split(/[\s:,–-]+/);
    const tier =
      lowerLabel === q
        ? 0
        : labelWords.includes(terms[0])
          ? 1
          : lowerLabel.startsWith(q)
            ? 2
            : labelWords.some((word) => word.startsWith(terms[0]))
              ? 3
              : 4;
    // Within a tier, a whole keyword ("clap" for 👏) beats a word that only
    // starts with it ("clapper", "hearth").
    const score = tier * 2 + (words.includes(terms[0]) ? 0 : 1);
    // Found outside the screen's own label: where the word was found. The
    // English label comes before the keywords in the search text.
    const position = tier === 4 ? words.findIndex((word) => word.startsWith(terms[0])) : 0;
    scored.push({ entry, score, position, index });
  });

  return scored
    .sort(
      (a, b) =>
        a.score - b.score || a.position - b.position || a.entry[2].length - b.entry[2].length || a.index - b.index,
    )
    .slice(0, limit)
    .map((item) => item.entry);
}
