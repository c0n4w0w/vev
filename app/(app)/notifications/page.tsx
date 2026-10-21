import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import { translator, type MessageKey } from "@/lib/i18n";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Badge,
  EmptyState,
  Panel,
  PageContainer,
  PageHeader,
  cn,
} from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import {
  IconBell,
  IconCalendar,
  IconMail,
  IconMegaphone,
  IconUsers,
} from "@/components/ui/icons";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { getCommunityById, getNotifications, getUnreadCount } from "@/lib/data";
import { internalHref } from "@/lib/notification-href";
import { timeAgo } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { NotificationKind } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getRequestTranslator())("shell.platform.notifications") };
}

const kindMeta: Record<NotificationKind, { icon: typeof IconBell; label: MessageKey }> = {
  mention: { icon: IconBell, label: "platform.notifications.mention" },
  announcement: { icon: IconMegaphone, label: "platform.notifications.announcement" },
  event: { icon: IconCalendar, label: "platform.notifications.event" },
  invitation: { icon: IconMail, label: "platform.notifications.invitation" },
  membership: { icon: IconUsers, label: "platform.notifications.membership" },
  direct_message: { icon: IconMail, label: "platform.notifications.direct_message" },
};

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const locale = await getRequestLocale();
  const t = translator(locale);
  const [notifications, unread] = await Promise.all([
    getNotifications(user.id),
    getUnreadCount(user.id),
  ]);

  // Resolve the community for each notification up front; JSX cannot await.
  const communityIds = [
    ...new Set(notifications.map((n) => n.communityId).filter(Boolean as unknown as (v: string | undefined) => v is string)),
  ];
  const communities = new Map(
    (await Promise.all(communityIds.map((id) => getCommunityById(id))))
      .filter((c) => Boolean(c))
      .map((c) => [c!.id, c!]),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("shell.platform.notifications")}
        title={t("shell.platform.notifications")}
        lead={
          unread > 0
            ? t("platform.notifications.unreadLead", { count: unread })
            : t("platform.notifications.readLead")
        }
        action={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      {notifications.length === 0 ? (
        <EmptyState
          title={t("platform.notifications.empty")}
          body={t("platform.notifications.emptyBody")}
        />
      ) : (
        <Panel className="divide-y divide-line">
          {notifications.map((notification) => {
            const meta = kindMeta[notification.kind];
            const community = notification.communityId
              ? communities.get(notification.communityId)
              : undefined;
            const Icon = meta.icon;

            return (
              <NotificationRow
                key={notification.id}
                id={notification.id}
                href={internalHref(notification.href)}
                read={notification.read}
                className={cn(
                  "flex gap-4 px-5 py-4 transition-colors hover:bg-paper-2/60",
                  !notification.read && "bg-skog-soft/30",
                )}
              >
                <span className="relative mt-0.5 shrink-0">
                  {community ? (
                    <CommunityAvatar community={community} size="sm" />
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-paper-2 text-ink-2">
                      <Icon size={16} />
                    </span>
                  )}
                  {!notification.read ? (
                    <>
                      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rust ring-2 ring-surface" />
                      <span className="sr-only">{t("shell.unread")}</span>
                    </>
                  ) : null}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-[0.9375rem] leading-snug",
                        notification.read ? "text-ink-2" : "font-medium text-ink",
                      )}
                    >
                      {notification.title}
                    </span>
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-ink-2">
                    {notification.body}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="outline">
                      <Icon size={11} />
                      {t(meta.label)}
                    </Badge>
                    <span className="text-[11px] text-ink-3">{timeAgo(notification.createdAt, locale)}</span>
                  </span>
                </span>
              </NotificationRow>
            );
          })}
        </Panel>
      )}
    </PageContainer>
  );
}
