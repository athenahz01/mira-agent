alter table public.users enable row level security;
alter table public.creator_profiles enable row level security;
alter table public.voice_style_guides enable row level security;
alter table public.media_kits enable row level security;
alter table public.brands enable row level security;
alter table public.brand_contacts enable row level security;
alter table public.source_signals enable row level security;
alter table public.campaigns enable row level security;
alter table public.messages enable row level security;
alter table public.email_threads enable row level security;
alter table public.reply_classifications enable row level security;
alter table public.follow_up_sequences enable row level security;
alter table public.deals enable row level security;
alter table public.deliverables enable row level security;
alter table public.payments enable row level security;
alter table public.voice_samples enable row level security;
alter table public.feedback_marks enable row level security;
alter table public.hook_library enable row level security;
alter table public.outreach_rules enable row level security;

create policy "users can select own rows"
on public.users for select
using (user_id = auth.uid());

create policy "users can insert own rows"
on public.users for insert
with check (user_id = auth.uid());

create policy "users can update own rows"
on public.users for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own rows"
on public.users for delete
using (user_id = auth.uid());

create policy "users can select own creator_profiles"
on public.creator_profiles for select
using (user_id = auth.uid());

create policy "users can insert own creator_profiles"
on public.creator_profiles for insert
with check (user_id = auth.uid());

create policy "users can update own creator_profiles"
on public.creator_profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own creator_profiles"
on public.creator_profiles for delete
using (user_id = auth.uid());

create policy "users can select own voice_style_guides"
on public.voice_style_guides for select
using (user_id = auth.uid());

create policy "users can insert own voice_style_guides"
on public.voice_style_guides for insert
with check (user_id = auth.uid());

create policy "users can update own voice_style_guides"
on public.voice_style_guides for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own voice_style_guides"
on public.voice_style_guides for delete
using (user_id = auth.uid());

create policy "users can select own media_kits"
on public.media_kits for select
using (user_id = auth.uid());

create policy "users can insert own media_kits"
on public.media_kits for insert
with check (user_id = auth.uid());

create policy "users can update own media_kits"
on public.media_kits for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own media_kits"
on public.media_kits for delete
using (user_id = auth.uid());

create policy "users can select own brands"
on public.brands for select
using (user_id = auth.uid());

create policy "users can insert own brands"
on public.brands for insert
with check (user_id = auth.uid());

create policy "users can update own brands"
on public.brands for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own brands"
on public.brands for delete
using (user_id = auth.uid());

create policy "users can select own brand_contacts"
on public.brand_contacts for select
using (user_id = auth.uid());

create policy "users can insert own brand_contacts"
on public.brand_contacts for insert
with check (user_id = auth.uid());

create policy "users can update own brand_contacts"
on public.brand_contacts for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own brand_contacts"
on public.brand_contacts for delete
using (user_id = auth.uid());

create policy "users can select own source_signals"
on public.source_signals for select
using (user_id = auth.uid());

create policy "users can insert own source_signals"
on public.source_signals for insert
with check (user_id = auth.uid());

create policy "users can update own source_signals"
on public.source_signals for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own source_signals"
on public.source_signals for delete
using (user_id = auth.uid());

create policy "users can select own campaigns"
on public.campaigns for select
using (user_id = auth.uid());

create policy "users can insert own campaigns"
on public.campaigns for insert
with check (user_id = auth.uid());

create policy "users can update own campaigns"
on public.campaigns for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own campaigns"
on public.campaigns for delete
using (user_id = auth.uid());

create policy "users can select own messages"
on public.messages for select
using (user_id = auth.uid());

create policy "users can insert own messages"
on public.messages for insert
with check (user_id = auth.uid());

create policy "users can update own messages"
on public.messages for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own messages"
on public.messages for delete
using (user_id = auth.uid());

create policy "users can select own email_threads"
on public.email_threads for select
using (user_id = auth.uid());

create policy "users can insert own email_threads"
on public.email_threads for insert
with check (user_id = auth.uid());

create policy "users can update own email_threads"
on public.email_threads for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own email_threads"
on public.email_threads for delete
using (user_id = auth.uid());

create policy "users can select own reply_classifications"
on public.reply_classifications for select
using (user_id = auth.uid());

create policy "users can insert own reply_classifications"
on public.reply_classifications for insert
with check (user_id = auth.uid());

create policy "users can update own reply_classifications"
on public.reply_classifications for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own reply_classifications"
on public.reply_classifications for delete
using (user_id = auth.uid());

create policy "users can select own follow_up_sequences"
on public.follow_up_sequences for select
using (user_id = auth.uid());

create policy "users can insert own follow_up_sequences"
on public.follow_up_sequences for insert
with check (user_id = auth.uid());

create policy "users can update own follow_up_sequences"
on public.follow_up_sequences for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own follow_up_sequences"
on public.follow_up_sequences for delete
using (user_id = auth.uid());

create policy "users can select own deals"
on public.deals for select
using (user_id = auth.uid());

create policy "users can insert own deals"
on public.deals for insert
with check (user_id = auth.uid());

create policy "users can update own deals"
on public.deals for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own deals"
on public.deals for delete
using (user_id = auth.uid());

create policy "users can select own deliverables"
on public.deliverables for select
using (user_id = auth.uid());

create policy "users can insert own deliverables"
on public.deliverables for insert
with check (user_id = auth.uid());

create policy "users can update own deliverables"
on public.deliverables for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own deliverables"
on public.deliverables for delete
using (user_id = auth.uid());

create policy "users can select own payments"
on public.payments for select
using (user_id = auth.uid());

create policy "users can insert own payments"
on public.payments for insert
with check (user_id = auth.uid());

create policy "users can update own payments"
on public.payments for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own payments"
on public.payments for delete
using (user_id = auth.uid());

create policy "users can select own voice_samples"
on public.voice_samples for select
using (user_id = auth.uid());

create policy "users can insert own voice_samples"
on public.voice_samples for insert
with check (user_id = auth.uid());

create policy "users can update own voice_samples"
on public.voice_samples for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own voice_samples"
on public.voice_samples for delete
using (user_id = auth.uid());

create policy "users can select own feedback_marks"
on public.feedback_marks for select
using (user_id = auth.uid());

create policy "users can insert own feedback_marks"
on public.feedback_marks for insert
with check (user_id = auth.uid());

create policy "users can update own feedback_marks"
on public.feedback_marks for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own feedback_marks"
on public.feedback_marks for delete
using (user_id = auth.uid());

create policy "users can select own hook_library"
on public.hook_library for select
using (user_id = auth.uid());

create policy "users can insert own hook_library"
on public.hook_library for insert
with check (user_id = auth.uid());

create policy "users can update own hook_library"
on public.hook_library for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own hook_library"
on public.hook_library for delete
using (user_id = auth.uid());

create policy "users can select own outreach_rules"
on public.outreach_rules for select
using (user_id = auth.uid());

create policy "users can insert own outreach_rules"
on public.outreach_rules for insert
with check (user_id = auth.uid());

create policy "users can update own outreach_rules"
on public.outreach_rules for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete own outreach_rules"
on public.outreach_rules for delete
using (user_id = auth.uid());
