import {
  getChannelResourceContributors,
  getChannelResourceFolders,
  getChannelResourceSummary,
  getPinnedChannelResources,
  listChannelResources,
  type ChannelResourceRow,
} from "@/lib/channel-resource-data";
import { parseResourceQuery, type ChannelResource, type ResourcePage } from "@/lib/channel-resources";
import { getChannel, getCommunityPersonas } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * One page of a channel's Ressurser, as JSON.
 *
 *   ?q=           part of a file name or link title, across every folder
 *   ?kind=        document | image | other | link
 *   ?contributor= who uploaded the file or added the link
 *   ?folder=      none (unfiled) | a folder id (directly in it); absent: all
 *   ?sort=        newest (default) | oldest | name_asc | name_desc
 *   ?cursor=      the previous page's `nextCursor`
 *   ?meta=1       also the pins, folders, contributors and counts
 *
 * Everything is read with the caller's own session. The channel must be one
 * they can read (`channels_select`) and belong to the community in the
 * address; the rows come from functions that answer only for a channel the
 * caller can read now. A channel they cannot read is the same empty 404 as
 * one that does not exist. File addresses are the authenticated attachment
 * route; link addresses are what a member typed, opened by the browser and
 * never fetched here.
 */
export const dynamic = "force-dynamic";

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  request: Request,
  context: RouteContext<"/community/[communityId]/channel/[channelId]/resources">,
) {
  const { communityId, channelId } = await context.params;
  if (channelId.length > 200) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  const channel = await getChannel(channelId);
  if (!channel || channel.communityId !== communityId) return notFound();

  const params = new URL(request.url).searchParams;
  const query = parseResourceQuery(params);
  const withMeta = params.get("meta") === "1";

  const [page, pins, folders, contributors, summary] = await Promise.all([
    listChannelResources(channel.id, query),
    withMeta ? getPinnedChannelResources(channel.id) : undefined,
    withMeta ? getChannelResourceFolders(channel.id) : undefined,
    withMeta ? getChannelResourceContributors(channel.id) : undefined,
    withMeta ? getChannelResourceSummary(channel.id) : undefined,
  ]);

  // Names as each person appears in this community, never their account.
  const ids = new Set<string>();
  for (const row of [...page.resources, ...(pins ?? [])]) if (row.contributorId) ids.add(row.contributorId);
  for (const contributor of contributors ?? []) ids.add(contributor.id);
  const personas = await getCommunityPersonas(communityId, [...ids]);
  const named = (row: ChannelResourceRow): ChannelResource =>
    ({ ...row, contributorName: (row.contributorId && personas.get(row.contributorId)?.name) || "" }) as ChannelResource;

  const body: ResourcePage = {
    resources: page.resources.map(named),
    nextCursor: page.nextCursor,
    meta:
      withMeta && pins && folders && contributors && summary
        ? {
            pins: pins.map(named),
            folders,
            contributors: contributors
              .map((contributor) => ({
                id: contributor.id,
                name: personas.get(contributor.id)?.name ?? "",
                count: contributor.count,
              }))
              .sort((a, b) => a.name.localeCompare(b.name, "nb")),
            summary,
          }
        : undefined,
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
