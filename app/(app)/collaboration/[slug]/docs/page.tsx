import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { CreateDocumentForm } from "@/components/collaboration/workspace/DocumentEditor";
import { IconFeed, IconPlus } from "@/components/ui/icons";
import { EmptyState, PageContainer, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { getDocuments, getWorkspacePeople, loadWorkspace } from "@/lib/collaboration-workspace-data";
import { timeAgo } from "@/lib/format";
import type { WorkspaceDocument } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/docs">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.docs.title")} · ${collaboration.name}` };
}

export default async function DocumentsPage({ params }: PageProps<"/collaboration/[slug]/docs">) {
  const { slug } = await params;
  const { collaboration, t, base } = await loadWorkspace(slug);
  const locale = await getRequestLocale(collaboration);
  const [documents, people] = await Promise.all([
    getDocuments(collaboration.id),
    getWorkspacePeople(collaboration.id),
  ]);
  const active = documents.filter((d) => d.status === "active");
  const archived = documents.filter((d) => d.status === "archived");

  const row = (document: WorkspaceDocument) => (
    <li key={document.id}>
      <Link href={`${base}/docs/${document.id}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-paper-2/60">
        <IconFeed size={17} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-medium text-ink [overflow-wrap:anywhere]">{document.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-ink-3">
            {t("ws.docs.updated", {
              when: timeAgo(document.updatedAt, locale),
              name: (document.updatedBy && people[document.updatedBy]?.name) || t("common.unknown"),
            })}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12px] text-ink-3">{t("ws.docs.version", { revision: document.revision })}</span>
      </Link>
    </li>
  );

  return (
    <PageContainer width="default">
      <PageHeader title={t("ws.docs.title")} lead={t("ws.docs.lead")} />

      <details className="mb-6 rounded-[6px] border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
          <IconPlus size={16} className="text-skog" />
          {t("ws.docs.new")}
        </summary>
        <div className="border-t border-line p-4">
          <CreateDocumentForm collaborationId={collaboration.id} slug={collaboration.slug} />
        </div>
      </details>

      {active.length > 0 ? (
        <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">{active.map(row)}</ul>
      ) : (
        <EmptyState title={t("ws.docs.empty")} body={t("ws.docs.lead")} />
      )}

      {archived.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>{t("ws.docs.archivedList")}</SectionHeading>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface/70 opacity-80">
            {archived.map(row)}
          </ul>
        </section>
      ) : null}
    </PageContainer>
  );
}
