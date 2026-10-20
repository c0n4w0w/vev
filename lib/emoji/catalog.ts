import enData from "emojibase-data/en/data.json";
import nbData from "emojibase-data/nb/data.json";
import { canonicalEmoji } from "@/lib/emoji/canonical";
import type { EmojiCatalog, EmojiCatalogEntry } from "@/lib/emoji/types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The Unicode emoji list, from Emojibase (`emojibase-data`), trimmed to what
 * the picker shows and searches.
 *
 * Kept out of: the "component" group (bare skin-tone and hair swatches), the
 * lone regional-indicator letters, and anything newer than Emoji 15.1, which
 * many phones and computers in use still draw as an empty box. Skin-tone
 * variants are not offered separately — there is no skin-tone picker — but
 * they are valid reactions (KNOWN_EMOJIS) when they arrive any other way.
 *
 * Read on the server (the /emoji-catalog route and the reaction actions) and
 * by the checks. Not for client components: the whole dataset would be
 * bundled into the page. The browser fetches the trimmed list instead.
 *
 * Search text holds the label and keywords in the screen's language, and, on
 * a Norwegian screen, the English ones too: many people look for "heart" or
 * "fire" whatever their interface says.
 */

type DataEmoji = {
  emoji: string;
  hexcode: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
  version: number;
  skins?: { emoji: string }[];
};

const NEWEST_VERSION = 15.1;
const COMPONENT_GROUP = 2;

const datasets: Record<Locale, DataEmoji[]> = {
  en: enData as unknown as DataEmoji[],
  nb: nbData as unknown as DataEmoji[],
};

function searchText(...parts: (string | string[] | undefined)[]): string {
  return [...new Set(parts.flat().filter(Boolean).join(" ").toLocaleLowerCase("nb").split(/\s+/))].join(" ");
}

const cache = new Map<Locale, EmojiCatalog>();

export function emojiCatalog(locale: Locale): EmojiCatalog {
  const cached = cache.get(locale);
  if (cached) return cached;

  const english = new Map(datasets.en.map((entry) => [entry.hexcode, entry]));
  const entries: EmojiCatalogEntry[] = datasets[locale]
    .filter(
      (entry) =>
        entry.group !== undefined &&
        entry.group !== COMPONENT_GROUP &&
        entry.version <= NEWEST_VERSION &&
        entry.order !== undefined,
    )
    .sort((a, b) => a.order! - b.order!)
    .map((entry) => {
      const en = english.get(entry.hexcode);
      return [
        canonicalEmoji(entry.emoji),
        entry.group!,
        entry.label,
        // Labels before keywords: search ranks a word found earlier higher.
        locale === "en" ? searchText(entry.label, entry.tags) : searchText(entry.label, en?.label, entry.tags, en?.tags),
      ];
    });

  const catalog: EmojiCatalog = { version: 1, entries };
  cache.set(locale, catalog);
  return catalog;
}

/**
 * Every emoji TING accepts as a built-in reaction: the whole dataset, skin
 * tones included, in canonical form.
 */
export const KNOWN_EMOJIS: ReadonlySet<string> = new Set(
  datasets.en.flatMap((entry) =>
    entry.group === undefined || entry.group === COMPONENT_GROUP
      ? []
      : [entry.emoji, ...(entry.skins ?? []).map((skin) => skin.emoji)].map(canonicalEmoji),
  ),
);

/** The canonical form of a built-in emoji, or undefined if it is not one. */
export function knownEmoji(input: string): string | undefined {
  const canonical = canonicalEmoji(input.trim());
  return KNOWN_EMOJIS.has(canonical) ? canonical : undefined;
}
