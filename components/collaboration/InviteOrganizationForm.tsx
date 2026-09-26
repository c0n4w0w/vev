"use client";

import { useActionState } from "react";
import { inviteOrganizationAction } from "@/app/collaboration-actions";
import { fieldClass } from "@/components/collaboration/CreateCollaborationForm";
import { Button } from "@/components/ui/primitives";
import { emptyCollaborationFormState } from "@/lib/collaboration-form";
import { PUBLIC_HOST } from "@/lib/brand";
import { useLocale, useT } from "@/lib/i18n/react";

/**
 * Inviting another organisation by its exact TING address.
 *
 * A plain text field on purpose: no autocomplete, no suggestions, no lookup
 * as you type. The server reduces what was typed to a slug, the database
 * resolves that slug exactly or not at all, and every failure gets the same
 * answer — so this form cannot be used to find out which organisations exist.
 */
export function InviteOrganizationForm({
  collaborationId,
  slug,
}: {
  collaborationId: string;
  slug: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    inviteOrganizationAction,
    emptyCollaborationFormState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="collaborationId" value={collaborationId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor="invite-target" className="block text-sm font-medium text-ink">
        {t("collab.manage.inviteLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="invite-target"
          name="target"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={`${PUBLIC_HOST}/…`}
          className={`${fieldClass} h-10 min-w-0 font-mono text-[13px] sm:flex-1`}
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "…" : t("collab.manage.inviteSubmit")}
        </Button>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-3">
        {t("collab.manage.inviteHint", {
          example: `${PUBLIC_HOST}/${t("collab.manage.inviteExample")}`,
        })}
      </p>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] text-rust"
              : "text-[13px] text-skog"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
