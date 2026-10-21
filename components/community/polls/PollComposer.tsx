"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose, IconPlus, IconPoll } from "@/components/ui/icons";
import { createPollAction } from "@/app/poll-actions";
import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  shapePoll,
  type PollVisibilityChoice,
} from "@/lib/poll-form";
import { useT } from "@/lib/i18n/react";
import type { Message } from "@/lib/types";

/**
 * The composer's "+" menu and what it opens. Today it holds "Avstemning",
 * offered to whoever the database says may create a poll in this channel;
 * create_channel_poll() decides again when the poll is sent.
 */
export function ComposerActions({
  scope,
  audienceName,
  accent,
  canCreatePoll,
  onPollCreated,
  className,
}: {
  scope: { communityId: string; channelId: string };
  /** Who is being asked, as the channel's audience sentence names them. */
  audienceName: string;
  accent: string;
  canCreatePoll: boolean;
  onPollCreated: (message: Message) => void;
  className?: string;
}) {
  const t = useT();
  const [pollOpen, setPollOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!canCreatePoll) return null;

  return (
    <div className={className}>
      <ActionMenu
        label={t("composer.moreActions")}
        ariaLabel={t("composer.moreActions")}
        align="right"
        triggerRef={triggerRef}
        containerClassName="relative [&>[role=menu]]:bottom-full [&>[role=menu]]:top-auto [&>[role=menu]]:mb-1"
        triggerClassName="flex h-9 w-9 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink aria-expanded:bg-paper-2 aria-expanded:text-ink"
        trigger={() => <IconPlus size={18} />}
        items={[
          { key: "poll", label: t("poll.menu"), icon: <IconPoll size={15} />, onSelect: () => setPollOpen(true) },
        ]}
      />
      {pollOpen ? (
        <PollDialog
          scope={scope}
          audienceName={audienceName}
          accent={accent}
          onClose={() => {
            setPollOpen(false);
            triggerRef.current?.focus();
          }}
          onCreated={(message) => {
            setPollOpen(false);
            onPollCreated(message);
          }}
        />
      ) : null}
    </div>
  );
}

function PollDialog({
  scope,
  audienceName,
  accent,
  onClose,
  onCreated,
}: {
  scope: { communityId: string; channelId: string };
  audienceName: string;
  accent: string;
  onClose: () => void;
  onCreated: (message: Message) => void;
}) {
  const t = useT();
  const id = useId();
  const [question, setQuestion] = useState("");
  // Anonymous unless the creator chooses otherwise. Fixed once posted.
  const [visibility, setVisibility] = useState<PollVisibilityChoice>("anonymous");
  const [options, setOptions] = useState<{ key: number; value: string }[]>([
    { key: 0, value: "" },
    { key: 1, value: "" },
  ]);
  const nextKey = useRef(2);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const questionRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<number, HTMLInputElement>());
  // The dialog focuses its first control (the close button) when it opens;
  // the question is where writing starts.
  useEffect(() => questionRef.current?.focus(), []);
  // A row just added takes the focus as soon as it is on screen.
  const focusKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusKey.current === undefined) return;
    optionRefs.current.get(focusKey.current)?.focus();
    focusKey.current = undefined;
  }, [options.length]);

  function addOption() {
    if (options.length >= POLL_OPTIONS_MAX) return;
    const key = nextKey.current++;
    focusKey.current = key;
    setOptions((current) => [...current, { key, value: "" }]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const input = { question, options: options.map((option) => option.value), visibility };
    const shaped = shapePoll(input);
    if (!shaped.ok) {
      setError(t(shaped.error));
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await createPollAction(scope, shaped.poll);
      if (result.ok) onCreated(result.value);
      else setError(result.error);
    });
  }

  return (
    <ConfirmDialog open onClose={pending ? () => undefined : onClose} labelledBy={`${id}-title`} trapFocus className="max-w-lg">
      <form onSubmit={submit} noValidate>
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-lg text-ink">
            <IconPoll size={18} className="text-ink-3" />
            {t("poll.create.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={t("poll.create.cancel")}
            className="-mr-1.5 -mt-1 rounded-[5px] p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <IconClose size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{t("poll.create.intro", { name: audienceName })}</p>

        <label htmlFor={`${id}-question`} className="mt-4 block text-[13px] font-medium text-ink">
          {t("poll.create.question")}
        </label>
        <input
          id={`${id}-question`}
          ref={questionRef}
          value={question}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            optionRefs.current.get(options[0].key)?.focus();
          }}
          maxLength={POLL_QUESTION_MAX}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("poll.create.questionPlaceholder")}
          className="mt-1.5 h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-[0.9375rem] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />

        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-ink">
            {t("poll.create.options")} <span className="font-normal text-ink-3">· {t("poll.create.limits")}</span>
          </legend>
          <ol className="mt-1.5 space-y-1.5">
            {options.map((option, index) => (
              <li key={option.key} className="flex items-center gap-1.5">
                <input
                  ref={(element) => {
                    if (element) optionRefs.current.set(option.key, element);
                    else optionRefs.current.delete(option.key);
                  }}
                  value={option.value}
                  maxLength={POLL_OPTION_MAX}
                  aria-label={t("poll.create.optionLabel", { n: index + 1 })}
                  placeholder={t("poll.create.optionPlaceholder", { n: index + 1 })}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOptions((current) => current.map((item) => (item.key === option.key ? { ...item, value } : item)));
                  }}
                  onKeyDown={(event) => {
                    // Enter moves to the next row, and in the last filled row
                    // adds one. Only the button publishes.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    const next = options[index + 1];
                    if (next) optionRefs.current.get(next.key)?.focus();
                    else if (option.value.trim()) addOption();
                  }}
                  className="h-10 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-3 text-[0.9375rem] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
                />
                {options.length > POLL_OPTIONS_MIN ? (
                  <button
                    type="button"
                    onClick={() => setOptions((current) => current.filter((item) => item.key !== option.key))}
                    aria-label={t("poll.create.removeOption", { n: index + 1 })}
                    className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-paper-2 hover:text-ink"
                  >
                    <IconClose size={15} />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {options.length < POLL_OPTIONS_MAX ? (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <IconPlus size={14} />
              {t("poll.create.addOption")}
            </button>
          ) : null}
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-ink">{t("poll.create.mode")}</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {(["anonymous", "visible"] as const).map((mode) => (
              <label
                key={mode}
                className={
                  "flex cursor-pointer items-start gap-2.5 rounded-[5px] border px-3 py-2.5 transition-colors " +
                  (visibility === mode ? "border-ink-3 bg-paper" : "border-line-2 hover:border-ink-3")
                }
              >
                <input
                  type="radio"
                  name={`${id}-visibility`}
                  value={mode}
                  checked={visibility === mode}
                  onChange={() => setVisibility(mode)}
                  className="mt-0.5 shrink-0"
                  style={{ accentColor: accent }}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">
                    {t(mode === "anonymous" ? "poll.mode.anonymous" : "poll.mode.visible")}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                    {t(mode === "anonymous" ? "poll.create.anonymousHelp" : "poll.create.visibleHelp")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t("poll.create.modeFixed")}</p>
        </fieldset>

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
            {t("poll.create.cancel")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {pending ? t("poll.create.submitting") : t("poll.create.submit")}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
