import type { EmojiCatalog } from "@/lib/emoji/types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The browser's copy of the emoji catalogue: fetched from /emoji-catalog the
 * first time a picker opens, then kept for the page's lifetime. A failed load
 * is forgotten, so the next opening tries again.
 */
const loads = new Map<Locale, Promise<EmojiCatalog>>();

export function loadEmojiCatalog(locale: Locale): Promise<EmojiCatalog> {
  let load = loads.get(locale);
  if (!load) {
    load = fetch(`/emoji-catalog/${locale}`, { credentials: "omit" })
      .then((response) => {
        if (!response.ok) throw new Error(`emoji catalogue ${response.status}`);
        return response.json() as Promise<EmojiCatalog>;
      })
      .catch((error) => {
        loads.delete(locale);
        throw error;
      });
    loads.set(locale, load);
  }
  return load;
}
