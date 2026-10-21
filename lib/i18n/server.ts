import "server-only";

import { getSessionUser } from "@/lib/session";
import { resolveLocale, translator, type Locale } from "@/lib/i18n";

/** The same priority as the client shell: account choice, context, platform. */
export async function getRequestLocale(context?: { defaultLocale: Locale } | Locale | null): Promise<Locale> {
  return resolveLocale({
    user: (await getSessionUser())?.preferredLocale,
    community: typeof context === "string" ? context : context?.defaultLocale,
  });
}

export async function getRequestTranslator(context?: { defaultLocale: Locale } | Locale | null) {
  return translator(await getRequestLocale(context));
}
