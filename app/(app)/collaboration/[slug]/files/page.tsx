import { removeFileAction } from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { FileUploadForm } from "@/components/collaboration/workspace/FileUploadForm";
import { IconAttach } from "@/components/ui/icons";
import { EmptyState, PageContainer, PageHeader, Panel, buttonClass } from "@/components/ui/primitives";
import { getFiles, getWorkspacePeople, loadWorkspace } from "@/lib/collaboration-workspace-data";
import { formatFileSize } from "@/lib/collaboration-file-type";
import { timeAgo } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/files">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.files.title")} · ${collaboration.name}` };
}

/**
 * Private files. Each link goes through this app's own route, which reads the
 * file with the viewer's session every time — there is no public or
 * long-lived URL to share or keep after access ends.
 */
export default async function FilesPage({ params }: PageProps<"/collaboration/[slug]/files">) {
  const { slug } = await params;
  const { collaboration, me, manager, t, base } = await loadWorkspace(slug);
  const locale = collaboration.defaultLocale;
  const [files, people] = await Promise.all([getFiles(collaboration.id), getWorkspacePeople(collaboration.id)]);

  return (
    <PageContainer width="default">
      <PageHeader title={t("ws.files.title")} lead={t("ws.files.lead")} />

      <Panel className="mb-8 p-4 sm:p-5">
        <FileUploadForm slug={collaboration.slug} />
      </Panel>

      {files.length === 0 ? (
        <EmptyState title={t("ws.files.empty")} body={t("ws.files.lead")} />
      ) : (
        <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
          {files.map((file) => (
            <li key={file.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <IconAttach size={17} className="mt-0.5 shrink-0 text-ink-3" />
                <div className="min-w-0">
                  <a
                    href={`${base}/files/${file.id}`}
                    className="block text-[0.9375rem] font-medium text-ink hover:text-skog [overflow-wrap:anywhere]"
                  >
                    {file.displayName}
                  </a>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">
                    {t("ws.files.by", {
                      size: formatFileSize(file.sizeBytes, locale),
                      when: timeAgo(file.createdAt, locale),
                      name: (file.uploadedBy && people[file.uploadedBy]?.name) || t("common.unknown"),
                    })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-start gap-2 pl-8 sm:pl-0">
                <a href={`${base}/files/${file.id}?download=1`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("ws.files.download")}
                </a>
                {file.uploadedBy === me.id || manager ? (
                  <ActionButton
                    action={removeFileAction}
                    fields={{ fileId: file.id, slug: collaboration.slug }}
                    label={t("ws.files.remove")}
                    variant="quiet"
                    ariaLabel={`${t("ws.files.remove")}: ${file.displayName}`}
                    confirm={{ note: t("ws.files.removeNote"), yes: t("ws.files.removeConfirm") }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
