"use client";

import Link from "next/link";
import { useState, useTransition, type ComponentType } from "react";
import { dismissOnboardingAction } from "@/app/actions";
import {
  IconArrowRight,
  IconClose,
  IconFeed,
  IconHash,
  IconMapPin,
  IconMessage,
  IconPlus,
  IconUser,
} from "@/components/ui/icons";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/react";
import type { OnboardingStep } from "@/lib/onboarding";

const STEP_ICON: Record<OnboardingStep["kind"], ComponentType<{ size?: number; className?: string }>> = {
  profile: IconUser,
  lokallag: IconMapPin,
  introductions: IconMessage,
  channel: IconHash,
  createChannel: IconPlus,
  feed: IconFeed,
};

const STEP_COPY: Record<OnboardingStep["kind"], { title: MessageKey; body: MessageKey }> = {
  profile: { title: "overview.welcome.profile.title", body: "overview.welcome.profile.body" },
  lokallag: { title: "overview.welcome.lokallag.title", body: "overview.welcome.lokallag.body" },
  introductions: {
    title: "overview.welcome.introductions.title",
    body: "overview.welcome.introductions.body",
  },
  channel: { title: "overview.welcome.channel.title", body: "overview.welcome.channel.body" },
  createChannel: {
    title: "overview.welcome.createChannel.title",
    body: "overview.welcome.createChannel.body",
  },
  feed: { title: "overview.welcome.feed.title", body: "overview.welcome.feed.body" },
};

/**
 * "Kom i gang" — a newly joined member's welcome on a community's Overview.
 *
 * The page renders this only when the database says the caller's own
 * membership here has not dismissed it; the steps are whatever this community
 * actually has (see `onboardingSteps`). Following a link does nothing to the
 * card. "Hopp over" and the close icon both dismiss it for good, for this
 * membership only — the card hides at once and the action persists it; if the
 * action is refused the card comes back rather than pretending.
 */
export function CommunityWelcomeCard({
  communityId,
  communityName,
  steps,
  accent,
}: {
  communityId: string;
  communityName: string;
  steps: OnboardingStep[];
  accent: string;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    startTransition(async () => {
      const result = await dismissOnboardingAction(communityId);
      if (!result.ok) setDismissed(false);
    });
  }

  const headingId = `welcome-${communityId}`;

  return (
    <section
      aria-labelledby={headingId}
      className="relative rounded-[6px] border border-line bg-surface"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("overview.welcome.close")}
        className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <IconClose size={15} />
      </button>

      <div className="px-5 pb-5 pr-12 pt-5 sm:px-6 sm:pr-14 sm:pt-6">
        <p className="label" style={{ color: accent }}>
          {t("overview.welcome.eyebrow")}
        </p>
        <h2 id={headingId} className="mt-2.5 font-display text-[1.375rem] leading-snug text-ink">
          {t("overview.welcome.title", { name: communityName })}
        </h2>
        <p className="mt-1.5 max-w-[36rem] text-[0.875rem] leading-relaxed text-ink-2">
          {t("overview.welcome.lead")}
        </p>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {steps.map((step) => {
          const Icon = STEP_ICON[step.kind];
          const copy = STEP_COPY[step.kind];
          return (
            <li key={step.kind}>
              <Link
                href={step.href}
                className="group flex min-h-14 items-center gap-3.5 px-5 py-3 transition-colors hover:bg-paper-2/50 sm:px-6"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] border border-line text-ink-2">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">{t(copy.title)}</span>
                  <span className="mt-0.5 block text-[12.5px] text-ink-3">
                    {step.kind === "introductions" || step.kind === "channel"
                      ? t(copy.body, { channel: step.channelName })
                      : t(copy.body)}
                  </span>
                </span>
                <IconArrowRight
                  size={15}
                  className="shrink-0 text-ink-3 transition-colors group-hover:text-ink"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-2.5 sm:px-6">
        <p className="min-w-0 text-[12px] leading-snug text-ink-3">{t("overview.welcome.footer")}</p>
        <button
          type="button"
          onClick={dismiss}
          className="-mr-2 inline-flex min-h-9 shrink-0 items-center rounded-[5px] px-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink hover:underline hover:underline-offset-4"
        >
          {t("overview.welcome.skip")}
        </button>
      </div>
    </section>
  );
}
