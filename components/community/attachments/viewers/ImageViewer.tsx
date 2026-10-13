"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/primitives";
import { IconChevronLeft, IconChevronRight, IconZoomIn, IconZoomOut } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * One image at full size, on a dark ground.
 *
 * Fitted to the window to begin with. Zooming — the two buttons, +/− on the
 * keyboard, or a double click or double tap — enlarges the picture itself
 * inside a scrolling area and keeps its middle in view, so it is panned the
 * way anything else is scrolled, by mouse, trackpad or finger. A sideways
 * swipe moves to the neighbouring image while it is not zoomed.
 *
 * The small rendition the message list already has is shown immediately and
 * the original is drawn over it when it arrives.
 */
export function ImageViewer({
  attachment,
  onPrevious,
  onNext,
}: {
  attachment: MessageAttachment;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  // The picture's size when it just fits the area; zoom multiplies this.
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
  const zoom = ZOOM_STEPS[step];
  const zoomed = zoom > 1;

  const measure = useCallback(() => {
    const box = area.current;
    const picture = image.current;
    if (!box || !picture || !picture.naturalWidth) return;
    // offset*, not client*: the scrollbars that appear when zoomed must not
    // change what "fits" means.
    const scale = Math.min(
      (box.offsetWidth - 24) / picture.naturalWidth,
      (box.offsetHeight - 24) / picture.naturalHeight,
      1,
    );
    setFit({ width: picture.naturalWidth * scale, height: picture.naturalHeight * scale });
    // Has dimensions, so it has arrived — also when it came from the cache
    // before the load handler was attached.
    setLoaded(true);
  }, []);

  useEffect(() => {
    const box = area.current;
    if (!box) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  // A new zoom level keeps the middle of the picture in the middle.
  useLayoutEffect(() => {
    const box = area.current;
    if (!box) return;
    box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
    box.scrollTop = (box.scrollHeight - box.clientHeight) / 2;
  }, [zoom, fit]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "+" || event.key === "=") setStep((value) => Math.min(value + 1, ZOOM_STEPS.length - 1));
      if (event.key === "-") setStep((value) => Math.max(value - 1, 0));
      if (event.key === "0") setStep(0);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navButton =
    "absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-2.5 text-white transition-colors hover:bg-black/70";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={area}
        className={cn("relative min-h-0 flex-1", zoomed ? "overflow-auto" : "overflow-hidden")}
        onTouchStart={(event) => {
          const touch = event.touches.length === 1 ? event.touches[0] : null;
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start || zoomed) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          if (dx > 0) onPrevious?.();
          else onNext?.();
        }}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center p-3"
          style={{ width: "max-content", height: "max-content" }}
        >
          {failed ? (
            <p role="alert" className="max-w-sm p-8 text-center text-sm leading-relaxed text-white/80">
              {t("attachments.previewFailed")}
            </p>
          ) : (
            <div
              className="relative flex items-center justify-center"
              style={
                fit
                  ? { width: fit.width * zoom, height: fit.height * zoom }
                  : { width: "calc(100vw - 2rem)", maxWidth: "100%", height: "60vh" }
              }
            >
              {attachment.hasThumbnail && !loaded ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${attachment.url}?variant=thumb`}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-contain opacity-60 blur-[2px]"
                />
              ) : null}
              {/* The original, from the authenticated route (see MessageAttachments). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={image}
                src={attachment.url}
                alt={attachment.name}
                onLoad={() => {
                  measure();
                  setLoaded(true);
                }}
                onError={() => setFailed(true)}
                onDoubleClick={() => setStep((value) => (value === 0 ? 2 : 0))}
                draggable={false}
                className={cn(
                  "relative h-full w-full select-none object-contain transition-opacity",
                  loaded ? "opacity-100" : "opacity-0",
                  zoomed ? "cursor-zoom-out" : "cursor-zoom-in",
                )}
              />
            </div>
          )}
        </div>

        {onPrevious && !zoomed ? (
          <button
            type="button"
            onClick={onPrevious}
            aria-label={t("attachments.previous")}
            className={cn(navButton, "left-2 sm:left-4")}
          >
            <IconChevronLeft size={20} />
          </button>
        ) : null}
        {onNext && !zoomed ? (
          <button
            type="button"
            onClick={onNext}
            aria-label={t("attachments.next")}
            className={cn(navButton, "right-2 sm:right-4")}
          >
            <IconChevronRight size={20} />
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-white/10 bg-[#1d2021] px-2 py-1.5 text-[12px] text-white/80">
        <button
          type="button"
          onClick={() => setStep((value) => Math.max(value - 1, 0))}
          disabled={step === 0}
          aria-label={t("attachments.zoomOut")}
          title={t("attachments.zoomOut")}
          className="rounded-[5px] p-1.5 transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <IconZoomOut size={17} />
        </button>
        <button
          type="button"
          onClick={() => setStep(0)}
          aria-label={t("attachments.zoomReset")}
          title={t("attachments.zoomReset")}
          className="min-w-[3.25rem] rounded-[5px] px-2 py-1 tabular-nums transition-colors hover:bg-white/10"
        >
          {Math.round(zoom * 100)} %
        </button>
        <button
          type="button"
          onClick={() => setStep((value) => Math.min(value + 1, ZOOM_STEPS.length - 1))}
          disabled={step === ZOOM_STEPS.length - 1}
          aria-label={t("attachments.zoomIn")}
          title={t("attachments.zoomIn")}
          className="rounded-[5px] p-1.5 transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <IconZoomIn size={17} />
        </button>
      </div>
    </div>
  );
}
