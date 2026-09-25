"use client";

import { useCallback, useState } from "react";
import { CommunityMark, cn, markPixels, markSizes } from "@/components/ui/primitives";
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
 * The invariant: an uploaded image can never affect layout outside its square.
 * The square's size, position context and clipping are set inline on the
 * wrapper, and the image carries its own pixel `width`/`height`, so none of it
 * waits on the stylesheet. That matters because the image is absolutely
 * positioned at 100% of its nearest positioned ancestor: if that ancestor's
 * `position: relative` came from a class that was not (yet) in effect, the
 * image would be sized against the viewport instead — with the stylesheet
 * disabled, the avatar became 751×714 and painted over the whole page. Now the
 * worst case is a missing or plain-sized square, never a full-screen image.
 *
 * It is a plain `<img>` rather than `next/image`: the file is a private,
 * already-small asset behind an authenticated route, there is nothing for an
 * optimiser to do, and `next/image` re-assigns `src` on mount whenever an
 * `onError` handler is present, restarting the request on every remount.
 *
 * The image is cropped by `object-fit: cover`, never stretched. If it fails to
 * load — removed, replaced under a stale page, or unreachable — the monogram
 * takes exactly the same square instead of a broken-image icon.
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

  // An image that failed before hydration never fires React's onError, so a
  // broken one is also caught when it is attached. Stable per URL, so it does
  // not re-run on every render.
  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth === 0) setFailedUrl(url);
    },
    [url],
  );

  if (!url || failedUrl === url) {
    return <CommunityMark community={community} size={size} className={className} />;
  }

  const px = markPixels[size];

  return (
    <span
      className={cn(
        "shrink-0 select-none border border-line bg-paper-2",
        markSizes[size],
        className,
      )}
      style={{
        position: "relative",
        display: "inline-block",
        overflow: "hidden",
        boxSizing: "border-box",
        width: px,
        height: px,
      }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see the note above */}
      <img
        ref={attach}
        src={url}
        alt=""
        width={px}
        height={px}
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(url)}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          maxWidth: "none",
          objectFit: "cover",
        }}
      />
    </span>
  );
}
