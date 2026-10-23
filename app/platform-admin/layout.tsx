import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MfaGate } from "@/components/platform/MfaGate";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { requirePlatformOperator } from "@/lib/platform/access";
import { getPlatformOverview } from "@/lib/platform/data";

/**
 * /platform-admin: TING's own administration, for platform operators only.
 *
 * Not indexed, not referred, and identical to any unknown address for
 * everyone else: signed out, an ordinary member and a community
 * administrator all get the site's 404. An operator without a verified
 * second factor in this session gets the MFA step and nothing else.
 *
 * A layout is not re-rendered on every navigation, so it is not where access
 * is enforced. Every page checks again (requireVerifiedOperator), and every
 * database function behind the pages checks for itself.
 *
 * Titles are generic on purpose: no community name, address or request ends
 * up in a tab title, the browser history or a shared screen's taskbar.
 */
export const metadata: Metadata = {
  title: { default: "Plattformadministrasjon", template: "%s · Plattform · TING" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function PlatformAdminLayout({ children }: { children: ReactNode }) {
  const access = await requirePlatformOperator();
  if (!access.mfaVerified) return <MfaGate hasFactor={access.hasFactor} email={access.user.email} />;

  const overview = await getPlatformOverview().catch(() => null);
  return (
    <PlatformShell
      role={access.role}
      name={access.user.name}
      email={access.user.email}
      pendingRequests={overview?.requestsPending ?? 0}
    >
      {children}
    </PlatformShell>
  );
}
