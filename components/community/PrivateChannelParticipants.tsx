"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconUsers } from "@/components/ui/icons";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { Channel, PrivateChannelParticipant } from "@/lib/types";

/**
 * One participant: their photo in this community where the viewer may see it
 * (the monogram otherwise), their display name here, and whether they run the
 * channel. Shared by the read-only list below and the managers' list in
 * `PrivateChannelAdmin`, so a person looks the same in both.
 */
export function PrivateChannelParticipantIdentity({
  communityId,
  person,
}: {
  communityId: string;
  person: PrivateChannelParticipant;
}) {
  const t = useT();
  return (
    <>
      <Avatar
        user={{
          id: person.userId,
          name: person.displayName,
          initials: person.initials,
          avatarUrl: person.avatarUrl,
          communityId,
        }}
        size="sm"
      />
      {/* Wide enough that a manager's buttons wrap under a name rather than squeeze it. */}
      <span className="min-w-[8rem] flex-1 truncate text-sm text-ink">{person.displayName}</span>
      {person.isManager ? <Badge tone="neutral">{t("privateChannel.participants.manager")}</Badge> : null}
    </>
  );
}

/**
 * "Deltakere" in a private channel's header, for a participant who does not
 * manage it: who else is reading here, and nothing to change.
 *
 * The list is what `private_channel_roster()` returned to this viewer, which
 * it does only for someone who can read the channel. There are no buttons
 * because there is nothing a participant may do to the list; the people who
 * can — a kanalansvarlig, an administrator — get `PrivateChannelAdmin`
 * instead, and the database refuses everyone else whatever is drawn.
 */
export function PrivateChannelParticipants({
  communityId,
  communityName,
  channel,
  roster,
}: {
  communityId: string;
  communityName: string;
  channel: Channel;
  roster: PrivateChannelParticipant[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
          "transition-colors hover:border-ink-3 hover:text-ink",
        )}
      >
        <IconUsers size={14} />
        {t("privateChannel.manage.participants")}
        <span className="tabular-nums text-ink-3">{roster.length}</span>
      </button>

      <ConfirmDialog open={open} onClose={close} labelledBy="private-channel-people-title">
        <h3 id="private-channel-people-title" className="font-display text-lg leading-snug text-ink">
          {t("privateChannel.participants.title", { name: channel.name })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t("privateChannel.participants.lead", { community: communityName })}
        </p>

        {roster.length === 0 ? (
          <p className="mt-4 text-[13px] text-ink-3">{t("privateChannel.participants.empty")}</p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {roster.map((person) => (
              <li
                key={person.userId}
                className="flex items-center gap-2.5 rounded-[5px] border border-line px-3 py-2"
              >
                <PrivateChannelParticipantIdentity communityId={communityId} person={person} />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
          {t("privateChannel.participants.readOnlyNote")}
        </p>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={close} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("common.close")}
          </button>
        </div>
      </ConfirmDialog>
    </>
  );
}
