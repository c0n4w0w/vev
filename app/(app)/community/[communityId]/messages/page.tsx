import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar, Badge, EmptyState, PageContainer, PageHeader, Panel } from "@/components/ui/primitives";
import { IconArrowRight, IconMail } from "@/components/ui/icons";
import {
  getCommunityById,
  getDirectConversations,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator, translator, type Translator } from "@/lib/i18n";
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

export default async function DirectMessagesPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/messages">) {
  const { communityId } = await params;
  const { feil } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const conversations = await getDirectConversations(community.id, user.id);

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

      {conversations.length === 0 ? (
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
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-line">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/community/${community.id}/messages/${conversation.id}`}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-2/60"
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
                      {conversation.latestMessage?.authorId === user.id ? t("dm.you") : ""}
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
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageContainer>
  );
}
