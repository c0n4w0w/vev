"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar, cn } from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import {
  IconAttach,
  IconBell,
  IconCalendar,
  IconClose,
  IconCollaboration,
  IconChevronRight,
  IconCommunities,
  IconFeed,
  IconHash,
  IconHome,
  IconLock,
  IconMapPin,
  IconMenu,
  IconMail,
  IconOverview,
  IconPlus,
  IconSettings,
  IconShield,
  IconSmile,
  IconUser,
  IconUsers,
} from "@/components/ui/icons";
import { CommunitySwitcher } from "@/components/shell/CommunitySwitcher";
import { ChannelCreateDialog } from "@/components/community/channels/ChannelCreateDialog";
import { DirectConversationMenu } from "@/components/community/messages/DirectConversationMenu";
import type { ShellCommunity, ShellData } from "@/components/shell/shell-data";
import { communityLocale, type Translator } from "@/lib/i18n";
import { PLATFORM_LOCALE } from "@/lib/i18n/locales";
import { LocaleProvider, useLocale, useT } from "@/lib/i18n/react";
import { Wordmark } from "@/components/shell/Wordmark";

// ── Nav building blocks ─────────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon,
  active,
  badge,
  unread,
  note,
  onNavigate,
  accent,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  active: boolean;
  badge?: number;
  unread?: boolean;
  /** A quiet word after the label, e.g. "Arkivert". Mutes the row. */
  note?: string;
  onNavigate?: () => void;
  accent?: string;
}) {
  const t = useT();
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-sm transition-colors",
        active ? "bg-paper-2 font-medium text-ink" : "text-ink-2 hover:bg-paper-2/70 hover:text-ink",
      )}
    >
      {active ? (
        <span
          className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
          style={{ backgroundColor: accent ?? "var(--color-skog)" }}
        />
      ) : null}
      {icon ? (
        <span className={cn("shrink-0", active ? "text-ink" : "text-ink-3")}>{icon}</span>
      ) : null}
      <span className={cn("min-w-0 flex-1 truncate", note && !active && "text-ink-3")}>{label}</span>
      {note ? <span className="shrink-0 text-[11px] text-ink-3">{note}</span> : null}
      {badge ? (
        <span className="shrink-0 rounded-full bg-rust px-1.5 py-px text-[10px] font-semibold leading-4 text-white">
          {badge}
        </span>
      ) : unread ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-rust" aria-label={t("shell.unread")} />
      ) : null}
    </Link>
  );
}

function DirectConversationNavLink({
  href,
  conversation,
  active,
  onNavigate,
  accent,
}: {
  href: string;
  conversation: ShellCommunity["recentDirectConversations"][number];
  active: boolean;
  onNavigate?: () => void;
  accent?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "group relative flex min-w-0 items-center rounded-[5px] transition-colors",
        active ? "bg-paper-2" : "hover:bg-paper-2/70 focus-within:bg-paper-2/70",
      )}
    >
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-2.5 rounded-[5px] py-[7px] pl-2.5 pr-1 text-sm transition-colors",
          active ? "font-medium text-ink" : "text-ink-2 hover:text-ink",
        )}
      >
        {active ? (
          <span
            className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
            style={{ backgroundColor: accent ?? "var(--color-skog)" }}
          />
        ) : null}
        <Avatar user={conversation.otherParticipant} size="xs" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            conversation.unread && !active && "font-medium text-ink",
          )}
        >
          {conversation.otherParticipant.name}
        </span>
        {conversation.unread && !active ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-rust" aria-label={t("shell.unread")} />
        ) : null}
      </Link>
      <DirectConversationMenu
        communityId={conversation.communityId}
        conversationId={conversation.id}
        otherName={conversation.otherParticipant.name}
        className="mr-0.5 shrink-0"
        triggerClassName="h-6 w-6"
      />
    </div>
  );
}

