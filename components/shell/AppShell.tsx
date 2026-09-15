"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar, CommunityMark, RoleBadge, cn } from "@/components/ui/primitives";
import {
  IconBell,
  IconCalendar,
  IconClose,
  IconCommunities,
  IconFeed,
  IconHash,
  IconHome,
  IconLock,
  IconMegaphone,
  IconMenu,
  IconMail,
  IconOverview,
  IconSettings,
  IconSmile,
  IconUser,
  IconUsers,
} from "@/components/ui/icons";
import { CommunitySwitcher } from "@/components/shell/CommunitySwitcher";
import type { ShellCommunity, ShellData } from "@/components/shell/shell-data";

// ── Nav building blocks ─────────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon,
  active,
  badge,
  onNavigate,
  accent,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
  accent?: string;
}) {
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 rounded-full bg-rust px-1.5 py-px text-[10px] font-semibold leading-4 text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

const platformNav = [
  { href: "/home", label: "Hjem", icon: IconHome },
  { href: "/communities", label: "Mine fellesskap", icon: IconCommunities },
  { href: "/events", label: "Arrangementer", icon: IconCalendar },
  { href: "/notifications", label: "Varsler", icon: IconBell },
];

function communityNav(id: string) {
  return [
    { href: `/community/${id}`, label: "Oversikt", icon: IconOverview, exact: true },
    { href: `/community/${id}/feed`, label: "Feed", icon: IconFeed },
    { href: `/community/${id}/announcements`, label: "Kunngjøringer", icon: IconMegaphone },
    { href: `/community/${id}/events`, label: "Arrangementer", icon: IconCalendar },
    { href: `/community/${id}/members`, label: "Medlemmer", icon: IconUsers },
    { href: `/community/${id}/requests`, label: "Forespørsler", icon: IconMail, adminOnly: true },
    { href: `/community/${id}/emojis`, label: "Emojier", icon: IconSmile },
    {
      href: `/community/${id}/settings`,
      label: "Innstillinger",
      icon: IconSettings,
      staffOnly: true,
    },
  ];
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
  const accent = current?.community.branding.accent;

  return (
    <div className="flex h-full flex-col">
      <div className={cn("border-b border-line px-3 py-3", inDrawer && "pr-12")}>
        <CommunitySwitcher data={data} current={current} onNavigate={onNavigate} />
      </div>

      <nav className="scroll-quiet flex-1 overflow-y-auto px-3 py-4">
        {current ? (
          <>
            <div className="mb-4 flex items-center gap-2 px-2.5">
              <RoleBadge role={current.membership.role} />
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                <IconLock size={12} />
                Lukket
              </span>
            </div>

            <ul className="space-y-px">
              {communityNav(current.community.id)
                // Both of these are tidiness only — the pages and the
                // database refuse anyone else regardless of what is rendered.
                // The queue is an administrator's tool; the settings page
                // holds a choice that only staff have to make.
                .filter((item) => !item.adminOnly || current.membership.role === "admin")
                .filter(
                  (item) =>
                    !item.staffOnly ||
                    current.membership.role === "admin" ||
                    current.membership.role === "moderator",
                )
                .map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={<item.icon size={17} />}
                    accent={accent}
                    active={
                      item.exact ? pathname === item.href : pathname.startsWith(item.href)
                    }
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>

            {current.channelGroups.map(({ group, channels }) => (
              <div key={group.id} className="mt-6">
                <p className="label mb-2 px-2.5">{group.label}</p>
                <ul className="space-y-px">
                  {channels.map((channel) => (
                    <li key={channel.id}>
                      <NavLink
                        href={`/community/${current.community.id}/channel/${channel.id}`}
                        label={channel.name}
                        icon={<IconHash size={15} />}
                        accent={accent}
                        active={pathname.endsWith(`/channel/${channel.id}`)}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <>
            <ul className="space-y-px">
              {platformNav.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={<item.icon size={17} />}
                    active={pathname === item.href}
                    badge={item.href === "/notifications" ? data.unreadCount : undefined}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-7">
              <p className="label mb-2 px-2.5">Mine fellesskap</p>
              {data.communities.length === 0 ? (
                <p className="px-2.5 text-[13px] leading-relaxed text-ink-3">
                  Ingen ennå. Fellesskap på TING finner du gjennom en invitasjon eller en
                  direktelenke.
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
                        <CommunityMark community={community} size="xs" />
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
      </div>
    </div>
  );
}

// ── Mobile bottom navigation ────────────────────────────────────────────

const mobileTabs = [
  { href: "/home", label: "Hjem", icon: IconHome },
  { href: "/communities", label: "Fellesskap", icon: IconCommunities },
  { href: "/events", label: "Program", icon: IconCalendar },
  { href: "/notifications", label: "Varsler", icon: IconBell },
  { href: "/profile", label: "Profil", icon: IconUser },
];

function MobileTabBar({ data, pathname }: { data: ShellData; pathname: string }) {
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
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
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
          aria-label="Åpne meny"
        >
          <IconMenu size={21} />
        </button>
        {current ? (
          <span className="flex min-w-0 items-center gap-2">
            <CommunityMark community={current.community} size="xs" />
            <span className="truncate text-sm font-medium text-ink">
              {current.community.name}
            </span>
          </span>
        ) : (
          <span className="font-display text-base text-ink">TING</span>
        )}
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Lukk meny"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[86vw] border-r border-line bg-surface shadow-[0_0_40px_rgba(23,25,26,0.18)]">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-3.5 z-10 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              aria-label="Lukk meny"
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
