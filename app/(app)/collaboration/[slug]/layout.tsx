import { notFound } from "next/navigation";
import { WorkspaceNav } from "@/components/collaboration/workspace/WorkspaceNav";
import {
  getCollaborationBySlug,
  getMyCollaborationPersona,
  hasCollaborationAccess,
} from "@/lib/collaboration-data";
import { LocaleProvider } from "@/lib/i18n/react";
import { getSessionUser } from "@/lib/session";

/**
 * Everything inside one collaboration speaks its language — the source
 * community's, fixed at creation — whichever organisation the viewer comes
 * from. A slug the viewer is not related to is simply not found: RLS returns
 * no row, and this does not distinguish "does not exist" from "not yours".
 *
 * The workspace navigation appears only for someone with effective access
 * who has set up how they appear here. A representative who is not on the
 * team, or someone invited who has not joined, sees the collaboration's
 * front page and nothing that suggests what is inside.
 */
export default async function CollaborationLayout({
  params,
  children,
}: LayoutProps<"/collaboration/[slug]">) {
  const { slug } = await params;
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();

  const user = await getSessionUser();
  const access = user ? await hasCollaborationAccess(collaboration.id) : false;
  const persona = access && user ? await getMyCollaborationPersona(collaboration.id, user.id) : undefined;

  return (
    <LocaleProvider locale={collaboration.defaultLocale}>
      <div lang={collaboration.defaultLocale}>
        {persona ? <WorkspaceNav slug={collaboration.slug} name={collaboration.name} /> : null}
        {children}
      </div>
    </LocaleProvider>
  );
}
