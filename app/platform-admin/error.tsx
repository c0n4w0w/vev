"use client";

import { Button } from "@/components/ui/primitives";

/**
 * Something failed while loading a dashboard page. The message is fixed:
 * whatever went wrong is in the server log, not here.
 */
export default function PlatformError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-[1.75rem] leading-tight text-ink">Siden kunne ikke lastes</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
        Noe gikk galt da plattformdata skulle hentes. Ingenting er endret. Har økten din utløpt, eller er tilgangen
        din endret, må du kanskje logge inn på nytt.
      </p>
      <div className="mt-6 flex gap-3">
        <Button type="button" onClick={reset}>
          Prøv igjen
        </Button>
      </div>
    </div>
  );
}
