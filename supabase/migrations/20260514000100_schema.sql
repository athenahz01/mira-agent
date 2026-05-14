create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.resolve_child_user_id(
  provided_user_id uuid,
  expected_user_id uuid,
  relation_name text
)
returns uuid
language plpgsql
as $$
begin
  if expected_user_id is null then
    raise exception 'Could not resolve user_id from %', relation_name
      using errcode = '23503';
  end if;

  if provided_user_id is not null and provided_user_id <> expected_user_id then
    raise exception 'user_id does not match % owner', relation_name
      using errcode = '23514';
  end if;

  return expected_user_id;
end;
$$;

create table public.users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null,
  name text,
  timezone text not null default 'America/New_York',
  physical_address text,
  gmail_oauth_token_ref text
);

create table public.creator_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null,
  display_name text not null,
  platform text not null default 'instagram',
  niche_tags text[] not null default '{}',
  audience_size_snapshot int,
  engagement_rate_snapshot numeric(5,4),
  tier text,
  aesthetic_keywords text[] not null default '{}',
  bio_extract text,
  recent_post_themes text[] not null default '{}',
  voice_style_guide_id uuid,
  active boolean not null default true,
  cross_pitch_cooldown_days int not null default 90,
  constraint creator_profiles_tier_check
    check (tier is null or tier in ('nano', 'micro', 'mid', 'macro')),
  constraint creator_profiles_engagement_rate_check
    check (engagement_rate_snapshot is null or engagement_rate_snapshot >= 0),
  constraint creator_profiles_cooldown_check
    check (cross_pitch_cooldown_days >= 0),
  unique (user_id, handle)
);

create table public.voice_style_guides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  version int not null,
  is_active boolean not null default false,
  style_doc_json jsonb not null,
  learned_from_message_ids uuid[] not null default '{}',
  constraint voice_style_guides_version_check check (version > 0),
  unique (creator_profile_id, version)
);

alter table public.creator_profiles
  add constraint creator_profiles_voice_style_guide_fk
  foreign key (voice_style_guide_id)
  references public.voice_style_guides(id)
  on delete set null;

create table public.media_kits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  version int not null,
  pdf_url text,
  data_json jsonb not null,
  is_active boolean not null default false,
  constraint media_kits_version_check check (version > 0),
  unique (creator_profile_id, version)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  domain text,
  instagram_handle text,
  tiktok_handle text,
  category text[] not null default '{}',
  aesthetic_tags text[] not null default '{}',
  size_estimate text,
  creator_friendliness_score int,
  pays_creators boolean,
  last_pitched_at timestamptz,
  pitch_count int not null default 0,
  source_signals_summary text,
  excluded boolean not null default false,
  exclusion_reason text,
  constraint brands_size_estimate_check
    check (
      size_estimate is null
      or size_estimate in (
        'pre-launch',
        'indie-small',
        'indie-medium',
        'established-dtc',
        'legacy-large'
      )
    ),
  constraint brands_creator_friendliness_score_check
    check (
      creator_friendliness_score is null
      or creator_friendliness_score between 0 and 100
    ),
  constraint brands_pitch_count_check check (pitch_count >= 0)
);

create table public.brand_contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  email text not null,
  name text,
  role text,
  source text not null,
  confidence int,
  verified_at timestamptz,
  last_emailed_at timestamptz,
  bounce_count int not null default 0,
  marked_unreachable boolean not null default false,
  unsubscribe_received_at timestamptz,
  constraint brand_contacts_role_check
    check (
      role is null
      or role in (
        'pr',
        'marketing',
        'partnerships',
        'founder',
        'generic_info',
        'unknown'
      )
    ),
  constraint brand_contacts_source_check
    check (
      source in (
        'hunter',
        'page_scrape',
        'manual',
        'linkedin',
        'press_kit',
        'inbound'
      )
    ),
  constraint brand_contacts_confidence_check
    check (confidence is null or confidence between 0 and 100),
  constraint brand_contacts_bounce_count_check check (bounce_count >= 0),
  unique (brand_id, email)
);

