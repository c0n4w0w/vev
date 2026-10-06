"use client";

import { useT } from "@/lib/i18n/react";
import type { LocalGroup, Subgroup } from "@/lib/types";

/**
 * The options of a post's or event's audience select: the whole community, a
 * lokallag, or a subgroup. Values are parsed by `parseContentScope()`.
 *
 * Which groups are offered is a convenience, not a permission: the page passes
 * only scopes the author can publish into, and `posts_insert` / `events_insert`
 * refuse any other regardless of what is submitted.
 */
export function ScopeOptions({
  localGroups,
  subgroups,
}: {
  localGroups: LocalGroup[];
  subgroups: Subgroup[];
}) {
  const t = useT();
  return (
    <>
      <option value="">{t("composer.wholeCommunity")}</option>
      {localGroups.length > 0 ? (
        <optgroup label={t("composer.localGroupsHeading")}>
          {localGroups.map((group) => (
            <option key={group.id} value={`local:${group.id}`}>
              {group.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {subgroups.length > 0 ? (
        <optgroup label={t("composer.subgroupsHeading")}>
          {subgroups.map((subgroup) => (
            <option key={subgroup.id} value={`subgroup:${subgroup.id}`}>
              {subgroup.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}
