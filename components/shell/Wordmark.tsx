import { cn } from "@/components/ui/primitives";

/**
 * The platform mark. A woven square — "vev" is Norwegian for weave — kept small
 * and quiet so community branding stays the loudest thing on screen.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="4" fill="#1f4a3d" />
        <path
          d="M5 6.2h10M5 10h10M5 13.8h10M7.4 4.2v11.6M12.6 4.2v11.6"
          stroke="#f6f4ef"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
      <span className="font-display text-[1.0625rem] tracking-[-0.01em] text-ink">Vev</span>
    </span>
  );
}
