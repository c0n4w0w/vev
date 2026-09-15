-- Per-staff opt-in to direct messages from ordinary members.
--
-- `dm_policy = 'staff_only'` says an ordinary member may not open a
-- conversation with anyone. That is the right default for the two Tryggere
-- organisations, but it is too blunt at the edges: a frivilligkoordinator or
-- an erfaringskonsulent may well want to be reachable, while the rest of the
-- staff stays closed. Making that a community-wide switch would force one
-- answer on everybody; making it a profile column would follow the person
-- into communities where they are an ordinary member and the question does
-- not arise.
--
-- So it is attached to the membership: the row that already says *this person,
-- in this community, in this role*. One person can be reachable in Tryggere
-- Ruspolitikk and not in Tryggere Ungdom, which is the behaviour the
-- organisations asked for.
--
-- This refines `staff_only`; it does not replace it. A community on
-- `dm_policy = 'members'` (Under The Rug) is unaffected in every direction:
-- its members could already message each other, and nothing here narrows
-- that.

alter table memberships
  add column accepts_member_dms boolean not null default false;

comment on column memberships.accepts_member_dms is
  'Staff only: when true, ordinary members of this community may open a DM with this person. Default false — never turned on for anyone by a migration. Has no effect unless the row''s role is admin or moderator, so a demotion silently closes the door again.';

-- ── Who may open a conversation ─────────────────────────────────────────
--
-- Replaces the previous two-clause version. The first two clauses are
-- unchanged and carry the existing semantics:
--
--   members:    any two active members of the community.
--   staff_only: both parties admin or moderator.
--
-- The third is new, and is the only thing this migration widens:
--
--   staff_only: any active member may write to a staff member who has
--               switched `accepts_member_dms` on.
--
-- Note what the third clause still requires. The sender must hold an active
-- membership of the same community — the joins below give a non-member
-- nothing, whatever the flag says. The recipient must *currently* be staff:
-- the flag alone authorises nothing, so a staff member who is demoted to
-- member stops being reachable without anyone having to remember to switch
-- the flag back off. And it says nothing about the reverse direction — staff
-- writing to an ordinary member under `staff_only` stays refused, exactly as
-- before, because this is about being reachable, not about being able to
-- reach.
create or replace function public.can_send_dm(cid text, recipient uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from memberships sender
    join memberships rec on rec.community_id = sender.community_id
    join communities c on c.id = sender.community_id
    where sender.community_id = cid
      and sender.user_id = auth.uid() and sender.status = 'active'
      and rec.user_id = recipient and rec.status = 'active'
      and recipient <> auth.uid()
      and (
        c.dm_policy = 'members'
        or (sender.role in ('admin', 'moderator') and rec.role in ('admin', 'moderator'))
        or (rec.role in ('admin', 'moderator') and rec.accepts_member_dms)
      )
  );
$$;

revoke execute on function public.can_send_dm(text, uuid) from public, anon;
grant execute on function public.can_send_dm(text, uuid) to authenticated;

-- ── Changing your own setting ───────────────────────────────────────────
--
-- `memberships` has no INSERT, UPDATE or DELETE policy, and does not get one
-- here. That is deliberate and long-standing: every write to the membership
-- table goes through a SECURITY DEFINER function that decides for itself who
-- is asking, because an UPDATE policy cannot express "you may change this one
-- column and nothing else" — `with check` sees the finished row, not which
-- fields moved, so a policy permissive enough to let someone flip this flag
-- would also let them rewrite their own `role`.
--
-- Routing it through a function instead means the statement is written here,
-- once, and the only thing a caller controls is which community and true or
-- false.
--
-- Everything it refuses, it refuses structurally rather than by checking:
--   * the acting user is auth.uid(), never an argument, so there is no user
--     id to forge;
--   * only the caller's own row is touched, so one staff member cannot reach
--     another's setting;
--   * the row must be in the community named in the call, so a setting cannot
--     be changed for a different community;
--   * the row must be active and admin or moderator, so an ordinary member
--     cannot switch it on for themselves.
--
-- Returns the value actually stored. A caller who may not change anything
-- gets false back rather than an error: the setting is off for them, which is
-- both true and the safe answer.
create or replace function public.set_accepts_member_dms(
  p_community_id text,
  p_value boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_stored boolean;
begin
  update memberships
     set accepts_member_dms = coalesce(p_value, false)
   where user_id = auth.uid()
     and community_id = p_community_id
     and status = 'active'
     and role in ('admin', 'moderator')
  returning accepts_member_dms into v_stored;

  return coalesce(v_stored, false);
end;
$$;

revoke execute on function public.set_accepts_member_dms(text, boolean) from public, anon;
grant execute on function public.set_accepts_member_dms(text, boolean) to authenticated;
