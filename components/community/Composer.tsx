"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Avatar, Panel, cn } from "@/components/ui/primitives";
import { IconMegaphone } from "@/components/ui/icons";
import { createPostAction } from "@/app/actions";
import { emptyPostFormState } from "@/lib/post-form";
import type { Community, User } from "@/lib/types";

function PublishButton({ accent, disabled }: { accent: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-30"
      style={{ backgroundColor: accent }}
    >
      {pending ? "Publiserer …" : "Publiser"}
    </button>
  );
}

/**
 * Feed composer.
 *
 * The draft is only cleared once the server action reports that the row was
 * written. If the database refuses — a member trying to publish an
 * announcement, say — the text stays exactly where it was, with the reason
 * shown, so nothing anyone typed is lost to a failed write.
 */
export function Composer({
  user,
  community,
  canAnnounce,
}: {
  user: User;
  community: Community;
  canAnnounce: boolean;
}) {
  const [state, formAction] = useActionState(createPostAction, emptyPostFormState);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState(false);

  // Only a confirmed write clears the composer. Comparing against the last
  // state we acted on lets this happen during render, without an effect that
  // would cause a second pass.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") {
      setDraft("");
      setAnnouncement(false);
      setOpen(false);
    }
  }

  return (
    <Panel className="p-4">
      <form action={formAction}>
        <input type="hidden" name="communityId" value={community.id} />
        <div className="flex items-start gap-3">
          <Avatar user={user} size="sm" />
          <div className="min-w-0 flex-1">
            <textarea
              name="body"
              rows={open ? 4 : 1}
              value={draft}
              onFocus={() => setOpen(true)}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Del noe med ${community.name}`}
              className="w-full resize-none bg-transparent py-1.5 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
            />

            {state.status === "error" ? (
              <p
                role="alert"
                className="mt-2 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] text-rust"
              >
                {state.message}
              </p>
            ) : null}

            {open ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                {canAnnounce ? (
                  <label
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-[5px] border px-2.5 py-1.5 text-[13px] transition-colors",
                      announcement
                        ? "border-rust/30 bg-rust-soft text-rust"
                        : "border-line text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="announcement"
                      checked={announcement}
                      onChange={(event) => setAnnouncement(event.target.checked)}
                      className="sr-only"
                    />
                    <IconMegaphone size={14} />
                    Publiser som kunngjøring
                  </label>
                ) : (
                  <span className="text-[13px] text-ink-3">Synlig for alle medlemmer</span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setDraft("");
                      setAnnouncement(false);
                    }}
                    className="h-9 rounded-[5px] px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
                  >
                    Avbryt
                  </button>
                  <PublishButton accent={community.branding.accent} disabled={!draft.trim()} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </Panel>
  );
}
