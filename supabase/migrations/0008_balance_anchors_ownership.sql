-- 0008_balance_anchors_ownership.sql
-- balance_anchors (0007) has the same (user_id, account_id) shape as
-- transactions — RLS's `auth.uid() = user_id` alone doesn't stop a client
-- from inserting a row with their own real user_id but a forged account_id
-- belonging to a different user's account (Postgres FK checks don't respect
-- RLS). Mirrors transactions_check_account_ownership (migration 0002).

create function public.balance_anchors_check_account_ownership()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.financial_accounts a
    where a.id = new.account_id
      and a.user_id = new.user_id
  ) then
    raise exception 'balance_anchors: account_id does not belong to user_id';
  end if;

  return new;
end;
$$;

create trigger balance_anchors_account_ownership
  before insert or update on public.balance_anchors
  for each row
  execute function public.balance_anchors_check_account_ownership();
