import { PLATFORM_LOCALE, t, type Locale } from "@/lib/i18n";
import type { RoleId } from "@/lib/types";

/**
 * Role names as shown to people.
 *
 * The role values themselves — `member`, `moderator`, `admin` — are what the
 * database and every policy speak, and never change with language. Only the
 * words on screen do, so labels are looked up per locale. Kept out of the data
 * layer because Client Components use them too: importing this must not pull
 * in a database client.
 */
export function roleLabel(roleId: RoleId, locale: Locale = PLATFORM_LOCALE) {
  return t(locale, `role.${roleId}.label`);
}

export function roleDescription(roleId: RoleId, locale: Locale = PLATFORM_LOCALE) {
  return t(locale, `role.${roleId}.description`);
}

/** The wording used where access is being managed: "Standard access" rather than "Member". */
export function roleAccessLabel(roleId: RoleId, locale: Locale = PLATFORM_LOCALE) {
  return t(locale, `role.access.${roleId}`);
}

/** Titles that only restate the default role are not worth showing. */
const DEFAULT_TITLES = new Set(["medlem", "member"]);

export function publicMemberTitle(title?: string | null) {
  const trimmed = title?.trim();
  if (!trimmed || DEFAULT_TITLES.has(trimmed.toLocaleLowerCase("nb-NO"))) return undefined;
  return trimmed;
}
