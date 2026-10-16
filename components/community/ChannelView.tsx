"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { ChannelIntroCard } from "@/components/community/ChannelIntroCard";
import { PrivateChannelAdmin } from "@/components/community/PrivateChannelAdmin";
import { CommunityChannelAdmin } from "@/components/community/channels/CommunityChannelAdmin";
import { PrivateChannelCreate } from "@/components/community/PrivateChannelCreate";
import { PrivateChannelParticipants } from "@/components/community/PrivateChannelParticipants";
import { ComposerEmojiButton, EmojiText, useComposerInsert } from "@/components/community/EmojiPicker";
import { AttachmentButton, PendingAttachmentList } from "@/components/community/attachments/ComposerAttachments";
import { ChannelResourceLibrary, type ResourcePermissions } from "@/components/community/resources/ChannelResourceLibrary";
import { MessageAttachments } from "@/components/community/attachments/MessageAttachments";
import { useAttachmentUploads } from "@/components/community/attachments/useAttachmentUploads";
import { IconAttach, IconClose, IconHash, IconLock, IconSend } from "@/components/ui/icons";
import { dayHeading, formatTime, isSameDay } from "@/lib/format";
import { createMessageAction } from "@/app/actions";
import { useLocale, useT } from "@/lib/i18n/react";
import { emptyMessageFormState } from "@/lib/message-form";
import type { AttachmentPolicy } from "@/lib/attachment-types";
import type { ResourceSummary } from "@/lib/channel-resources";
import type {
  Channel,
  Community,
  CommunityEmoji,
  CommunityPersona,
  ChannelContentCounts,
  ChannelSection,
  Message,
  PrivateChannelParticipant,
} from "@/lib/types";

/**
 * What a lokallag channel's page adds for the people who run it. All of it is
 * presentation: each flag was answered by the database for this viewer, and
 * every action behind it is decided there again.
 */
export interface PrivateChannelControls {
  /** The lokallag this channel belongs to — its main chat or a private channel under it. */
  localGroup: { id: string; name: string };
  /** Main lokallag chat only: the viewer may create a private channel under it. */
  canCreate: boolean;
  /** The sidebar's "+ Ny privat kanal" link asked for the form. */
  createRequested: boolean;
  /** Private channel only: the viewer may rename, archive and change participants. */
  canManage: boolean;
  /** Private channel only: its participants, for everyone who can read it. */
  roster: PrivateChannelParticipant[];
  /** Community admin: may choose who else manages the channel. */
  viewerIsAdmin: boolean;
}

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
 *
 * A private lokallag channel is the same conversation with a lock instead of
 * a hash, a sentence saying who can read it, a "Deltakere" list for everyone
 * in it, and — for its managers instead — the "Administrer kanal" menu. An
 * archived one keeps its history and has no composer.
 *
 * In a private group's chat and a private lokallag channel the composer also
 * has a paperclip. Files are uploaded as they are picked and travel with the
 * message as ids; a message may then be files alone. Whether this channel
 * takes files at all is `attachmentPolicy`, answered by the database for this
 * viewer, and decided there again for every upload and every send. A
 * community channel has the paperclip too once its administrators switch
 * file sharing on.
 *
 * "Ressurser" in the header opens the channel's library of files, links,
 * folders and pins — offered wherever files can be shared now or resources
 * exist, so switching sharing off or archiving the channel never hides what
 * is already there, and to administrators so they can add the first link.
 * "Gå til melding" there brings the message into view here and marks it for a
 * moment; a message that is not on this page any more (sent since it loaded)
 * is fetched by loading the channel again at `?melding=<id>`, and one that no
 * longer exists says so instead of going anywhere.
 */
