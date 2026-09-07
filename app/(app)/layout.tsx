import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { buildShellData } from "@/components/shell/shell-data";
import { getSessionUser } from "@/lib/session";

/**
 * Every authenticated screen lives under this layout. Session resolution and
 * the redirect happen here so no individual page has to think about it.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <AppShell data={await buildShellData(user)}>{children}</AppShell>;
}
