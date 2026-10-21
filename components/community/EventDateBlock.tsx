import { cn } from "@/components/ui/primitives";
import { formatDateParts } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

/** The date block that anchors every event card. */
export function EventDateBlock({
  iso,
  accent,
  locale,
  compact = false,
}: {
  iso: string;
  accent: string;
  locale: Locale;
  compact?: boolean;
}) {
  const { day, month } = formatDateParts(iso, locale);
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-[6px] border",
        compact ? "h-11 w-11" : "h-14 w-14",
      )}
      style={{ borderColor: `${accent}33`, backgroundColor: `${accent}0f` }}
    >
      <span
        className={cn("font-display leading-none text-ink", compact ? "text-base" : "text-xl")}
      >
        {day}
      </span>
      <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {month}
      </span>
    </div>
  );
}
