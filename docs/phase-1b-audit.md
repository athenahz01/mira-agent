# Phase 1b Audit — Mira

Audited 2026-05-14 against the Phase 1b kickoff prompt and the architecture doc.

## Verdict

**Pass. Ready for Phase 1c.** No blockers. A handful of minor notes below, none requiring fixes before moving on.

This phase is meaningfully cleaner than Phase 1a — five conventional commits instead of one giant commit, real tests with dependency injection on the LLM call, tight scope discipline (no media kit / Gmail / sourcing snuck in), and a voice guide schema that's `.strict()` so the LLM can't sneak extra fields past us.

---

## What's strong

**Versioning of voice guides is correct.** `persistVoiceGuide()` deactivates all prior guides for a profile, computes `nextVersion = max(version) + 1`, inserts the new row as `is_active=true`, then updates `creator_profiles.voice_style_guide_id` to point at it. The test (`scripts/test-onboarding.ts`) explicitly asserts this — generating a second guide creates v2 with is_active=true AND v1 becomes is_active=false AND the profile pointer moves. Future "regenerate" actions will be safe.

**Middleware routing covers all four quadrants correctly:**
- Signed in + on `/login` or `/signup` → redirect to `/dashboard` (or `/onboarding` if onboarding not complete)
- Not signed in + not on auth/API → redirect to `/login`
- Signed in + onboarding not complete + not on auth/API/onboarding → redirect to `/onboarding`
- Otherwise pass through

This is the right shape. Cookies are forwarded via `redirectWithCookies()` so refreshed Supabase session cookies survive the redirect.

**Server actions return typed `ActionResult<T>` shapes** and never throw to the client. Every server action wraps its work in `runOnboardingAction` which catches errors and converts them to `{ok: false, error: string}`. Matches the spec.

**Zod validation at every boundary.** Inputs are parsed at the server action layer (`upsertUserBasics`, `upsertCreatorProfile`, `addVoiceSamples`, etc.). The voice guide JSON is parsed again before persistence even though it came from the LLM (which already parsed it once) — paranoid but safe.

**Voice guide Zod schema is `.strict()`** — catches extra fields silently inserted by the LLM. Combined with the prompt instruction "Fill in every field. Do not use null. Do not add extra fields," this gives strong guarantees that what gets persisted matches what later code expects.

**Tests have real assertion teeth.** `test:onboarding` doesn't just check that code runs — it asserts: exactly 2 profiles created, 3 samples per profile, v1 guides active for both, v2 generation increments AND deactivates v1, onboarding_completed_at gets set. `test:voice-guide-shape` calls the real Anthropic API and validates the response against the Zod schema. Both use service-role cleanup in `finally` blocks.

**Dependency injection on the LLM generator.** `generateAndPersistVoiceGuide()` takes an optional `generator` parameter so tests can inject a fake. Makes the onboarding test fast and deterministic without an API key.

**Scope discipline is tight.** Grepped the codebase for references to media kit, Gmail OAuth, brand sourcing — the only hits are in the schema migration (which creates those tables ahead of time per the original spec), the RLS policies, the generated types file, and docs that describe future phases. No premature implementation snuck in.

**Five well-named conventional commits** (db: add onboarding user fields, feat(voice): add guide generation service, feat(onboarding): add voice setup wizard, test(onboarding): cover voice guide setup, fix(voice): align opus request parameters). Big improvement over Phase 1a's single commit.

**ChipInput component is well-designed.** Enter or comma to add, backspace to remove last when input is empty, blur commits, dedup happens on add. Lives in `/components/ui/chip-input.tsx` per the prompt instruction not to pull in a third-party tag library.

---

## Decisions to review (Codex flagged these — my read)

### Used Opus 4.7 instead of Sonnet for voice guide generation

Spec said Sonnet. Codex used `claude-opus-4-7` (the model is real — I verified Anthropic shipped it in April 2026). Voice guide generation is reasoning-heavy synthesis from raw samples into structured JSON, so Opus arguably produces a sharper guide. But Opus 4.7 costs $5/M input + $25/M output vs. Sonnet's ~$3/$15 — roughly 1.5–2x more expensive.

For voice guide generation specifically: this runs maybe 5–10 times per profile in a lifetime. The cost difference is rounding error (~$0.03 per generation). **Accepting this decision.**

