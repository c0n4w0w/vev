"use client";

import { useEffect, useState, useTransition } from "react";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconCheck, IconChevronDown, IconLock, IconPoll, IconShield, IconUsers } from "@/components/ui/icons";
import { closePollAction, pollVotersAction, votePollAction, withdrawVoteAction } from "@/app/poll-actions";
import { initialsFor } from "@/lib/format";
import { pollPercent } from "@/lib/poll-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { tn } from "@/lib/i18n";
import type { ChannelPoll, PollVoters } from "@/lib/types";

/**
 * A poll in the conversation: the question, its options and how it stands.
 *
 * Choosing an option votes, choosing another moves the vote, and choosing
 * one's own option again takes the vote back — which, while the poll is
 * open, hides the results again until one votes. Counts and
 * percentages appear once the viewer has voted or the poll is closed — for
 * everyone alike, creator and moderators included — exactly as the database
 * gives them.
 *
 * The poll's mode is on the card from the start. An anonymous poll never
 * tells anyone who voted for what. A visible one says before the viewer
 * votes that voting shows their name and choice to the other voters; once
 * results show, each option lists who chose it (channel_poll_voters():
 * community names and photos of voters still in the channel). Every flag on `poll` was answered by
 * the database for this viewer, and every vote, close and list is decided
 * there again.
 */
