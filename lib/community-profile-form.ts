/**
 * Shared shapes for editing your profile in one community.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions. The display-name rule itself is the access request's
 * (`normalizeDisplayName` in `lib/access-form.ts`), so a name that was good
 * enough to ask to join with is good enough to keep, and vice versa.
 */
import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";

export type CommunityProfileFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyCommunityProfileFormState: CommunityProfileFormState = { status: "idle" };

/** Characters, the same limit `update_my_community_profile()` enforces. */
export const BIO_MAX = 500;

export function normalizeBio(
  raw: string,
  t: Translator = translator(PLATFORM_LOCALE),
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  // Array.from counts characters rather than UTF-16 units, as Postgres does.
  if (Array.from(value).length > BIO_MAX) {
    return { ok: false, message: t("err.bioTooLong", { max: BIO_MAX }) };
  }
  return { ok: true, value };
}
