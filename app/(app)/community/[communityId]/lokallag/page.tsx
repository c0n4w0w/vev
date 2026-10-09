import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import { EventComposer } from "@/components/community/EventComposer";
import { LocalGroupAdmin } from "@/components/community/LocalGroupAdmin";
import { LocalGroupPicker } from "@/components/community/LocalGroupPicker";
import { OrganizationPersonCard } from "@/components/community/OrganizationPersonCard";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
  buttonClass,
} from "@/components/ui/primitives";
import { IconArrowRight, IconMapPin } from "@/components/ui/icons";
import {
  canLeadLocalGroup,
  getCommunityById,
  getLocalGroupChannel,
  getLocalGroupLeader,
  getLocalGroupMemberCounts,
  getLocalGroups,
  getMembership,
  getOrganizationPersonDmActions,
  getRecentLocalGroupPosts,
  getUpcomingLocalGroupEvents,
  getCommunityPersonas,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator, translator, type Locale } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { Community, CommunityPersona, Post } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return {
    title: t("lokallag.metaTitle", { name: community?.name ?? t("common.communityFallback") }),
  };
}

function excerpt(body: string) {
  const first = body.replace(/\s+/g, " ").trim();
  return first.length > 180 ? `${first.slice(0, 177)}...` : first;
}

function LocalPostPreview({
  post,
  author,
  community,
  locale,
}: {
  post: Post;
  author?: CommunityPersona;
  community: Community;
  locale: Locale;
}) {
  const t = translator(locale);
  return (
    <Panel as="li" className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-3">
            {author?.name ?? t("lokallag.memberFallback")} · {timeAgo(post.createdAt, locale)}
          </p>
          <h3 className="mt-1 font-display text-[1rem] leading-snug text-ink">
            <Link href={`/community/${community.id}/feed#post-${post.id}`} className="hover:text-ink-2">
              {post.title ?? excerpt(post.body)}
            </Link>
          </h3>
          {post.title ? (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{excerpt(post.body)}</p>
          ) : null}
        </div>
        <Link
          href={`/community/${community.id}/feed#post-${post.id}`}
          className="mt-1 shrink-0 text-ink-3 transition-colors hover:text-ink"
          aria-label={t("lokallag.openPost")}
        >
          <IconArrowRight size={16} />
        </Link>
      </div>
    </Panel>
  );
}

/**
 * Local groups: the member's own affiliation, and — for administrators — the
 * roster of groups itself.
 *
 * Reachable directly after accepting an invitation, and from the sidebar at
 * any time afterwards. Nothing here is required: a member who never opens this
 * page has full access to everything, which is the point.
 */