export function PollCard({
  poll,
  scope,
  accent,
  archived,
  onChange,
}: {
  poll: ChannelPoll;
  scope: { communityId: string; channelId: string };
  accent: string;
  /** The channel is archived: the poll is read-only whatever its state. */
  archived?: boolean;
  onChange: (poll: ChannelPoll) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState<string | undefined>(undefined);
  const [voting, startVote] = useTransition();
  const [closing, startClose] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);
  // The option just chosen, shown as chosen while the vote is on its way;
  // null while a withdrawal is.
  const [choosing, setChoosing] = useState<string | null | undefined>(undefined);

  const closed = Boolean(poll.closedAt);
  const canVote = poll.canVote && !closed && !archived;
  const mine = choosing === undefined ? poll.myOptionId : (choosing ?? undefined);
  const titleId = `poll-${poll.messageId}-question`;
  const visible = poll.visibility === "visible";
  const hint = !canVote
    ? undefined
    : poll.myOptionId
      ? "poll.changeHint"
      : poll.resultsVisible
        ? undefined
        : "poll.resultsAfterVote";

  function vote(optionId: string) {
    if (!canVote || voting) return;
    // One's own option again: take the vote back.
    const withdrawing = optionId === poll.myOptionId;
    setError(undefined);
    setChoosing(withdrawing ? null : optionId);
    startVote(async () => {
      const result = withdrawing
        ? await withdrawVoteAction(scope, poll.messageId)
        : await votePollAction(scope, poll.messageId, optionId);
      setChoosing(undefined);
      if (result.ok) onChange(result.value);
      else setError(result.error);
    });
  }

  function close() {
    setError(undefined);
    startClose(async () => {
      const result = await closePollAction(scope, poll.messageId);
      if (result.ok) {
        onChange(result.value);
        setConfirmClose(false);
      } else {
        setError(result.error);
        setConfirmClose(false);
      }
    });
  }

  return (
    <section
      aria-labelledby={titleId}
      className="mt-1 max-w-xl rounded-[6px] border border-line bg-surface px-3.5 py-3 sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
          <IconPoll size={14} />
          {t("poll.badge")}
        </span>
        {closed ? (
          <Badge tone="outline">
            <IconLock size={11} />
            {t("poll.closed")}
          </Badge>
        ) : (
          <Badge tone="neutral">{t("poll.open")}</Badge>
        )}
        <Badge tone="outline">
          {visible ? <IconUsers size={11} /> : <IconShield size={11} />}
          {t(visible ? "poll.mode.visible" : "poll.mode.anonymous")}
        </Badge>
      </div>

      <h3 id={titleId} className="mt-1.5 break-words text-[0.9375rem] font-medium leading-snug text-ink">
        {poll.question}
      </h3>

      {visible && canVote && !poll.myOptionId ? (
        <p className="mt-2 rounded-[5px] border border-line bg-paper px-2.5 py-2 text-[12px] leading-snug text-ink-2">
          {t("poll.visibleNotice")}
        </p>
      ) : null}

      <ul className="mt-3 space-y-1.5">
        {poll.options.map((option) => {
          const chosen = mine === option.id;
          const count = option.count ?? 0;
          const percent = pollPercent(count, poll.total);
          const showResult = poll.resultsVisible && option.count !== undefined;
          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => vote(option.id)}
                disabled={!canVote || voting}
                aria-pressed={chosen}
                aria-label={
                  [
                    showResult
                      ? t("poll.optionResult", { option: option.label, count, total: poll.total, percent })
                      : t("poll.voteFor", { option: option.label }),
                    chosen ? t("poll.yourVote") : undefined,
                    chosen && canVote ? t("poll.withdrawAction") : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }
                title={chosen && canVote ? t("poll.withdrawAction") : undefined}
                className={cn(
                  "relative flex min-h-10 w-full items-center gap-2.5 overflow-hidden rounded-[5px] border px-3 py-2 text-left text-[13px] transition-colors",
                  chosen ? "border-ink-3" : "border-line-2",
                  canVote && !voting ? "hover:border-ink-3" : "cursor-default",
                  "disabled:opacity-100",
                )}
              >
                {showResult ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 transition-[width] duration-500"
                    style={{ width: `${percent}%`, backgroundColor: accent, opacity: chosen ? 0.16 : 0.09 }}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    chosen ? "border-transparent text-white" : "border-line-2",
                  )}
                  style={chosen ? { backgroundColor: accent } : undefined}
                >
                  {chosen ? <IconCheck size={11} strokeWidth={2.4} /> : null}
                </span>
                <span className="relative min-w-0 flex-1 break-words text-ink">
                  {option.label}
                  {chosen ? <span className="ml-2 text-[11px] text-ink-3">{t("poll.yourVote")}</span> : null}
                </span>
                {showResult ? (
                  <span className="relative shrink-0 tabular-nums text-[12px] text-ink-2">
                    <span className="font-medium text-ink">{percent} %</span>
                    <span className="ml-1.5 text-ink-3">{count}</span>
                  </span>
                ) : null}
              </button>
              {visible && showResult && count > 0 ? (
                <VoterList
                  communityId={scope.communityId}
                  messageId={poll.messageId}
                  optionId={option.id}
                  count={count}
                  label={option.label}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-[11px] text-ink-3">
          {tn(locale, "poll.votes", poll.total)}
          {hint ? ` · ${t(hint)}` : null}
        </p>
        {poll.canClose && !closed ? (
          <button
            type="button"
            onClick={() => setConfirmClose(true)}
            className="h-7 rounded-[5px] border border-line-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            {t("poll.close")}
          </button>
        ) : null}
      </div>
      {closed || archived ? (
        <p className="mt-1.5 text-[11px] text-ink-3">{t(closed ? "poll.closedNote" : "poll.archivedNote")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-rust">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmClose}
        onClose={closing ? () => undefined : () => setConfirmClose(false)}
        labelledBy={`${titleId}-close`}
      >
        <h3 id={`${titleId}-close`} className="font-display text-lg text-ink">
          {t("poll.closeTitle")}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{t("poll.closeBody")}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmClose(false)}
            disabled={closing}
            className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2 disabled:opacity-40"
          >
            {t("poll.create.cancel")}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={closing}
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {closing ? t("poll.closing") : t("poll.closeConfirm")}
          </button>
        </div>
      </ConfirmDialog>
    </section>
  );
}

/**
 * "Who chose this" under one option of a visible poll. Asked for when opened,
 * and again when the option's count changes while it is open.
 */
function VoterList({
  communityId,
  messageId,
  optionId,
  count,
  label,
}: {
  communityId: string;
  messageId: string;
  optionId: string;
  count: number;
  label: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [voters, setVoters] = useState<PollVoters | null | undefined>(undefined);
  const listId = `voters-${optionId}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    pollVotersAction(communityId, messageId, optionId).then((result) => {
      if (!cancelled) setVoters(result ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, communityId, messageId, optionId, count]);

  return (
    <div className="pl-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("poll.voters.showFor", { option: label })}
        className="mt-0.5 inline-flex h-7 items-center gap-1 rounded-[5px] px-1.5 text-[12px] text-ink-3 hover:bg-paper-2 hover:text-ink"
      >
        <IconChevronDown size={13} className={cn("transition-transform", open ? "rotate-180" : "")} />
        {t("poll.voters.show")}
      </button>
      {open ? (
        <div id={listId} className="pb-1 pl-1.5 text-[12px] leading-relaxed text-ink-2">
          {voters === undefined ? (
            <p className="text-ink-3">{t("poll.voters.loading")}</p>
          ) : voters === null ? (
            <p className="text-ink-3">{t("poll.voters.unavailable")}</p>
          ) : (
            <>
              {voters.people.length > 0 ? (
                <ul className="flex flex-wrap gap-x-3 gap-y-1.5 py-0.5">
                  {voters.people.map((person) => (
                    <li
                      key={person.ref}
                      className={cn("inline-flex items-center gap-1.5", person.me ? "font-medium text-ink" : undefined)}
                    >
                      <Avatar
                        user={{ id: person.ref, name: person.name, initials: initialsFor(person.name), avatarUrl: person.avatarUrl, communityId }}
                        size="xs"
                      />
                      {person.me ? t("poll.voters.you", { name: person.name }) : person.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              {voters.unnamed > 0 ? (
                <p className="text-ink-3">
                  {voters.people.length > 0
                    ? t("poll.voters.andOthers", { count: voters.unnamed })
                    : t("poll.voters.onlyOthers", { count: voters.unnamed })}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
