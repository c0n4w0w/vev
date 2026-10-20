"use client";

import { useId, useRef, useState, useTransition, type RefObject } from "react";
import { setDisappearingMessagesAction } from "@/app/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconCheck, IconTimer } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { showToast } from "@/components/ui/Toast";
import { BACKUP_RETENTION_DAYS } from "@/lib/backup-retention";
import { DISAPPEAR_LABEL, DISAPPEAR_OPTIONS, type DisappearSeconds } from "@/lib/disappearing";
import { tn, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { DirectConversationNotice, DirectMessage } from "@/lib/types";

/**
 * «Forsvinnende meldinger» in a direct conversation: the timer under the
 * other person's name, the dialog that changes it, the notice left in the
 * conversation when someone does, and the small mark on a disappearing
 * message.
 *
 * Presentation only. The database captures each message's duration, stamps
 * the recipient's first read with its own clock and refuses an expired
 * message everywhere (20261107100000). Times shown here count down from the
 * server's clock as the page last saw it, never from the browser's own.
 */

/** The timer under the other person's name; informational, the menu changes it. */
export function DisappearingStatus({ seconds }: { seconds: DisappearSeconds }) {
  const t = useT();
  const label = t(DISAPPEAR_LABEL[seconds]);
  return (
    <span
      title={t("dm.disappearing.statusLabel", { duration: label })}
      className="inline-flex max-w-full items-center gap-1"
    >
      <IconTimer size={13} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("dm.disappearing.statusLabel", { duration: label })}</span>
      <span className="truncate" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

/**
 * Off, 1 hour … 4 weeks. Choosing is a radio group (arrow keys move, nothing
 * is sent until «Lagre»); the change applies to both participants and to
 * messages sent from then on.
 */
export function DisappearingDialog(props: DisappearingDialogProps) {
  const titleId = useId();
  const busy = useRef(false);
  return (
    <ConfirmDialog
      open={props.open}
      labelledBy={titleId}
      onClose={() => {
        if (!busy.current) props.onClose();
      }}
    >
      {/* Mounted per opening, so each starts from what is in force now. */}
      {props.open ? <DisappearingChoice {...props} titleId={titleId} busyRef={busy} /> : null}
    </ConfirmDialog>
  );
}

type DisappearingDialogProps = {
  open: boolean;
  onClose: () => void;
  communityId: string;
  conversationId: string;
  current?: DisappearSeconds;
  /** The community's own colour, for the confirming button. */
  accent: string;
  onChanged: (seconds?: DisappearSeconds) => void;
};

function DisappearingChoice({
  onClose,
  communityId,
  conversationId,
  current,
  accent,
  onChanged,
  titleId,
  busyRef,
}: DisappearingDialogProps & { titleId: string; busyRef: RefObject<boolean> }) {
  const t = useT();
  const name = useId();
  const [choice, setChoice] = useState<DisappearSeconds | 0>(current ?? 0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  function save() {
    if (pending) return;
    if (choice === (current ?? 0)) {
      onClose();
      return;
    }
    busyRef.current = true;
    startTransition(async () => {
      const result = await setDisappearingMessagesAction(communityId, conversationId, choice || null);
      busyRef.current = false;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged(result.disappearSeconds);
      showToast(
        result.disappearSeconds
          ? t("dm.disappearing.done.on", { duration: t(DISAPPEAR_LABEL[result.disappearSeconds]) })
          : t("dm.disappearing.done.off"),
      );
      onClose();
    });
  }

  const options: { value: DisappearSeconds | 0; label: string }[] = [
    { value: 0, label: t("dm.disappearing.off") },
    ...DISAPPEAR_OPTIONS.map((value) => ({ value, label: t(DISAPPEAR_LABEL[value]) })),
  ];

  return (
    <>
      <h3 id={titleId} className="flex items-center gap-2 font-display text-lg text-ink">
        <IconTimer size={18} className="text-ink-3" />
        {t("dm.disappearing.title")}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{t("dm.disappearing.lead")}</p>

      <fieldset className="mt-4">
        <legend className="sr-only">{t("dm.disappearing.choices")}</legend>
        <div className="overflow-hidden rounded-[6px] border border-line">
          {options.map((option) => {
            const selected = choice === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-3 text-sm last:border-b-0 has-[:focus-visible]:bg-paper-2",
                  selected ? "bg-paper-2/70 font-medium text-ink" : "text-ink-2 hover:bg-paper-2/50",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={selected}
                  onChange={() => setChoice(option.value)}
                  className="sr-only"
                />
                <span className="flex-1">{option.label}</span>
                <IconCheck size={16} className={cn("shrink-0 text-skog", !selected && "invisible")} />
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t("dm.disappearing.scope")}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
        {t("dm.disappearing.retention", { days: BACKUP_RETENTION_DAYS })}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-rust">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2 disabled:opacity-40"
        >
          {t("dm.disappearing.cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          {pending ? t("dm.disappearing.saving") : t("dm.disappearing.save")}
        </button>
      </div>
    </>
  );
}

/** «Robin slo på forsvinnende meldinger: 1 dag.» — between the messages. */
export function DisappearingNoticeLine({
  notice,
  previous,
  actorName,
  mine,
}: {
  notice: DirectConversationNotice;
  /** The setting before this change, as far as the viewer can see. */
  previous?: DisappearSeconds;
  actorName: string;
  mine: boolean;
}) {
  const t = useT();
  const duration = notice.disappearSeconds ? t(DISAPPEAR_LABEL[notice.disappearSeconds]) : "";
  const text = !notice.disappearSeconds
    ? t(mine ? "dm.disappearing.notice.youOff" : "dm.disappearing.notice.off", { name: actorName })
    : previous
      ? t(mine ? "dm.disappearing.notice.youChanged" : "dm.disappearing.notice.changed", { name: actorName, duration })
      : t(mine ? "dm.disappearing.notice.youOn" : "dm.disappearing.notice.on", { name: actorName, duration });
  return (
    <p className="mx-auto my-4 flex max-w-md items-start justify-center gap-1.5 text-center text-[12px] leading-relaxed text-ink-3">
      <IconTimer size={13} className="mt-[3px] shrink-0" />
      <span>{text}</span>
    </p>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** «om 3 timer» — from a remaining time in milliseconds. */
function remaining(ms: number, locale: Locale): string {
  if (ms < HOUR) return tn(locale, "time.inMinutes", Math.max(1, Math.ceil(ms / MINUTE)));
  if (ms < DAY - HOUR / 2) return tn(locale, "time.inHours", Math.round(ms / HOUR));
  const days = Math.max(1, Math.round(ms / DAY));
  if (days < 14) return tn(locale, "time.inDays", days);
  return tn(locale, "time.inWeeks", Math.round(days / 7));
}

/**
 * When a disappearing message disappears, as the page knows it: its own
 * expiry once the recipient has read it. A message from the other person
 * that this page is showing for the first time has just been read by the
 * viewer — its timer started when the page loaded.
 */
export function expiryOf(message: DirectMessage, viewerId: string, loadedAt: number): number | undefined {
  if (!message.disappearSeconds) return undefined;
  if (message.readAt && message.expiresAt) return Date.parse(message.expiresAt);
  if (message.authorId !== viewerId && !message.id.startsWith("pending-")) {
    const created = Date.parse(message.createdAt);
    return Math.min(loadedAt + message.disappearSeconds * 1000, Math.max(loadedAt, created) + 30 * DAY);
  }
  return message.expiresAt ? Date.parse(message.expiresAt) : undefined;
}

/** The small timer beside a disappearing message's time. */
export function MessageTimer({
  message,
  viewerId,
  otherName,
  loadedAt,
  serverNow,
  className,
}: {
  message: DirectMessage;
  viewerId: string;
  otherName: string;
  /** Server time when the page loaded, in ms. */
  loadedAt: number;
  /** Server time now, in ms. */
  serverNow: number;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  if (!message.disappearSeconds) return null;
  const duration = t(DISAPPEAR_LABEL[message.disappearSeconds]);
  const mine = message.authorId === viewerId;
  const expiry = expiryOf(message, viewerId, loadedAt);
  const label =
    mine && !message.readAt
      ? t("dm.disappearing.message.unread", { duration, name: otherName })
      : t("dm.disappearing.message.running", { when: remaining(Math.max(0, (expiry ?? serverNow) - serverNow), locale) });
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex shrink-0 text-ink-3", className)}>
      <IconTimer size={12} />
    </span>
  );
}
