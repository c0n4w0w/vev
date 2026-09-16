import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";
import { notFoundCopy } from "@/lib/not-found-copy";

// Without this an unmatched address is titled plainly "TING", which reads in a
// tab or a history entry as though the page loaded.
export const metadata: Metadata = { title: notFoundCopy.label };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 lg:px-8">
        <p className="label">{notFoundCopy.label}</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">
          {notFoundCopy.heading}
        </h1>
        <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-ink-2">
          {notFoundCopy.body}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {notFoundCopy.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={buttonClass(
                link.variant === "secondary" ? { variant: "secondary" } : undefined,
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
