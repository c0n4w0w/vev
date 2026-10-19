/**
 * Keeps the check scripts from silently emptying private channels they did
 * not create.
 *
 * Several suites switch a fixture member's status, or lokallag, for a moment
 * and then put it back. channel_participants_follow_membership removes that
 * member from every private lokallag channel the moment they stop being an
 * active member there — the right rule for real people — and putting the
 * status back does not bring the participation back. A private channel made
 * by hand in the development app would quietly lose its people.
 *
 * So a suite records every participation before it starts, and its cleanup
 * restores those that vanished: only where the channel still exists and the
 * person is again an active member of its lokallag (the table's own guard
 * asks the same), never one the suite created, and with the original
 * manager flag, inviter and time.
 */
import { execFileSync } from "node:child_process";

const psql = (input: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    { input, stdio: ["pipe", "pipe", "pipe"] },
  ).toString().trim();

let snapshot: string | undefined;

/** Call first in a suite's main(). */
export function rememberChannelParticipants(): void {
  snapshot = psql("select coalesce(json_agg(cp), '[]') from public.channel_participants cp;");
}

/** Call at the end of a suite's cleanup. Returns how many were put back. */
export function restoreChannelParticipants(): number {
  if (!snapshot) return 0;
  const restored = psql(`
    with recorded as (
      select * from json_populate_recordset(null::public.channel_participants, $snapshot$${snapshot}$snapshot$::json)
    ), back as (
      insert into public.channel_participants
      select r.* from recorded r
      where exists (
          select 1 from public.channels c
          where c.id = r.channel_id and c.is_private
            and c.community_id = r.community_id and c.local_group_id = r.local_group_id
        )
        and exists (
          select 1 from public.memberships m
          where m.user_id = r.user_id and m.community_id = r.community_id
            and m.status = 'active' and m.local_group_id = r.local_group_id
        )
      on conflict do nothing
      returning 1
    )
    select count(*) from back;`);
  const count = Number(restored.split("\n").pop());
  if (count > 0) console.log(`  (satte tilbake ${count} kanaldeltakelse(r) som testen hadde fjernet)`);
  return count;
}
