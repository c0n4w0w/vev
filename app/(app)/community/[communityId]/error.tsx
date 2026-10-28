"use client";

import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";

/**
 * A page inside a community failed to render. Without this boundary one bad
 * row (a message whose stored shape the page cannot draw, say) takes the
 * whole page down to the bare framework error, with no way back. The
 * community's navigation stays, the message is fixed text — the cause is in
 * the server log, not here — and the overview is one click away.
 */
export default function CommunityError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  const { communityId } = useParams<{ communityId: string }>();

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-[1.75rem] leading-tight text-ink">{t("err.communityPage.title")}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("err.communityPage.body")}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => retry()}>
          {t("err.communityPage.retry")}
        </Button>
        {communityId ? (
          <ButtonLink href={`/community/${encodeURIComponent(communityId)}`} variant="secondary">
            {t("shell.nav.overview")}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