create table public.source_signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  signal_type text not null,
  evidence_url text,
  evidence_json jsonb,
  weight numeric(5,2) not null default 1.0
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  deal_type text not null,
  status text not null default 'queued',
  score int,
  score_rationale_json jsonb,
  hook_chosen text,
  research_brief_json jsonb,
  target_contact_id uuid references public.brand_contacts(id) on delete set null,
  scheduled_send_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  closed_at timestamptz,
  outcome text,
  deal_value_usd numeric(10,2),
  notes text,
  constraint campaigns_deal_type_check
    check (deal_type in ('paid', 'gifting', 'affiliate', 'ugc', 'ambassador')),
  constraint campaigns_status_check
    check (
      status in (
        'queued',
        'researching',
        'drafted',
        'approved',
        'sent',
        'bounced',
        'opened',
        'replied',
        'negotiating',
        'won',
        'lost',
        'ghosted',
        'skipped'
      )
    ),
  constraint campaigns_score_check check (score is null or score between 0 and 100),
  constraint campaigns_outcome_check
    check (outcome is null or outcome in ('won', 'lost', 'ghost', 'not_a_fit')),
  constraint campaigns_deal_value_check
    check (deal_value_usd is null or deal_value_usd >= 0)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version int not null,
  kind text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  status text not null default 'draft',
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  model_used text,
  prompt_hash text,
  was_edited_before_send boolean not null default false,
  edit_diff jsonb,
  constraint messages_version_check check (version > 0),
  constraint messages_kind_check
    check (kind in ('initial', 'follow_up_1', 'follow_up_2', 'reply')),
  constraint messages_status_check
    check (
      status in (
        'draft',
        'pending_approval',
        'approved',
        'sent',
        'bounced',
        'replied',
        'skipped'
      )
    ),
  unique (campaign_id, version)
);

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_thread_id text not null unique,
  campaign_id uuid references public.campaigns(id) on delete set null,
  last_message_at timestamptz,
  participant_emails text[] not null default '{}'
);

create table public.reply_classifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  category text not null,
  confidence int,
  summary text not null,
  suggested_action text not null,
  constraint reply_classifications_category_check
    check (
      category in (
        'interested',
        'asks_rate',
        'asks_more_info',
        'decline_polite',
        'decline_firm',
        'out_of_office',
        'wrong_person',
        'unsubscribe',
        'spam',
        'other'
      )
    ),
  constraint reply_classifications_confidence_check
    check (confidence is null or confidence between 0 and 100),
  constraint reply_classifications_suggested_action_check
    check (
      suggested_action in (
        'draft_reply',
        'pause_campaign',
        'move_to_negotiating',
        'mark_lost',
        'no_action'
      )
    )
);

create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  steps_json jsonb not null,
  cancelled boolean not null default false,
  cancelled_reason text,
  unique (campaign_id)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade unique,
  agreed_value_usd numeric(10,2),
  currency text not null default 'USD',
  payment_terms text,
  contract_url text,
  contract_status text not null default 'none',
  usage_rights_scope text,
  exclusivity_clauses_json jsonb,
  constraint deals_agreed_value_check
    check (agreed_value_usd is null or agreed_value_usd >= 0),
  constraint deals_payment_terms_check
    check (
      payment_terms is null
      or payment_terms in ('net_30', 'upfront', 'split', 'gifting_only')
    ),
  constraint deals_contract_status_check
    check (contract_status in ('draft', 'signed', 'none'))
);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null,
  quantity int not null default 1,
  due_date date,
  posted_url text,
  status text not null default 'pending',
  constraint deliverables_kind_check
    check (
      kind in (
        'ig_reel',
        'ig_static',
        'ig_story',
        'tiktok',
        'ugc_video',
        'ugc_photo_set'
      )
    ),
  constraint deliverables_quantity_check check (quantity > 0),
  constraint deliverables_status_check
    check (
      status in (
        'pending',
        'in_progress',
        'submitted',
        'posted',
        'approved',
        'revisions'
      )
    )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  amount_usd numeric(10,2) not null,
  expected_at date,
  received_at date,
  status text not null default 'pending',
  constraint payments_amount_check check (amount_usd >= 0),
  constraint payments_status_check
    check (status in ('pending', 'received', 'overdue', 'cancelled'))
);

create table public.voice_samples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  source text not null,
  text text not null,
  metadata_json jsonb,
  tag text,
  constraint voice_samples_source_check
    check (
      source in (
        'website',
        'ig_caption',
        'tiktok_caption',
        'email_sent',
        'email_edited',
        'manual_paste'
      )
    )
);

