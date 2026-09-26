import { notFound } from "next/navigation";
import { getCollaborationBySlug } from "@/lib/collaboration-data";
import { LocaleProvider } from "@/lib/i18n/react";

/**
 * Everything inside one collaboration speaks its language — the source
 * community's, fixed at creation — whichever organisation the viewer comes
 * from. A slug the viewer is not related to is simply not found: RLS returns
 * no row, and this does not distinguish "does not exist" from "not yours".
 */
export default async function CollaborationLayout({
  params,
  children,
}: LayoutProps<"/collaboration/[slug]">) {
  const { slug } = await params;
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();

  return (
    <LocaleProvider locale={collaboration.defaultLocale}>
      <div lang={collaboration.defaultLocale}>{children}</div>
    </LocaleProvider>
  );
}
