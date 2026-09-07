"use client";

import { useState } from "react";
import { Avatar, Panel, cn } from "@/components/ui/primitives";
import { IconMegaphone } from "@/components/ui/icons";
import type { Community, User } from "@/lib/types";

/**
 * Feed composer. It does not persist anything yet — the collapsed/expanded
 * states exist so the posting flow reads correctly in the prototype.
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState(false);
  const [posted, setPosted] = useState(false);

  if (posted) {
    return (
      <Panel className="flex items-center justify-between gap-4 p-4">
        <p className="text-sm text-ink-2">
          Innlegget er lagt til lokalt. I prototypen lagres det ikke videre.
        </p>
        <button
          type="button"
          onClick={() => setPosted(false)}
          className="text-sm font-medium text-ink transition-opacity hover:opacity-70"
        >
          Skriv et til
        </button>
      </Panel>
    );
  }

  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <Avatar user={user} size="sm" />
        <div className="min-w-0 flex-1">
          <textarea
            rows={open ? 4 : 1}
            value={draft}
            onFocus={() => setOpen(true)}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Del noe med ${community.name}`}
            className="w-full resize-none bg-transparent py-1.5 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
          />

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
                <button
                  type="button"
                  disabled={!draft.trim()}
                  onClick={() => {
                    setPosted(true);
                    setOpen(false);
                    setDraft("");
                    setAnnouncement(false);
                  }}
                  className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-30"
                  style={{ backgroundColor: community.branding.accent }}
                >
                  Publiser
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
