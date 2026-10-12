/**
 * Shared shapes for subgroup (team) actions, and the one parser for a post's or
 * event's audience field.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions.
 */
import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";

export type SubgroupFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptySubgroupFormState: SubgroupFormState = { status: "idle" };

/**
 * Creating a group. Success never comes back as a state: the action redirects
 * to the new group's chat.
 */
export type SubgroupCreateFormState = { status: "idle" } | { status: "error"; error: string };

export const emptySubgroupCreateFormState: SubgroupCreateFormState = { status: "idle" };

/** One match from the member search: an id and a community display name. */
export type SubgroupCandidate = { userId: string; displayName: string };

/**
 * How many members one create form may carry. Far above any real working
 * group; create_subgroup() has its own, higher ceiling.
 */
export const SUBGROUP_MEMBERS_MAX = 100;

/**
 * A group's chat is named after the group, so the name shares the channel
 * name's limit; the description is the chat's description. Both mirror
 * create_subgroup() / set_subgroup_details(), so a value refused here would be
 * refused there too; this just answers without a round trip.
 */
export const SUBGROUP_NAME_MAX = 40;
export const SUBGROUP_DESCRIPTION_MAX = 200;

// Same set as Postgres' [[:cntrl:]]: newlines, tabs and other control characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeSubgroupDetails(
  rawName: string,
  rawDescription: string,
  t: Translator = translator(PLATFORM_LOCALE),
): { ok: true; name: string; description: string } | { ok: false; message: string } {
  const name = rawName.trim();
  const description = rawDescription.trim();
  if (!name || CONTROL.test(name)) return { ok: false, message: t("err.subgroupNameEmpty") };
  if (Array.from(name).length > SUBGROUP_NAME_MAX) {
    return { ok: false, message: t("err.subgroupNameTooLong", { max: SUBGROUP_NAME_MAX }) };
  }
  if (CONTROL.test(description) || Array.from(description).length > SUBGROUP_DESCRIPTION_MAX) {
    return { ok: false, message: t("err.subgroupDescriptionTooLong", { max: SUBGROUP_DESCRIPTION_MAX }) };
  }
  return { ok: true, name, description };
}

/**
 * The composer's audience select submits `scope` as `""` (whole community),
 * `local:<uuid>` or `subgroup:<uuid>`. Only the shape is parsed here; whether
 * the caller may publish to that scope, and whether the group belongs to this
 * community, is decided by `posts_insert` / `events_insert` and the foreign
 * keys. Anything unrecognised is the whole community — which the database
 * still checks like any other write.
 */
export function parseContentScope(raw: string): { localGroupId?: string; subgroupId?: string } {
  const value = raw.trim();
  if (value.startsWith("local:")) return { localGroupId: value.slice("local:".length) || undefined };
  if (value.startsWith("subgroup:")) return { subgroupId: value.slice("subgroup:".length) || undefined };
  return {};
}