export function ChannelView({
  channel,
  community,
  initialMessages,
  authors,
  currentUser,
  canPost,
  canEdit,
  customEmojis,
  lastActivityLabel,
  privateChannels,
  subgroup,
  attachmentPolicy,
  channelAdmin,
  resources,
  focusMessageId,
}: {
  channel: Channel;
  community: Community;
  initialMessages: Message[];
  authors: Record<string, CommunityPersona>;
  /** The viewer as they appear in this community. */
  currentUser: CommunityPersona;
  canPost: boolean;
  /**
   * Shows the pencil: an active admin of this community on a community-wide
   * channel, or a manager of a private lokallag channel. The write is
   * re-checked server-side.
   */
  canEdit: boolean;
  /** This community's own custom emojis, for the picker and for rendering. */
  customEmojis: CommunityEmoji[];
  /**
   * Rendered on the server. Computing a relative time in the browser as well
   * would risk the two disagreeing across a minute boundary during hydration.
   */
  lastActivityLabel?: string;
  /** Set on a lokallag's main chat and on the private channels under it. */
  privateChannels?: PrivateChannelControls;
  /**
   * Set on a team's chat. `moderatorsRead` words the audience sentence the
   * way the database decides it; `manageHref` is the team's entry on the
   * Grupper page, present only for someone who may manage the team.
   */
  subgroup?: { moderatorsRead: boolean; manageHref?: string };
  /** Whether files may be attached here, and how many and how large. */
  attachmentPolicy: AttachmentPolicy;
  /**
   * Set on one of the community's own channels for its active admins: the
   * "Administrer kanal" menu, with the community's sections to move it to and
   * what deleting it would remove (answered by the database for this viewer).
   */
  channelAdmin?: { sections: ChannelSection[]; counts?: ChannelContentCounts };
  /** Set when "Ressurser" is offered; the flags only decide which controls appear. */
  resources?: { summary: ResourceSummary; permissions: ResourcePermissions; uploads?: { enabled: boolean } };
  /** A message to bring into view on arrival (`?melding=`). */
  focusMessageId?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [editRequest, setEditRequest] = useState(0);
  // Arriving at `?melding=`: the conversation opens at that message instead
  // of at its end — or, when it no longer exists, says so.
  const arrival =
    focusMessageId && initialMessages.some((message) => message.id === focusMessageId)
      ? focusMessageId
      : undefined;
  const [highlightId, setHighlightId] = useState<string | undefined>(arrival);
  const [messageNotice, setMessageNotice] = useState<string | undefined>(
    focusMessageId && !arrival ? t("channel.messageGone") : undefined,
  );
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arrivingAtMessage = useRef(Boolean(arrival));
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const insertText = useComposerInsert(composerRef, draft, setDraft);
  const uploads = useAttachmentUploads({
    communityId: community.id,
    target: { channelId: channel.id },
    policy: attachmentPolicy,
  });
  // Who can read this conversation, stated as the database decides it
  // (content_scope_admits): the whole community; a lokallag and the
  // community's admins; or a team and the community's admins — and its
  // moderators too, for a team that predates team creation (Safe-Space).
  // A lokallag or team channel's name is its group's name. A private lokallag
  // channel (channel_access_admits) has a name of its own, so its sentence
  // names the lokallag it sits under: invited participants, and the admins.
  const audience = channel.isPrivate
    ? { note: "channel.membersOnlyPrivate", footer: "channel.footerPrivate" } as const
    : channel.localGroupId
      ? { note: "channel.membersOnlyLocal", footer: "channel.footerLocal" } as const
      : channel.subgroupId
        ? subgroup?.moderatorsRead === false
          ? { note: "channel.membersOnlySubgroupClosed", footer: "channel.footerSubgroupClosed" } as const
          : { note: "channel.membersOnlySubgroup", footer: "channel.footerSubgroup" } as const
        : { note: "channel.membersOnly", footer: "channel.footer" } as const;
  const audienceVars = {
    name: channel.isPrivate
      ? (privateChannels?.localGroup.name ?? community.name)
      : channel.localGroupId || channel.subgroupId
        ? channel.name
        : community.name,
    community: community.name,
  };

  useEffect(() => {
    if (arrivingAtMessage.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /** Scrolls to a message on this page and marks it. False if it is not here. */
  function showMessage(messageId: string, behavior: ScrollBehavior): boolean {
    const element = document.getElementById(`melding-${messageId}`);
    if (!element) return false;
    element.scrollIntoView({ block: "center", behavior });
    setHighlightId(messageId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(undefined), 2600);
    return true;
  }

  useEffect(() => {
    if (!arrival) return;
    document.getElementById(`melding-${arrival}`)?.scrollIntoView({ block: "center" });
    arrivingAtMessage.current = false;
    highlightTimer.current = setTimeout(() => setHighlightId(undefined), 2600);
    return () => clearTimeout(highlightTimer.current);
    // Once, on arrival; the page remounts this view for another message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToMessage(messageId: string) {
    setMessageNotice(undefined);
    if (showMessage(messageId, "smooth")) return;
    // Not on this page — sent after it loaded. Load the channel again, at it.
    router.push(
      `/community/${encodeURIComponent(community.id)}/channel/${encodeURIComponent(channel.id)}?melding=${encodeURIComponent(messageId)}`,
    );
  }

  const people = useMemo(
    () => ({ ...authors, [currentUser.id]: currentUser }),
    [authors, currentUser],
  );

  function send() {
    const body = draft.trim();
    if ((!body && uploads.isEmpty) || pending) return;
    // Files still on their way up, or one that failed: nothing is sent until
    // every picked file is either uploaded or taken out.
    if (!uploads.isEmpty && !uploads.sendable) {
      setError(t(uploads.failed ? "err.attachmentFailedPresent" : "err.attachmentStillUploading"));
      return;
    }
    const files = uploads.take();

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
        attachments: files.attachments,
      },
    ]);
    setDraft("");
    setError(undefined);
    composerRef.current?.focus();

    const form = new FormData();
    form.set("channelId", channel.id);
    form.set("communityId", community.id);
    form.set("body", body);
    for (const attachment of files.attachments) form.append("attachmentIds", attachment.id);

    startTransition(async () => {
      const result = await createMessageAction(emptyMessageFormState, form);
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
      // The uploads are still there; they go back above the composer.
      files.restore();
    });
  }

  return (
    <div className="flex h-full min-h-[calc(100dvh-3.25rem)] flex-col lg:min-h-dvh">
      <header className="sticky top-[3.25rem] z-20 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur-sm lg:top-0 lg:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="flex min-w-0 items-center gap-1.5 text-[0.9375rem] font-medium text-ink">
            {channel.isPrivate ? (
              <IconLock size={15} className="shrink-0 text-ink-3" />
            ) : (
              <IconHash size={16} className="shrink-0 text-ink-3" />
            )}
            <span className="truncate">{channel.name}</span>
          </h1>
          {channel.readOnly ? (
            <Badge tone="neutral">
              <IconLock size={11} />
              {t("channel.restrictedPosting")}
            </Badge>
          ) : null}
          {channel.isPrivate ? <Badge tone="neutral">{t("channel.privateBadge")}</Badge> : null}
          {channel.archived ? <Badge tone="outline">{t("channel.archivedBadge")}</Badge> : null}
          {resources || (privateChannels && (channel.isPrivate || privateChannels.canCreate)) || channelAdmin || subgroup?.manageHref ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {resources ? (
                <ChannelResourceLibrary
                  communityId={community.id}
                  channelId={channel.id}
                  channelName={channel.name}
                  summary={resources.summary}
                  permissions={resources.permissions}
                  uploads={resources.uploads}
                  accent={community.branding.accent}
                  onGoToMessage={goToMessage}
                />
              ) : null}
              {privateChannels && (channel.isPrivate || privateChannels.canCreate) ? (
                channel.isPrivate && !privateChannels.canManage ? (
                  // Everyone in a private channel may see who else is in it;
                  // only its managers get the menu that changes anything.
                  <PrivateChannelParticipants
                    communityId={community.id}
                    communityName={community.name}
                    channel={channel}
                    roster={privateChannels.roster}
                  />
                ) : channel.isPrivate ? (
                  <PrivateChannelAdmin
                    communityId={community.id}
                    communityName={community.name}
                    channel={channel}
                    localGroup={privateChannels.localGroup}
                    roster={privateChannels.roster}
                    viewerIsAdmin={privateChannels.viewerIsAdmin}
                    accent={community.branding.accent}
                    onEdit={() => setEditRequest((n) => n + 1)}
                  />
                ) : (
                  <PrivateChannelCreate
                    communityId={community.id}
                    communityName={community.name}
                    localGroup={privateChannels.localGroup}
                    accent={community.branding.accent}
                    openRequested={privateChannels.createRequested}
                  />
                )
              ) : null}
              {channelAdmin ? (
                <CommunityChannelAdmin
                  communityId={community.id}
                  channel={channel}
                  sections={channelAdmin.sections}
                  counts={channelAdmin.counts}
                  accent={community.branding.accent}
                />
              ) : null}
              {subgroup?.manageHref ? (
                <Link
                  href={subgroup.manageHref}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
                    "transition-colors hover:border-ink-3 hover:text-ink",
                  )}
                >
                  {t("subgroups.manage.menu")}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <ChannelIntroCard
            communityId={community.id}
            audienceNote={t(audience.note, audienceVars)}
            channel={channel}
            canEdit={canEdit}
            accent={community.branding.accent}
            editRequest={editRequest}
          />

          {messageNotice ? (
            <p
              role="status"
              className="mb-4 flex items-start justify-between gap-3 rounded-[6px] border border-line bg-paper px-3.5 py-2.5 text-[13px] text-ink-2"
            >
              <span>{messageNotice}</span>
              <button
                type="button"
                onClick={() => setMessageNotice(undefined)}
                aria-label={t("common.close")}
                className="-my-1 -mr-1.5 shrink-0 rounded-[5px] p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
              >
                <IconClose size={14} />
              </button>
            </p>
          ) : null}

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
                <li key={message.id} id={`melding-${message.id}`} className="scroll-mt-28">
                  {newDay ? (
                    <div className="flex items-center gap-3 pb-3 pt-6 first:pt-0">
                      <span className="h-px flex-1 bg-line" />
                      <span className="label">{dayHeading(message.createdAt, locale)}</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      "group -mx-2 flex gap-3 rounded-[6px] px-2 transition-colors duration-700",
                      grouped ? "mt-0.5" : "mt-4",
                      highlightId === message.id ? "bg-paper-2" : "bg-transparent",
                    )}
                  >
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

                      {message.body ? (
                        <p className="whitespace-pre-line text-[0.9375rem] leading-[1.65] text-ink-2">
                          <EmojiText body={message.body} emojis={customEmojis} />
                        </p>
                      ) : null}

                      <MessageAttachments
                        attachments={message.attachments}
                        className={message.body ? "mt-1.5" : "mt-0.5"}
                      />

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
            <PendingAttachmentList
              items={uploads.items}
              onRemove={uploads.remove}
              onRetry={uploads.retry}
              accent={community.branding.accent}
            />
          ) : null}
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
              <div className="flex shrink-0 items-end gap-0.5 sm:gap-1">
                {attachmentPolicy.allowed ? (
                  <AttachmentButton onPick={uploads.add} disabled={uploads.full} className="mb-0.5" />
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
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-[6px] border border-dashed border-line-2 px-4 py-3.5 text-[13px] text-ink-3">
              <IconLock size={14} />
              {t(channel.archived ? "channel.archivedNotice" : "channel.readOnly")}
            </p>
          )}
          {error || uploads.notice ? (
            <p role="alert" className="mt-2 text-[11px] text-rust">
              {error ?? uploads.notice}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-3">
            {t(audience.footer, audienceVars)}
            {lastActivityLabel ? ` ${t("channel.lastActivity", { when: lastActivityLabel })}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
