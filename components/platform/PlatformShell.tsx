"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Wordmark } from "@/components/shell/Wordmark";
import {
  IconClose,
  IconCommunities,
  IconFile,
  IconInboxIn,
  IconMenu,
  IconOverview,
  IconShield,
} from "@/components/ui/icons";
import { Badge, cn } from "@/components/ui/primitives";

const NAV = [
  { href: "/platform-admin", label: "Oversikt", icon: IconOverview, exact: true },
  { href: "/platform-admin/fellesskap", label: "Fellesskap", icon: IconCommunities },
  { href: "/platform-admin/foresporsler", label: "Forespørsler", icon: IconInboxIn },
  { href: "/platform-admin/administratorer", label: "Plattformadministratorer", icon: IconShield },
  { href: "/platform-admin/aktivitetslogg", label: "Aktivitetslogg", icon: IconFile },
] as const;

/**
 * The dashboard's frame: TING's own sidebar language, without any community
 * in it. Navigation state lives here; who may see what is decided on the
 * server, page by page.
 */
export function PlatformShell({
  children,
  role,
  name,
  email,
  pendingRequests,
}: {
  children: ReactNode;
  role: "owner" | "operator";
  name: string;
  email: string;
  pendingRequests: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav aria-label="Plattformadministrasjon" className="flex flex-col gap-0.5 px-3">
      {NAV.map((item) => {
        const Icon = item.icon;
        const current = active(item.href, "exact" in item ? item.exact : false);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-[5px] px-3 text-sm transition-colors",
              current ? "bg-skog-soft font-medium text-skog" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
            )}
          >
            <Icon size={18} />
            <span className="flex-1">{item.label}</span>
            {item.href === "/platform-admin/foresporsler" && pendingRequests > 0 ? (
              <span className="rounded-full bg-skog px-1.5 text-[11px] font-semibold leading-5 text-white">
                {pendingRequests}
                <span className="sr-only"> ventende</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const identity = (
    <div className="border-t border-line px-6 py-4">
      <p className="truncate text-sm font-medium text-ink">{name}</p>
      <p className="truncate text-xs text-ink-3">{email}</p>
      <Badge tone={role === "owner" ? "skog" : "fjord"} className="mt-2">
        {role === "owner" ? "Plattformeier" : "Plattformoperatør"}
      </Badge>
      <Link href="/home" className="mt-3 block text-xs text-ink-3 underline underline-offset-2 hover:text-ink">
        Tilbake til TING
      </Link>
    </div>
  );

  return (
    <div className="min-h-dvh bg-paper lg:flex">
      <a
        href="#platform-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Hopp til innholdet
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-6 pb-4 pt-6">
          <Link href="/platform-admin" aria-label="Plattformadministrasjon – oversikt">
            <Wordmark size="app" />
          </Link>
          <p className="label mt-3">Plattformadministrasjon</p>
        </div>
        <div className="flex-1 overflow-y-auto scroll-quiet">{nav}</div>
        {identity}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link href="/platform-admin" aria-label="Plattformadministrasjon – oversikt">
          <Wordmark size="app" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-[5px] text-ink-2 hover:bg-paper-2"
          aria-label="Åpne meny"
          aria-expanded={open}
          aria-controls="platform-mobile-nav"
        >
          <IconMenu />
        </button>
      </header>

      {open ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Meny"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Lukk meny" onClick={() => setOpen(false)} />
          <div id="platform-mobile-nav" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-lg">
            <div className="flex items-center justify-between px-6 pb-4 pt-5">
              <p className="label">Plattformadministrasjon</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[5px] text-ink-2 hover:bg-paper-2"
                aria-label="Lukk meny"
                autoFocus
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {identity}
          </div>
        </div>
      ) : null}

      <main id="platform-main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
