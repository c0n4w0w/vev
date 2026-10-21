"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { translator, type Translator } from "@/lib/i18n";
import { PLATFORM_LOCALE, type Locale } from "@/lib/i18n/locales";

const LocaleContext = createContext<Locale>(PLATFORM_LOCALE);

/**
 * Hands a locale to the Client Components beneath it.
 *
 * The community layout wraps everything inside a community, so a shared
 * component reads the community's language without every parent threading a
 * prop through. Server Components do not use this — they are given the locale
 * (or the community) directly.
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
