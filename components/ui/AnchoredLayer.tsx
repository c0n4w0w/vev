"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A layer pinned next to an element — a picker or a tooltip — rendered at the
 * end of the document so no scrolling container, sticky bar or blur clips it.
 *
 * Opens above the anchor when there is room and below when there is not, and
 * always stays inside the viewport with an 8px margin (on a 375px phone too).
 * Follows the anchor while anything scrolls or the window resizes.
 */
export function AnchoredLayer({
  anchorRef,
  align = "start",
  gap = 6,
  className,
  style,
  children,
  layerRef,
  ...rest
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** Which edge of the anchor the layer lines up with; `center` for tooltips. */
  align?: "start" | "end" | "center";
  gap?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  layerRef?: RefObject<HTMLDivElement | null>;
} & Omit<HTMLAttributes<HTMLDivElement>, "style" | "className" | "children">) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = layerRef ?? ownRef;
  const [position, setPosition] = useState<CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    // Transparent rather than hidden until placed: a hidden layer could not
    // take focus, and a picker focuses its search field as it opens.
    opacity: 0,
    pointerEvents: "none",
  });

  useLayoutEffect(() => {
    function place(event?: Event) {
      if (event?.target instanceof Node && ref.current?.contains(event.target)) return;
      const anchor = anchorRef.current;
      const layer = ref.current;
      if (!anchor || !layer) return;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = layer.offsetWidth;
      const height = layer.offsetHeight;
      const margin = 8;

      const preferred = align === "end" ? a.right - width : align === "center" ? a.left + a.width / 2 - width / 2 : a.left;
      const left = Math.max(margin, Math.min(preferred, vw - width - margin));
      const above = a.top - gap - height;
      const below = a.bottom + gap;
      const top =
        above >= margin ? above : below + height <= vh - margin ? below : Math.max(margin, vh - height - margin);
      setPosition({ position: "fixed", top, left });
    }

    place();
    const observer = new ResizeObserver(() => place());
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, align, gap, ref]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={className} style={{ ...style, ...position }} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
