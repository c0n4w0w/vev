import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  CommunityMark,
  EmptyState,
  Panel,
  PageContainer,
  PageHeader,
  cn,
} from "@/components/ui/primitives";
import {
  IconBell,
  IconCalendar,
  IconMail,
  IconMegaphone,
  IconUsers,
} from "@/components/ui/icons";
import { getCommunityById, getNotifications, getUnreadCount } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { NotificationKind } from "@/lib/types";

export const metadata: Metadata = { title: "Varsler" };

const kindMeta: Record<NotificationKind, { icon: typeof IconBell; label: string }> = {
  mention: { icon: IconBell, label: "Nevnt" },
  announcement: { icon: IconMegaphone, label: "Kunngjøring" },
  event: { icon: IconCalendar, label: "Arrangement" },
  invitation: { icon: IconMail, label: "Invitasjon" },
  membership: { icon: IconUsers, label: "Medlemskap" },
};

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

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
        eyebrow="Varsler"
        title="Varsler"
        lead={
          unread > 0
            ? `${unread} uleste. Varsler samles på tvers av fellesskapene dine.`
            : "Alt er lest. Varsler samles på tvers av fellesskapene dine."
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="Ingen varsler"
          body="Du får beskjed her når noen nevner deg, når et fellesskap publiserer en kunngjøring, eller når et arrangement du er påmeldt nærmer seg."
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
              <Link
                key={notification.id}
                href={notification.href}
                className={cn(
                  "flex gap-4 px-5 py-4 transition-colors hover:bg-paper-2/60",
                  !notification.read && "bg-skog-soft/30",
                )}
              >
                <span className="relative mt-0.5 shrink-0">
                  {community ? (
                    <CommunityMark community={community} size="sm" />
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-paper-2 text-ink-2">
                      <Icon size={16} />
                    </span>
                  )}
                  {!notification.read ? (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rust ring-2 ring-surface" />
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
                      {meta.label}
                    </Badge>
                    <span className="text-[11px] text-ink-3">{timeAgo(notification.createdAt)}</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </PageContainer>
  );
}
