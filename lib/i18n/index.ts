import { en } from "./en";
import { nb, type MessageKey } from "./nb";
import { PLATFORM_LOCALE, resolveLocale, type Locale } from "./locales";

export * from "./locales";
export type { MessageKey } from "./nb";

const dictionaries: Record<Locale, Record<MessageKey, string>> = { nb, en };

export type MessageParams = Record<string, string | number>;

/** A message lookup bound to one locale. */
export type Translator = (key: MessageKey, params?: MessageParams) => string;

/**
 * One interface message, in one locale.
 *
 * `{name}` placeholders are filled from `params`. Messages are interface
 * chrome only; anything a person or an administrator wrote — posts, bios,
 * channel names, event text — is data and never passes through here.
 */
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = dictionaries[locale][key] ?? dictionaries[PLATFORM_LOCALE][key] ?? key;
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function translator(locale: Locale): Translator {
  return (key, params) => t(locale, key, params);
}

/**
 * A count in words: `tn("en", "count.members", 1)` → "1 member".
 *
 * Reads `<key>.one` for exactly one and `<key>.other` for everything else,
 * with `{count}` filled in. Both languages here have just those two forms.
 */
export function tn(
  locale: Locale,
  key: PluralBase,
  count: number,
  params?: MessageParams,
): string {
  return t(locale, `${key}.${count === 1 ? "one" : "other"}` as MessageKey, {
    ...params,
    count,
  });
}

/** Message keys that have `.one` / `.other` forms. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

/** The locale of a community's own screens. */
export function communityLocale(community: { defaultLocale: Locale }): Locale {
  return resolveLocale({ community: community.defaultLocale });
}

/**
 * The translator for a community's screens — or the platform's when there is
 * no community (a page metadata function asked about one the caller cannot see).
 */
export function communityTranslator(
  community?: { defaultLocale: Locale } | null,
): Translator {
  return translator(community ? communityLocale(community) : PLATFORM_LOCALE);
}
