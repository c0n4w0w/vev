/**
 * Which languages the interface can be written in.
 *
 * Adding one is three deliberate steps: a dictionary alongside `nb` and `en`,
 * an entry here, and a widening of the `communities_default_locale_allowed`
 * check in the database. Nothing else has to change — components ask for a
 * message by key and get it in whichever locale they were handed.
 *
 * Locale is presentation. Nothing here, and nothing that reads it, decides who
 * may see or do anything.
 */
export const LOCALES = ["nb", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** The language of any screen that belongs to no community and has no preference. */
export const PLATFORM_LOCALE: Locale = "nb";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Narrows an arbitrary stored string; anything unrecognised becomes the platform locale. */
export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : PLATFORM_LOCALE;
}

/**
 * The language a screen is shown in.
 *
 *   explicit user preference → community default → platform fallback
 *
 * An unset account preference is undefined: opening a community never writes
 * a preference, and its default continues to apply until the owner chooses.
 */
export function resolveLocale(sources: {
  user?: Locale | null;
  community?: Locale | null;
}): Locale {
  return sources.user ?? sources.community ?? PLATFORM_LOCALE;
}

/** The BCP 47 tag `Intl` should format with. British English: day-month order, 24-hour clock. */
export const INTL_TAG: Record<Locale, string> = {
  nb: "nb-NO",
  en: "en-GB",
};
