"use client";

import { useEffect, useState } from "react";

const WORDS = [
  "møtene",
  "aksjonene",
  "idéene",
  "kampanjene",
  "samtalene",
  "gjennomslagene",
] as const;

const INTERVAL_MS = 2800;

// The widest entry, plus the full stop. Rendered invisibly so the wrapper
// always reserves enough room and nothing around it moves when the word changes.
const SIZER = `${WORDS.reduce((a, b) => (b.length > a.length ? b : a))}.`;

/**
 * The rotating last word of the portal headline, with its full stop.
 *
 * Kept as its own tiny client component so the timer lives here and the rest
 * of the portal stays a Server Component. The first render is always the first
 * word with no animation, so server and client markup match.
 *
 * Accessibility: the visible layers are hidden from assistive technology and a
 * single static "møtene" is exposed instead, so the heading reads as one
 * ordinary sentence and nothing is announced when the word changes. With
 * `prefers-reduced-motion` the word never rotates.
 */
export function RotatingHeadlineWord() {
  const [{ current, previous }, setState] = useState<{
    current: number;
    previous: number | null;
  }>({ current: 0, previous: null });

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;

    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (query.matches) {
        setState({ current: 0, previous: null });
        return;
      }
      timer = window.setInterval(() => {
        setState((state) => ({
          current: (state.current + 1) % WORDS.length,
          previous: state.current,
        }));
      }, INTERVAL_MS);
    };

    start();
    query.addEventListener("change", start);
    return () => {
      stop();
      query.removeEventListener("change", start);
    };
  }, []);

  return (
    <>
      <span className="sr-only">{WORDS[0]}.</span>
      <span className="relative inline-block whitespace-nowrap" aria-hidden="true">
        <span className="invisible">{SIZER}</span>
        {previous !== null ? (
          <span key={`out-${previous}`} className="rotating-word-out absolute left-0 top-0">
            {WORDS[previous]}.
          </span>
        ) : null}
        <span
          key={`in-${current}`}
          className={`absolute left-0 top-0${previous !== null ? " rotating-word-in" : ""}`}
        >
          {WORDS[current]}.
        </span>
      </span>
    </>
  );
}
