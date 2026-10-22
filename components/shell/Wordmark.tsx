import Image from "next/image";
import { cn } from "@/components/ui/primitives";

/**
 * The platform mark: the approved TING horizontal lockup (enclosed horn +
 * outlined serif lettering), logo system v2. Spruce on light surfaces, cream on
 * spruce/dark ones. The supplied transparent SVGs carry their own clear space
 * and must not be recoloured, redrawn or sized per part.
 *
 * `size` picks an explicit height (the lockup is 976:264, or 936:232 for the
 * trimmed copy); width follows the aspect ratio. It is announced as "TING".
 */
const sizes = {
  /** Public header and footer lockup. */
  header: "h-9",
  /** App sidebar and mobile top bar. */
  app: "h-7",
  /** "Drevet av" portal footers. */
  footer: "h-6",
  /**
   * Public front page header. Uses the trimmed lockup (same artwork, viewBox
   * cropped to the drawn edges), so the emblem fills the full height: 36px on
   * phones, 40px from `sm`.
   */
  landing: "h-9 sm:h-10",
} as const;

/** Sizes that use the trimmed lockup instead of the padded one. */
const trimmed = new Set<keyof typeof sizes>(["landing"]);

export function Wordmark({
  className,
  tone = "green",
  size = "header",
}: {
  className?: string;
  tone?: "green" | "cream";
  size?: keyof typeof sizes;
}) {
  const trim = trimmed.has(size);
  return (
    <Image
      src={`/brand/ting-horizontal-${tone === "green" ? "spruce" : "cream"}${trim ? "-trim" : ""}.svg`}
      alt="TING"
      width={trim ? 936 : 976}
      height={trim ? 232 : 264}
      className={cn(sizes[size], "w-auto select-none", className)}
    />
  );
}