create table public.feedback_marks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  direction text not null,
  note text,
  constraint feedback_marks_target_kind_check
    check (target_kind in ('message', 'campaign')),
  constraint feedback_marks_direction_check
    check (direction in ('positive', 'negative'))
);

create table public.hook_library (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hook_pattern text not null,
  applies_to_deal_types text[] not null default '{}',
  creator_profile_id uuid references public.creator_profiles(id) on delete set null,
  usage_count int not null default 0,
  reply_count int not null default 0,
  positive_reply_count int not null default 0,
  constraint hook_library_usage_count_check check (usage_count >= 0),
  constraint hook_library_reply_count_check check (reply_count >= 0),
  constraint hook_library_positive_reply_count_check
    check (positive_reply_count >= 0)
);

create table public.outreach_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_profile_id uuid references public.creator_profiles(id) on delete cascade,
  max_sends_per_day int not null default 15,
  send_window_start_hour int not null default 9,
  send_window_end_hour int not null default 16,
  send_timezone text not null default 'America/New_York',
  min_minutes_between_sends int not null default 4,
  max_minutes_between_sends int not null default 11,
  send_on_weekends boolean not null default false,
  excluded_brand_ids uuid[] not null default '{}',
  excluded_categories text[] not null default '{}',
  auto_send_after_approval boolean not null default false,
  require_per_email_approval boolean not null default true,
  warmup_mode boolean not null default true,
  warmup_max_per_day int not null default 5,
  constraint outreach_rules_max_sends_check check (max_sends_per_day >= 0),
  constraint outreach_rules_send_window_start_check
    check (send_window_start_hour between 0 and 23),
  constraint outreach_rules_send_window_end_check
    check (send_window_end_hour between 0 and 23),
  constraint outreach_rules_minutes_between_check
    check (
      min_minutes_between_sends >= 0
      and max_minutes_between_sends >= min_minutes_between_sends
    ),
  constraint outreach_rules_warmup_max_check check (warmup_max_per_day >= 0)
);

create or replace function public.set_user_id_from_creator_profile()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  select cp.user_id
    into parent_user_id
  from public.creator_profiles cp
  where cp.id = new.creator_profile_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'creator_profile'
  );

  return new;
end;
$$;

create or replace function public.set_user_id_from_brand()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  select b.user_id
    into parent_user_id
  from public.brands b
  where b.id = new.brand_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'brand'
  );

  return new;
end;
$$;

create or replace function public.set_campaign_user_id()
returns trigger
language plpgsql
as $$
declare
  profile_user_id uuid;
  brand_user_id uuid;
  contact_user_id uuid;
begin
  select cp.user_id
    into profile_user_id
  from public.creator_profiles cp
  where cp.id = new.creator_profile_id;

  select b.user_id
    into brand_user_id
  from public.brands b
  where b.id = new.brand_id;

  if profile_user_id is null or brand_user_id is null then
    raise exception 'Could not resolve campaign parent user_id'
      using errcode = '23503';
  end if;

  if profile_user_id <> brand_user_id then
    raise exception 'Campaign profile and brand must belong to the same user'
      using errcode = '23514';
  end if;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    profile_user_id,
    'campaign parents'
  );

  if new.target_contact_id is not null then
    select bc.user_id
      into contact_user_id
    from public.brand_contacts bc
    where bc.id = new.target_contact_id;

    if contact_user_id is null or contact_user_id <> new.user_id then
      raise exception 'Campaign contact must belong to the same user'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_user_id_from_campaign()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  select c.user_id
    into parent_user_id
  from public.campaigns c
  where c.id = new.campaign_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'campaign'
  );

  return new;
end;
$$;

create or replace function public.set_email_thread_user_id()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  if new.campaign_id is null then
    if new.user_id is null then
      raise exception 'email_threads.user_id is required when campaign_id is null'
        using errcode = '23502';
    end if;

    return new;
  end if;

  select c.user_id
    into parent_user_id
  from public.campaigns c
  where c.id = new.campaign_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'campaign'
  );

  return new;
end;
$$;

create or replace function public.set_user_id_from_message()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  select m.user_id
    into parent_user_id
  from public.messages m
  where m.id = new.message_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'message'
  );

  return new;
