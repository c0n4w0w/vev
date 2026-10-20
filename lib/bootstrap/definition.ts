import { communities } from "@/lib/mock/communities";
import { communityPeople } from "@/lib/mock/community-people";
import { communityPolicies } from "@/lib/mock/community-policies";
import { localGroups } from "@/lib/mock/local-groups";
import { subgroups } from "@/lib/mock/subgroups";
import type { Database } from "@/lib/supabase/database.types";

/**
 * What a real TING installation starts with: the three organisations, each
 * with its own identity, settings and permanent structure — and no people,
 * no content and no accounts.
 *
 * Nothing is written down twice. The organisations' own definitions already
 * live in the repository, in the files the showcase seed reads, and those
 * files say of themselves which parts are the organisations' and which are
 * the showcase's:
 *
 *   lib/mock/communities.ts         name, slug, branding, language, the
 *                                   texts and links in the header
 *   lib/mock/community-policies.ts  who may see the member list and message
 *   lib/mock/local-groups.ts        the lokallag each organisation has
 *   lib/mock/subgroups.ts           Safe-Space frivillige
 *   lib/mock/community-people.ts    the organisation's published directory
 *
 * This module picks from them, field by field, and leaves the rest behind:
 * the cast of fixture accounts, their memberships and local-group choices,
 * group members and managers, the showcase's channel sections and channels,
 * posts, comments, messages, events, emojis, notifications and requests. A
 * bootstrap creates none of those.
 *
 * In particular a community starts with **no channels and no sections**.
 * How an organisation arranges its conversations is its administrators'
 * decision, made in the app (Administrasjon → Kanaler), and a later run never
 * puts back a channel or section they deleted — there is nothing here to put
 * back. The only channels a fresh community has are the ones the database
 * itself gives each lokallag and group (their chats), under the two platform
 * headings below.
 *
 * It is also where a fresh database catches up with migrations that only
 * ever corrected an existing row. Applied to an empty database they change
 * nothing, so the values they were written to establish have to arrive here:
 *
 *   20260927100000  Under The Rug works in English            → default_locale
 *   20261015100000  header: location, founding year, website  → location, founded_year, links
 *   20261005100000  Safe-Space frivillige exists in FTR       → subgroups
 *   20261022100000  …and its moderators read it               → moderators_read
 *   20261017100000  two staff contact addresses in FTR        → people
 *
 * `npm run check:bootstrap` holds this to the seed: a bootstrapped database
 * and a seeded one must agree on every row both create.
 */

type Tables = Database["public"]["Tables"];

export type CommunityRow = Tables["communities"]["Insert"];
export type ChannelGroupRow = Tables["channel_groups"]["Insert"];

export interface LocalGroupRow {
  name: string;
  slug: string;
  sort_order: number;
}

export interface SubgroupRow {
  slug: string;
  name: string;
  description: string;
  moderators_read: boolean;
}

export interface PersonRow {
  section: Tables["community_people"]["Row"]["section"];
  /** Slug of the lokallag a local-group leader's card belongs to. */
  local_group_slug: string | null;
  name: string;
  role: string | null;
  email: string | null;
  description: string | null;
  sort_order: number;
}

export interface CommunityDefinition {
  community: CommunityRow;
  localGroups: LocalGroupRow[];
  subgroups: SubgroupRow[];
  people: PersonRow[];
}

/**
 * Which organisations start with their directory filled in.
 *
 * A directory card names a real person, and some carry an address. Foreningen
 * Tryggere Ruspolitikk's is part of what the first installation was asked to
 * contain. The other two are in the repository as well and are left out until
 * someone says they should be there: add the community's id and run the
 * bootstrap again — it only ever adds what is missing.
 */
export const DIRECTORY_INCLUDED: ReadonlySet<string> = new Set(["tryggere-ruspolitikk"]);

/** The slug the seed gives a lokallag, so both name the same row. */
export function localGroupSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[æ]/g, "a")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The platform's own headings, under which the database files lokallag chats,
 * private lokallag channels and group chats. They are created by the
 * migrations that introduced them and are listed so a run can confirm they
 * are there, in this order. A community's own sections are not platform rows
 * and are not created here.
 */
export const channelGroupRows: ChannelGroupRow[] = [
  { id: "lokallag", label: "Mitt lokallag", position: 0 },
  { id: "grupper", label: "Mine grupper", position: 1 },
];

export const communityDefinitions: CommunityDefinition[] = communities.map((community) => {
  const policy = communityPolicies.find((entry) => entry.communityId === community.id);
  if (!policy) throw new Error(`Ingen personverninnstillinger for ${community.id}`);

  return {
    community: {
      id: community.id,
      slug: community.slug,
      name: community.name,
      tagline: community.tagline,
      public_description: community.publicDescription,
      about: community.about,
      location: community.location,
      founded_year: community.foundedYear,
      accent: community.branding.accent,
      accent_soft: community.branding.accentSoft,
      monogram: community.branding.monogram,
      mark_style: community.branding.markStyle,
      access_policy: community.accessPolicy,
      default_locale: community.defaultLocale,
      links: community.links,
      member_directory_visibility: policy.memberDirectoryVisibility,
      dm_policy: policy.dmPolicy,
      reaction_author_visibility: policy.reactionAuthorVisibility,
    },

    localGroups: localGroups
      .filter((group) => group.communityId === community.id)
      .map((group) => ({ name: group.name, slug: localGroupSlug(group.name), sort_order: group.sortOrder })),

    subgroups: subgroups
      .filter((subgroup) => subgroup.communityId === community.id)
      .map((subgroup) => ({
        slug: subgroup.slug,
        name: subgroup.name,
        description: subgroup.description,
        moderators_read: subgroup.moderatorsRead,
      })),

    // Never `userId`: that links a card to a fixture account, and there are
    // no accounts. An administrator links a card to a real one in the app.
    people: DIRECTORY_INCLUDED.has(community.id)
      ? communityPeople
          .filter((person) => person.communityId === community.id)
          .map((person) => ({
            section: person.section,
            local_group_slug: person.localGroupName ? localGroupSlug(person.localGroupName) : null,
            name: person.name,
            role: person.role ?? null,
            email: person.email ?? null,
            description: person.description ?? null,
            sort_order: person.sortOrder,
          }))
      : [],
  };
});

/** Directory cards the repository holds for a community this run leaves out. */
export function directoryLeftOut(communityId: string): number {
  if (DIRECTORY_INCLUDED.has(communityId)) return 0;
  return communityPeople.filter((person) => person.communityId === communityId).length;
}
