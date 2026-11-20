-- 0048_invitation_emails.sql
-- The invitation email (the notify Edge Function) sends real mail to invitations.email, so the
-- database now holds that column to one plain address and paces the sends.
--
--   1. One plain address. Until now the address only had to be lowercase and look like
--      '%@%.%' (0001), so a writer going straight to the API could store "x <ceo@otherco.com>",
--      "<ceo@otherco.com>" or "a@gmail.com,ceo@otherco.com". guard_invitation_target (0028) reads
--      the domain with split_part, so those slipped past its domain rules, and the email would
--      have gone wherever the string pointed. The check below is the same pattern notify applies
--      before it sends. Every row in production matched it before this was written.
--   2. A pace for resends. invitations.last_emailed_at is when the invitation email last went.
--      notify claims it in one conditional update with its service client (only when it is empty
--      or more than 10 minutes old, and the invitation is still waiting), and puts the old value
--      back if the send fails. No signed-in writer sets or changes it, Rococo admins included,
--      so nobody can clear it to send again early. The SQL editor, with no signed-in user, can.
--
-- Idempotent: safe to paste again.

-- 1. One plain address ------------------------------------------------------------------------
alter table public.invitations drop constraint if exists invitations_email_address_check;
alter table public.invitations
  add constraint invitations_email_address_check
  check (email ~ '^[^\s@<>,;:"()[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$');

-- 2. A pace for resends ---------------------------------------------------------------------
alter table public.invitations add column if not exists last_emailed_at timestamptz;

comment on column public.invitations.last_emailed_at is
  'When the invitation email last went out. Written only by the notify function''s service client.';

create or replace function public.guard_invitation_emailed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The notify function's service client and the SQL editor have no signed-in user.
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.last_emailed_at is not null then
    raise exception 'Only the invitation email records when it was sent.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.last_emailed_at is distinct from old.last_emailed_at then
    raise exception 'Only the invitation email records when it was sent.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_invitation_emailed() from public, anon, authenticated;

drop trigger if exists invitations_guard_emailed on public.invitations;
create trigger invitations_guard_emailed
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_emailed();
