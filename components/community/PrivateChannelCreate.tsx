"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPrivateChannelAction } from "@/app/actions";
import { PrivateChannelParticipantSearch } from "@/components/community/PrivateChannelParticipantSearch";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose, IconLock } from "@/components/ui/icons";
import { CHANNEL_NAME_MAX, CHANNEL_PURPOSE_MAX } from "@/lib/channel-edit-form";
import { useT } from "@/lib/i18n/react";
import {
  PRIVATE_CHANNEL_PARTICIPANTS_MAX,
  emptyPrivateChannelCreateFormState,
  type PrivateChannelCandidate,
} from "@/lib/private-channel-form";

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
      {pending ? t("privateChannel.create.creating") : t("privateChannel.create.submit")}
    </button>
  );
}

/**
 * The form behind the sidebar's "+ Ny privat kanal" link (the main chat has no button of its own).
 *
 * Rendered only for someone the page found may create a channel under this
 * lokallag — a community admin, or its lokallagsleder — and decided again by
 * `create_private_channel()`. The form carries the lokallag, a name, an
 * optional description and the ids of the chosen participants; on success the
 * action opens the new conversation. Everything typed is kept in state, so a
 * refused save loses nothing.
 */
export function PrivateChannelCreate({
  communityId,
  communityName,
  localGroup,
  accent,
  openRequested,
}: {
  communityId: string;
  communityName: string;
  localGroup: { id: string; name: string };
  accent: string;
  /** The sidebar's "+ Ny privat kanal" link arrives with the form already asked for. */
  openRequested: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [state, formAction] = useActionState(createPrivateChannelAction, emptyPrivateChannelCreateFormState);
  const [open, setOpen] = useState(openRequested);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [participants, setParticipants] = useState<PrivateChannelCandidate[]>([]);

  // Asked for from outside (the sidebar link) while already on this page:
  // adjusted during render, like the event editor's `openRequest`.
  const [seenRequest, setSeenRequest] = useState(openRequested);
  if (openRequested !== seenRequest) {
    setSeenRequest(openRequested);
    if (openRequested) setOpen(true);
  }

  function close() {
    setOpen(false);
    // Drop the sidebar link's marker so a reload does not reopen the form.
    if (openRequested) router.replace(pathname, { scroll: false });
  }

  return (
    <>
      <ConfirmDialog open={open} onClose={close} labelledBy="private-channel-create-title">
        <h3
          id="private-channel-create-title"
          className="flex items-center gap-2 font-display text-lg leading-snug text-ink"
        >
          <IconLock size={16} className="shrink-0 text-ink-3" />
          {t("privateChannel.create.title", { name: localGroup.name })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t("privateChannel.create.lead", { community: communityName })}
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="communityId" value={communityId} />
          <input type="hidden" name="localGroupId" value={localGroup.id} />
          {participants.map((person) => (
            <input key={person.userId} type="hidden" name="participantIds" value={person.userId} />
          ))}

          <div>
            <label htmlFor="private-channel-name" className="label mb-1 block">
              {t("privateChannel.create.name")}
            </label>
            <input
              id="private-channel-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={CHANNEL_NAME_MAX}
              required
              autoComplete="off"
              placeholder={t("privateChannel.create.namePlaceholder")}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="private-channel-purpose" className="label mb-1 block">
              {t("privateChannel.create.purpose")}{" "}
              <span className="font-normal normal-case tracking-normal text-ink-3">
                ({t("privateChannel.create.optional")})
              </span>
            </label>
            <input
              id="private-channel-purpose"
              name="purpose"
              type="text"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              maxLength={CHANNEL_PURPOSE_MAX}
              autoComplete="off"
              placeholder={t("privateChannel.create.purposePlaceholder")}
              className={fieldClass}
            />
          </div>

          <div>
            <p className="label mb-1">{t("privateChannel.create.participants")}</p>
            <p className="mb-2 text-[12px] leading-relaxed text-ink-3">
              {t("privateChannel.create.participantsHint", { name: localGroup.name })}
            </p>

            {participants.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("privateChannel.selected.label")}>
                {participants.map((person) => (
                  <li
                    key={person.userId}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-paper py-0.5 pl-2.5 pr-1 text-[13px] text-ink"
                  >
                    <span className="max-w-[12rem] truncate">{person.displayName}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setParticipants((current) => current.filter((p) => p.userId !== person.userId))
                      }
                      aria-label={t("privateChannel.selected.removeNamed", { name: person.displayName })}
                      className="rounded-full p-0.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                    >
                      <IconClose size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-[13px] text-ink-3">{t("privateChannel.selected.none")}</p>
            )}

            <PrivateChannelParticipantSearch
              inputId="private-channel-search"
              localGroupId={localGroup.id}
              localGroupName={localGroup.name}
              excludeIds={participants.map((person) => person.userId)}
              renderAction={(candidate) => (
                <button
                  type="button"
                  disabled={participants.length >= PRIVATE_CHANNEL_PARTICIPANTS_MAX}
                  onClick={() => setParticipants((current) => [...current, candidate])}
                  aria-label={t("privateChannel.search.addNamed", { name: candidate.displayName })}
                  className="h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-40"
                >
                  {t("privateChannel.search.add")}
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
              onClick={close}
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
