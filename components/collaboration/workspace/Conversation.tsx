"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteMessageAction,
  editMessageAction,
  postMessageAction,
} from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { ComposerEmojiButton, useComposerInsert } from "@/components/community/EmojiPicker";
import { IconArrowLeft, IconClose, IconHash, IconLock, IconSend } from "@/components/ui/icons";
import {
  MESSAGE_MAX,
  emptyMessagePostState,
  emptyWorkspaceFormState,
} from "@/lib/collaboration-workspace-form";
import { dayHeading, formatTime, isSameDay } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/react";
import type {
  CollaborationPersona,
  WorkspaceChannel,
  WorkspaceMessage,
} from "@/lib/types";

export interface ThreadSummaryView {
  replyCount: number;
  /** Rendered on the server so the two sides never disagree. */
  lastReplyLabel?: string;
}

interface Context {
  collaborationId: string;
  slug: string;
  channel: WorkspaceChannel;
  people: Record<string, CollaborationPersona>;
  me: CollaborationPersona;
  manager: boolean;
}

/** How the page refreshes while someone is reading: calm, and only when visible. */
const REFRESH_MS = 20_000;

function useQuietRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
}

/**
 * A channel, and — with `?thread=` — one of its threads.
 *
 * On a wide screen the thread opens beside the conversation. On anything
 * narrower — a phone, a tablet, a laptop with the sidebar open — the same
 * address shows only the thread, full width, with a way back; nothing is
 * squeezed into a side panel that would not fit.
 *
 * Every person is drawn from `people`, the collaboration personas the
 * database let this viewer read. An author without one is "Ukjent" — never
 * an account name, never a community persona.
 */
export function Conversation({
  collaborationId,
  slug,
  channel,
  people,
  me,
  manager,
  messages,
  threads,
  thread,
  threadMissing,
}: Context & {
  messages: WorkspaceMessage[];
  threads: Record<string, ThreadSummaryView>;
  thread?: { root: WorkspaceMessage; replies: WorkspaceMessage[] };
  threadMissing?: boolean;
}) {
  const t = useT();
  useQuietRefresh();
  const context: Context = { collaborationId, slug, channel, people, me, manager };
  const channelHref = `/collaboration/${slug}/channels/${channel.id}`;
  const threadOpen = Boolean(thread) || Boolean(threadMissing);

  return (
    <div className={cn(threadOpen && "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]")}>
      <section className={cn("min-w-0 flex-col", threadOpen ? "hidden xl:flex" : "flex")}>
        <MessageStream
          context={context}
          messages={messages}
          threads={threads}
          activeThreadId={thread?.root.id}
          intro={
            <div className="mb-6 rounded-[6px] border border-line bg-paper-2/40 p-4">
              <h2 className="flex items-center gap-1.5 font-display text-lg text-ink">
                <IconHash size={17} className="text-ink-3" />
                {t("ws.msg.start", { name: channel.name })}
              </h2>
              {channel.description ? (
                <p className="mt-1 text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                  {channel.description}
                </p>
              ) : null}
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                <IconLock size={12} />
                {t("ws.msg.private", { name: me.name })}
              </p>
            </div>
          }
        />
      </section>

      {threadOpen ? (
        <aside
          aria-label={t("ws.msg.thread")}
          className="min-w-0 border-line bg-surface xl:sticky xl:top-0 xl:h-dvh xl:overflow-y-auto xl:border-l"
        >
          <div className="sticky top-[3.25rem] z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur-sm lg:top-0">
            <Link
              href={channelHref}
              className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink xl:hidden"
            >
              <IconArrowLeft size={14} />
              <span className="truncate">{t("ws.msg.back", { name: channel.name })}</span>
            </Link>
            <p className="hidden truncate text-sm font-medium text-ink xl:block">
              {t("ws.msg.threadIn", { name: channel.name })}
            </p>
            <Link
              href={channelHref}
              aria-label={t("ws.msg.closeThread")}
              className="hidden rounded-[5px] p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink xl:inline-flex"
            >
              <IconClose size={16} />
            </Link>
          </div>
          {thread ? (
            <MessageStream
              key={thread.root.id}
              context={context}
              messages={thread.replies}
              threads={{}}
              root={thread.root}
            />
          ) : (
            <p className="px-5 py-8 text-sm text-ink-3">{t("ws.msg.threadMissing")}</p>
          )}
        </aside>
      ) : null}
    </div>
  );
}

