import type { ReactNode } from "react";
import { Badge, cn } from "@/components/ui/primitives";
import {
  IconCalendar,
  IconClock,
  IconFeed,
  IconHash,
  IconLock,
  IconMapPin,
  IconMegaphone,
  IconMessage,
  IconPin,
  IconPoll,
  IconSend,
  IconUsers,
} from "@/components/ui/icons";
import { communities } from "./art";

/**
 * Static previews of what a community actually does in TING: channel
 * conversations with reactions and polls, events with sign-up, announcements,
 * and the community's own spaces. Everything shown here exists in the app;
 * the people and communities are invented.
 */

const tints = {
  lavender: "bg-[#e4def0] text-[#5d4f86]",
  sky: "bg-[#d8e6ee] text-[#2f5a73]",
  peach: "bg-[#f7dcc8] text-[#8a4c33]",
  sage: "bg-[#dbe8dc] text-[#28503f]",
} as const;

function Mono({ initials, tint, size = "md" }: { initials: string; tint: keyof typeof tints; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide",
        size === "md" ? "h-9 w-9 text-[11px]" : "h-7 w-7 text-[10px]",
        tints[tint],
      )}
    >
      {initials}
    </span>
  );
}

function Reaction({ emoji, count, mine }: { emoji: string; count: number; mine?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        mine ? "border-[#cfdfd5] bg-skog-soft text-skog" : "border-line bg-surface text-ink-2",
      )}
    >
      <span aria-hidden="true">{emoji}</span>
      {count}
    </span>
  );
}

