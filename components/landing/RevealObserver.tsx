"use client";

import { useEffect } from "react";

/**
 * Plays front page sections in as they scroll into view.
 *
 * The server renders every section fully visible. After hydration, only the
 * sections that start below the fold are marked `hidden`; each becomes `shown`
 * the first time it enters the viewport. Sections already on screen are left
 * alone, so nothing visible ever blinks out. Without JavaScript, or with
 * reduced motion, the page stays exactly as rendered.
 */
const SELECTOR = "[data-reveal], [data-reveal-stagger]";

function mark(el: Element, state: "hidden" | "shown") {
  if (el.hasAttribute("data-reveal-stagger")) el.setAttribute("data-reveal-stagger", state);
  else el.setAttribute("data-reveal", state);
}

export function RevealObserver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          mark(entry.target, "shown");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    const fold = window.innerHeight;
    document.querySelectorAll(SELECTOR).forEach((el) => {
      if (el.getBoundingClientRect().top < fold * 0.9) return;
      // Number staggered children so CSS can delay each one.
      if (el.hasAttribute("data-reveal-stagger")) {
        Array.from(el.children).forEach((child, i) => {
          (child as HTMLElement).style.setProperty("--i", String(i));
        });
      }
      mark(el, "hidden");
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
