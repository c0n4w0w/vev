import type { BadgeTone } from "@/components/ui/primitives";

/**
 * Tone for a private team's access badge, keyed on the subgroup slug (never
 * the display name). Safe-Space frivillige gets its own plum tint; every other
 * team keeps the tone its surface already used.
 */
export function subgroupBadgeTone(slug: string | undefined, fallback: BadgeTone): BadgeTone {
  return slug === "safe-space-frivillige" ? "plum" : fallback;
}
