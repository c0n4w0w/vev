"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateCommunityAboutAction } from "@/app/actions";
import { IconPencil } from "@/components/ui/icons";
import { Panel, RichText, SectionHeading, cn } from "@/components/ui/primitives";
import { emptyCommunityAboutFormState } from "@/lib/community-about-form";
import { useT } from "@/lib/i18n/react";

function SaveButton({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? t("common.saving") : t("common.save")}
    </button>
  );
}

/**
 * The "Om fellesskapet" panel on the overview page.
 *
 * Read mode is the same heading and card every member has always seen. The
 * pencil — and the inline editor it opens — render only for whoever this page
 * decided `canEdit` for. That decision is presentation only: the actual write
 * goes through `updateCommunityAboutAction`, which asks the database fresh
 * whether the caller is an active admin of this exact community, so a request
 * aimed at the action directly gets refused the same way.
 */
export function CommunityAboutSection({
  communityId,
  about,
  canEdit,
  accent,
}: {
  communityId: string;
  about: string;
  canEdit: boolean;
  accent: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(about);
  // A controlled draft, separate from `value`. A Server Action round trip can
  // cause this subtree to re-render even without a redirect or revalidation,
  // and an uncontrolled `defaultValue` textarea does not survive that: it
  // snaps back to whatever the prop said at mount. Keeping the typed text in
  // state instead of the DOM means a failed save can never lose it.
  const [draft, setDraft] = useState(about);
  const [state, formAction] = useActionState(updateCommunityAboutAction, emptyCommunityAboutFormState);

  // Close the editor and adopt the stored value only once the save is
  // confirmed, adjusted during render rather than in an effect — the same
  // shape as PostActions.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") {
      setValue(state.about);
      setDraft(state.about);
      setEditing(false);
    }
  }

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <section>
        <SectionHeading
          action={
            canEdit ? (
              <button
                type="button"
                onClick={startEditing}
                aria-label={t("overview.editAbout")}
                title={t("overview.editAbout")}
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px]",
                  "text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink",
                )}
              >
                <IconPencil size={15} />
              </button>
            ) : undefined
          }
        >
          {t("overview.about")}
        </SectionHeading>
        <Panel className="p-5 sm:p-6">
          <RichText body={value} />
        </Panel>
      </section>
    );
  }

  return (
    <section>
      <SectionHeading>{t("overview.about")}</SectionHeading>
      <Panel className="p-5 sm:p-6">
        <form action={formAction}>
          <input type="hidden" name="communityId" value={communityId} />
          <label htmlFor="community-about" className="sr-only">
            {t("overview.aboutLabel")}
          </label>
          <textarea
            id="community-about"
            name="about"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelEditing();
            }}
            className="w-full resize-y rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-[0.9375rem] leading-[1.7] text-ink outline-none focus:border-ink-3"
          />
          {state.status === "error" ? (
            <p role="alert" className="mt-2 text-[13px] text-rust">
              {state.message}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelEditing}
              className="h-9 rounded-[5px] px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              {t("common.cancel")}
            </button>
            <SaveButton accent={accent} />
          </div>
        </form>
      </Panel>
    </section>
  );
}
