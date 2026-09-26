"use client";

import { useActionState, useState } from "react";
import { saveCollaborationProfileAction } from "@/app/collaboration-actions";
import { fieldClass } from "@/components/collaboration/CreateCollaborationForm";
import { Avatar, Button, Panel } from "@/components/ui/primitives";
import { DISPLAY_NAME_MAX } from "@/lib/access-form";
import { emptyCollaborationFormState } from "@/lib/collaboration-form";
import { BIO_MAX } from "@/lib/community-profile-form";
import { initialsFor } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/react";

/**
 * The person's own collaboration persona: a name and an optional bio, and
 * nothing else in Step 1B (the monogram stands in for a photo).
 *
 * The starting values are either the saved collaboration profile, or — only
 * when the person explicitly picked one — a copy of one of their own
 * community profiles. Saving writes an independent row; the community profile
 * is never touched and never linked.
 */
export function CollaborationProfileForm({
  collaborationId,
  slug,
  userId,
  initialName,
  initialBio,
  onboarding,
}: {
  collaborationId: string;
  slug: string;
  userId: string;
  initialName: string;
  initialBio: string;
  onboarding: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    saveCollaborationProfileAction,
    emptyCollaborationFormState,
  );
  const [name, setName] = useState(initialName);
  const [bioLength, setBioLength] = useState(Array.from(initialBio).length);

  return (
    <Panel className="p-5 sm:p-6">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="collaborationId" value={collaborationId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locale" value={locale} />
        {onboarding ? <input type="hidden" name="onboarding" value="1" /> : null}

        <div className="flex items-center gap-3">
          <Avatar
            user={{
              id: userId,
              communityId: collaborationId,
              name: name || "·",
              initials: initialsFor(name) || "·",
            }}
            size="lg"
          />
          <p className="min-w-0 text-[13px] leading-relaxed text-ink-3">
            {t("collab.profile.displayNameHelp")}
          </p>
        </div>

        <div>
          <label htmlFor="collab-display-name" className="mb-1.5 block text-sm font-medium text-ink">
            {t("collab.profile.displayName")}
          </label>
          <input
            id="collab-display-name"
            name="displayName"
            required
            maxLength={DISPLAY_NAME_MAX}
            defaultValue={initialName}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            className={`${fieldClass} h-10`}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor="collab-bio" className="text-sm font-medium text-ink">
              {t("collab.profile.bio")}{" "}
              <span className="font-normal text-ink-3">({t("collab.new.optional")})</span>
            </label>
            <span className="text-[11px] tabular-nums text-ink-3">
              {bioLength}/{BIO_MAX}
            </span>
          </div>
          <textarea
            id="collab-bio"
            name="bio"
            rows={4}
            maxLength={BIO_MAX}
            defaultValue={initialBio}
            onChange={(event) => setBioLength(Array.from(event.target.value).length)}
            placeholder={t("collab.profile.bioPlaceholder")}
            className={`${fieldClass} resize-y py-2 leading-relaxed`}
          />
        </div>

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

        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" disabled={pending}>
            {pending ? "…" : onboarding ? t("collab.profile.saveFirst") : t("common.save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
