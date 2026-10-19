import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import { ButtonLink, EmptyState, PageContainer } from "@/components/ui/primitives";
import {
  canCreatePrivateChannel,
  canModerateChannelMessages,
  canManagePrivateChannel,
  canManageSubgroup,
  getChannel,
  getChannelSections,
  getCommunityById,
  getCommunityChannelContentCounts,
  getCommunityEmojis,
  getCommunityPersonas,
  getLocalGroups,
  getMembership,
  getMessages,
  getPinnedMessageId,
  getPrivateChannelRoster,
  getSubgroups,
  getVisibleCommunityPersonas,
} from "@/lib/data";
import { getAttachmentPolicy } from "@/lib/attachment-data";
import { getChannelResourcePermissions, getChannelResourceSummary } from "@/lib/channel-resource-data";
import { channelTakesFiles, isUuid } from "@/lib/channel-resources";
import { isCommunityChannel } from "@/lib/channel-management-form";
import { mentionIds } from "@/lib/mentions";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { channelId, communityId } = await params;
  const [channel, community] = await Promise.all([
    getChannel(channelId),
    getCommunityById(communityId),
  ]);
  const t = communityTranslator(community);
  return {
    title: `#${channel?.name ?? t("channel.fallbackName")} · ${community?.name ?? t("common.communityFallback")}`,
  };
}

