import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCommunityById, getPortalSlugForCommunity, hasAccess } from "@/lib/data";
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

  // Row level security hides communities the user has no relationship with, so
  // an unknown id and a community they simply are not in look identical here.
  // Both should land on the public portal when one exists — a bare 404 would
  // treat a stranger differently from an invited user for no good reason.
  if (!community) {
    const slug = await getPortalSlugForCommunity(communityId);
    if (!slug) notFound();
    redirect(`/${slug}`);
  }

  if (!(await hasAccess(user.id, community.id))) redirect(`/${community.slug}`);

  return <>{children}</>;
}
