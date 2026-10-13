import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { buildShellData } from "@/components/shell/shell-data";
import { getAccountSecurity } from "@/lib/account-security";
import { getSessionUser } from "@/lib/session";

/**
 * Every authenticated screen lives under this layout. Session resolution and
 * the redirect happen here so no individual page has to think about it.
 *
 * Someone who has tried to accept an invitation without a password is sent
 * to choose one first — which is how an interrupted setup resumes, whenever
 * and however they next sign in. This redirect is a signpost, not the rule:
 * the rule is in the database, which gives such an account no membership to
 * use until the password exists.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if ((await getAccountSecurity())?.passwordSetupRequired) redirect("/opprett-passord");

  return <AppShell data={await buildShellData(user)}>{children}</AppShell>;
}
