"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Avatar, cn } from "@/components/ui/primitives";
import { ComposerEmojiButton, EmojiText, useComposerInsert } from "@/components/community/EmojiPicker";
import { AttachmentButton, PendingAttachmentList } from "@/components/community/attachments/ComposerAttachments";
import { MessageAttachments } from "@/components/community/attachments/MessageAttachments";
import { useAttachmentUploads } from "@/components/community/attachments/useAttachmentUploads";
import {
  DeleteMessageDialog,
  DeletedMessage,
  EditedMark,
  MessageEditor,
  MessageMenu,
  useMessageChanges,
} from "@/components/community/messages/MessageChanges";
import { IconArrowLeft, IconSend } from "@/components/ui/icons";
import { createDirectMessageAction } from "@/app/actions";
import { emptyDirectMessageFormState } from "@/lib/direct-message-form";
import { dayHeading, formatTime, isSameDay } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/react";
import { bothHaveWritten, type AttachmentPolicy } from "@/lib/attachment-types";
import type { Community, CommunityEmoji, CommunityPersona, DirectConversation } from "@/lib/types";

/**
 * One direct conversation.
 *
 * The composer has the same paperclip as a private channel's. In a
 * conversation with an organisational representative it works from the first
 * message. Between two ordinary members it is there but locked — with the
 * reason on hover and focus — until each of them has sent a text message;
 * `attachmentPolicy` is the database's answer to that when the page loaded,
 * and `bothHaveWritten` lets the lock open the moment the viewer's own reply
 * is stored, without a reload. Neither is what enforces it: the database
 * checks again on every upload and every send.
 *
 * Each participant may edit or delete their own messages — never the other
 * person's; there is no moderation in a direct conversation. A deleted message
 * keeps its place as a placeholder.
 */
