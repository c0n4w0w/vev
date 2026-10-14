import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import { ButtonLink, EmptyState, PageContainer } from "@/components/ui/primitives";
import {
  canCreatePrivateChannel,
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
  getPrivateChannelRoster,
  getSubgroups,
} from "@/lib/data";
import { getAttachmentPolicy } from "@/lib/attachment-data";
import { isCommunityChannel } from "@/lib/channel-management-form";
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
  const { ny } = await searchParams;
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

  const [membership, messages, customEmojis, attachmentPolicy] = await Promise.all([
    getMembership(user.id, community.id),
    getMessages(channel.id),
    getCommunityEmojis(community.id),
    // Whether this viewer may attach files here — a private group's chat or a
    // private lokallag channel, and not an archived one. The database's
    // answer; it gives the same one again at upload and at send.
    getAttachmentPolicy({ channelId: channel.id }),
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
  const channelAdmin =
    viewerIsAdmin && isCommunityChannel(channel)
      ? await Promise.all([getChannelSections(community.id), getCommunityChannelContentCounts(channel.id)])
      : undefined;
  const personas = await getCommunityPersonas(community.id, [
    ...new Set([user.id, ...messages.map((message) => message.authorId)]),
  ]);
  const authors = Object.fromEntries(personas);

  return (
    <ChannelView
      key={channel.id}
      channel={channel}
      community={community}
      initialMessages={messages}
      authors={authors}
      currentUser={personas.get(user.id)!}
      canPost={
        !channel.archived &&
        (!channel.readOnly ||
          membership?.role === "admin" ||
          membership?.role === "moderator")
      }
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
      channelAdmin={channelAdmin ? { sections: channelAdmin[0], counts: channelAdmin[1] } : undefined}
      lastActivityLabel={
        messages.length > 0
          ? timeAgo(messages[messages.length - 1].createdAt, communityLocale(community))
          : undefined
      }
    />
  );
}
