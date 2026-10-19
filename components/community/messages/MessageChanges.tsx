"use client";

import { useEffect, useRef, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { deleteMessageAction, editMessageAction, setMessagePinnedAction } from "@/app/message-actions";
import { EmojiText } from "@/components/community/EmojiPicker";
import { useMentionAutocomplete, type MentionScope } from "@/components/community/messages/Mentions";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconMore, IconPencil, IconPin, IconTrash } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/format";
import { MESSAGE_BODY_MAX } from "@/lib/message-form";
import { mentionsAsText, mentionsToDraft, type MentionCandidate } from "@/lib/mentions";
import { useLocale, useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import type { CommunityEmoji, CommunityPersona, MessageDeletion } from "@/lib/types";

/**
 * Editing, deleting and pinning a chat message, shared by channels and direct
 * messages.
 *
 * Everything here is presentation. Which items a message's menu offers is
 * decided by its owner from flags the database answered for this viewer; every
 * action asks the database again (20261101100000), which finds the message by
 * id and refuses whatever the viewer may not do.
 */

/** What both kinds of chat message have in common, as far as changing them goes. */
export interface ChangeableMessage {
  id: string;
  authorId: string;
  body: string;
  editedAt?: string;
  deleted?: MessageDeletion;
  attachments?: MessageAttachment[];
  hasAttachments?: boolean;
}

type Scope = { communityId: string; channelId?: string; conversationId?: string };

/** The same message as a placeholder: nothing of what it said or carried is kept. */
function tombstone<M extends ChangeableMessage>(message: M, deleted: MessageDeletion): M {
  return {
    ...message,
    body: "",
    editedAt: undefined,
    deleted,
    attachments: undefined,
    hasAttachments: undefined,
    reactions: [],
    attachment: undefined,
  } as M;
}

/**
 * State for one conversation's message changes: which message is being edited
 * inline, which one waits for its deletion to be confirmed, and which one
 * waits for "replace the pinned message?".
 */
export function useMessageChanges<M extends ChangeableMessage>({
  scope,
  setMessages,
  pinnedId,
  setPinnedId,
  onNotice,
}: {
  scope: Scope;
  setMessages: Dispatch<SetStateAction<M[]>>;
  /** Channels only: the pinned message, and how to change it. */
  pinnedId?: string;
  setPinnedId?: (id: string | undefined) => void;
  /** A refusal that has no dialog of its own to appear in. */
  onNotice?: (text: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<M | undefined>(undefined);
  const [pinTarget, setPinTarget] = useState<M | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  // Separate, so one action's refresh never makes another's dialog read "Sletter …".
  const [deleting, startDeleting] = useTransition();
  const [pinning, startPinning] = useTransition();

  async function saveEdit(message: M, body: string): Promise<string | undefined> {
    const result = await editMessageAction(scope, message.id, body);
    if (!result.ok) return result.error;
    const stored = result.message;
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, body: stored.body, editedAt: stored.editedAt } : item,
      ),
    );
    setEditingId(undefined);
    return undefined;
  }

  function askDelete(message: M) {
    setDialogError(undefined);
    setDeleteTarget(message);
  }

  function confirmDelete() {
    const message = deleteTarget;
    if (!message || deleting) return;
    startDeleting(async () => {
      const result = await deleteMessageAction(scope, message.id);
      if (!result.ok) {
        setDialogError(result.error);
        return;
      }
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? tombstone(item, result.deleted) : item)),
      );
      if (pinnedId === message.id) setPinnedId?.(undefined);
      if (editingId === message.id) setEditingId(undefined);
      setDeleteTarget(undefined);
    });
  }

  function writePin(message: M, pinned: boolean) {
    startPinning(async () => {
      const result = await setMessagePinnedAction(scope, message.id, pinned);
      if (!result.ok) {
        if (pinTarget) setDialogError(result.error);
        else onNotice?.(result.error);
        return;
      }
      setPinnedId?.(pinned ? message.id : undefined);
      setPinTarget(undefined);
    });
  }

  function togglePin(message: M) {
    if (pinning) return;
    if (pinnedId === message.id) {
      writePin(message, false);
    } else if (pinnedId) {
      // Only one per channel: replacing it is confirmed first.
      setDialogError(undefined);
      setPinTarget(message);
    } else {
      writePin(message, true);
    }
  }

  return {
    editingId,
    startEdit: (message: M) => setEditingId(message.id),
    cancelEdit: () => setEditingId(undefined),
    saveEdit,
    askDelete,
    deleteTarget,
    closeDelete: () => setDeleteTarget(undefined),
    confirmDelete,
    togglePin,
    pinTarget,
    closePin: () => setPinTarget(undefined),
    confirmPin: () => pinTarget && writePin(pinTarget, true),
    dialogError,
    deleting,
    pinning,
  };
}