const platformNav = [
  { href: "/home", label: "shell.platform.home", icon: IconHome },
  { href: "/communities", label: "shell.platform.communities", icon: IconCommunities },
  { href: "/collaborations", label: "shell.platform.collaborations", icon: IconCollaboration },
  { href: "/events", label: "shell.platform.events", icon: IconCalendar },
  { href: "/notifications", label: "shell.platform.notifications", icon: IconBell },
] as const;

/**
 * The community sidebar's primary group: what a member came here to do.
 *
 * Kunngjøringer is deliberately absent. An announcement is a kind of post and
 * appears in the feed alongside everything else, so a second destination
 * listing the same rows was duplication rather than navigation.
 *
 * Lokallag belongs here — a member chooses their own — and appears only where
 * the community actually has local groups, so a community that never adopted
 * them never sees it.
 */
function communityNav(
  id: string,
  localGroups: ShellCommunity["localGroups"],
  hasOrganizationPeople: boolean,
  t: Translator,
) {
  return [
    { href: `/community/${id}`, label: t("shell.nav.overview"), icon: IconOverview, exact: true },
    { href: `/community/${id}/feed`, label: t("shell.nav.feed"), icon: IconFeed },
    { href: `/community/${id}/events`, label: t("shell.nav.events"), icon: IconCalendar },
    {
      href: `/community/${id}/members`,
      label:
        hasOrganizationPeople && id !== "under-the-rug"
          ? t("shell.nav.organization")
          : t("shell.nav.members"),
      icon: IconUsers,
    },
    ...(localGroups.usesLocalGroups
      ? [
          {
            href: `/community/${id}/lokallag`,
            label: t("shell.nav.localGroups"),
            icon: IconMapPin,
          },
        ]
      : []),
  ];
}

/**
 * Administration: configuration rather than participation.
 *
 * Separating these is the point of the split. Previously an emoji manager sat
 * in the same undifferentiated list as the feed, which made it look equally
 * central to being a member here.
 *
 * Emojier is navigation-gated to staff because managing the set is a staff
 * job. That is *all* it is: `community_emojis` still lets any member read the
 * set and only staff change it, unchanged by this. Hiding a link is tidiness —
 * every page and policy behind these refuses the wrong caller anyway.
 */
function communityAdminNav(id: string, managesSubgroups: boolean, t: Translator) {
  return [
    {
      href: `/community/${id}/admin/members`,
      label: t("shell.nav.members"),
      icon: IconUsers,
      adminOnly: true,
    },
    // Private teams: drawn for anyone who may manage at least one — an admin,
    // or an explicit manager whatever their role — and for moderators, who
    // may create one. A moderator still sees only the teams they manage there.
    ...(managesSubgroups
      ? [{ href: `/community/${id}/grupper`, label: t("shell.nav.subgroups"), icon: IconShield }]
      : []),
    // The community's own channels and sections. Administrators only, as
    // create_community_channel() and the rest of 20261028100000 are.
    {
      href: `/community/${id}/kanaler`,
      label: t("shell.nav.channels"),
      icon: IconHash,
      adminOnly: true,
    },
    {
      href: `/community/${id}/organization-links`,
      label: t("shell.nav.accountLinks"),
      icon: IconAttach,
      adminOnly: true,
    },
    {
      href: `/community/${id}/requests`,
      label: t("shell.nav.requests"),
      icon: IconMail,
      adminOnly: true,
    },
    { href: `/community/${id}/emojis`, label: t("shell.nav.emojis"), icon: IconSmile, staffOnly: true },
    // Innstillinger holds the community's profile image (administrator only)
    // and each staff member's own choices. UTR's DM policy is already open, so
    // there its only *control* is the image: a moderator would find an
    // informational panel and nothing to change, and does not get the link.
    // The page itself refuses anyone the database would refuse regardless.
    {
      href: `/community/${id}/settings`,
      label: t("shell.nav.settings"),
      icon: IconSettings,
      staffOnly: true,
      adminOnly: id === "under-the-rug",
    },
  ];
}

// ── Channels ────────────────────────────────────────────────────────────

