/**
 * Shared shapes for subgroup (team) actions, and the one parser for a post's or
 * event's audience field.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions.
 */
export type SubgroupFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptySubgroupFormState: SubgroupFormState = { status: "idle" };

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
