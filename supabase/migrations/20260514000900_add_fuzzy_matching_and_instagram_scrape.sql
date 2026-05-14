create extension if not exists pg_trgm;

alter table public.jobs
  drop constraint if exists jobs_kind_check;

alter table public.jobs
  add constraint jobs_kind_check check (
    kind in ('page_scrape', 'instagram_scrape')
  );

create index if not exists brands_name_trgm_idx
  on public.brands using gin (name gin_trgm_ops);

create index if not exists brands_domain_trgm_idx
  on public.brands using gin (domain gin_trgm_ops);

create or replace function public.fuzzy_match_brands(
  p_user_id uuid,
  p_name text,
  p_domain text,
  p_min_score numeric
)
returns table(brand_id uuid, score numeric, matched_field text)
language sql
as $$
  select
    brand_id,
    max(score)::numeric as score,
    (array_agg(matched_field order by score desc))[1] as matched_field
  from (
    select
      id as brand_id,
      similarity(name, p_name) as score,
      'name' as matched_field
    from public.brands
    where user_id = p_user_id
      and p_name is not null
      and similarity(name, p_name) >= p_min_score
    union all
    select
      id as brand_id,
      similarity(coalesce(domain, ''), p_domain) as score,
      'domain' as matched_field
    from public.brands
    where user_id = p_user_id
      and p_domain is not null
      and domain is not null
      and similarity(domain, p_domain) >= p_min_score
  ) candidates
  group by brand_id
  order by score desc
  limit 5;
$$;

revoke execute on function public.fuzzy_match_brands(uuid, text, text, numeric) from anon;
grant execute on function public.fuzzy_match_brands(uuid, text, text, numeric) to authenticated;
grant execute on function public.fuzzy_match_brands(uuid, text, text, numeric) to service_role;

create table public.brand_match_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  incoming_payload_json jsonb not null,
  candidate_brand_ids uuid[] not null,
  candidate_scores numeric(5,4)[] not null,
  source text not null,
  status text not null default 'open',
  resolved_brand_id uuid references public.brands(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  constraint brand_match_proposals_status_check
    check (status in ('open', 'merged_into', 'created_new', 'dismissed')),
  constraint brand_match_proposals_arrays_match
    check (array_length(candidate_brand_ids, 1) = array_length(candidate_scores, 1))
);

create table public.competitor_handles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  handle text not null,
  platform text not null default 'instagram',
  last_scraped_at timestamptz,
  notes text,
  constraint competitor_handles_unique unique (creator_profile_id, handle)
);

create trigger set_brand_match_proposals_updated_at
before update on public.brand_match_proposals
for each row execute function public.set_updated_at();

create trigger set_competitor_handles_updated_at
before update on public.competitor_handles
for each row execute function public.set_updated_at();

create trigger set_competitor_handles_user_id
before insert or update of user_id, creator_profile_id on public.competitor_handles
for each row execute function public.set_user_id_from_creator_profile();

alter table public.brand_match_proposals enable row level security;
alter table public.competitor_handles enable row level security;

create policy "users can select own brand_match_proposals"
on public.brand_match_proposals for select
using (user_id = auth.uid());

create policy "users can insert own brand_match_proposals"
on public.brand_match_proposals for insert
with check (user_id = auth.uid());

create policy "users can update own brand_match_proposals"
on public.brand_match_proposals for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own brand_match_proposals"
on public.brand_match_proposals for delete
using (user_id = auth.uid());

create policy "users can select own competitor_handles"
on public.competitor_handles for select
using (user_id = auth.uid());

create policy "users can insert own competitor_handles"
on public.competitor_handles for insert
with check (user_id = auth.uid());

create policy "users can update own competitor_handles"
on public.competitor_handles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own competitor_handles"
on public.competitor_handles for delete
using (user_id = auth.uid());
