import { getRequestLocale } from "@/lib/i18n/server";
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
 * The account language overrides the source community's default. A slug the
 * viewer is not related to is simply not found: RLS returns
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
  const locale = await getRequestLocale(collaboration);

  return (
    <LocaleProvider locale={locale}>
      <div lang={locale}>
        {persona ? <WorkspaceNav slug={collaboration.slug} name={collaboration.name} /> : null}
        {children}
      </div>
    </LocaleProvider>
  );
}