export function DirectConversationView({
  conversation,
  community,
  currentUser,
  customEmojis,
  attachmentPolicy,
}: {
  conversation: DirectConversation;
  community: Community;
  /** The viewer as they appear in this conversation's community. */
  currentUser: CommunityPersona;
  /** Only this conversation's community's emojis, never another the pair share. */
  customEmojis: CommunityEmoji[];
  /** Whether files may be attached here, and how many and how large. */
  attachmentPolicy: AttachmentPolicy;
}) {
  const t = useT();
  const locale = useLocale();
  const [messages, setMessages] = useState(conversation.messages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const insertText = useComposerInsert(composerRef, draft, setDraft);

  // Only stored messages count: a message still on its way has a temporary
  // id, and one the server refuses must not have unlocked anything.
  const unlocked =
    attachmentPolicy.reason === "needs_mutual" &&
    bothHaveWritten(
      messages.filter((message) => !message.id.startsWith("pending-")),
      conversation.participantIds,
    );
  const policy = useMemo<AttachmentPolicy>(
    () => (unlocked ? { ...attachmentPolicy, allowed: true, reason: "ok" } : attachmentPolicy),
    [attachmentPolicy, unlocked],
  );
  const uploads = useAttachmentUploads({
    communityId: community.id,
    target: { conversationId: conversation.id },
    policy,
  });

  const changes = useMessageChanges({
    scope: { communityId: community.id, conversationId: conversation.id },
    setMessages,
  });

  // To the end when a message arrives — not when one is edited or deleted.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const people = useMemo(
    () => ({
      [currentUser.id]: currentUser,
      [conversation.otherParticipant.id]: conversation.otherParticipant,
    }),
    [conversation.otherParticipant, currentUser],
  );

  function send() {
    const body = draft.trim();
    if ((!body && uploads.isEmpty) || pending) return;
    if (!uploads.isEmpty && !uploads.sendable) {
      setError(t(uploads.failed ? "err.attachmentFailedPresent" : "err.attachmentStillUploading"));
      return;
    }
    const files = uploads.take();

    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        conversationId: conversation.id,
        authorId: currentUser.id,
        body,
        createdAt: new Date().toISOString(),
        attachments: files.attachments,
      },
    ]);
    setDraft("");
    setError(undefined);
    composerRef.current?.focus();

    const form = new FormData();
    form.set("communityId", community.id);
    form.set("conversationId", conversation.id);
    form.set("body", body);
    for (const attachment of files.attachments) form.append("attachmentIds", attachment.id);

    startTransition(async () => {
      const result = await createDirectMessageAction(emptyDirectMessageFormState, form);
      if (result.status === "ok") {
        setMessages((current) =>
          current.map((message) => (message.id === pendingId ? result.message : message)),
        );
        files.release();
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      setError(result.status === "error" ? result.error : undefined);
      setDraft((current) => current || body);
      files.restore();
    });
  }

  return (
    <div className="flex h-full min-h-[calc(100dvh-3.25rem)] flex-col lg:min-h-dvh">
      <header className="sticky top-[3.25rem] z-20 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur-sm lg:top-0 lg:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link
            href={`/community/${community.id}/messages`}
            className="-ml-1 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            aria-label={t("dm.back")}
          >
            <IconArrowLeft size={18} />
          </Link>
          <Avatar user={conversation.otherParticipant} size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-[0.9375rem] font-medium text-ink">
              {conversation.otherParticipant.name}
            </h1>
            <p className="truncate text-[12px] text-ink-3">{community.name}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center">
              <h2 className="font-display text-lg text-ink">
                {t("dm.startWith", { name: conversation.otherParticipant.name })}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
                {t("dm.storedIn", { name: community.name })}
              </p>
            </div>
          ) : (
            <ol>
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const author = people[message.authorId];
                const mine = message.authorId === currentUser.id;
                const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
                const grouped =
                  !newDay &&
                  previous?.authorId === message.authorId &&
                  Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 10 * 60_000;
                const editing = changes.editingId === message.id;
                const ownLive = mine && !message.deleted && !message.id.startsWith("pending-") && !editing;

                return (
                  <li key={message.id}>
                    {newDay ? (
                      <div className="flex items-center gap-3 pb-3 pt-6 first:pt-0">
                        <span className="h-px flex-1 bg-line" />
                        <span className="label">{dayHeading(message.createdAt, locale)}</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "group relative flex gap-2",
                        grouped ? "mt-1" : "mt-4",
                        mine && "flex-row-reverse",
                      )}
                    >
                      <div className="w-9 shrink-0">
                        {grouped ? (
                          <span
                            className={cn(
                              "mt-1 hidden text-[10px] tabular-nums text-ink-3 group-hover:block",
                              mine && "text-right",
                            )}
                          >
                            {formatTime(message.createdAt, locale)}
                          </span>
                        ) : author ? (
                          <Avatar user={author} size="sm" />
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          "min-w-0 max-w-[min(34rem,78%)]",
                          mine && "text-right",
                          editing && "w-full",
                        )}
                      >
                        {!grouped ? (
                          <p
                            className={cn(
                              "mb-[3px] flex items-baseline gap-2",
                              mine && "justify-end",
                            )}
                          >
                            <span className="text-sm font-medium text-ink">
                              {author?.name ?? t("common.unknown")}
                            </span>
                            <span className="text-[11px] text-ink-3">
                              {formatTime(message.createdAt, locale)}
                            </span>
                          </p>
                        ) : null}

                        {message.deleted ? (
                          <DeletedMessage
                            deleted={message.deleted}
                            className="inline-block rounded-[6px] border border-dashed border-line-2 px-3 py-2 text-left"
                          />
                        ) : editing ? (
                          <MessageEditor
                            initialBody={message.body}
                            allowEmpty={Boolean(message.hasAttachments || message.attachments?.length)}
                            accent={community.branding.accent}
                            onSave={(body) => changes.saveEdit(message, body)}
                            onCancel={changes.cancelEdit}
                          />
                        ) : message.body ? (
                          <p
                            className={cn(
                              "inline-block max-w-full whitespace-pre-line break-words rounded-[6px] px-3 py-2 text-left text-[0.9375rem] leading-[1.55]",
                              mine
                                ? "bg-skog text-white"
                                : "border border-line bg-surface text-ink-2",
                            )}
                          >
                            <EmojiText body={message.body} emojis={customEmojis} />
                            {message.editedAt ? (
                              <EditedMark editedAt={message.editedAt} className={mine ? "text-white/70" : undefined} />
                            ) : null}
                          </p>
                        ) : message.editedAt ? (
                          <EditedMark editedAt={message.editedAt} className="block" />
                        ) : null}

                        <MessageAttachments
                          attachments={message.attachments}
                          align={mine ? "end" : "start"}
                          className={message.body ? "mt-1.5" : undefined}
                        />
                      </div>

                      {ownLive ? (
                        <MessageMenu
                          onEdit={() => changes.startEdit(message)}
                          onDelete={() => changes.askDelete(message)}
                          align="right"
                          anchorToRow
                          className={cn("shrink-0 self-start", grouped ? "mt-0.5" : "mt-6")}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={endRef} />

          <DeleteMessageDialog
            target={changes.deleteTarget}
            ownMessage
            direct
            pending={changes.deleting}
            error={changes.dialogError}
            onConfirm={changes.confirmDelete}
            onClose={changes.closeDelete}
          />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur-sm lg:px-8">
        <div className="mx-auto max-w-3xl">
          <PendingAttachmentList
            items={uploads.items}
            onRemove={uploads.remove}
            onRetry={uploads.retry}
            accent={community.branding.accent}
          />
          <div className="flex items-end gap-3 rounded-[6px] border border-line-2 bg-surface p-2 focus-within:border-ink-3">
            <Avatar user={currentUser} size="sm" className="mb-0.5" />
            <textarea
              ref={composerRef}
              rows={1}
              value={draft}
              maxLength={4000}
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
              placeholder={t("dm.placeholder", { name: conversation.otherParticipant.name })}
              className="max-h-44 min-h-[2.25rem] min-w-0 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
            />
            <div className="flex shrink-0 items-end gap-0.5 sm:gap-1">
              {policy.allowed || policy.reason === "needs_mutual" ? (
                <AttachmentButton
                  onPick={uploads.add}
                  disabled={uploads.full}
                  lockedReason={policy.allowed ? undefined : t("attachments.lockedMutual")}
                  className="mb-0.5"
                />
              ) : null}
              <ComposerEmojiButton
                customEmojis={customEmojis}
                onInsert={insertText}
                textareaRef={composerRef}
                className="mb-0.5"
              />
              <button
                type="button"
                onClick={send}
                disabled={(!draft.trim() && uploads.isEmpty) || pending || uploads.uploading}
                aria-label={t("channel.send")}
                className="mb-0.5 rounded-[5px] p-2 text-white transition-opacity disabled:opacity-30"
                style={{ backgroundColor: community.branding.accent }}
              >
                <IconSend size={17} />
              </button>
            </div>
          </div>
          {error || uploads.notice ? (
            <p role="alert" className="mt-2 text-[11px] text-rust">
              {error ?? uploads.notice}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-3">
            {t("dm.notice")}
          </p>
        </div>
      </div>
    </div>
  );
}
