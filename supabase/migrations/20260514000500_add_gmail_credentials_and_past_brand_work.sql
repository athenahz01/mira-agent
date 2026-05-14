alter table public.users
  drop column if exists gmail_oauth_token_ref;

create table public.gmail_credentials (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_email text not null,
  refresh_token_encrypted text not null,
  scopes text[] not null,
  revoked_at timestamptz,
  last_refreshed_at timestamptz,
  unique (user_id, google_email)
);

create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  redirect_to text
);

create table public.past_brand_work (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  brand_name text not null,
  year int not null check (year between 2000 and 2100),
  deal_type text not null check (
    deal_type in ('paid', 'gifting', 'affiliate', 'ugc', 'ambassador')
  ),
  one_liner text not null,
  link text,
  sort_order int not null default 0
);

create trigger set_gmail_credentials_updated_at
before update on public.gmail_credentials
for each row execute function public.set_updated_at();

create trigger set_oauth_states_updated_at
before update on public.oauth_states
for each row execute function public.set_updated_at();

create trigger set_past_brand_work_updated_at
before update on public.past_brand_work
for each row execute function public.set_updated_at();

create trigger set_past_brand_work_user_id
before insert or update of user_id, creator_profile_id on public.past_brand_work
for each row execute function public.set_user_id_from_creator_profile();

alter table public.gmail_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.past_brand_work enable row level security;

create policy "users can select own gmail_credentials"
on public.gmail_credentials for select
using (user_id = auth.uid());

create policy "users can insert own gmail_credentials"
on public.gmail_credentials for insert
with check (user_id = auth.uid());

create policy "users can update own gmail_credentials"
on public.gmail_credentials for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own gmail_credentials"
on public.gmail_credentials for delete
using (user_id = auth.uid());

create policy "users can select own oauth_states"
on public.oauth_states for select
using (user_id = auth.uid());

create policy "users can insert own oauth_states"
on public.oauth_states for insert
with check (user_id = auth.uid());

create policy "users can update own oauth_states"
on public.oauth_states for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own oauth_states"
on public.oauth_states for delete
using (user_id = auth.uid());

create policy "users can select own past_brand_work"
on public.past_brand_work for select
using (user_id = auth.uid());

create policy "users can insert own past_brand_work"
on public.past_brand_work for insert
with check (user_id = auth.uid());

create policy "users can update own past_brand_work"
on public.past_brand_work for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own past_brand_work"
on public.past_brand_work for delete
using (user_id = auth.uid());
