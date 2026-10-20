import { emojiCatalog } from "@/lib/emoji/catalog";
import { LOCALES, isLocale } from "@/lib/i18n/locales";

/**
 * The Unicode emoji list for the picker, one file per interface language.
 *
 * Public on purpose: it is the Unicode standard's own list with Emojibase's
 * labels, the same for everyone, and says nothing about any community.
 * Community emojis never travel with it — they come with each page, under
 * their own policy. Built once at build time and served as a static file;
 * the picker fetches it the first time it opens.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function GET(_request: Request, context: RouteContext<"/emoji-catalog/[locale]">) {
  const { locale } = await context.params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  return Response.json(emojiCatalog(locale), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
