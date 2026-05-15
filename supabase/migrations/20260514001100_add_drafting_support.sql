alter table public.outreach_rules
  add column max_drafts_per_day int not null default 10,
  add constraint outreach_rules_max_drafts_check
    check (max_drafts_per_day between 0 and 50);

alter table public.jobs
  drop constraint if exists jobs_kind_check;

alter table public.jobs
  add constraint jobs_kind_check check (
    kind in ('page_scrape', 'instagram_scrape', 'auto_draft')
  );

create table public.draft_suppressions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  deal_type text not null,
  suppressed_until timestamptz not null,
  reason text not null,
  constraint draft_suppressions_deal_type_check
    check (deal_type in ('paid', 'gifting', 'affiliate', 'ugc', 'ambassador')),
  constraint draft_suppressions_reason_check
    check (reason in ('skipped', 'excluded', 'manual')),
  unique (creator_profile_id, brand_id, deal_type)
);

create index draft_suppressions_active_idx
on public.draft_suppressions (user_id, suppressed_until);

create index messages_pending_approval_idx
on public.messages (user_id, status, created_at desc)
where status = 'pending_approval';

create trigger set_draft_suppressions_updated_at
before update on public.draft_suppressions
for each row execute function public.set_updated_at();

create trigger set_draft_suppressions_user_id
before insert or update of user_id, creator_profile_id on public.draft_suppressions
for each row execute function public.set_user_id_from_creator_profile();

alter table public.draft_suppressions enable row level security;

create policy "users can select own draft_suppressions"
on public.draft_suppressions for select
using (user_id = auth.uid());

create policy "users can insert own draft_suppressions"
on public.draft_suppressions for insert
with check (user_id = auth.uid());

create policy "users can update own draft_suppressions"
on public.draft_suppressions for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own draft_suppressions"
on public.draft_suppressions for delete
using (user_id = auth.uid());
