import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { CreateChannelForm } from "@/components/collaboration/workspace/ChannelForms";
import { IconHash, IconPlus } from "@/components/ui/icons";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { getChannels, getRecentMessages, loadWorkspace } from "@/lib/collaboration-workspace-data";
import { timeAgo } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/channels">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.channels.title")} · ${collaboration.name}` };
}

/**
 * The collaboration's channels. Everyone on the team reads every channel;
 * only workspace managers make new ones. Archived channels stay listed apart,
 * readable, so nothing said in them disappears.
 */
export default async function ChannelsPage({ params }: PageProps<"/collaboration/[slug]/channels">) {
  const { slug } = await params;
  const { collaboration, manager, t, base } = await loadWorkspace(slug);
  const locale = await getRequestLocale(collaboration);
  const [channels, recent] = await Promise.all([
    getChannels(collaboration.id),
    getRecentMessages(collaboration.id, 300),
  ]);

  const last = new Map<string, string>();
  for (const message of recent) {
    if (!last.has(message.channelId)) last.set(message.channelId, message.createdAt);
  }
  const active = channels.filter((channel) => channel.status === "active");
  const archived = channels.filter((channel) => channel.status === "archived");

  const row = (channel: (typeof channels)[number]) => {
    const at = last.get(channel.id);
    return (
      <li key={channel.id}>
        <Link
          href={`${base}/channels/${channel.id}`}
          className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-paper-2/60"
        >
          <IconHash size={17} className="mt-0.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-medium text-ink [overflow-wrap:anywhere]">
              {channel.name}
            </span>
            {channel.description ? (
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                {channel.description}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 pt-0.5 text-right text-[12px] text-ink-3">
            {at ? t("ws.channels.lastActivity", { when: timeAgo(at, locale) }) : t("ws.channels.noMessages")}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <PageContainer width="default">
      <PageHeader title={t("ws.channels.title")} lead={t("ws.channels.lead")} />

      <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">{active.map(row)}</ul>

      <section className="mt-8">
        {manager ? (
          <details className="group rounded-[6px] border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              <IconPlus size={16} className="text-skog" />
              {t("ws.channels.new")}
            </summary>
            <div className="border-t border-line p-4">
              <CreateChannelForm collaborationId={collaboration.id} slug={collaboration.slug} />
            </div>
          </details>
        ) : (
          <p className="text-[13px] text-ink-3">{t("ws.channels.managersOnly")}</p>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>{t("ws.channels.archived")}</SectionHeading>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface/70 opacity-80">
            {archived.map(row)}
          </ul>
        </section>
      ) : null}
    </PageContainer>
  );
}