end;
$$;

create or replace function public.set_user_id_from_deal()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  select d.user_id
    into parent_user_id
  from public.deals d
  where d.id = new.deal_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'deal'
  );

  return new;
end;
$$;

create or replace function public.set_polymorphic_feedback_user_id()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  if new.target_kind = 'message' then
    select m.user_id
      into parent_user_id
    from public.messages m
    where m.id = new.target_id;
  elsif new.target_kind = 'campaign' then
    select c.user_id
      into parent_user_id
    from public.campaigns c
    where c.id = new.target_id;
  else
    raise exception 'Unsupported feedback target kind: %', new.target_kind
      using errcode = '23514';
  end if;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'feedback target'
  );

  return new;
end;
$$;

create or replace function public.set_optional_profile_user_id()
returns trigger
language plpgsql
as $$
declare
  parent_user_id uuid;
begin
  if new.creator_profile_id is null then
    if new.user_id is null then
      raise exception 'user_id is required when creator_profile_id is null'
        using errcode = '23502';
    end if;

    return new;
  end if;

  select cp.user_id
    into parent_user_id
  from public.creator_profiles cp
  where cp.id = new.creator_profile_id;

  new.user_id := public.resolve_child_user_id(
    new.user_id,
    parent_user_id,
    'creator_profile'
  );

  return new;
end;
$$;

create trigger set_voice_style_guides_user_id
before insert or update of user_id, creator_profile_id on public.voice_style_guides
for each row execute function public.set_user_id_from_creator_profile();

create trigger set_media_kits_user_id
before insert or update of user_id, creator_profile_id on public.media_kits
for each row execute function public.set_user_id_from_creator_profile();

create trigger set_brand_contacts_user_id
before insert or update of user_id, brand_id on public.brand_contacts
for each row execute function public.set_user_id_from_brand();

create trigger set_source_signals_user_id
before insert or update of user_id, brand_id on public.source_signals
for each row execute function public.set_user_id_from_brand();

create trigger set_campaigns_user_id
before insert or update of user_id, creator_profile_id, brand_id, target_contact_id on public.campaigns
for each row execute function public.set_campaign_user_id();

create trigger set_messages_user_id
before insert or update of user_id, campaign_id on public.messages
for each row execute function public.set_user_id_from_campaign();

create trigger set_email_threads_user_id
before insert or update of user_id, campaign_id on public.email_threads
for each row execute function public.set_email_thread_user_id();

create trigger set_reply_classifications_user_id
before insert or update of user_id, message_id on public.reply_classifications
for each row execute function public.set_user_id_from_message();

create trigger set_follow_up_sequences_user_id
before insert or update of user_id, campaign_id on public.follow_up_sequences
for each row execute function public.set_user_id_from_campaign();

create trigger set_deals_user_id
before insert or update of user_id, campaign_id on public.deals
for each row execute function public.set_user_id_from_campaign();

create trigger set_deliverables_user_id
before insert or update of user_id, deal_id on public.deliverables
for each row execute function public.set_user_id_from_deal();

create trigger set_payments_user_id
before insert or update of user_id, deal_id on public.payments
for each row execute function public.set_user_id_from_deal();

create trigger set_voice_samples_user_id
before insert or update of user_id, creator_profile_id on public.voice_samples
for each row execute function public.set_user_id_from_creator_profile();

create trigger set_feedback_marks_user_id
before insert or update of user_id, target_kind, target_id on public.feedback_marks
for each row execute function public.set_polymorphic_feedback_user_id();

create trigger set_hook_library_user_id
before insert or update of user_id, creator_profile_id on public.hook_library
for each row execute function public.set_optional_profile_user_id();

create trigger set_outreach_rules_user_id
before insert or update of user_id, creator_profile_id on public.outreach_rules
for each row execute function public.set_optional_profile_user_id();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'creator_profiles',
    'voice_style_guides',
    'media_kits',
    'brands',
    'brand_contacts',
    'source_signals',
    'campaigns',
    'messages',
    'email_threads',
    'reply_classifications',
    'follow_up_sequences',
    'deals',
    'deliverables',
    'payments',
    'voice_samples',
    'feedback_marks',
    'hook_library',
    'outreach_rules'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;
