"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Panel } from "@/components/ui/primitives";
import {
  addSubgroupMemberAction,
  removeSubgroupMemberAction,
  setSubgroupManagerAction,
} from "@/app/actions";
import { useT } from "@/lib/i18n/react";
import { emptySubgroupFormState } from "@/lib/subgroup-form";
import type { Subgroup, SubgroupRosterEntry } from "@/lib/types";

function Pending({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? "…" : children}</>;
}

/**
 * Membership of one private team, for the people allowed to change it.
 *
 * Adding starts with a search by name: the page asks the database for at most
 * ten active members of this community whose display name matches, and the
 * database refuses anyone else on add regardless. There is deliberately no
 * list of the whole community here. Removing takes away the team membership
 * and nothing more: the person stays in the community, keeps their role and
 * lokallag, and everything they wrote stays.
 *
 * Who else runs the group is the community's decision: the "gruppeansvarlig"
 * buttons are drawn for admins only, and for every member of the group —
 * being gruppeansvarlig is a job in this group, whatever the person's role in
 * the community. A gruppeansvarlig who is not an admin gets no such buttons,
 * and none to remove another gruppeansvarlig. The database refuses all of it
 * again whatever is drawn.
 */
export function SubgroupAdmin({
  communityId,
  subgroup,
  roster,
  query,
  candidates,
  viewerId,
  viewerIsAdmin,
}: {
  communityId: string;
  subgroup: Subgroup;
  roster: SubgroupRosterEntry[];
  viewerId: string;
  viewerIsAdmin: boolean;
  /** The current search text for this team, if any. */
  query: string;
  /** Matches for `query`, from the database. Empty until someone searches. */
  candidates: { userId: string; displayName: string }[];
}) {
  const t = useT();
  const [addState, addAction] = useActionState(addSubgroupMemberAction, emptySubgroupFormState);
  const [removeState, removeAction] = useActionState(removeSubgroupMemberAction, emptySubgroupFormState);
  const [managerState, managerAction] = useActionState(setSubgroupManagerAction, emptySubgroupFormState);

  return (
    <div className="space-y-4">
      {roster.length === 0 ? (
        <p className="text-[13px] text-ink-3">{t("subgroups.empty")}</p>
      ) : (
        <ul className="space-y-2" aria-label={t("subgroups.membersHeading", { name: subgroup.name })}>
          {roster.map((person) => (
            <Panel as="li" key={person.userId} className="flex flex-wrap items-center gap-3 p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] text-ink">{person.displayName}</span>
                {person.role ? (
                  <span className="block text-[12px] text-ink-3">{t(`role.${person.role}.label`)}</span>
                ) : null}
              </span>
              {person.isManager ? <Badge tone="neutral">{t("subgroups.manager")}</Badge> : null}
              {viewerIsAdmin ? (
                <form action={managerAction}>
                  <input type="hidden" name="communityId" value={communityId} />
                  <input type="hidden" name="subgroupId" value={subgroup.id} />
                  <input type="hidden" name="userId" value={person.userId} />
                  <input type="hidden" name="isManager" value={person.isManager ? "false" : "true"} />
                  <button
                    type="submit"
                    aria-label={t(
                      person.isManager ? "subgroups.unmakeManagerNamed" : "subgroups.makeManagerNamed",
                      { name: person.displayName },
                    )}
                    className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                  >
                    <Pending>{t(person.isManager ? "subgroups.unmakeManager" : "subgroups.makeManager")}</Pending>
                  </button>
                </form>
              ) : null}
              {viewerIsAdmin || !person.isManager || person.userId === viewerId ? (
                <form action={removeAction}>
                  <input type="hidden" name="communityId" value={communityId} />
                  <input type="hidden" name="subgroupId" value={subgroup.id} />
                  <input type="hidden" name="userId" value={person.userId} />
                  <button
                    type="submit"
                    aria-label={t("subgroups.removeNamed", { name: person.displayName })}
                    className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                  >
                    <Pending>{t("subgroups.remove")}</Pending>
                  </button>
                </form>
              ) : null}
            </Panel>
          ))}
        </ul>
      )}

      {removeState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {removeState.error}
        </p>
      ) : null}

      {managerState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {managerState.error}
        </p>
      ) : null}

      {subgroup.active ? (
        <div className="space-y-2">
          <form method="get" className="flex flex-wrap items-center gap-2" role="search">
            <input type="hidden" name="gruppe" value={subgroup.id} />
            <label className="sr-only" htmlFor={`search-${subgroup.id}`}>
              {t("subgroups.searchLabel")}
            </label>
            <input
              id={`search-${subgroup.id}`}
              name="sok"
              type="search"
              defaultValue={query}
              minLength={2}
              maxLength={80}
              placeholder={t("subgroups.searchPlaceholder")}
              className="h-10 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
            />
            <button
              type="submit"
              className="h-10 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3"
            >
              {t("subgroups.search")}
            </button>
          </form>

          {query.length >= 2 ? (
            candidates.length > 0 ? (
              <ul className="space-y-1.5" aria-label={t("subgroups.searchResults")}>
                {candidates.map((candidate) => (
                  <li
                    key={candidate.userId}
                    className="flex items-center gap-3 rounded-[5px] border border-line px-3.5 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{candidate.displayName}</span>
                    <form action={addAction}>
                      <input type="hidden" name="communityId" value={communityId} />
                      <input type="hidden" name="subgroupId" value={subgroup.id} />
                      <input type="hidden" name="userId" value={candidate.userId} />
                      <button
                        type="submit"
                        aria-label={t("subgroups.addNamed", { name: candidate.displayName })}
                        className="h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                      >
                        <Pending>{t("subgroups.add")}</Pending>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">{t("subgroups.noMatches")}</p>
            )
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">{t("subgroups.archivedNote")}</p>
      )}

      {addState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {addState.error}
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-3">{t("subgroups.removeNote")}</p>
    </div>
  );
}
