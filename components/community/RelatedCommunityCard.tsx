import Link from "next/link";
import { CommunityMark, cn } from "@/components/ui/primitives";
import { IconArrowRight, IconExternal } from "@/components/ui/icons";
import type { Translator } from "@/lib/i18n";
import { relatedCommunityHref } from "@/lib/related-communities";
import type { RelatedCommunity } from "@/lib/data";

const linkClass =
  "inline-flex min-h-8 items-center gap-1 text-[13px] font-medium text-skog underline decoration-line-2 underline-offset-4 transition-colors hover:text-skog-2";

/**
 * A quiet pointer to a related organisation's own community.
 *
 * Not a call to action: a hairline card with a faint green tint. Someone who
 * already belongs to the target is told so and offered the way in; everyone
 * else is told how access works and gets both the membership link and the
 * public portal. What it knows about the target is what its portal shows
 * anyone, plus the viewer's own membership.
 */
export function RelatedCommunityCard({
  related,
  t,
}: {
  related: RelatedCommunity;
  t: Translator;
}) {
  const { config, target, joined } = related;
  return (
    <div
      className={cn(
        "rounded-[6px] border border-line bg-skog-soft/40 px-4 py-4",
        "flex flex-col gap-3",
      )}
    >
      <div className="flex items-center gap-2.5">
        <CommunityMark community={target} size="sm" />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{target.name}</span>
      </div>

      {joined ? (
        <p className="text-[13px] leading-relaxed text-ink-2">
          {t("overview.related.alsoMember", { name: target.name })}
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink-2">
          {config.copy.lead ? (
            <span className="block font-medium text-ink">{t(config.copy.lead)}</span>
          ) : null}
          {t(config.copy.body)}
        </p>
      )}

      <div className="flex flex-col items-start">
        {joined ? null : (
          <a
            href={config.membershipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {t("overview.related.join")}
            <IconExternal size={13} />
          </a>
        )}
        <Link href={relatedCommunityHref(target, joined)} className={linkClass}>
          {joined ? t("overview.related.open") : t("overview.related.goToPortal")}
          <IconArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
