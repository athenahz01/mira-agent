alter table public.messages
  add column scheduled_send_at timestamptz,
  add column send_attempts int not null default 0,
  add column send_error text,
  add column undo_until timestamptz,
  add constraint messages_send_attempts_check check (send_attempts >= 0);

create index messages_pending_send_idx
on public.messages (user_id, scheduled_send_at)
where status = 'approved' and sent_at is null;

alter table public.outreach_rules
  add column send_mode text not null default 'immediate',
  add constraint outreach_rules_send_mode_check
    check (send_mode in ('immediate', 'queued'));

alter table public.jobs
  drop constraint if exists jobs_kind_check;

alter table public.jobs
  add constraint jobs_kind_check check (
    kind in ('page_scrape', 'instagram_scrape', 'auto_draft', 'send_email')
  );

create table public.send_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  event_type text not null,
  details_json jsonb,
  constraint send_events_type_check check (
    event_type in ('queued', 'undone', 'attempting', 'sent', 'failed', 'paused')
  )
);

create trigger set_send_events_user_id
before insert or update of user_id, message_id on public.send_events
for each row execute function public.set_user_id_from_message();

alter table public.send_events enable row level security;

create policy "users can select own send_events"
on public.send_events for select
using (user_id = auth.uid());

create policy "users can insert own send_events"
on public.send_events for insert
with check (user_id = auth.uid());

create policy "users can update own send_events"
on public.send_events for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own send_events"
on public.send_events for delete
using (user_id = auth.uid());
