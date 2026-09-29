/**
 * Shared shape for editing a community's "Om fellesskapet" text.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions. The limit mirrors the `communities_about_length` check
 * constraint and `set_community_about()`, so a value rejected here would be
 * rejected there too — this just gives the answer without a round trip.
 */
import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";

export type CommunityAboutFormState =
  | { status: "idle" }
  | { status: "ok"; about: string }
  | { status: "error"; message: string };

export const emptyCommunityAboutFormState: CommunityAboutFormState = { status: "idle" };

export const COMMUNITY_ABOUT_MAX = 1500;

export function normalizeCommunityAbout(
  raw: string,
  t: Translator = translator(PLATFORM_LOCALE),
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (Array.from(value).length > COMMUNITY_ABOUT_MAX) {
    return { ok: false, message: t("err.communityAboutTooLong", { max: COMMUNITY_ABOUT_MAX }) };
  }
  return { ok: true, value };
}