/**
 * The small "⋯" beside a message. Visible on hover and keyboard focus, and
 * always on touch screens, where there is no hover.
 */
export function MessageMenu({
  onEdit,
  onDelete,
  onRemove,
  onPin,
  pinned,
  align = "right",
  anchorToRow,
  className,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  onRemove?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  align?: "left" | "right";
  /** Open the list against the message's (positioned) row rather than the button. */
  anchorToRow?: boolean;
  className?: string;
}) {
  const t = useT();
  const items: ActionMenuItem[] = [];
  if (onEdit) items.push({ key: "edit", label: t("message.edit"), icon: <IconPencil size={15} />, onSelect: onEdit });
  if (onPin) {
    items.push({ key: "pin", label: t(pinned ? "message.unpin" : "message.pin"), icon: <IconPin size={15} />, onSelect: onPin });
  }
  if (onDelete) {
    items.push({
      key: "delete",
      label: t("message.delete"),
      icon: <IconTrash size={15} />,
      danger: true,
      separatorBefore: items.length > 0,
      onSelect: onDelete,
    });
  } else if (onRemove) {
    items.push({
      key: "remove",
      label: t("message.remove"),
      icon: <IconTrash size={15} />,
      danger: true,
      separatorBefore: items.length > 0,
      onSelect: onRemove,
    });
  }
  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        "has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <ActionMenu
        label={t("message.actions")}
        ariaLabel={t("message.actions")}
        align={align}
        containerClassName={anchorToRow ? "static" : undefined}
        items={items}
        triggerClassName="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink aria-expanded:bg-paper-2 aria-expanded:text-ink"
        trigger={() => <IconMore size={16} />}
      />
    </div>
  );
}

/**
 * Inline editor in place of the message's text. Enter saves, Shift+Enter
 * breaks a line, Escape cancels.
 *
 * In a channel (`mentions`) the text's mentions show as "@Name" and "@" offers
 * people again, as in the composer; what is saved has them as mentions. The
 * database checks every mention the edit adds, and leaves the ones it keeps.
 */
