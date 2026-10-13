import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell/Wordmark";
import type { Locale } from "@/lib/i18n";

/**
 * The frame around the account screens that sit outside the app shell —
 * choosing, resetting and confirming things, where the only navigation worth
 * offering is the way home. Same shape as the invitation and welcome pages.
 */
export function AccountShell({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <main lang={locale} className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 lg:px-8 lg:py-16">{children}</div>
    </main>
  );
}