/**
 * The community's channels in the sidebar, drawn from what the database
 * returned for this viewer and assuming nothing: no channel, section or name
 * has to exist.
 *
 * Order: the community's own channels in no section (no heading), its
 * sections, a disclosure for its archived channels, then the platform
 * headings (Mitt lokallag, Mine grupper). An administrator also gets "+"
 * beside the heading, the empty state's "Opprett kanal", and the community's
 * empty sections with a way to add a channel to each. All of that is
 * presentation; `create_community_channel()` decides.
 */
function ChannelList({
  current,
  pathname,
  onNavigate,
  accent,
}: {
  current: ShellCommunity;
  pathname: string;
  onNavigate?: () => void;
  accent?: string;
}) {
  const t = useT();
  const [create, setCreate] = useState<{ sectionId?: string } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const communityId = current.community.id;
  const admin = current.managesChannels;

  const unsectioned = current.channelGroups.filter((entry) => entry.group.kind === "unsectioned");
  const system = current.channelGroups.filter((entry) => entry.group.kind === "system");
  // Administrators see every section, empty ones too, so a new section is
  // somewhere to put a channel. Members see the sections that have channels.
  const filled = new Map(
    current.channelGroups.filter((entry) => entry.group.kind === "section").map((entry) => [entry.group.id, entry]),
  );
  const sections = admin
    ? current.channelSections.map(
        (section) =>
          filled.get(section.id) ?? {
            group: { id: section.id, label: section.name, kind: "section" as const },
            channels: [],
          },
      )
    : [...filled.values()];

  const archived = current.archivedChannels;
  const showArchived = archivedOpen || archived.some((channel) => pathname.endsWith(`/channel/${channel.id}`));
  // No channel of the community's own, active or archived. Lokallag and
  // group chats below are the lokallag's and the group's, not the community's.
  const noCommunityChannels = !current.hasCommunityChannels && archived.length === 0;

  function renderGroup({ group, channels }: ShellCommunity["channelGroups"][number]) {
    return (
      <div key={group.id || "unsectioned"} className="mt-3 first:mt-0">
        {group.kind !== "unsectioned" ? (
          <p className="mb-1 px-2.5 text-[11px] text-ink-3">{group.label}</p>
        ) : null}
        <ul className="space-y-px">
          {channels.map((channel, index) => {
            const channelHref = `/community/${communityId}/channel/${channel.id}`;
            // A lokallag's block ends where the next channel belongs
            // to another lokallag: that is where its "+ Ny privat
            // kanal" goes, under the private channels it already has.
            const lastOfLocalGroup =
              channel.localGroupId !== undefined &&
              channels[index + 1]?.localGroupId !== channel.localGroupId;
            const mainChannel = lastOfLocalGroup
              ? channels.find((c) => c.localGroupId === channel.localGroupId && !c.isPrivate)
              : undefined;
            // Drawn for the viewer's own lokallag, and for the one
            // they have open — an admin with seven lokallag does not
            // get seven of them. The channel's own header offers the
            // same action everywhere it is allowed.
            const offerCreate =
              mainChannel !== undefined &&
              current.privateChannelLocalGroupIds.includes(channel.localGroupId!) &&
              (channel.localGroupId === current.membership.localGroupId ||
                channels.some(
                  (c) =>
                    c.localGroupId === channel.localGroupId &&
                    pathname.endsWith(`/channel/${c.id}`),
                ));

            return (
              <li key={channel.id}>
                {/* Private channels sit a step in from their lokallag's
                    own chat, with a lock where the others have a hash. */}
                <div className={cn(channel.isPrivate && "pl-4")}>
                  <NavLink
                    href={channelHref}
                    label={channel.name}
                    icon={
                      channel.isPrivate ? (
                        <>
                          <IconLock size={14} />
                          <span className="sr-only">{t("shell.nav.privateChannel")}</span>
                        </>
                      ) : (
                        <IconHash size={15} />
                      )
                    }
                    note={channel.archived ? t("shell.nav.archivedChannel") : undefined}
                    accent={accent}
                    active={pathname.endsWith(`/channel/${channel.id}`)}
                    onNavigate={onNavigate}
                  />
                </div>
                {offerCreate && mainChannel ? (
                  <Link
                    href={`/community/${communityId}/channel/${mainChannel.id}?ny=privat`}
                    onClick={onNavigate}
                    className="ml-4 mt-px flex items-center gap-2.5 rounded-[5px] px-2.5 py-[6px] text-[13px] text-ink-3 transition-colors hover:bg-paper-2/70 hover:text-ink"
                  >
                    <IconPlus size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t("shell.nav.newPrivateChannel")}</span>
                  </Link>
                ) : null}
              </li>
            );
          })}
          {admin && group.kind === "section" && channels.length === 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setCreate({ sectionId: group.id })}
                aria-label={t("channels.nav.addToSectionNamed", { name: group.label })}
                className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-[6px] text-left text-[13px] text-ink-3 transition-colors hover:bg-paper-2/70 hover:text-ink"
              >
                <IconPlus size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t("channels.nav.addToSection")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2 pl-2.5 pr-1">
        <p className="label">{t("shell.nav.channels")}</p>
        {admin ? (
          <button
            type="button"
            onClick={() => setCreate({})}
            aria-label={t("channels.nav.create")}
            title={t("channels.nav.create")}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <IconPlus size={14} />
          </button>
        ) : null}
      </div>

      {admin && !current.hasCommunityChannels ? (
        <div className="mb-3 rounded-[6px] border border-dashed border-line-2 px-3 py-3">
          <p className="text-[13px] font-medium text-ink">{t("channels.nav.emptyTitle")}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{t("channels.nav.emptyAdmin")}</p>
          <button
            type="button"
            onClick={() => setCreate({})}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: accent ?? "var(--color-skog)" }}
          >
            <IconPlus size={14} />
            {t("channels.nav.create")}
          </button>
        </div>
      ) : null}

      {!admin && noCommunityChannels ? (
        <p className="px-2.5 text-[13px] leading-relaxed text-ink-3">{t("channels.nav.emptyMember")}</p>
      ) : null}

      {[...unsectioned, ...sections].map(renderGroup)}

      {archived.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={showArchived}
            aria-controls={`archived-channels-${communityId}`}
            className="flex w-full items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-left text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            <IconChevronRight size={12} className={cn("shrink-0 transition-transform", showArchived && "rotate-90")} />
            {t("channels.nav.archived", { count: archived.length })}
          </button>
          {showArchived ? (
            <ul id={`archived-channels-${communityId}`} className="mt-1 space-y-px">
              {archived.map((channel) => (
                <li key={channel.id}>
                  <NavLink
                    href={`/community/${communityId}/channel/${channel.id}`}
                    label={channel.name}
                    icon={<IconHash size={15} />}
                    note={t("shell.nav.archivedChannel")}
                    accent={accent}
                    active={pathname.endsWith(`/channel/${channel.id}`)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {system.length > 0 ? <div className="mt-3">{system.map(renderGroup)}</div> : null}

      {admin ? (
        <ChannelCreateDialog
          communityId={communityId}
          communityName={current.community.name}
          sections={current.channelSections}
          defaultSectionId={create?.sectionId}
          accent={accent ?? "var(--color-skog)"}
          open={create !== null}
          onClose={() => setCreate(null)}
        />
      ) : null}
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────

function SidebarContent({
  data,
  current,
  pathname,
  onNavigate,
  inDrawer = false,
}: {
  data: ShellData;
  current?: ShellCommunity;
  pathname: string;
  onNavigate?: () => void;
  /** Leaves room for the drawer's close button next to the switcher. */
  inDrawer?: boolean;
}) {
  const t = useT();
  const accent = current?.community.branding.accent;
  const activeDirectConversation = current?.recentDirectConversations.find(
    (conversation) =>
      pathname === `/community/${current.community.id}/messages/${conversation.id}`,
  );
  const unreadDirectCountOutsideActive =
    (current?.unreadDirectCount ?? 0) - (activeDirectConversation?.unread ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("border-b border-line px-3 py-3", inDrawer && "pr-12")}>
        <CommunitySwitcher data={data} current={current} onNavigate={onNavigate} />
      </div>

      <nav className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {current ? (
          <>
            <p className="label mb-2 px-2.5">{t("shell.nav.main")}</p>
            <ul className="space-y-px">
              {communityNav(
                current.community.id,
                current.localGroups,
                current.hasOrganizationPeople,
                t,
              ).map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={<item.icon size={17} />}
                    accent={accent}
                    active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-6">
              <p className="label mb-2 px-2.5">{t("shell.nav.messages")}</p>
              <ul className="space-y-px">
                <li>
                  <NavLink
                    href={`/community/${current.community.id}/messages`}
                    label={t("shell.nav.allMessages")}
                    icon={<IconMail size={17} />}
                    accent={accent}
                    active={pathname === `/community/${current.community.id}/messages`}
                    unread={unreadDirectCountOutsideActive > 0}
                    onNavigate={onNavigate}
                  />
                </li>
                {current.recentDirectConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <DirectConversationNavLink
                      href={`/community/${current.community.id}/messages/${conversation.id}`}
                      conversation={conversation}
                      accent={accent}
                      active={
                        pathname ===
                        `/community/${current.community.id}/messages/${conversation.id}`
                      }
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {(() => {
              // Filtering happens before the heading is drawn, so a member who
              // administers nothing does not get an empty "Administrasjon".
              const adminItems = communityAdminNav(current.community.id, current.managesSubgroups, t)
                .filter((item) => !item.adminOnly || current.membership.role === "admin")
                .filter(
                  (item) =>
                    !item.staffOnly ||
                    current.membership.role === "admin" ||
                    current.membership.role === "moderator",
                );
              if (adminItems.length === 0) return null;

              return (
                <div className="mt-6">
                  <p className="label mb-2 px-2.5">{t("shell.nav.administration")}</p>
                  <ul className="space-y-px">
                    {adminItems.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          href={item.href}
                          label={item.label}
                          icon={<item.icon size={17} />}
                          accent={accent}
                          active={pathname.startsWith(item.href)}
                          onNavigate={onNavigate}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <ChannelList
              current={current}
              pathname={pathname}
              onNavigate={onNavigate}
              accent={accent}
            />
          </>
        ) : (
          <>
            <ul className="space-y-px">
              {platformNav.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={t(item.label)}
                    icon={<item.icon size={17} />}
                    active={
                      item.href === "/collaborations"
                        ? pathname.startsWith("/collaboration")
                        : pathname === item.href
                    }
                    badge={item.href === "/notifications" ? data.unreadCount : undefined}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-7">
              <p className="label mb-2 px-2.5">{t("shell.platform.communities")}</p>
              {data.communities.length === 0 ? (
                <p className="px-2.5 text-[13px] leading-relaxed text-ink-3">
                  {t("shell.platform.noneYet")}
                </p>
              ) : (
                <ul className="space-y-px">
                  {data.communities.map(({ community }) => (
                    <li key={community.id}>
                      <Link
                        href={`/community/${community.id}`}
                        onClick={onNavigate}
                        className="flex items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-sm text-ink-2 transition-colors hover:bg-paper-2/70 hover:text-ink"
                      >
                        <CommunityAvatar community={community} size="xs" />
                        <span className="min-w-0 flex-1 truncate">{community.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </>
        )}
      </nav>

      <div className="border-t border-line p-3">
        {/* Inside a community, you are shown as that community sees you, and
            the link edits that profile. Outside one, it is the account. */}
        {current ? (
          <Link
            href={`/community/${current.community.id}/profile/edit`}
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[5px] px-2 py-2 transition-colors hover:bg-paper-2"
          >
            <Avatar user={current.me} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{current.me.name}</span>
              <span className="block truncate text-xs text-ink-3">{t("shell.yourProfile")}</span>
            </span>
          </Link>
        ) : (
          <Link
            href="/profile"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[5px] px-2 py-2 transition-colors hover:bg-paper-2"
          >
            <Avatar user={data.user} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{data.user.name}</span>
              <span className="block truncate text-xs text-ink-3">@{data.user.handle}</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Mobile bottom navigation ────────────────────────────────────────────

const mobileTabs = [
  { href: "/home", label: "shell.tabs.home", icon: IconHome },
  { href: "/communities", label: "shell.tabs.communities", icon: IconCommunities },
  { href: "/events", label: "shell.tabs.events", icon: IconCalendar },
  { href: "/notifications", label: "shell.tabs.notifications", icon: IconBell },
  { href: "/profile", label: "shell.tabs.profile", icon: IconUser },
] as const;

function MobileTabBar({ data, pathname }: { data: ShellData; pathname: string }) {
  const t = useT();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-sm lg:hidden">
      <ul className="mx-auto flex max-w-lg items-stretch">
        {mobileTabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-skog" : "text-ink-3",
                )}
              >
                <span className="relative">
                  <tab.icon size={21} />
                  {tab.href === "/notifications" && data.unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-rust ring-2 ring-surface" />
                  ) : null}
                </span>
                {t(tab.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────

/**
 * The signed-in frame.
 *
 * Inside a community the whole shell speaks that community's language, and it
 * follows the route — moving from one community to another changes it with no
 * reload — because the current community is read from the path. Everywhere else
 * it uses the platform's. This is the one place a future user preference would
 * be folded in: `resolveLocale({ user, community })`.
 */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
  const current = data.communities.find(({ community }) =>
    pathname.startsWith(`/community/${community.id}`),
  );
  // A collaboration's own pages speak its language, fixed from the community
  // that started it; the hub and everything else speak the platform's.
  const collaboration = data.collaborations.find(
    ({ slug }) =>
      pathname === `/collaboration/${slug}` || pathname.startsWith(`/collaboration/${slug}/`),
  );
  const locale = current
    ? communityLocale(current.community)
    : (collaboration?.defaultLocale ?? PLATFORM_LOCALE);

  return (
    <LocaleProvider locale={locale}>
      <ShellFrame data={data}>{children}</ShellFrame>
    </LocaleProvider>
  );
}

function ShellFrame({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const locale = useLocale();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPath, setDrawerPath] = useState(pathname);

  // Close the mobile drawer whenever the route changes, including on back and
  // forward navigation. Adjusting state during render avoids an extra pass.
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const current = data.communities.find(({ community }) =>
    pathname.startsWith(`/community/${community.id}`),
  );

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div
      lang={locale}
      className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]"
      style={
        current
          ? ({
              "--community-accent": current.community.branding.accent,
              "--community-accent-soft": current.community.branding.accentSoft,
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:block lg:h-dvh">
        <SidebarContent data={data} current={current} pathname={pathname} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="-ml-1.5 rounded-[5px] p-1.5 text-ink-2 transition-colors hover:bg-paper-2"
          aria-label={t("shell.openMenu")}
        >
          <IconMenu size={21} />
        </button>
        {current ? (
          <span className="flex min-w-0 items-center gap-2">
            <CommunityAvatar community={current.community} size="xs" />
            <span className="truncate text-sm font-medium text-ink">
              {current.community.name}
            </span>
          </span>
        ) : (
          <Wordmark size="app" />
        )}
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t("shell.closeMenu")}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[86vw] border-r border-line bg-surface shadow-[0_0_40px_rgba(23,25,26,0.18)]">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-3.5 z-10 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              aria-label={t("shell.closeMenu")}
            >
              <IconClose size={18} />
            </button>
            <SidebarContent
              data={data}
              current={current}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
              inDrawer
            />
          </div>
        </div>
      ) : null}

      <div className="min-w-0 pb-[4.75rem] lg:pb-0">{children}</div>

      <MobileTabBar data={data} pathname={pathname} />
    </div>
  );
}
