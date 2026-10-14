import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { channelGroupRows, communityDefinitions, directoryLeftOut, type CommunityDefinition } from "@/lib/bootstrap/definition";

/**
 * Brings a database to the installation described in ./definition.ts.
 *
 * One rule throughout: **add what is missing, change nothing that exists.**
 * Every row is looked up by its natural key first — a community by id, a
 * lokallag or group by community and slug, a directory card by community,
 * section and name. Missing rows are inserted with their final
 * values. A row that is there is left exactly as it is, even where it differs
 * from the definition: an administrator may have rewritten the About text or
 * renamed a lokallag since, and a second run must not undo that. Differences
 * are reported, never corrected.
 *
 * That makes it safe to run again at any time, and safe to run after one
 * that stopped halfway: it picks up where the last one ended.
 *
 * One exception, and it is not a community's row: the order of the two
 * platform headings, `lokallag` and `grupper`. They are created by migrations,
 * nobody edits them in the app, and their order is the same for every
 * community, so it is put right here.
 *
 * It creates no account, no membership, no content, and no community channel
 * or channel section: those are each community's administrators' to create
 * (and to delete, which a later run then respects). It deletes nothing, and
 * touches only the tables named here. With `write: false` it reads and
 * reports and does nothing else.
 */

type Admin = SupabaseClient<Database>;

export interface BootstrapReport {
  /** Rows inserted, or — on a dry run — rows that would be. */
  created: string[];
  /** Rows already there and equal to the definition where it has a say. */
  present: string[];
  /** Rows already there that differ. Left alone. */
  differs: string[];
  /** Platform headings whose order was put right (or would be). */
  corrected: string[];
  /** Things the definition holds and deliberately does not create. */
  skipped: string[];
}

class BootstrapError extends Error {}

type Result<T> = { data: T | null; error: { message: string } | null };

/** The rows a read or an insert returned; a failure stops the run. */
function check<T>(step: string, result: Result<T>): T {
  if (result.error || result.data === null) throw new BootstrapError(`${step}: ${result.error?.message ?? "ingen data"}`);
  return result.data;
}

/** For a write that returns nothing, and a lookup that may find nothing. */
function settle<T>(step: string, result: Result<T>): T | null {
  if (result.error) throw new BootstrapError(`${step}: ${result.error.message}`);
  return result.data;
}

/** JSON with object keys in one order: a jsonb column returns them sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** Field names whose stored value is not the definition's. */
function differences(defined: Record<string, unknown>, stored: Record<string, unknown>, ignore: string[] = []): string[] {
  return Object.keys(defined).filter((key) => !ignore.includes(key) && canonical(defined[key]) !== canonical(stored[key]));
}

export async function applyBootstrap(admin: Admin, options: { write: boolean }): Promise<BootstrapReport> {
  const report: BootstrapReport = { created: [], present: [], differs: [], corrected: [], skipped: [] };
  const { write } = options;

  const note = (label: string, defined: Record<string, unknown>, stored: Record<string, unknown> | null | undefined, ignore?: string[]) => {
    if (!stored) return false;
    const changed = differences(defined, stored, ignore);
    if (changed.length > 0) report.differs.push(`${label} (${changed.join(", ")})`);
    else report.present.push(label);
    return true;
  };

  // Platform headings first: a lokallag or group inserted below gets its chat
  // channel from a trigger, filed under `lokallag` or `grupper`.
  const storedGroups = check("plattformoverskrifter", await admin.from("channel_groups").select("*"));
  for (const group of channelGroupRows) {
    const label = `plattformoverskrift ${group.id}`;
    const existing = storedGroups.find((row) => row.id === group.id);
    const position = group.position ?? 0;
    if (existing && existing.position !== position) {
      if (write) settle(label, await admin.from("channel_groups").update({ position }).eq("id", group.id));
      report.corrected.push(`${label}: plass ${existing.position} → ${position}`);
      existing.position = position;
    }
    if (note(label, group, existing)) continue;
    if (write) settle(label, await admin.from("channel_groups").insert(group));
    report.created.push(label);
  }

  for (const definition of communityDefinitions) {
    await applyCommunity(admin, definition, write, report, note);
  }
  return report;
}

