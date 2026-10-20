-- 在 Reading 项目的 SQL Editor 完整执行。不修改阅读数据表。
begin;
create table if not exists public.health_journals (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint health_payload_shape check (coalesce(
    jsonb_typeof(payload) = 'object' and payload->>'version' = '1'
    and jsonb_typeof(payload->'foods') = 'array'
    and jsonb_typeof(payload->'exercises') = 'array'
    and jsonb_typeof(payload->'days') = 'object'
    and jsonb_typeof(payload->'targets') = 'object'
    and octet_length(payload::text) <= 20971520
  , false))
);
alter table public.health_journals enable row level security;
revoke all on public.health_journals from public, anon, authenticated;
grant select, insert, update on public.health_journals to authenticated;
drop policy if exists health_own_journal on public.health_journals;
create policy health_own_journal on public.health_journals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.save_health_journal(p_payload jsonb, p_expected_revision bigint, p_expected_user uuid)
returns table(payload jsonb, revision bigint)
language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); affected integer;
begin
  if uid is null then raise exception 'HEALTH_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if p_expected_user is null or uid <> p_expected_user then
    raise exception 'HEALTH_ACCOUNT_CHANGED' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'HEALTH_INVALID_REVISION' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.health_journals as journal(user_id, payload, revision)
      values (uid, p_payload, 1) on conflict (user_id) do nothing;
  else
    update public.health_journals as journal
      set payload = p_payload, revision = journal.revision + 1, updated_at = clock_timestamp()
      where journal.user_id = uid and journal.revision = p_expected_revision;
  end if;
  get diagnostics affected = row_count;
  if affected = 0 then raise exception 'HEALTH_CONFLICT' using errcode = '40001'; end if;
  return query select journal.payload, journal.revision from public.health_journals as journal where journal.user_id = uid;
end;
$$;
revoke all on function public.save_health_journal(jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_health_journal(jsonb,bigint,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
