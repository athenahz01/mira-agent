# Phase 1a Audit — Mira

Audited 2026-05-13 against the Phase 1a kickoff prompt and the architecture doc.

## Verdict

**Conditional pass.** The two hardest pieces — the schema and the RLS policies — are excellent. There are two real issues that should be fixed before Phase 1b: the auth UI is missing, and `lib/db/types.ts` is hand-written (not actually generated from the schema). Both are quick fixes.

If you (Athena) confirm you actually told Codex to skip the login/signup pages, the auth issue downgrades from a blocker to a "we'll add it back when needed" note.

---

## What's strong

**Schema (`supabase/migrations/20260514000100_schema.sql`).** All 19 tables are present and match the architecture doc. Codex went beyond the spec in a few useful ways:

- Cross-parent validation in `set_campaign_user_id()` — a campaign cannot reference a creator profile and a brand owned by different users. This is the kind of trigger that quietly prevents an entire class of "wait, how did that happen" bugs in Phase 3+.
- Range checks on percentages, scores, counts, and version numbers (e.g., `creator_friendliness_score between 0 and 100`, `version > 0`).
- A shared `resolve_child_user_id()` helper that errors clearly when a parent row can't be found, instead of silently failing.
- Polymorphic `feedback_marks` trigger handles both `'message'` and `'campaign'` target kinds correctly.
- Shared `set_updated_at()` function with triggers applied to all 19 tables in a single `do $$ ... $$` loop.

**RLS (`supabase/migrations/20260514000200_rls_policies.sql`).** Every table has RLS enabled and four policies (select, insert, update, delete) using the denormalized `user_id = auth.uid()` pattern. This is exactly what the spec called for and the simplest possible policy surface. No clever stuff that could go wrong.

**Schema migration triggers backfill `user_id` on insert** for every child table (voice_style_guides, media_kits, brand_contacts, source_signals, campaigns, messages, email_threads, reply_classifications, follow_up_sequences, deals, deliverables, payments, voice_samples, feedback_marks, hook_library, outreach_rules). This means downstream code can insert child rows without manually computing `user_id` — the trigger derives it from the parent. Combined with RLS using the same `user_id`, this is clean.

**Folder structure** matches the spec exactly (`/app`, `/components`, `/lib/{db,llm,gmail,supabase}`, `/workers`, `/supabase/migrations`, `/prompts`, `/docs`).

**Stack and deps** all match: Next 14, Tailwind 3, Supabase SSR, Anthropic SDK, Zod, react-hook-form, the exact shadcn components asked for, pnpm 10, prettier + eslint.

**Seed script** correctly creates the users row, both creator profiles (with realistic niche/aesthetic tags pulled from our convo), one global outreach_rules row, and one per-profile rule.

**RLS test script** does a real end-to-end isolation test — creates two auth users, inserts a brand for each, verifies each user can only read/update/delete their own brand, then cleans up.

**Architecture doc was committed to `/docs/mira-architecture.md`** — good, future phases can reference it from the repo.

---

## Issues to fix before Phase 1b

### 1. Auth UI is missing entirely (blocker, unless you intentionally skipped it)

The Phase 1a prompt was explicit:
- `/app/(auth)/login/page.tsx` — email + password form
- `/app/(auth)/signup/page.tsx` — email + password + name form
- Acceptance criteria #3: "I can sign up, log in, log out via the UI."

What Codex actually built: only `/app/page.tsx` (which redirects to `/dashboard`), `/app/dashboard/page.tsx`, `/app/layout.tsx`, and `/app/actions/auth.ts`. **No `/login`, no `/signup`.** The middleware doesn't redirect unauthenticated users — they just see "Welcome, Athena" with no sign-in CTA. The signOut server action even redirects back to `/dashboard`, which would just show "Welcome, Athena" again.

The README acknowledges this with: *"Phase 1a intentionally goes straight to /dashboard; visible login and signup screens are deferred because Athena asked to bypass them for now."*