/**
 * A list of messages with its composer. Used twice: for the channel (top
 * level) and for a thread (`root` set; everything posted is a reply to it).
 *
 * Sending shows the message at once under a temporary id, then swaps in the
 * row the database stored. A refused write takes it back out and puts the
 * text back in the composer.
 */
function MessageStream({
  context,
  messages,
  threads,
  root,
  activeThreadId,
  intro,
}: {
  context: Context;
  messages: WorkspaceMessage[];
  threads: Record<string, ThreadSummaryView>;
  root?: WorkspaceMessage;
  activeThreadId?: string;
  intro?: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const { channel, me, slug, collaborationId } = context;
  const [pendingRows, setPendingRows] = useState<WorkspaceMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const insertText = useComposerInsert(composerRef, draft, setDraft);

  const shown = useMemo(() => {
    const stored = new Set(messages.map((message) => message.id));
    return [...messages, ...pendingRows.filter((row) => !stored.has(row.id))];
  }, [messages, pendingRows]);

  const canPost = channel.status === "active" && (!root || !root.deleted);

  // After the router has finished its own scroll-to-top for a navigation,
  // not before it — otherwise the page opens at the oldest message.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
    return () => window.cancelAnimationFrame(frame);
  }, [shown.length]);

  function send() {
    const body = draft.trim();
    if (!body || sending) return;
    if (Array.from(body).length > MESSAGE_MAX) {
      setError(t("ws.msg.tooLong", { max: MESSAGE_MAX }));
      return;
    }
    const temporary = `pending-${Date.now()}`;
    setPendingRows((rows) => [
      ...rows,
      {
        id: temporary,
        channelId: channel.id,
        authorId: me.id,
        parentMessageId: root?.id ?? null,
        body,
        createdAt: new Date().toISOString(),
        deleted: false,
      },
    ]);
    setDraft("");
    setError(undefined);
    if (composerRef.current) composerRef.current.style.height = "auto";
    composerRef.current?.focus();

    const form = new FormData();
    form.set("channelId", channel.id);
    form.set("collaborationId", collaborationId);
    form.set("slug", slug);
    form.set("locale", locale);
    form.set("body", body);
    if (root) form.set("parentMessageId", root.id);

    startTransition(async () => {
      const result = await postMessageAction(emptyMessagePostState, form);
      if (result.status === "ok") {
        setPendingRows((rows) => rows.map((row) => (row.id === temporary ? result.message : row)));
        return;
      }
      setPendingRows((rows) => rows.filter((row) => row.id !== temporary));
      setError(result.status === "error" ? result.error : t("ws.msg.failed"));
      setDraft((current) => current || body);
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-1 flex-col">
      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {intro}
          {root ? (
            <div className="mb-5 border-b border-line pb-4">
              <MessageRow context={context} message={root} grouped={false} isRoot />
            </div>
          ) : null}
          {root && shown.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t("ws.msg.noReplies")}</p>
          ) : null}
          <ol className="space-y-0.5">
            {shown.map((message, index) => {
              const previous = shown[index - 1];
              const newDay = !root && (!previous || !isSameDay(previous.createdAt, message.createdAt));
              const grouped =
                !newDay &&
                !!previous &&
                !previous.deleted &&
                !message.deleted &&
                previous.authorId === message.authorId &&
                !threads[previous.id]?.replyCount &&
                Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 10 * 60_000;
              return (
                <li key={message.id}>
                  {newDay ? (
                    <div className="flex items-center gap-3 pb-2 pt-5 first:pt-0">
                      <span className="h-px flex-1 bg-line" />
                      <span className="label">{dayHeading(message.createdAt, locale)}</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  ) : null}
                  <MessageRow
                    context={context}
                    message={message}
                    grouped={grouped}
                    thread={root ? undefined : threads[message.id] ?? { replyCount: 0 }}
                    active={activeThreadId === message.id}
                    pending={message.id.startsWith("pending-")}
                  />
                </li>
              );
            })}
          </ol>
          {/* Its scroll margin is the sticky composer (plus the phone's tab
              bar), so "scroll to the latest" means visible above them. */}
          <div ref={endRef} className="scroll-mb-40 lg:scroll-mb-28" />
        </div>
      </div>

      <div className="sticky bottom-[4.75rem] z-10 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur-sm lg:bottom-0 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {canPost ? (
            <>
              <div className="flex items-end gap-2 rounded-[6px] border border-line-2 bg-surface p-1.5 focus-within:border-ink-3">
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  aria-label={root ? t("ws.msg.replyPlaceholder") : t("ws.msg.placeholder", { name: channel.name })}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    const el = event.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder={root ? t("ws.msg.replyPlaceholder") : t("ws.msg.placeholder", { name: channel.name })}
                  className="max-h-44 min-h-[2.25rem] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
                />
                <div className="flex shrink-0 items-end gap-1">
                  {/* Standard emojis only: a community's custom emojis are private
                      to it, and a collaboration spans organizations. */}
                  <ComposerEmojiButton onInsert={insertText} textareaRef={composerRef} />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim() || sending}
                    aria-label={t("ws.msg.send")}
                    className="shrink-0 rounded-[5px] bg-skog p-2 text-white transition-opacity hover:bg-skog-2 disabled:opacity-30"
                  >
                    <IconSend size={17} />
                  </button>
                </div>
              </div>
              <p className="mt-1.5 hidden text-[11px] text-ink-3 sm:block">{t("ws.msg.hint")}</p>
            </>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-[6px] border border-dashed border-line-2 px-4 py-3 text-center text-[13px] text-ink-3">
              <IconLock size={14} />
              {t("ws.channel.archivedNotice")}
            </p>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-[12px] text-rust">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  context,
  message,
  grouped,
  thread,
  active,
  pending,
  isRoot,
}: {
  context: Context;
  message: WorkspaceMessage;
  grouped: boolean;
  thread?: ThreadSummaryView;
  active?: boolean;
  pending?: boolean;
  isRoot?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { people, me, manager, slug, channel } = context;
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const author = message.authorId ? people[message.authorId] : undefined;
  const name = author?.name ?? t("common.unknown");
  const mine = message.authorId === me.id;
  const threadHref = `/collaboration/${slug}/channels/${channel.id}?thread=${message.id}`;
  const canEdit = mine && !message.deleted && !pending && channel.status === "active";
  const canDelete = (mine || manager) && !message.deleted && !pending;

  return (
    <div
      className={cn(
        "group relative -mx-2 flex gap-3 rounded-[6px] px-2",
        grouped ? "mt-0 py-0.5" : "mt-3 py-1",
        active && "bg-skog-soft/50",
        pending && "opacity-60",
      )}
    >
      <div className="w-8 shrink-0 pt-0.5">
        {grouped ? null : message.deleted ? (
          <span className="inline-block h-8 w-8 rounded-full border border-dashed border-line-2" />
        ) : (
          <Avatar
            user={{
              id: message.authorId ?? "ukjent",
              name,
              initials: author?.initials ?? "?",
              communityId: context.collaborationId,
            }}
            size="sm"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && !message.deleted ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{name}</span>
            <time dateTime={message.createdAt} className="text-[11px] text-ink-3">
              {formatTime(message.createdAt, locale)}
            </time>
          </p>
        ) : null}

        {message.deleted ? (
          <p className="py-1 text-[13px] italic text-ink-3">{t("ws.msg.deleted")}</p>
        ) : editing ? (
          <EditMessage
            message={message}
            slug={slug}
            onDone={() => setEditing(false)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-[1.6] text-ink-2 [overflow-wrap:anywhere]">
            {message.body}
            {message.editedAt ? (
              <span className="ml-1.5 text-[11px] text-ink-3">({t("ws.msg.edited")})</span>
            ) : null}
          </p>
        )}

        {thread && thread.replyCount > 0 && !isRoot && !pending ? (
          <Link
            href={threadHref}
            className="mt-1 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-[4px] text-[12.5px] font-medium text-skog hover:underline"
          >
            {t(thread.replyCount === 1 ? "ws.msg.replies.one" : "ws.msg.replies.other", {
              count: thread.replyCount,
            })}
            {thread.lastReplyLabel ? (
              <span className="font-normal text-ink-3">{t("ws.msg.lastReply", { when: thread.lastReplyLabel })}</span>
            ) : null}
          </Link>
        ) : null}

        {menu && (canEdit || canDelete) ? (
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setMenu(false);
                }}
                className="h-8 rounded-[5px] border border-line-2 bg-surface px-3 text-[13px] text-ink-2 hover:bg-paper-2"
              >
                {t("ws.msg.edit")}
              </button>
            ) : null}
            {canDelete ? (
              <ActionButton
                action={deleteMessageAction}
                fields={{ messageId: message.id, slug }}
                label={t("ws.msg.delete")}
                variant="quiet"
                confirm={{ note: t("ws.msg.deleteConfirm"), yes: t("ws.msg.delete") }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Beside the message, never under it, so a run of short messages
          stays compact. Always visible on a touch screen; on hover or focus
          elsewhere. */}
      {!editing && !pending && !message.deleted ? (
        <div className="flex shrink-0 items-start gap-0.5 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {thread && !isRoot && thread.replyCount === 0 && channel.status === "active" ? (
            <Link
              href={threadHref}
              title={t("ws.msg.reply")}
              className="h-6 rounded-[5px] px-1.5 text-[12px] leading-6 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              {t("common.reply")}
            </Link>
          ) : null}
          {canEdit || canDelete ? (
            <button
              type="button"
              onClick={() => setMenu((open) => !open)}
              aria-expanded={menu}
              aria-label={t("ws.msg.actions")}
              className="h-6 rounded-[5px] px-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              ⋯
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditMessage({
  message,
  slug,
  onDone,
}: {
  message: WorkspaceMessage;
  slug: string;
  onDone: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(editMessageAction, emptyWorkspaceFormState);
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(message.body);
  const seen = useRef(state);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.status === "ok") onDone();
  }, [state, onDone]);

  return (
    <form
      className="mt-1 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => formAction(form));
      }}
    >
      <input type="hidden" name="messageId" value={message.id} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <textarea
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={Math.min(8, Math.max(2, body.split("\n").length))}
        maxLength={MESSAGE_MAX}
        className="w-full resize-y rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-[0.9375rem] leading-6 text-ink outline-none focus:border-ink-3"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="h-8 rounded-[5px] bg-skog px-3 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {pending ? "…" : t("ws.msg.save")}
        </button>
        <button type="button" onClick={onDone} className="h-8 px-2 text-[13px] text-ink-3 hover:text-ink">
          {t("common.cancel")}
        </button>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-[12px] text-rust">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** The channel's heading. Managers get the settings disclosure beside it. */
export function ChannelHeading({
  channel,
  settings,
}: {
  channel: WorkspaceChannel;
  settings?: React.ReactNode;
}) {
  const t = useT();
  return (
    <header className="border-b border-line bg-surface px-5 py-3 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="flex min-w-0 items-center gap-1 text-[1rem] font-medium text-ink">
          <IconHash size={16} className="shrink-0 text-ink-3" />
          <span className="truncate">{channel.name}</span>
        </h1>
        {channel.status === "archived" ? <Badge tone="neutral">{t("ws.channel.archivedBadge")}</Badge> : null}
        {channel.description ? (
          <p className="w-full truncate text-[13px] text-ink-3 sm:w-auto sm:flex-1">{channel.description}</p>
        ) : (
          <span className="hidden flex-1 sm:block" />
        )}
        {settings}
      </div>
    </header>
  );
}
