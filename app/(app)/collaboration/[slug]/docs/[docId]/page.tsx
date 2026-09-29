import Link from "next/link";
import { notFound } from "next/navigation";
import { setDocumentStatusAction } from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { DocumentEditor, RestoreVersionForm } from "@/components/collaboration/workspace/DocumentEditor";
import { IconArrowLeft } from "@/components/ui/icons";
import { Badge, PageContainer, Panel, SectionHeading, cn } from "@/components/ui/primitives";
import {
  getDocument,
  getDocumentVersions,
  getWorkspacePeople,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { UUID } from "@/lib/collaboration-workspace-form";
import { timeAgo } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/docs/[docId]">) {
  const { slug, docId } = await params;
  const { collaboration } = await loadWorkspace(slug);
  const document = UUID.test(docId) ? await getDocument(collaboration.id, docId) : undefined;
  return { title: document ? `${document.title} · ${collaboration.name}` : collaboration.name };
}

/**
 * One document: the editor, or — with `?version=N` — an earlier saved state,
 * read-only, with a way to bring it back as a new version.
 */
export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/collaboration/[slug]/docs/[docId]">) {
  const { slug, docId } = await params;
  const { version: versionParam } = await searchParams;
  const { collaboration, manager, t, base } = await loadWorkspace(slug);
  if (!UUID.test(docId)) notFound();
  const locale = collaboration.defaultLocale;

  const [document, versions, people] = await Promise.all([
    getDocument(collaboration.id, docId),
    getDocumentVersions(collaboration.id, docId),
    getWorkspacePeople(collaboration.id),
  ]);
  if (!document) notFound();

  const wanted = typeof versionParam === "string" ? Number(versionParam) : NaN;
  const viewing = Number.isInteger(wanted) && wanted !== document.revision
    ? versions.find((v) => v.revision === wanted)
    : undefined;
  const nameOf = (id: string | null) => (id && people[id]?.name) || t("common.unknown");
  const href = `${base}/docs/${document.id}`;

  return (
    <PageContainer width="wide">
      <Link href={`${base}/docs`} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <IconArrowLeft size={14} />
        {t("ws.docs.back")}
      </Link>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {viewing ? (
            <div className="space-y-4">
              <Panel className="border-fjord/25 bg-fjord-soft/50 p-4">
                <p className="text-[13px] leading-relaxed text-ink-2">
                  {t("ws.docs.viewing", {
                    revision: viewing.revision,
                    when: timeAgo(viewing.createdAt, locale),
                    name: nameOf(viewing.createdBy),
                  })}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {document.status === "active" ? (
                    <RestoreVersionForm
                      documentId={document.id}
                      collaborationId={collaboration.id}
                      slug={collaboration.slug}
                      currentRevision={document.revision}
                      version={viewing}
                    />
                  ) : null}
                  <Link href={href} className="text-[13px] font-medium text-skog hover:underline">
                    {t("ws.docs.backToCurrent")}
                  </Link>
                </div>
              </Panel>
              <h1 className="font-display text-[1.625rem] leading-tight text-ink [overflow-wrap:anywhere]">{viewing.title}</h1>
              <pre className="whitespace-pre-wrap rounded-[6px] border border-line bg-surface p-4 font-mono text-[13.5px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                {viewing.content}
              </pre>
            </div>
          ) : document.status === "archived" ? (
            <div className="space-y-4">
              <Panel className="bg-paper-2/60 p-4 text-[13px] text-ink-2">{t("ws.docs.archivedNotice")}</Panel>
              <h1 className="font-display text-[1.625rem] leading-tight text-ink [overflow-wrap:anywhere]">{document.title}</h1>
              <pre className="whitespace-pre-wrap rounded-[6px] border border-line bg-surface p-4 font-mono text-[13.5px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                {document.content}
              </pre>
            </div>
          ) : (
            <DocumentEditor document={document} collaborationId={collaboration.id} slug={collaboration.slug} />
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <SectionHeading>{t("ws.docs.history")}</SectionHeading>
            <ol className="space-y-1">
              {versions.map((version) => {
                const current = version.revision === document.revision;
                const selected = viewing ? viewing.revision === version.revision : current;
                return (
                  <li key={version.revision}>
                    <Link
                      href={current ? href : `${href}?version=${version.revision}`}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        "block rounded-[5px] px-2.5 py-2 text-[13px] transition-colors hover:bg-paper-2",
                        selected && "bg-skog-soft",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium text-ink">
                        {t("ws.docs.version", { revision: version.revision })}
                        {current ? <Badge tone="skog">{t("ws.docs.current")}</Badge> : null}
                      </span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {t("ws.docs.versionBy", { when: timeAgo(version.createdAt, locale), name: nameOf(version.createdBy) })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>

          {manager ? (
            <section className="border-t border-line pt-5">
              {document.status === "active" ? (
                <ActionButton
                  action={setDocumentStatusAction}
                  fields={{ documentId: document.id, status: "archived", slug: collaboration.slug }}
                  label={t("ws.docs.archive")}
                  variant="quiet"
                  confirm={{ note: t("ws.docs.archiveNote"), yes: t("ws.docs.archiveConfirm") }}
                />
              ) : (
                <ActionButton
                  action={setDocumentStatusAction}
                  fields={{ documentId: document.id, status: "active", slug: collaboration.slug }}
                  label={t("ws.docs.unarchive")}
                  variant="secondary"
                />
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
