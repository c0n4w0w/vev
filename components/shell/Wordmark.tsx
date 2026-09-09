import { cn } from "@/components/ui/primitives";

/**
 * The platform mark. Kept small and quiet so community branding stays the
 * loudest thing on screen.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-[1.0625rem] font-medium tracking-[-0.01em] text-ink",
        className,
      )}
    >
      TING
    </span>
  );
}