export default async function ChannelPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { communityId, channelId } = await params;
  const { ny, melding } = await searchParams;
  const focusMessageId = typeof melding === "string" && isUuid(melding) ? melding : undefined;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, channel] = await Promise.all([
    getCommunityById(communityId),
    getChannel(channelId),
  ]);
  // `channels_select` decides whether the channel exists for this viewer. A
  // private channel someone was never in — or was removed from — is the same
  // not-found as an id that was never a channel, or one that was deleted: no
  // name, no description. Inside a community the viewer belongs to, that is
  // said in place, with the way back, rather than leaving the community.
  if (!community) notFound();
  if (!channel || channel.communityId !== community.id) {
    const t = communityTranslator(community);
    return (
      <PageContainer width="narrow">
        <EmptyState
          title={t("channel.missing.title")}
          body={t("channel.missing.body")}
          action={
            <ButtonLink href={`/community/${community.id}`} variant="secondary">
              {t("channel.missing.back")}
            </ButtonLink>
          }
        />
      </PageContainer>
    );
  }

  const [
    membership,
    messages,
    customEmojis,
    attachmentPolicy,
    resourceSummary,
    resourcePermissions,
    canModerate,
    pinnedMessageId,
  ] = await Promise.all([
    getMembership(user.id, community.id),
    getMessages(channel.id),
    getCommunityEmojis(community.id),
    // Whether this viewer may attach files here — a private group's chat, a
    // private lokallag channel, or a community channel with file sharing
    // switched on; not an archived one, and in a restricted channel only for
    // administrators and moderators. The database's answer; it gives the
    // same one again at upload and at send.
    getAttachmentPolicy({ channelId: channel.id }),
    // What is in the channel's Ressurser for this viewer: all zero for a
    // channel they could not read.
    getChannelResourceSummary(channel.id),
    // What this viewer may do with them (channel_resource_permissions).
    getChannelResourcePermissions(channel.id),
    // Whether this viewer may remove others' messages and pin one here: the
    // community's admins and moderators in its own channels, a lokallag's
    // leaders in its chat, a private channel's or a group's managers in
    // theirs (can_moderate_channel_messages). Asked again on every action.
    canModerateChannelMessages(channel.id),
    getPinnedMessageId(channel.id),
  ]);

  // Lokallag channels only: the main chat may offer "+ Ny privat kanal", a
  // private channel may offer "Administrer kanal". Each answer comes from the
  // database for this viewer. The participant list of a private channel is
  // for everyone who can read it — which this viewer can, or the channel
  // would not have been found above.
  const localGroup = channel.localGroupId
    ? (await getLocalGroups(community.id)).find((group) => group.id === channel.localGroupId)
    : undefined;
  const canManage = channel.isPrivate ? await canManagePrivateChannel(channel.id) : false;
  const [canCreate, roster] = await Promise.all([
    localGroup && !channel.isPrivate ? canCreatePrivateChannel(localGroup.id) : false,
    channel.isPrivate ? getPrivateChannelRoster(community.id, channel.id) : [],
  ]);
  // A team's chat: how its audience is worded, and — for someone who may
  // manage the team — the way to its entry on the Grupper page.
  const subgroup = channel.subgroupId
    ? (await getSubgroups(community.id)).find((group) => group.id === channel.subgroupId)
    : undefined;
  const managesSubgroup = subgroup ? await canManageSubgroup(subgroup.id) : false;
  // One of the community's own channels, for its administrators: the sections
  // it can move to and what deleting it would remove.
  const viewerIsAdmin = membership?.role === "admin" && membership.status === "active";
  const canPost =
    !channel.archived &&
    (!channel.readOnly || membership?.role === "admin" || membership?.role === "moderator");
  // "Ressurser" is offered where files can be shared now, where any file,
  // link or folder exists — switching uploads off or archiving never hides
  // them — and to whoever manages the channel's resources (its community's
  // administrators; in a lokallag's chats also its leaders), so an empty
  // channel's first link can be added and its uploads switched on. A channel
  // that has never had anything stays quiet for members. Every flag is the
  // database's answer for this viewer, and every action asks again.
  const hasResources = resourceSummary.files + resourceSummary.links + resourceSummary.folders > 0;
  const resources =
    resourcePermissions.canRead &&
    (channelTakesFiles(channel) ||
      hasResources ||
      resourcePermissions.canManage ||
      resourcePermissions.canConfigureUploads)
      ? {
          summary: resourceSummary,
          permissions: {
            canContribute: resourcePermissions.canContribute,
            canManage: resourcePermissions.canManage,
            viewerId: user.id,
          },
          // A lokallag's main chat has no edit dialog, so its uploads are
          // switched in Ressurser; a community channel keeps "Rediger kanal".
          uploads:
            channel.localGroupId && !channel.isPrivate && resourcePermissions.canConfigureUploads
              ? { enabled: Boolean(channel.fileSharing) }
              : undefined,
        }
      : undefined;
  const channelAdmin =
    viewerIsAdmin && isCommunityChannel(channel)
      ? await Promise.all([getChannelSections(community.id), getCommunityChannelContentCounts(channel.id)])
      : undefined;
  const personas = await getCommunityPersonas(community.id, [
    ...new Set([user.id, ...messages.map((message) => message.authorId)]),
  ]);
  const authors = Object.fromEntries(personas);
  // Whom the messages mention, as they are called here now — only those this
  // viewer may see (can_view_community_profile, which admits anyone mentioned
  // in a message they can read). A display name changed since is shown as it
  // is now; the message itself only holds the account id.
  const mentionPeople = Object.fromEntries(
    await getVisibleCommunityPersonas(community.id, [
      ...new Set(messages.flatMap((message) => mentionIds(message.body))),
    ]),
  );

  return (
    <ChannelView
      // A link to one message (`?melding=`) opens a fresh view at it.
      key={`${channel.id}:${focusMessageId ?? ""}`}
      channel={channel}
      community={community}
      initialMessages={messages}
      authors={authors}
      currentUser={personas.get(user.id)!}
      canPost={canPost}
      // A main lokallag or team channel's name follows its group and
      // set_channel_details() refuses it, so there is nothing to offer there.
      // A private lokallag channel is edited by whoever manages it.
      canEdit={
        channel.isPrivate
          ? canManage
          : viewerIsAdmin && isCommunityChannel(channel)
      }
      privateChannels={
        localGroup
          ? {
              localGroup: { id: localGroup.id, name: localGroup.name },
              canCreate,
              createRequested: canCreate && ny === "privat",
              canManage,
              roster,
              viewerIsAdmin,
            }
          : undefined
      }
      subgroup={
        subgroup
          ? {
              moderatorsRead: subgroup.moderatorsRead,
              manageHref: managesSubgroup
                ? `/community/${community.id}/grupper#gruppe-${subgroup.id}`
                : undefined,
            }
          : undefined
      }
      customEmojis={customEmojis}
      attachmentPolicy={attachmentPolicy}
      resources={resources}
      focusMessageId={focusMessageId}
      canModerate={canModerate}
      pinnedMessageId={pinnedMessageId}
      mentionPeople={mentionPeople}
      channelAdmin={channelAdmin ? { sections: channelAdmin[0], counts: channelAdmin[1] } : undefined}
      lastActivityLabel={
        messages.length > 0
          ? timeAgo(messages[messages.length - 1].createdAt, communityLocale(community))
          : undefined
      }
    />
  );
}
