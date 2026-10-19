import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar, Badge, EmptyState, PageContainer, PageHeader, Panel, cn } from "@/components/ui/primitives";
import { IconArrowRight, IconMail } from "@/components/ui/icons";
import { DirectConversationMenu, RestoreConversationButton } from "@/components/community/messages/DirectConversationMenu";
import {
  getCommunityById,
  getDirectConversations,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator, translator, type Locale, type Translator } from "@/lib/i18n";
import type { DirectConversationSummary } from "@/lib/types";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/messages">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("dm.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

function preview(t: Translator, body?: string, hasAttachments?: boolean, deleted?: boolean) {
  // A deleted message has nothing left to quote.
  if (deleted) return t("message.deletedOwn");
  // A message that is only files has no text to quote.
  if (!body?.trim() && hasAttachments) return t("attachments.messageOnlyFiles");
  if (!body) return t("dm.noMessages");
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

/** Where the messages page's two views live. Presentation only. */
const ARCHIVE_VIEW = "arkiv";

function ConversationList({
  conversations,
  communityId,
  userId,
  locale,
  t,
}: {
  conversations: DirectConversationSummary[];
  communityId: string;
  userId: string;
  locale: Locale;
  t: Translator;
}) {
  return (
    // Not overflow-hidden: each row's "⋯" menu opens below it.
    <Panel>
      <ul className="divide-y divide-line">
        {conversations.map((conversation) => (
          <li
            key={conversation.id}
            className="group flex items-center gap-2 pr-3 transition-colors first:rounded-t-[6px] last:rounded-b-[6px] hover:bg-paper-2/60 focus-within:bg-paper-2/60"
          >
            <Link
              href={`/community/${communityId}/messages/${conversation.id}`}
              className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-4"
            >
              <Avatar user={conversation.otherParticipant} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[0.9375rem] font-medium text-ink">
                    {conversation.otherParticipant.name}
                  </span>
                  {conversation.unread ? <Badge tone="skog">{t("dm.new")}</Badge> : null}
                </p>
                <p className="mt-1 truncate text-[13px] text-ink-2">
                  {conversation.latestMessage?.authorId === userId ? t("dm.you") : ""}
                  {preview(
                    t,
                    conversation.latestMessage?.body,
                    conversation.latestMessage?.hasAttachments,
                    Boolean(conversation.latestMessage?.deleted),
                  )}
                </p>
              </div>
              <div className="hidden shrink-0 items-center gap-2 text-[12px] text-ink-3 sm:flex">
                <span>{timeAgo(conversation.lastMessageAt, locale)}</span>
                <IconArrowRight size={14} />
              </div>
            </Link>
            {conversation.archived ? (
              <RestoreConversationButton
                communityId={communityId}
                conversationId={conversation.id}
                otherName={conversation.otherParticipant.name}
              />
            ) : null}
            <DirectConversationMenu
              communityId={communityId}
              conversationId={conversation.id}
              otherName={conversation.otherParticipant.name}
              archived={conversation.archived}
              // The row's own «Gjenopprett» button is the restore action here.
              restoreInMenu={false}
              className="shrink-0"
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function DirectMessagesPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/messages">) {
  const { communityId } = await params;
  const { feil, vis } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  // A deleted conversation is in neither list until a later message.
  const [inbox, archived] = await Promise.all([
    getDirectConversations(community.id, user.id),
    getDirectConversations(community.id, user.id, { archived: true }),
  ]);
  const showArchive = vis === ARCHIVE_VIEW;
  const base = `/community/${community.id}/messages`;
  const archivedUnread = archived.some((conversation) => conversation.unread);

  const tab = (active: boolean) =>
    cn(
      "-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm transition-colors",
      active ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
    );

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title={t("dm.title")}
        lead={t("dm.lead")}
      />

      {feil === "start" ? (
        <p role="alert" className="mb-4 rounded-[6px] border border-rust-soft bg-rust-soft/40 px-4 py-3 text-[13px] text-rust">
          {t("dm.openFailed")}
        </p>
      ) : null}

      {archived.length > 0 || showArchive ? (
        <nav aria-label={t("dm.title")} className="mb-5 flex gap-5 border-b border-line">
          <Link href={base} aria-current={showArchive ? undefined : "page"} className={tab(!showArchive)}>
            {t("dm.inbox")}
          </Link>
          <Link
            href={`${base}?vis=${ARCHIVE_VIEW}`}
            aria-current={showArchive ? "page" : undefined}
            className={tab(showArchive)}
          >
            {t("dm.archived")}
            <span className="text-[12px] tabular-nums text-ink-3">{archived.length}</span>
            {archivedUnread ? (
              <span className="h-1.5 w-1.5 rounded-full bg-rust" aria-label={t("shell.unread")} />
            ) : null}
          </Link>
        </nav>
      ) : null}

      {showArchive ? (
        <>
          <p className="mb-4 text-[13px] text-ink-3">{t("dm.archivedLead")}</p>
          {archived.length === 0 ? (
            <p className="rounded-[6px] border border-dashed border-line-2 px-4 py-6 text-center text-[13px] text-ink-3">
              {t("dm.archivedEmpty")}
            </p>
          ) : (
            <ConversationList conversations={archived} communityId={community.id} userId={user.id} locale={locale} t={t} />
          )}
        </>
      ) : inbox.length === 0 ? (
        <EmptyState
          title={t("dm.empty.title")}
          body={t("dm.empty.body")}
          action={
            <Link
              href={`/community/${community.id}/members`}
              className="inline-flex items-center gap-2 rounded-[5px] border border-line-2 bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-2"
            >
              <IconMail size={16} />
              {t("dm.findSomeone")}
            </Link>
          }
        />
      ) : (
        <ConversationList conversations={inbox} communityId={community.id} userId={user.id} locale={locale} t={t} />
      )}
    </PageContainer>
  );
}