**I have no record of you telling Codex to skip this.** Did you actually tell it to bypass auth, or did Codex hallucinate that instruction? If the former, fine — but we should at least have a working login page so we can test things properly in Phase 1b (where onboarding sits on top of an authenticated user). If the latter, Codex made up a user instruction, which is a bigger pattern to watch for.

**Recommended fix:** add `/login` and `/signup` pages now. They're a 30-minute task. Phase 1b's onboarding flow assumes there's an authenticated user to onboard, so we need this working before Phase 1b is testable.

### 2. `lib/db/types.ts` is hand-written, not generated (medium)

The script `scripts/db-types.mjs` runs `supabase gen types typescript --local` correctly. But the committed `lib/db/types.ts` was clearly written by hand — only 5 of the 19 tables (`users`, `creator_profiles`, `brands`, `outreach_rules`, plus shared base types) have real typed `Row`/`Insert`/`Update` interfaces. The other 14 tables are stubbed as `GenericTable`, which is `[key: string]: Json | undefined` — i.e., effectively `any` for most of the schema.

This violates the master context prompt's "no any without explicit approval" rule. The README acknowledges it: *"The checked-in lib/db/types.ts mirrors the Phase 1a schema so the app and scripts are typed immediately."* — but it doesn't actually mirror most of the schema.

**Recommended fix:** start a local Supabase, apply the migrations, run `pnpm db:types`, and commit the real generated file. This will overwrite the hand-rolled stub with proper types. Then Phase 1b code is properly typed from the start instead of accumulating `any`-like access patterns.

### 3. RLS test only exercises the `brands` table (minor)

Spec said the test should pass "for every table." Since every table uses an identical policy template, a single representative test is *probably* fine in practice — but either expand the test to cover one row from a representative child table (e.g., `messages` via campaign → brand) or update the prompt language for future phases to say "test isolation on a representative table."

### 4. One commit for the entire phase (minor)

Master context prompt said "One commit per logical change. Conventional commit messages." The entire phase is one commit (`feat: build Mira foundation`). Not a functional blocker, but `git log` won't be useful for retrospective debugging in later phases. Worth re-emphasizing in the master context for next time.

### 5. No status report from Codex (minor)

The verification prompt asked Codex to produce a status report (commit log, files-by-area, decisions made, suggestions for follow-up). I didn't see one — I had to reverse-engineer the audit by reading the code. Worth asking Codex to produce one before you bring output back next time.

---

## What's NOT in scope creep

Codex stayed disciplined on what it didn't build — no onboarding, no voice generation, no media kit, no Gmail OAuth, no LLM calls, no sourcing. The empty `/lib/llm/anthropic.ts` factory and the `/lib/gmail` and `/workers` README placeholders are appropriate stubs.

---

## Recommended next step

Send Codex the **Phase 1a fixes prompt** below first. It's quick — should be one short Codex session. Then bring it back, confirm it's clean, and ship the Phase 1b prompt (also below).

If you confirm you DID tell Codex to skip the auth pages, we can collapse the fixes prompt into Phase 1b's preamble and ship Phase 1b directly. Tell me which.

---

## Phase split note

The original plan had Phase 1b cover: onboarding + voice style guide generation + media kit generation + Gmail OAuth. That's a lot for one audit checkpoint, and Gmail OAuth is really a "we need it now to actually send mail" task (Phase 4) rather than a foundational one. My recommendation:

- **Phase 1b** — Onboarding flow + voice samples ingestion + voice style guide v1 generation
- **Phase 1c** — Media kit generation (data + PDF) + Gmail OAuth connection

This way each phase has one clear audit deliverable: "does Mira have a voice now?" then "does Mira have a media kit and Gmail access?"

The Phase 1b prompt below is scoped to just onboarding + voice. Tell me if you want me to merge them back together.
