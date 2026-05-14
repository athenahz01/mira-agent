create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  status text not null default 'queued',
  payload_json jsonb not null,
  result_json jsonb,
  error_message text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  locked_by text,
  locked_until timestamptz,
  constraint jobs_kind_check check (
    kind in ('page_scrape', 'apify_scrape')
  ),
  constraint jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  constraint jobs_attempts_check check (attempts >= 0 and max_attempts > 0)
);

create index jobs_pending_idx on public.jobs (next_attempt_at)
  where status = 'queued';

create index jobs_user_status_idx
  on public.jobs (user_id, status, kind);

create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

create policy "users can select own jobs"
on public.jobs for select
using (user_id = auth.uid());

create policy "users can insert own jobs"
on public.jobs for insert
with check (user_id = auth.uid());

create policy "users can update own jobs"
on public.jobs for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own jobs"
on public.jobs for delete
using (user_id = auth.uid());

create or replace function public.claim_next_job(
  p_kind text,
  p_worker_id text,
  p_lease_seconds int
)
returns setof public.jobs
language plpgsql
as $$
begin
  return query
  update public.jobs
  set
    status = 'running',
    locked_by = p_worker_id,
    locked_until = now() + (p_lease_seconds || ' seconds')::interval,
    started_at = now(),
    finished_at = null,
    error_message = null,
    attempts = attempts + 1
  where id = (
    select id
    from public.jobs
    where kind = p_kind
      and status = 'queued'
      and next_attempt_at <= now()
    order by next_attempt_at asc, created_at asc
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;

revoke execute on function public.claim_next_job(text, text, int) from anon;
revoke execute on function public.claim_next_job(text, text, int) from authenticated;
grant execute on function public.claim_next_job(text, text, int) to service_role;