async function applyCommunity(
  admin: Admin,
  definition: CommunityDefinition,
  write: boolean,
  report: BootstrapReport,
  note: (label: string, defined: Record<string, unknown>, stored: Record<string, unknown> | null | undefined, ignore?: string[]) => boolean,
) {
  const id = definition.community.id;

  const stored = settle(`fellesskap ${id}`, await admin.from("communities").select("*").eq("id", id).maybeSingle());
  if (!note(`fellesskap ${id}`, definition.community, stored)) {
    if (write) settle(`fellesskap ${id}`, await admin.from("communities").insert(definition.community));
    report.created.push(`fellesskap ${id}`);
  }
  // On a dry run the community may not exist yet; nothing under it does then.
  const exists = Boolean(stored) || write;

  // Lokallag. Each insert creates the group's chat channel (local_group_channel_sync).
  const storedLocalGroups = exists
    ? check(`lokallag i ${id}`, await admin.from("community_local_groups").select("id, slug, name, sort_order").eq("community_id", id))
    : [];
  const localGroupId = new Map(storedLocalGroups.map((row) => [row.slug, row.id]));
  for (const group of definition.localGroups) {
    const label = `lokallag ${id}/${group.slug}`;
    if (note(label, { ...group }, storedLocalGroups.find((row) => row.slug === group.slug))) continue;
    if (write) {
      const created = check<{ id: string }>(
        label,
        await admin.from("community_local_groups").insert({ community_id: id, ...group }).select("id").single(),
      );
      localGroupId.set(group.slug, created.id);
    }
    report.created.push(label);
  }

  // Groups. Each insert creates the group's private channel (subgroup_channel_sync).
  // Members and managers are people and are appointed in the app.
  const storedSubgroups = exists
    ? check(`grupper i ${id}`, await admin.from("community_subgroups").select("slug, name, description, moderators_read").eq("community_id", id))
    : [];
  for (const subgroup of definition.subgroups) {
    const label = `gruppe ${id}/${subgroup.slug}`;
    if (note(label, { ...subgroup }, storedSubgroups.find((row) => row.slug === subgroup.slug))) continue;
    if (write) settle(label, await admin.from("community_subgroups").insert({ community_id: id, ...subgroup }));
    report.created.push(label);
  }

  // The published directory. A card is the same card if the community,
  // section and name are — the key 20261017100000 addresses them by.
  const storedPeople = exists
    ? check(`organisasjonspersoner i ${id}`, await admin.from("community_people").select("section, name, role, email, description, sort_order, local_group_id").eq("community_id", id))
    : [];
  for (const person of definition.people) {
    const label = `organisasjonsperson ${id}/${person.section}/${person.name}`;
    const { local_group_slug: groupSlug, ...card } = person;
    const groupId = groupSlug ? localGroupId.get(groupSlug) : null;
    if (groupSlug && !groupId && write) throw new BootstrapError(`${label}: lokallaget ${groupSlug} finnes ikke`);

    const existing = storedPeople.find((row) => row.section === person.section && row.name === person.name);
    if (note(label, { ...card, ...(groupId ? { local_group_id: groupId } : {}) }, existing)) continue;
    if (write) {
      settle(label, await admin.from("community_people").insert({ community_id: id, ...card, local_group_id: groupId ?? null }));
    }
    report.created.push(label);
  }

  report.skipped.push(`kanaler og kanalseksjoner i ${id} (opprettes av fellesskapets administratorer i appen)`);

  const leftOut = directoryLeftOut(id);
  if (leftOut > 0) {
    report.skipped.push(`${leftOut} organisasjonspersoner i ${id} (katalogen er ikke tatt med — se DIRECTORY_INCLUDED)`);
  }
}

export interface InstallationSummary {
  community: string;
  /** The community's own channels, archived ones included. Lokallag and group chats are not counted. */
  channels: number;
  sections: number;
  localGroups: number;
  subgroups: number;
  people: number;
  activeMembers: number;
  hasAdministrator: boolean;
}

/** What is there now, in numbers. Names nobody. */
export async function summarizeInstallation(admin: Admin): Promise<InstallationSummary[]> {
  const summary: InstallationSummary[] = [];
  for (const { community } of communityDefinitions) {
    const count = async (table: "channel_sections" | "community_local_groups" | "community_subgroups" | "community_people") =>
      (await admin.from(table).select("*", { count: "exact", head: true }).eq("community_id", community.id)).count ?? 0;
    const communityChannels =
      (
        await admin
          .from("channels")
          .select("*", { count: "exact", head: true })
          .eq("community_id", community.id)
          .is("local_group_id", null)
          .is("subgroup_id", null)
      ).count ?? 0;
    const members = check(
      `medlemskap i ${community.id}`,
      await admin.from("memberships").select("role").eq("community_id", community.id).eq("status", "active"),
    );
    summary.push({
      community: community.id,
      channels: communityChannels,
      sections: await count("channel_sections"),
      localGroups: await count("community_local_groups"),
      subgroups: await count("community_subgroups"),
      people: await count("community_people"),
      activeMembers: members.length,
      hasAdministrator: members.some((row) => row.role === "admin"),
    });
  }
  return summary;
}
