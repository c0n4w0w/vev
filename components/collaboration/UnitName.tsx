import { cn } from "@/components/ui/primitives";
import type { CollaborationUnit } from "@/lib/types";

/** "Tryggere Ruspolitikk – FTR Oslo", or just the community for a whole-organisation unit. */
export function unitLabel(unit: Pick<CollaborationUnit, "communityName" | "localGroupName">): string {
  return unit.localGroupName ? `${unit.communityName} – ${unit.localGroupName}` : unit.communityName;
}

/**
 * A participating unit by name, with its organisation's public monogram. The
 * monogram and colour are what the organisation's own portal shows anyone;
 * nothing private about the organisation is rendered here.
 */
export function UnitName({
  unit,
  className,
}: {
  unit: Pick<CollaborationUnit, "communityName" | "localGroupName" | "branding">;
  className?: string;
}) {
  const fonts = { serif: "font-display", sans: "font-sans", mono: "font-mono" } as const;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-[4px] text-[8px] font-semibold tracking-[0.04em] text-white",
          fonts[unit.branding.markStyle],
        )}
        style={{ backgroundColor: unit.branding.accent }}
      >
        {unit.branding.monogram}
      </span>
      <span className="min-w-0 truncate">{unitLabel(unit)}</span>
    </span>
  );
}
