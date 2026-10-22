import { RoleBadge, cn } from "@/components/ui/primitives";
import { IconCheck, IconHash, IconLock, IconPlus } from "@/components/ui/icons";
import type { RoleId } from "@/lib/types";

/**
 * The organisation managing its own community: members and roles, a pending
 * membership request, and which rooms exist. Layered on large screens,
 * stacked on small ones.
 */

const members: { name: string; initials: string; role: RoleId; tint: string }[] = [
  { name: "Ingrid Holm", initials: "IH", role: "admin", tint: "bg-[#e4def0] text-[#5d4f86]" },
  { name: "Jonas Aas", initials: "JA", role: "moderator", tint: "bg-[#d8e6ee] text-[#2f5a73]" },
  { name: "Sara Lie", initials: "SL", role: "member", tint: "bg-[#f7dcc8] text-[#8a4c33]" },
  { name: "Ola Berg", initials: "OB", role: "member", tint: "bg-[#dbe8dc] text-[#28503f]" },
];

const card = "rounded-[14px] border border-line bg-surface shadow-[0_18px_40px_-24px_rgb(23_58_48/0.45)]";

export function ControlMockup() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-x-4 -inset-y-6 rounded-[44%_56%_48%_52%/52%_44%_56%_48%] bg-lavender sm:-inset-x-8"
      />
      <div data-reveal-stagger="" className="relative grid gap-4 lg:block lg:min-h-[500px]">
        {/* Members and roles */}
        <div className={cn(card, "l-lift p-4 sm:p-5 lg:absolute lg:left-0 lg:top-24 lg:w-[66%]")}>
          <p className="font-display text-lg text-ink">Medlemmer</p>
          <ul className="mt-3 divide-y divide-line">
            {members.map((m) => (
              <li key={m.name} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", m.tint)}
                >
                  {m.initials}
                </span>
                <span className="min-w-0 truncate text-sm text-ink">{m.name}</span>
                <RoleBadge role={m.role} className="ml-auto shrink-0" />
              </li>
            ))}
          </ul>
          <span className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[5px] bg-skog px-3 text-sm font-medium text-white">
            <IconPlus size={14} /> Inviter
          </span>
        </div>

        {/* A membership request waiting for approval */}
        <div className={cn(card, "l-lift p-4 lg:absolute lg:right-0 lg:top-0 lg:w-[52%]")}>
          <p className="label">Medlemsforespørsel</p>
          <div className="mt-3 flex items-center gap-2.5">
            <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eae7df] text-[11px] font-semibold text-[#6b5a3e]">
              MB
            </span>
            <span className="text-sm text-ink">Mina Bakke</span>
          </div>
          <div className="mt-3 flex gap-2">
            <span className="inline-flex h-8 flex-1 items-center justify-center rounded-[5px] border border-line-2 text-sm text-ink">
              Avslå
            </span>
            <span className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-[5px] bg-skog text-sm font-medium text-white">
              <IconCheck size={14} /> Godkjenn
            </span>
          </div>
        </div>

        {/* Rooms the organisation decides on */}
        <div className={cn(card, "l-lift p-4 lg:absolute lg:bottom-0 lg:right-0 lg:w-[52%]")}>
          <p className="label">Kanaler</p>
          <ul className="mt-2.5 space-y-1 text-sm">
            <li className="flex items-center gap-2 text-ink-2">
              <IconHash size={14} className="text-ink-3" /> generelt
            </li>
            <li className="flex items-center gap-2 text-ink-2">
              <IconHash size={14} className="text-ink-3" /> arrangementer
            </li>
            <li className="flex items-center gap-2 text-ink">
              <IconLock size={14} className="text-ink-3" /> styret
              <span className="ml-auto rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Privat</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
