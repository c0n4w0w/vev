"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/primitives";
import {
  IconCalendar,
  IconCheck,
  IconFeed,
  IconHash,
  IconLock,
  IconOverview,
  IconAttach,
  IconUsers,
} from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";

/**
 * The workspace's own navigation, shown only to people with effective access
 * and a collaboration profile (the layout decides). One row of tabs — it
 * scrolls sideways on a phone rather than wrapping or hiding anything behind
 * a menu, and each tab is a real link.
 *
 * A collaboration is not a community, so this never borrows the community
 * sidebar.
 */
export function WorkspaceNav({ slug, name }: { slug: string; name: string }) {
  const t = useT();
  const pathname = usePathname();
  const base = `/collaboration/${slug}`;

  const items = [
    { href: base, label: t("ws.nav.overview"), icon: IconOverview, exact: true },
    { href: `${base}/channels`, label: t("ws.nav.channels"), icon: IconHash },
    { href: `${base}/tasks`, label: t("ws.nav.tasks"), icon: IconCheck },
    { href: `${base}/docs`, label: t("ws.nav.docs"), icon: IconFeed },
    { href: `${base}/files`, label: t("ws.nav.files"), icon: IconAttach },
    { href: `${base}/events`, label: t("ws.nav.events"), icon: IconCalendar },
    { href: `${base}/participants`, label: t("ws.nav.people"), icon: IconUsers },
  ];

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 pt-4 lg:px-10 lg:pt-5">
        <p className="label mb-1.5 inline-flex items-center gap-1.5">
          <IconLock size={11} />
          {t("ws.privateNote")}
        </p>
        <Link
          href={base}
          className="block truncate font-display text-[1.25rem] leading-snug text-ink hover:text-skog lg:text-[1.375rem]"
        >
          {name}
        </Link>
      </div>
      <nav aria-label={t("ws.nav.label")} className="mx-auto max-w-6xl">
        <ul className="scroll-quiet flex gap-1 overflow-x-auto px-3 lg:px-8">
          {items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-3 text-[13.5px] transition-colors",
                    active
                      ? "border-skog font-medium text-ink"
                      : "border-transparent text-ink-2 hover:text-ink",
                  )}
                >
                  <item.icon size={15} className={active ? "text-skog" : "text-ink-3"} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