But this raises a bigger question for Phase 3 (drafting), where the LLM runs every time you pitch a brand — possibly 100+ times a day at full volume. **We should explicitly decide Sonnet vs. Opus for drafting before we get there.** I'd lean Sonnet for drafts + Opus for rationale-generation (the "why pitch this brand" reasoning), but want your input.

### Added `sender_display_name` column on `users`

Wasn't in the original Phase 1a schema. Codex added it in Phase 1b because Step 1 needed to capture it separately from `users.name`. Reason: `name` is "how Mira refers to you in the app" while `sender_display_name` is "what brand inboxes see as the From: name." These can legitimately differ — and the architecture doc explicitly mentioned "display name 'Athena Huo'" as a separate concept. Good call.

### Onboarding-completed-at check happens on every authenticated request

The middleware reads `users.onboarding_completed_at` on every request that has a user. Once onboarding is done, this is wasted work. Easy optimization later (cache in JWT custom claims, or just gate the check to only fire on `/onboarding` route entry). Not worth fixing now.

---

## Minor notes (none are blockers)

1. **"I'll add more later" bypasses the minimum.** Spec said "lets her skip after the minimum (website copy + 1 caption per profile)." Codex's implementation lets you skip with zero samples. If you click skip immediately, voice guide generation will run with an empty samples array and produce something nearly random. Fix: gate the "I'll add more later" button on the minimum being met, OR make the guide-generation prompt explicitly handle the no-samples case with a graceful note. Either is a small future task.

2. **Empty `remote-public-schema.sql` at the repo root.** Artifact from Codex inspecting the remote DB during Phase 1a fixes. Just `rm` it.

3. **Two separate migrations for `onboarding_completed_at` and `sender_display_name`.** Could have been one. Functionally fine, but tiny git noise.

4. **Dashboard "Edit voice" button links to `?step=voice` (the samples step, step 3) rather than `?step=guide` (the guide-editing step, step 4).** Subtle UX bug — if you want to edit the *guide*, you land on the *samples* step first. Trivial fix: change the href.

5. **Two `unknown` type bridges left over from Phase 1a fixes** — one in `lib/supabase/server.ts` (SDK type mismatch between `@supabase/ssr` and `supabase-js`), one in `scripts/test-rls.ts` (trigger-populated `user_id` not inferable by generated types). These are pragmatic but worth tracking. They could mask real type errors. Not new issues, just inherited.

6. **`voiceSampleSourceSchema` only includes 4 of the 6 sources** the DB constraint allows. Missing: `tiktok_caption`, `email_edited`. Fine for now — `email_edited` gets populated in Phase 4 (when Mira-drafted messages get edited before send) and `tiktok_caption` becomes relevant if/when TikTok scraping happens. Just noting.

7. **The signup-to-dashboard happy path was never manually click-tested end-to-end.** Phase 1a fixes status doc shows the signup UI was blocked by a Supabase email rate limit. The programmatic test (`test:onboarding`) covers the server-side flow but doesn't exercise the browser-side login/signup form behavior. **Worth doing a manual click-through now** before Phase 1c, since the rate limit has had time to clear. If anything's broken in the form, find it now rather than after we've built more on top.

8. **Prompt file at `/prompts/voice-guide-v1.md` is good but generic.** It doesn't currently anchor on the specifics we'd want the LLM to know about you: bilingual English/Mandarin (could matter for Asian-American brands), the Berkeley/Cornell/Bay→NYC angle, the drone content angle. These get added via the creator profile JSON at runtime, but pre-baking concrete examples of "what a strong avoid_phrase looks like" or "what a useful hook_pattern looks like" into the prompt itself would make outputs more consistent. Future iteration.

---

## What I want you to do before Phase 1c

Two small things:

1. **Manually click through onboarding end-to-end.** Sign up a fresh test user against the remote Supabase (use any throwaway email), step through all 5 steps with real content, generate a voice guide for each profile, hit "Finish onboarding," confirm you land on `/dashboard` and the voice guides show "v1 active." Spend 10 minutes doing this — bugs that only show up in the browser won't show up in `test:onboarding`.

2. **Delete the test user after.** Service role can do it from the Supabase dashboard's Auth tab.

If anything's broken, tell me and I'll write a fixes prompt before Phase 1c.

If everything works, proceed to the Phase 1c prompt — it's in `/outputs/mira-codex-prompts-next.md`, Section E.
