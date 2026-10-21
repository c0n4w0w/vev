import type { Locale } from "@/lib/i18n";

/** Carry the community's UI language across account links; never an access decision. */
export function accountPath(path: string, locale: Locale): string {
  const url = new URL(path, "http://ting.local");
  if (locale === "en") url.searchParams.set("locale", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}