/** The coloured frame each preview sits in, with a small caption chip. */
function Frame({
  tone,
  icon,
  label,
  className,
  children,
}: {
  tone: "lavender" | "peach" | "sky" | "sage";
  icon: ReactNode;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const bg = {
    lavender: "bg-lavender",
    peach: "bg-peach",
    sky: "bg-sky",
    sage: "bg-sage",
  }[tone];
  return (
    <figure className={cn("l-lift flex flex-col rounded-[28px] p-4 sm:p-6", bg, className)}>
      <figcaption className="mb-4 inline-flex items-center gap-2 self-start rounded-full bg-white/70 px-3 py-1 text-[13px] font-medium text-ink">
        {icon}
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

function Conversation() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_12px_30px_-20px_rgb(23_58_48/0.4)]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] font-display text-[10px] font-semibold text-white"
          style={{ backgroundColor: communities.kor.color }}
        >
          {communities.kor.mono}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            <IconHash size={13} className="mr-0.5 inline-block align-[-2px] text-ink-3" />
            øvelser
          </p>
          <p className="truncate text-[11px] text-ink-3">{communities.kor.name}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-3">
          <IconUsers size={13} /> 42
        </span>
      </div>

      <ul className="flex-1 space-y-4 px-4 py-4">
        <li className="flex gap-3">
          <Mono initials="IH" tint="lavender" />
          <div className="min-w-0">
            <p className="text-sm">
              <span className="font-medium text-ink">Ingrid Holm</span>{" "}
              <span className="text-xs text-ink-3">18:02</span>
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-2">
              Notene til sommerkonserten ligger i kanalen. Øv særlig på andre vers!
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Reaction emoji="🎶" count={7} mine />
              <Reaction emoji="🙏" count={3} />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Mono initials="JA" tint="sky" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium text-ink">Jonas Aas</span>{" "}
              <span className="text-xs text-ink-3">18:10</span>
            </p>
            <div className="mt-2 rounded-[10px] border border-line bg-paper p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
                <IconPoll size={13} /> Avstemning
              </p>
              <p className="mt-1.5 text-sm font-medium text-ink">Hvilken dag passer for ekstraøvelse?</p>
              <div className="mt-2.5 space-y-1.5">
                {[
                  { label: "Tirsdag", pct: 62, chosen: true },
                  { label: "Torsdag", pct: 38 },
                ].map((o) => (
                  <div key={o.label} className="relative overflow-hidden rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[13px]">
                    <span
                      aria-hidden="true"
                      className={cn("absolute inset-y-0 left-0", o.chosen ? "bg-skog-soft" : "bg-paper-2")}
                      style={{ width: `${o.pct}%` }}
                    />
                    <span className="relative flex justify-between gap-2">
                      <span className={o.chosen ? "font-medium text-skog" : "text-ink-2"}>{o.label}</span>
                      <span className="text-ink-3">{o.pct} %</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-3">Anonym avstemning · 21 stemmer</p>
            </div>
          </div>
        </li>
      </ul>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-2 rounded-[8px] border border-line-2 px-3 py-2 text-sm text-ink-3">
          Skriv i #øvelser
          <IconSend size={16} className="ml-auto text-skog" />
        </div>
      </div>
    </div>
  );
}

function EventPreview() {
  return (
    <div className="flex flex-1 gap-4 rounded-[14px] border border-line bg-surface p-4 shadow-[0_12px_30px_-20px_rgb(23_58_48/0.4)] sm:p-5">
      <div className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-[8px] border border-line bg-paper">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-rust">LØR</span>
        <span className="font-display text-2xl leading-none text-ink">14</span>
        <span className="text-[10px] text-ink-3">juni</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg leading-snug text-ink">Sommerkonsert i parken</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-2">
          <IconClock size={14} className="text-ink-3" /> 18:00–20:00
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-2">
          <IconMapPin size={14} className="text-ink-3" /> Paviljongen
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-[5px] bg-skog px-3 text-sm font-medium text-white">
            Meld deg på
          </span>
          <span className="text-xs text-ink-3">18 av 40</span>
        </div>
      </div>
    </div>
  );
}

function AnnouncementPreview() {
  return (
    <div className="flex-1 rounded-[14px] border border-line border-l-2 border-l-skog bg-surface p-4 shadow-[0_12px_30px_-20px_rgb(23_58_48/0.4)] sm:p-5">
      <div className="flex items-center gap-2.5">
        <Mono initials="SL" tint="peach" size="sm" />
        <p className="text-sm">
          <span className="font-medium text-ink">Sara Lie</span>{" "}
          <span className="text-xs text-ink-3">i går</span>
        </p>
        <Badge tone="skog" className="ml-auto">
          <IconPin size={11} /> Kunngjøring
        </Badge>
      </div>
      <p className="mt-3 font-display text-lg leading-snug text-ink">Velkommen til nytt styre!</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">Årsmøtet er over. Her er planene for høsten.</p>
      <div className="mt-3 flex gap-1.5">
        <Reaction emoji="👏" count={24} />
        <Reaction emoji="❤️" count={9} mine />
      </div>
    </div>
  );
}

function SpacesPreview() {
  const channels = [
    { name: "generelt", unread: true },
    { name: "øvelser" },
    { name: "styret", locked: true },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-[0_12px_30px_-20px_rgb(23_58_48/0.4)]">
        <p className="label">Kanaler</p>
        <ul className="mt-3 space-y-1">
          {channels.map((c) => (
            <li
              key={c.name}
              className={cn(
                "flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm",
                c.unread ? "bg-paper-2 font-medium text-ink" : "text-ink-2",
              )}
            >
              {c.locked ? <IconLock size={14} className="text-ink-3" /> : <IconHash size={14} className="text-ink-3" />}
              {c.name}
              {c.locked ? (
                <Badge tone="outline" className="ml-auto">
                  Privat
                </Badge>
              ) : null}
              {c.unread ? <span className="ml-auto h-2 w-2 rounded-full bg-skog" aria-hidden="true" /> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-[0_12px_30px_-20px_rgb(23_58_48/0.4)]">
        <p className="label">Lokallag og grupper</p>
        <ul className="mt-3 space-y-2">
          {[
            { name: "Lokallag Bergen", meta: "31 medlemmer", icon: <IconMapPin size={14} /> },
            { name: "Lokallag Tromsø", meta: "12 medlemmer", icon: <IconMapPin size={14} /> },
            { name: "Sopranene", meta: "Gruppe", icon: <IconUsers size={14} /> },
          ].map((g) => (
            <li key={g.name} className="flex items-center gap-2 text-sm text-ink-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sage text-skog">{g.icon}</span>
              <span className="text-ink">{g.name}</span>
              <span className="ml-auto text-xs text-ink-3">{g.meta}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  return (
    <div data-reveal-stagger="" className="grid gap-4 sm:gap-5 lg:grid-cols-12">
      <Frame
        tone="lavender"
        icon={<IconMessage size={15} />}
        label="Samtaler"
        className="lg:col-span-7 lg:row-span-2"
      >
        <Conversation />
      </Frame>
      <Frame tone="peach" icon={<IconCalendar size={15} />} label="Arrangementer" className="lg:col-span-5">
        <EventPreview />
      </Frame>
      <Frame tone="sky" icon={<IconMegaphone size={15} />} label="Innlegg" className="lg:col-span-5">
        <AnnouncementPreview />
      </Frame>
      <Frame tone="sage" icon={<IconFeed size={15} />} label="Egne rom for fellesskapet" className="lg:col-span-12">
        <SpacesPreview />
      </Frame>
    </div>
  );
}
