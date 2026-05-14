create table public.brand_fit_scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  deal_type text not null,
  base_fit_score int not null,
  deal_type_score int not null,
  score_rationale_json jsonb not null,
  computed_at timestamptz not null default now(),
  constraint brand_fit_scores_deal_type_check
    check (deal_type in ('paid', 'gifting', 'affiliate', 'ugc', 'ambassador')),
  constraint brand_fit_scores_base_check check (base_fit_score between 0 and 100),
  constraint brand_fit_scores_deal_type_check_range check (deal_type_score between 0 and 100),
  constraint brand_fit_scores_unique unique (creator_profile_id, brand_id, deal_type)
);

create index brand_fit_scores_ranked_idx
on public.brand_fit_scores (creator_profile_id, deal_type, deal_type_score desc);

create trigger set_brand_fit_scores_updated_at
before update on public.brand_fit_scores
for each row execute function public.set_updated_at();

create trigger set_brand_fit_scores_user_id
before insert or update of user_id, creator_profile_id on public.brand_fit_scores
for each row execute function public.set_user_id_from_creator_profile();

alter table public.brand_fit_scores enable row level security;

create policy "users can select own brand_fit_scores"
on public.brand_fit_scores for select
using (user_id = auth.uid());

create policy "users can insert own brand_fit_scores"
on public.brand_fit_scores for insert
with check (user_id = auth.uid());

create policy "users can update own brand_fit_scores"
on public.brand_fit_scores for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own brand_fit_scores"
on public.brand_fit_scores for delete
using (user_id = auth.uid());
