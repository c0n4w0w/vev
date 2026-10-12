"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createSubgroupAction } from "@/app/actions";
import { SubgroupMemberSearch } from "@/components/community/SubgroupMemberSearch";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose, IconLock, IconPlus } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import {
  SUBGROUP_DESCRIPTION_MAX,
  SUBGROUP_MEMBERS_MAX,
  SUBGROUP_NAME_MAX,
  emptySubgroupCreateFormState,
  type SubgroupCandidate,
} from "@/lib/subgroup-form";

const fieldClass =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";

function CreateButton({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? t("subgroups.create.creating") : t("subgroups.create.submit")}
    </button>
  );
}

/**
 * "+ Ny gruppe" on the Grupper page, and the form behind it.
 *
 * Rendered only for someone the page found may create a group here — an
 * admin or moderator of the community — and decided again by
 * `create_subgroup()`. The form carries the community, a name, an optional
 * description and the ids of the chosen members; on success the action opens
 * the new group's chat. Everything typed is kept in state, so a refused save
 * loses nothing.
 */
export function SubgroupCreate({
  communityId,
  communityName,
  accent,
}: {
  communityId: string;
  communityName: string;
  accent: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(createSubgroupAction, emptySubgroupCreateFormState);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<SubgroupCandidate[]>([]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[5px] px-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: accent }}
      >
        <IconPlus size={15} />
        {t("subgroups.new")}
      </button>

      <ConfirmDialog open={open} onClose={() => setOpen(false)} labelledBy="subgroup-create-title">
        <h3
          id="subgroup-create-title"
          className="flex items-center gap-2 font-display text-lg leading-snug text-ink"
        >
          <IconLock size={16} className="shrink-0 text-ink-3" />
          {t("subgroups.create.title", { community: communityName })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t("subgroups.create.lead", { community: communityName })}
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="communityId" value={communityId} />
          {members.map((person) => (
            <input key={person.userId} type="hidden" name="memberIds" value={person.userId} />
          ))}

          <div>
            <label htmlFor="subgroup-create-name" className="label mb-1 block">
              {t("subgroups.create.name")}
            </label>
            <input
              id="subgroup-create-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={SUBGROUP_NAME_MAX}
              required
              autoComplete="off"
              placeholder={t("subgroups.create.namePlaceholder")}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="subgroup-create-description" className="label mb-1 block">
              {t("subgroups.create.description")}{" "}
              <span className="font-normal normal-case tracking-normal text-ink-3">
                ({t("subgroups.create.optional")})
              </span>
            </label>
            <input
              id="subgroup-create-description"
              name="description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={SUBGROUP_DESCRIPTION_MAX}
              autoComplete="off"
              placeholder={t("subgroups.create.descriptionPlaceholder")}
              className={fieldClass}
            />
          </div>

          <div>
            <p className="label mb-1">{t("subgroups.create.members")}</p>
            <p className="mb-2 text-[12px] leading-relaxed text-ink-3">
              {t("subgroups.create.membersHint", { community: communityName })}
            </p>

            {members.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("subgroups.selected.label")}>
                {members.map((person) => (
                  <li
                    key={person.userId}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-paper py-0.5 pl-2.5 pr-1 text-[13px] text-ink"
                  >
                    <span className="max-w-[12rem] truncate">{person.displayName}</span>
                    <button
                      type="button"
                      onClick={() => setMembers((current) => current.filter((p) => p.userId !== person.userId))}
                      aria-label={t("subgroups.selected.removeNamed", { name: person.displayName })}
                      className="rounded-full p-0.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                    >
                      <IconClose size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-[13px] text-ink-3">{t("subgroups.selected.none")}</p>
            )}

            <SubgroupMemberSearch
              inputId="subgroup-create-search"
              communityId={communityId}
              communityName={communityName}
              excludeIds={members.map((person) => person.userId)}
              renderAction={(candidate) => (
                <button
                  type="button"
                  disabled={members.length >= SUBGROUP_MEMBERS_MAX}
                  onClick={() => setMembers((current) => [...current, candidate])}
                  aria-label={t("subgroups.newSearch.addNamed", { name: candidate.displayName })}
                  className="h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-40"
                >
                  {t("subgroups.newSearch.add")}
                </button>
              )}
            />
          </div>

          {state.status === "error" ? (
            <p role="alert" className="text-[13px] text-rust">
              {state.error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2"
            >
              {t("common.cancel")}
            </button>
            <CreateButton accent={accent} />
          </div>
        </form>
      </ConfirmDialog>
    </>
  );
}
