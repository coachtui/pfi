-- Plaid Slice 2 (DECISIONS #44, security review): the per-user Item cap is
-- checked in the server actions at mint and exchange time, but those checks
-- are read-then-insert and can be raced from parallel Link flows. This
-- trigger is the hard ceiling in the database (matches the maximum
-- PLAID_MAX_ITEMS accepts); the configurable, lower cap stays in the app.
create or replace function public.plaid_items_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'disconnected' and (
    select count(*) from public.plaid_items
    where user_id = new.user_id and status <> 'disconnected'
  ) >= 20 then
    raise exception 'plaid_items: active Item cap reached for user %', new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists plaid_items_cap_backstop on public.plaid_items;
create trigger plaid_items_cap_backstop
  before insert on public.plaid_items
  for each row execute function public.plaid_items_enforce_cap();