export default async function LocalGroupsPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const { velkommen } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const [membership, groups, memberCounts] = await Promise.all([
    getMembership(user.id, community.id),
    getLocalGroups(community.id),
    getLocalGroupMemberCounts(community.id),
  ]);

  // A community that has never defined any. The feature simply does not apply
  // here — no slug is consulted to reach that conclusion.
  if (groups.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title={t("lokallag.title")} />
        <EmptyState
          title={t("lokallag.unused.title")}
          body={t("lokallag.unused.body", { name: community.name })}
        />
      </PageContainer>
    );
  }

  const isAdmin = membership?.role === "admin";
  const selected = groups.find((group) => group.id === membership?.localGroupId);
  const selectable = groups.filter((group) => group.active);
  const welcome = velkommen === "1";
  const [localEvents, localPosts] = selected
    ? await Promise.all([
        getUpcomingLocalGroupEvents(community.id, selected.id, 3),
        getRecentLocalGroupPosts(community.id, selected.id, 3),
      ])
    : [[], []];
  // Creating an event here is locked to this lokallag: offered to its
  // lokallagsleder and to the community's admins. Everyone else gets no form,
  // and events_insert refuses them regardless.
  const canCreateLocalEvent =
    selected?.active === true && (isAdmin || (await canLeadLocalGroup(selected.id)));
  const [localLeader, localChannel] = selected
    ? await Promise.all([
        getLocalGroupLeader(community.id, selected.id),
        // Read through the same channels_select policy as the sidebar, so the
        // link exists exactly when the chat is open to this member.
        getLocalGroupChannel(community.id, selected.id),
      ])
    : [undefined, undefined];
  const organizationDmActions = localLeader
    ? await getOrganizationPersonDmActions(community.id)
    : new Map<string, string | undefined>();
  const localPeople = selected
    ? await getCommunityPersonas(community.id, [
        ...new Set([
          ...localPosts.map((post) => post.authorId),
          ...localEvents.map((event) => event.hostId).filter(Boolean),
        ]),
      ])
    : new Map<string, CommunityPersona>();

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title={t("lokallag.mine")}
        lead={
          selected
            ? t("lokallag.lead.selected", { name: community.name })
            : welcome
              ? t("lokallag.lead.welcome", { name: community.name })
              : t("lokallag.lead.choose")
        }
      />

      {selected ? (
        <>
          <section className="mb-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px]"
                  style={{ backgroundColor: `${community.branding.accent}12`, color: community.branding.accent }}
                >
                  <IconMapPin size={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-ink-3">{t("lokallag.affiliated")}</p>
                  <h2 className="font-display text-2xl leading-tight text-ink">{selected.name}</h2>
                  {selected.active ? null : (
                    <p className="mt-1 text-[12px] text-ink-3">
                      {t("lokallag.retired")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {localChannel ? (
                  <Link
                    href={`/community/${community.id}/channel/${localChannel.id}`}
                    className={buttonClass({ variant: "primary", size: "sm" })}
                  >
                    {t("lokallag.openChat")}
                    <IconArrowRight size={14} />
                  </Link>
                ) : null}
                <a href="#endre-lokallag" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("lokallag.change")}
                </a>
              </div>
            </div>

            <SectionHeading
              action={
                localEvents.length > 1 ? (
                  <Link href={`/community/${community.id}/events`} className="text-xs text-ink-3 hover:text-ink">
                    {t("events.all")}
                  </Link>
                ) : null
              }
            >
              {t("lokallag.nextActivity")}
            </SectionHeading>
            {canCreateLocalEvent ? (
              <EventComposer
                communityId={community.id}
                communityName={community.name}
                accent={community.branding.accent}
                lockedLocalGroup={{ id: selected.id, name: selected.name }}
              />
            ) : null}
            {localEvents.length > 0 ? (
              <div className="space-y-3">
                {localEvents.map((event, index) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    community={community}
                    host={localPeople.get(event.hostId)}
                    attending={event.attending}
                    variant={index === 0 ? "full" : "compact"}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("lokallag.noEvents.title")}
                body={t("lokallag.noEvents.body")}
              />
            )}
          </section>

          <section className="mb-10">
            <SectionHeading
              action={
                localPosts.length > 0 ? (
                  <Link href={`/community/${community.id}/feed`} className="text-xs text-ink-3 hover:text-ink">
                    {t("lokallag.openFeed")}
                  </Link>
                ) : null
              }
            >
              {t("lokallag.fromGroup")}
            </SectionHeading>
            {localPosts.length > 0 ? (
              <ul className="space-y-3">
                {localPosts.map((post) => (
                  <LocalPostPreview
                    key={post.id}
                    post={post}
                    author={localPeople.get(post.authorId)}
                    community={community}
                    locale={locale}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title={t("lokallag.noPosts.title")}
                body={t("lokallag.noPosts.body")}
              />
            )}
          </section>

          {localLeader ? (
            <section className="mb-10">
              <SectionHeading>{t("lokallag.contact")}</SectionHeading>
              <ul className="max-w-xl">
                <OrganizationPersonCard
                  person={localLeader}
                  localGroupName={selected.name}
                  locale={locale}
                  compact
                  dmAction={
                    organizationDmActions.has(localLeader.id)
                      ? {
                          communityId: community.id,
                          conversationId: organizationDmActions.get(localLeader.id),
                        }
                      : undefined
                  }
                />
              </ul>
            </section>
          ) : null}

          <details id="endre-lokallag" className="mb-8 rounded-[6px] border border-line bg-surface p-5">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {t("lokallag.change")}
            </summary>
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              {t("lokallag.changeHelp", { name: community.name })}
            </p>
            <div className="mt-4">
              <LocalGroupPicker
                communityId={community.id}
                groups={selectable}
                selectedId={selected.active ? selected.id : undefined}
                accent={community.branding.accent}
                memberCounts={memberCounts}
                welcome={welcome}
              />
            </div>
          </details>
        </>
      ) : (
        <>
          <EmptyState
            title={t("lokallag.none.title")}
            body={t("lokallag.none.body", { name: community.name })}
            action={
              <a href="#velg-lokallag" className={buttonClass({ variant: "primary", size: "md" })}>
                {t("lokallag.choose")}
              </a>
            }
          />

          <section id="velg-lokallag" className="mt-8 scroll-mt-6">
            <SectionHeading>{t("lokallag.choose")}</SectionHeading>
            <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              {t("lokallag.chooseHelp", { name: community.name })}
            </p>
            <LocalGroupPicker
              communityId={community.id}
              groups={selectable}
              accent={community.branding.accent}
              memberCounts={memberCounts}
              welcome={welcome}
            />
          </section>
        </>
      )}

      {isAdmin ? (
        <div className="mt-12 border-t border-line pt-8">
          <SectionHeading>{t("lokallag.manage")}</SectionHeading>
          <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            {t("lokallag.manageHelp", { name: community.name })}
          </p>
          <LocalGroupAdmin
            communityId={community.id}
            groups={groups}
            memberCounts={memberCounts}
          />
        </div>
      ) : null}
    </PageContainer>
  );
}
