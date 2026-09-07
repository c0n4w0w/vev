import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCommunityById, hasAccess } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * Access guard for everything inside a community.
 *
 * A signed-in user who is not a member is sent to the community's public
 * portal rather than shown an error — from their point of view the private
 * side simply does not exist.
 */
export default async function CommunityLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  if (!(await hasAccess(user.id, community.id))) redirect(`/${community.slug}`);

  return <>{children}</>;
}
