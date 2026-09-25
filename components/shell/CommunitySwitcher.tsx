"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ElevatedRoleBadge, cn } from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconCheck, IconChevronDown, IconPlus, IconSwitch } from "@/components/ui/icons";
import { Wordmark } from "@/components/shell/Wordmark";
import type { ShellCommunity, ShellData } from "@/components/shell/shell-data";
import { communityLocale } from "@/lib/i18n";
import { PLATFORM_LOCALE } from "@/lib/i18n/locales";
import { useT } from "@/lib/i18n/react";

/**
 * Context switcher at the top of the sidebar. It shows where you are — the
 * platform itself, or one specific community — and lets you move between the
 * communities you belong to. It lists nothing you do not already have access to.
 */
export function CommunitySwitcher({
  data,
  current,
  onNavigate,
}: {
  data: ShellData;
  current?: ShellCommunity;
  onNavigate?: () => void;
}) {
  const t = useT();
  const locale = current ? communityLocale(current.community) : PLATFORM_LOCALE;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex w-full items-center gap-3 rounded-[6px] border px-3 py-2.5 text-left transition-colors",
          open ? "border-line-2 bg-paper-2" : "border-transparent hover:bg-paper-2",
        )}
      >
        {current ? (
          <>
            <CommunityAvatar community={current.community} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-medium leading-tight text-ink">
                {current.community.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-3">
                {current.community.tagline}
              </span>
            </span>
          </>
        ) : (
          <>
            <Wordmark className="flex-1" />
          </>
        )}
        <IconChevronDown
          size={16}
          className={cn("shrink-0 text-ink-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[6px] border border-line-2 bg-surface shadow-[0_12px_32px_-12px_rgba(23,25,26,0.28)]"
        >
          {current ? (
            <Link
              href="/home"
              onClick={close}
              className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <IconSwitch size={16} className="text-ink-3" />
              {t("shell.switcher.backToTing")}
            </Link>
          ) : null}

          <div className="px-3 pb-1.5 pt-3">
            <p className="label">{t("shell.switcher.myCommunities")}</p>
          </div>

          {data.communities.length === 0 ? (
            <p className="px-3 pb-3 text-sm leading-relaxed text-ink-3">
              {t("shell.switcher.none")}
            </p>
          ) : (
            <ul className="pb-1.5">
              {data.communities.map(({ community, membership }) => {
                const active = current?.community.id === community.id;
                return (
                  <li key={community.id}>
                    <Link
                      href={`/community/${community.id}`}
                      onClick={close}
                      className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-paper-2"
                    >
                      <CommunityAvatar community={community} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{community.name}</span>
                      </span>
                      {active ? (
                        <IconCheck size={15} className="shrink-0 text-skog" />
                      ) : (
                        <ElevatedRoleBadge role={membership.role} locale={locale} />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            href="/communities"
            onClick={close}
            className="flex items-center gap-2.5 border-t border-line px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <IconPlus size={16} className="text-ink-3" />
            {t("shell.switcher.join")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
