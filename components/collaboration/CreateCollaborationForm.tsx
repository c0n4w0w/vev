"use client";

import { useActionState } from "react";
import { createCollaborationAction } from "@/app/collaboration-actions";
import { Button, Panel } from "@/components/ui/primitives";
import {
  COLLABORATION_DESCRIPTION_MAX,
  COLLABORATION_NAME_MAX,
  emptyCollaborationFormState,
} from "@/lib/collaboration-form";
import { useLocale, useT } from "@/lib/i18n/react";

export const fieldClass =
  "w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3 focus-visible:ring-2 focus-visible:ring-skog/20";

export interface RepresentableOrganization {
  communityId: string;
  communityName: string;
  /** Encoded unit value for the whole community. */
  wholeValue: string;
  /** Its own active local groups, encoded. */
  localGroups: { value: string; name: string }[];
}

/**
 * Starting a collaboration. The only choices offered are units the person can
 * represent right now — their own organisations as administrator, and those
 * organisations' own active local groups. The database checks that again;
 * this list is a convenience, not the rule.
 *
 * There is no slug field: the server derives one from the name.
 */
export function CreateCollaborationForm({
  organizations,
}: {
  organizations: RepresentableOrganization[];
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    createCollaborationAction,
    emptyCollaborationFormState,
  );

  return (
    <Panel className="p-5 sm:p-6">
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="locale" value={locale} />

        <div>
          <label htmlFor="collab-name" className="mb-1.5 block text-sm font-medium text-ink">
            {t("collab.new.name")}
          </label>
          <input
            id="collab-name"
            name="name"
            required
            maxLength={COLLABORATION_NAME_MAX}
            placeholder={t("collab.new.namePlaceholder")}
            className={`${fieldClass} h-10`}
          />
        </div>

        <div>
          <label htmlFor="collab-description" className="mb-1.5 block text-sm font-medium text-ink">
            {t("collab.new.description")}{" "}
            <span className="font-normal text-ink-3">({t("collab.new.optional")})</span>
          </label>
          <textarea
            id="collab-description"
            name="description"
            rows={4}
            maxLength={COLLABORATION_DESCRIPTION_MAX}
            placeholder={t("collab.new.descriptionPlaceholder")}
            className={`${fieldClass} resize-y py-2 leading-relaxed`}
          />
        </div>

        <div>
          <label htmlFor="collab-unit" className="mb-1.5 block text-sm font-medium text-ink">
            {t("collab.new.unit")}
          </label>
          <select
            id="collab-unit"
            name="unit"
            required
            defaultValue={organizations[0]?.wholeValue}
            className={`${fieldClass} h-10 pr-8`}
          >
            {organizations.map((organization) => (
              <optgroup key={organization.communityId} label={organization.communityName}>
                <option value={organization.wholeValue}>
                  {t("collab.new.wholeOrg", { name: organization.communityName })}
                </option>
                {organization.localGroups.map((group) => (
                  <option key={group.value} value={group.value}>
                    {group.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{t("collab.new.unitHint")}</p>
        </div>

        {state.status === "error" && state.message ? (
          <p
            role="alert"
            className="rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] text-rust"
          >
            {state.message}
          </p>
        ) : null}

        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" disabled={pending}>
            {pending ? "…" : t("collab.new.submit")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