export function MessageEditor({
  initialBody,
  allowEmpty,
  accent,
  onSave,
  onCancel,
  mentions,
}: {
  initialBody: string;
  /** The message carries files, so it may be left without text. */
  allowEmpty: boolean;
  accent: string;
  onSave: (body: string) => Promise<string | undefined>;
  onCancel: () => void;
  mentions?: {
    scope: MentionScope;
    people: Record<string, CommunityPersona | undefined>;
    onPick?: (candidate: MentionCandidate) => void;
  };
}) {
  const t = useT();
  const [initial] = useState(() =>
    mentions
      ? mentionsToDraft(initialBody, (id) => mentions.people[id]?.name)
      : { text: initialBody, mentions: [] },
  );
  const [draft, setDraft] = useState(initial.text);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, startSaving] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const autocomplete = useMentionAutocomplete({
    scope: mentions?.scope,
    textareaRef: ref,
    anchorRef: frameRef,
    value: draft,
    setValue: setDraft,
    initialMentions: initial.mentions,
    placement: "below",
    onPick: mentions?.onPick,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  const empty = !draft.trim();
  const blocked = (empty && !allowEmpty) || draft.trim().length > MESSAGE_BODY_MAX;

  function save() {
    if (saving) return;
    if (blocked) {
      setError(t(empty ? "err.messageEmpty" : "err.messageTooLong"));
      return;
    }
    const stored = autocomplete.stored(draft);
    if (stored.trim() === initialBody.trim()) {
      onCancel();
      return;
    }
    setError(undefined);
    startSaving(async () => {
      const refusal = await onSave(stored);
      if (refusal) setError(refusal);
    });
  }

  return (
    <div ref={frameRef} className="relative mt-0.5">
      <textarea
        ref={ref}
        value={draft}
        rows={1}
        maxLength={MESSAGE_BODY_MAX}
        aria-label={t("message.editLabel")}
        disabled={saving}
        {...autocomplete.textareaProps}
        onChange={(event) => {
          setDraft(event.target.value);
          autocomplete.onChange(event);
          const el = event.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
        }}
        onPaste={autocomplete.onPaste}
        onClick={autocomplete.onCaretMove}
        onKeyUp={autocomplete.onKeyUp}
        onKeyDown={(event) => {
          if (autocomplete.onKeyDown(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
        className="block max-h-60 min-h-[2.5rem] w-full resize-none rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-left text-[0.9375rem] leading-6 text-ink outline-none focus:border-ink-3 disabled:opacity-60"
      />
      {autocomplete.menu}
      {error ? (
        <p role="alert" className="mt-1.5 text-left text-[12px] text-rust">
          {error}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || blocked}
          className="h-8 rounded-[5px] px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          {saving ? t("message.saving") : t("message.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-[5px] px-3 text-[13px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-40"
        >
          {t("message.cancel")}
        </button>
        <span className="hidden text-[11px] text-ink-3 sm:inline">{t("message.editHint")}</span>
      </div>
    </div>
  );
}

/** «· redigert», with when on hover. */
export function EditedMark({ editedAt, className }: { editedAt: string; className?: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <span
      className={cn("whitespace-nowrap text-[11px] text-ink-3", className)}
      title={t("message.editedAt", { when: `${formatDate(editedAt, locale)} ${formatTime(editedAt, locale)}` })}
    >
      {" "}· {t("message.edited")}
    </span>
  );
}

/** Where a deleted message was. Says only who removed it, never what it said. */
export function DeletedMessage({ deleted, className }: { deleted: MessageDeletion; className?: string }) {
  const t = useT();
  return (
    <p className={cn("text-[0.875rem] italic leading-[1.65] text-ink-3", className)}>
      {t(deleted === "moderator" ? "message.deletedModerator" : "message.deletedOwn")}
    </p>
  );
}

/** "Slette meldingen?" / "Fjerne meldingen?" */
export function DeleteMessageDialog({
  target,
  authorName,
  ownMessage,
  direct,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  target?: { id: string };
  authorName?: string;
  ownMessage: boolean;
  /** A direct message: there is no Ressurser to mention. */
  direct?: boolean;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog open={Boolean(target)} onClose={pending ? () => undefined : onClose} labelledBy="message-delete-title">
      <h3 id="message-delete-title" className="font-display text-lg text-ink">
        {t(ownMessage ? "message.deleteTitle" : "message.removeTitle")}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        {ownMessage
          ? t(direct ? "message.deleteBodyDirect" : "message.deleteBody")
          : t("message.removeBody", { name: authorName ?? t("common.unknown") })}
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
          {t("message.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {pending ? t("message.deleting") : t(ownMessage ? "message.delete" : "message.remove")}
        </button>
      </div>
    </ConfirmDialog>
  );
}

/** "Erstatte den festede meldingen?" */
export function ReplacePinDialog({
  open,
  pending,
  error,
  accent,
  onConfirm,
  onClose,
}: {
  open: boolean;
  pending: boolean;
  error?: string;
  accent: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog open={open} onClose={pending ? () => undefined : onClose} labelledBy="message-pin-title">
      <h3 id="message-pin-title" className="font-display text-lg text-ink">
        {t("message.pinReplaceTitle")}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{t("message.pinReplaceBody")}</p>
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
          {t("message.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          {t("message.pinReplaceConfirm")}
        </button>
      </div>
    </ConfirmDialog>
  );
}

/**
 * The pinned message, one line beneath the channel's header: who wrote it and
 * how it starts — read from the message itself, so an edit shows here at once.
 */
export function PinnedMessageBar({
  message,
  authorName,
  customEmojis,
  onOpen,
  people,
}: {
  message: ChangeableMessage;
  authorName: string;
  customEmojis: CommunityEmoji[];
  onOpen: () => void;
  /** Names for the mentions in it, shown as "@Name". */
  people?: Record<string, CommunityPersona | undefined>;
}) {
  const t = useT();
  const preview = mentionsAsText(message.body, (id) => people?.[id]?.name).replace(/\s+/g, " ").trim();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("message.pinnedOpen", { name: authorName })}
      className="mx-auto mt-2.5 flex w-full max-w-3xl min-w-0 items-center gap-2 rounded-[5px] border border-line bg-paper px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-line-2 hover:bg-paper-2"
    >
      <IconPin size={14} className="shrink-0 text-ink-3" />
      <span className="hidden shrink-0 text-[11px] uppercase tracking-wide text-ink-3 sm:inline">
        {t("message.pinned")}
      </span>
      <span className="shrink-0 font-medium text-ink">{authorName}</span>
      <span className="min-w-0 flex-1 truncate text-ink-2">
        {preview ? <EmojiText body={preview} emojis={customEmojis} /> : t("attachments.messageOnlyFiles")}
      </span>
    </button>
  );
}
