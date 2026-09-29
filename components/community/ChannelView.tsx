"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { ComposerEmojiButton, EmojiText, useComposerInsert } from "@/components/community/EmojiPicker";
import { IconAttach, IconHash, IconLock, IconSend } from "@/components/ui/icons";
import { dayHeading, formatTime, isSameDay } from "@/lib/format";
import { createMessageAction } from "@/app/actions";
import { useLocale, useT } from "@/lib/i18n/react";
import { emptyMessageFormState } from "@/lib/message-form";
import type { Channel, Community, CommunityEmoji, CommunityPersona, Message } from "@/lib/types";

/**
 * Channel conversation.
 *
 * The page mounts this with `key={channel.id}`, so moving between channels
 * gives a fresh component rather than a state reset.
 *
 * Sending writes through `createMessageAction` and then replaces the pending
 * row with the one the database returned, so what stays on screen is what was
 * actually stored. A refused write — a member in a read-only channel — takes
 * the pending row back out and puts the text back in the composer, so nothing
 * anyone typed is lost to a failed write.
 */
export function ChannelView({
  channel,
  community,
  initialMessages,
  authors,
  currentUser,
  canPost,
  customEmojis,
  lastActivityLabel,
}: {
  channel: Channel;
  community: Community;
  initialMessages: Message[];
  authors: Record<string, CommunityPersona>;
  /** The viewer as they appear in this community. */
  currentUser: CommunityPersona;
  canPost: boolean;
  /** This community's own custom emojis, for the picker and for rendering. */
  customEmojis: CommunityEmoji[];
  /**
   * Rendered on the server. Computing a relative time in the browser as well
   * would risk the two disagreeing across a minute boundary during hydration.
   */
  lastActivityLabel?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const insertText = useComposerInsert(composerRef, draft, setDraft);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const people = useMemo(
    () => ({ ...authors, [currentUser.id]: currentUser }),
    [authors, currentUser],
  );

  function send() {
    const body = draft.trim();
    if (!body || pending) return;

    // Shown immediately under a temporary id. Nothing reads this id but React;
    // the row it stands for is replaced by the stored one as soon as the write
    // comes back, and removed entirely if it does not.
    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        channelId: channel.id,
        authorId: currentUser.id,
        body,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
    setError(undefined);
    composerRef.current?.focus();

    const form = new FormData();
    form.set("channelId", channel.id);
    form.set("communityId", community.id);
    form.set("body", body);

    startTransition(async () => {
      const result = await createMessageAction(emptyMessageFormState, form);
      if (result.status === "ok") {
        setMessages((current) =>
          current.map((message) => (message.id === pendingId ? result.message : message)),
        );
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      setError(result.status === "error" ? result.error : undefined);
      setDraft((current) => current || body);
    });
  }

  return (
    <div className="flex h-full min-h-[calc(100dvh-3.25rem)] flex-col lg:min-h-dvh">
      <header className="sticky top-[3.25rem] z-20 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur-sm lg:top-0 lg:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="flex items-center gap-1.5 text-[0.9375rem] font-medium text-ink">
            <IconHash size={16} className="text-ink-3" />
            {channel.name}
          </h1>
          {channel.readOnly ? (
            <Badge tone="neutral">
              <IconLock size={11} />
              {t("channel.announcementsOnly")}
            </Badge>
          ) : null}
          <p className="w-full text-[13px] text-ink-3 sm:w-auto sm:flex-1 sm:truncate">
            {channel.purpose}
          </p>
        </div>
      </header>

      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div
            className="mb-8 rounded-[6px] border border-line p-5"
            style={{ backgroundColor: `${community.branding.accent}0a` }}
          >
            <h2 className="font-display text-lg text-ink">
              {t("channel.start", { name: channel.name })}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{channel.purpose}</p>
            <p className="mt-3 text-xs text-ink-3">
              {t("channel.membersOnly", { name: community.name })}
            </p>
          </div>

          <ol className="space-y-1">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const author = people[message.authorId];
              const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
              const grouped =
                !newDay &&
                previous?.authorId === message.authorId &&
                Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 10 * 60_000;

              return (
                <li key={message.id}>
                  {newDay ? (
                    <div className="flex items-center gap-3 pb-3 pt-6 first:pt-0">
                      <span className="h-px flex-1 bg-line" />
                      <span className="label">{dayHeading(message.createdAt, locale)}</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  ) : null}

                  <div className={cn("group flex gap-3", grouped ? "mt-0.5" : "mt-4")}>
                    <div className="w-9 shrink-0">
                      {grouped ? (
                        <span className="mt-1 hidden justify-end pr-0.5 text-[10px] tabular-nums text-ink-3 group-hover:flex">
                          {formatTime(message.createdAt, locale)}
                        </span>
                      ) : author ? (
                        <Avatar user={author} size="sm" />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      {!grouped ? (
                        <p className="mb-0.5 flex items-baseline gap-2">
                          <span className="text-sm font-medium text-ink">
                            {author?.name ?? t("common.unknown")}
                          </span>
                          <span className="text-[11px] text-ink-3">
                            {formatTime(message.createdAt, locale)}
                          </span>
                        </p>
                      ) : null}

                      <p className="whitespace-pre-line text-[0.9375rem] leading-[1.65] text-ink-2">
                        <EmojiText body={message.body} emojis={customEmojis} />
                      </p>

                      {message.attachment ? (
                        <div className="mt-2 inline-flex items-center gap-2.5 rounded-[5px] border border-line bg-paper px-3 py-2">
                          <IconAttach size={16} className="text-ink-3" />
                          <span>
                            <span className="block text-[13px] font-medium text-ink">
                              {message.attachment.label}
                            </span>
                            <span className="block text-[11px] text-ink-3">
                              {message.attachment.meta}
                            </span>
                          </span>
                        </div>
                      ) : null}

                      {message.reactions?.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {message.reactions.map((reaction) => (
                            <span
                              key={reaction.emoji}
                              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink-2"
                            >
                              <span aria-hidden="true">{reaction.emoji}</span>
                              {reaction.userIds.length}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur-sm lg:px-8">
        <div className="mx-auto max-w-3xl">
          {canPost ? (
            <div className="flex items-end gap-3 rounded-[6px] border border-line-2 bg-surface p-2 focus-within:border-ink-3">
              <Avatar user={currentUser} size="sm" className="mb-0.5" />
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  const el = event.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={t("channel.placeholder", { name: channel.name })}
                className="max-h-44 min-h-[2.25rem] min-w-0 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
              />
              <div className="flex shrink-0 items-end gap-1">
                <ComposerEmojiButton
                  customEmojis={customEmojis}
                  onInsert={insertText}
                  textareaRef={composerRef}
                  className="mb-0.5"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || pending}
                  aria-label={t("channel.send")}
                  className="mb-0.5 rounded-[5px] p-2 text-white transition-opacity disabled:opacity-30"
                  style={{ backgroundColor: community.branding.accent }}
                >
                  <IconSend size={17} />
                </button>
              </div>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-[6px] border border-dashed border-line-2 px-4 py-3.5 text-[13px] text-ink-3">
              <IconLock size={14} />
              {t("channel.readOnly")}
            </p>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-[11px] text-rust">
              {error}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-3">
            {t("channel.footer", { name: community.name })}
            {lastActivityLabel ? ` ${t("channel.lastActivity", { when: lastActivityLabel })}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
