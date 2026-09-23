"use client";

import Image from "next/image";
import { useState } from "react";
import { CommunityMark, cn, markSizes } from "@/components/ui/primitives";
import type { Community } from "@/lib/types";

/**
 * A community's identity inside the signed-in app: its uploaded profile image
 * when it has one, otherwise the monogram it has always had.
 *
 * The one place that decides between the two, so the sidebar, switcher,
 * overview and lists cannot drift apart. It takes a `Community` rather than
 * the public shape on purpose — the image is not part of what a portal shows,
 * and the public pages keep using `CommunityMark` directly.
 *
 * The image is a square, cropped by `object-fit: cover`, never stretched. If
 * it fails to load — removed, replaced under a stale page, or unreachable — the
 * monogram takes its place instead of a broken image icon.
 */
export function CommunityAvatar({
  community,
  size = "md",
  className,
}: {
  community: Pick<Community, "branding" | "avatarUrl">;
  size?: keyof typeof markSizes;
  className?: string;
}) {
  const url = community.avatarUrl;
  // Remembering *which* URL failed, not that one did, means a new upload gets
  // a fresh chance without any reset logic.
  const [failedUrl, setFailedUrl] = useState<string>();

  if (!url || failedUrl === url) {
    return <CommunityMark community={community} size={size} className={className} />;
  }

  return (
    <span
      className={cn(
        "relative inline-block shrink-0 select-none overflow-hidden border border-line bg-paper-2",
        markSizes[size],
        className,
      )}
      aria-hidden="true"
    >
      <Image
        src={url}
        alt=""
        fill
        unoptimized
        sizes="96px"
        className="object-cover"
        onError={() => setFailedUrl(url)}
        // An image that failed before hydration never fires onError in React.
        ref={(img) => {
          if (img?.complete && img.naturalWidth === 0) setFailedUrl(url);
        }}
      />
    </span>
  );
}
