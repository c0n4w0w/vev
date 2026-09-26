"use client";

import { useActionState, useId } from "react";
import {
  acceptOrganizationInviteAction,
  declineOrganizationInviteAction,
} from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { Button, cn } from "@/components/ui/primitives";
import { emptyCollaborationFormState, encodeUnit } from "@/lib/collaboration-form";
import { useLocale, useT } from "@/lib/i18n/react";

/**
 * An organisation answering an invitation, and choosing HOW it takes part.
 *
 * Only the invited organisation's own representative ever sees this, and the
 * choices are that organisation's own active local groups — read through the
 * representative's ordinary membership of it. The inviter never saw this
 * list; the invitation named only the community.
 */
export function OrganizationInviteResponse({
  participantId,
  communityId,
  communityName,
  localGroups,
  slug,
}: {
  participantId: string;
  communityId: string;
  communityName: string;
  localGroups: { id: string; name: string }[];
  slug: string;
}) {
  const t = useT();
  const locale = useLocale();
  const groupName = useId();
  const [state, formAction, pending] = useActionState(
    acceptOrganizationInviteAction,
    emptyCollaborationFormState,
  );

  const options = [
    { value: encodeUnit(communityId), label: t("collab.orgInvite.wholeOrg", { name: communityName }) },
    ...localGroups.map((group) => ({ value: encodeUnit(communityId, group.id), label: group.name })),
  ];

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="participantId" value={participantId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locale" value={locale} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">
            {t("collab.orgInvite.participateAs")}
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {options.map((option, index) => (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[5px] border border-line bg-surface px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-paper-2",
                  "has-[:checked]:border-skog/50 has-[:checked]:bg-skog-soft/50 has-[:checked]:text-ink",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-skog/25",
                  index === 0 && "sm:col-span-2 font-medium",
                )}
              >
                <input
                  type="radio"
                  name="unit"
                  value={option.value}
                  defaultChecked={index === 0}
                  className="accent-[var(--color-skog)]"
                  aria-describedby={index === 0 ? groupName : undefined}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p id={groupName} className="text-[12.5px] leading-relaxed text-ink-3">
          {t("collab.orgInvite.note")}
        </p>
        {state.status === "error" && state.message ? (
          <p role="alert" className="text-[13px] text-rust">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "…" : t("collab.orgInvite.accept")}
        </Button>
      </form>
      <ActionButton
        action={declineOrganizationInviteAction}
        fields={{ participantId, slug }}
        label={t("collab.orgInvite.decline")}
        variant="quiet"
        confirm={{ note: t("collab.orgInvite.declineNote"), yes: t("collab.orgInvite.declineConfirm") }}
      />
    </div>
  );
}
