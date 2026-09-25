"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * A person's uploaded profile photo, round, falling back to their monogram.
 *
 * The same two rules as `CommunityAvatar`, for the same reasons: the square's
 * size, clipping and position are set inline so the image can never be sized
 * against anything but its own box, and a photo that fails to load — removed,
 * replaced under a stale page, not visible to this viewer — gives way to the
 * monogram rather than a broken-image icon. Plain `<img>`, not `next/image`:
 * a private, already-small file behind an authenticated route.
 */
export function AvatarPhoto({
  url,
  px,
  label,
  className,
  fallback,
}: {
  url: string;
  px: number;
  label: string;
  className?: string;
  fallback: ReactNode;
}) {
  // Which URL failed, not whether one did: a new upload gets a fresh chance.
  const [failedUrl, setFailedUrl] = useState<string>();

  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth === 0) setFailedUrl(url);
    },
    [url],
  );

  if (failedUrl === url) return <>{fallback}</>;

  return (
    <span
      className={["shrink-0 select-none rounded-full bg-paper-2", className].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        display: "inline-block",
        overflow: "hidden",
        boxSizing: "border-box",
        width: px,
        height: px,
        borderRadius: "9999px",
      }}
      title={label}
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
