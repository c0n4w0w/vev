import Image from "next/image";
import { cn } from "@/components/ui/primitives";

/**
 * The platform mark: the approved TING horizontal lockup (enclosed horn +
 * outlined serif lettering), logo system v2. Spruce on light surfaces, cream on
 * spruce/dark ones. The supplied transparent SVGs carry their own clear space
 * and must not be recoloured, redrawn or sized per part.
 *
 * `size` picks an explicit height (the lockup is 976:264); width follows the
 * aspect ratio. It is announced as "TING".
 */
const sizes = {
  /** Public header and footer lockup. */
  header: "h-9",
  /** App sidebar and mobile top bar. */
  app: "h-7",
  /** "Drevet av" portal footers. */
  footer: "h-6",
} as const;

export function Wordmark({
  className,
  tone = "green",
  size = "header",
}: {
  className?: string;
  tone?: "green" | "cream";
  size?: keyof typeof sizes;
}) {
  return (
    <Image
      src={`/brand/ting-horizontal-${tone === "green" ? "spruce" : "cream"}.svg`}
      alt="TING"
      width={976}
      height={264}
      className={cn(sizes[size], "w-auto select-none", className)}
    />
  );
}
