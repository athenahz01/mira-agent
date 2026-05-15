alter table public.jobs
  drop constraint if exists jobs_kind_check;

alter table public.jobs
  add constraint jobs_kind_check check (
    kind in (
      'page_scrape',
      'instagram_scrape',
      'auto_draft',
      'send_email',
      'inbox_poll',
      'follow_up_generate'
    )
  );

alter table public.users
  add column inbox_last_polled_at timestamptz,
  add column inbox_poll_paused boolean not null default false;

create index messages_awaiting_reply_idx
on public.messages (user_id, sent_at)
where status = 'sent';

create index follow_up_sequences_active_idx
on public.follow_up_sequences (user_id, cancelled, campaign_id)
where cancelled = false;

alter table public.outreach_rules
  add column follow_up_enabled boolean not null default true,
  add column follow_up_1_days_after int not null default 7,
  add column follow_up_2_days_after_initial int not null default 14,
  add column follow_up_max_count int not null default 2,
  add constraint outreach_rules_follow_up_1_days_check
    check (follow_up_1_days_after between 1 and 30),
  add constraint outreach_rules_follow_up_2_days_check
    check (follow_up_2_days_after_initial between 1 and 60),
  add constraint outreach_rules_follow_up_count_check
    check (follow_up_max_count between 0 and 3);
