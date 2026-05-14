# Phase 2a Audit — Mira

Audited 2026-05-14 against the Phase 2a kickoff prompt.

## Verdict

**Pass. Ready for Phase 2b (Hunter.io contact enrichment).** No blockers. A handful of small notes below, none requiring fixes before moving on.

The hardest piece — identity resolution with migrate-up — is implemented carefully and tested explicitly. The migration's SQL backfill mirrors the JS normalization rules, so brands inserted before/after the migration get the same identity_key. The shared `ActionResult<T>` type got extracted to `lib/server/action.ts` per the prompt suggestion — small but real cleanup that compounds across future phases. Four conventional commits, scope discipline tight (no Hunter/Apify/Playwright/fuzzy-matching anywhere in code).

---

## What's strong

**The migration backfill is genuinely thoughtful.** The SQL CTE walks through the priority cascade (domain → ig_handle → tt_handle → name) for each existing brand row, normalizes each field with the same rules as the JS (lowercase, strip protocol, strip www, strip path/query/fragment, strip leading @, etc.), then writes the computed identity_key. Critically, this runs BEFORE the unique constraint is added, so existing rows get keys first and the constraint then enforces uniqueness on the computed values. If the JS and SQL normalization rules drifted, the constraint addition would fail loudly — defensible by design.

**Identity logic exports both the primary key and ALL candidates.** `brandIdentityCandidates(input)` returns every key the input could match against in priority order. `identityKeyRank(key)` lets the service detect when an existing brand should be promoted to a higher-priority key. Clean separation: the pure-function module computes possibilities; the service layer makes the merge/promote decision against persisted state.

**`findOrCreateBrand` does a smart two-pass lookup:**
1. First, query brands where `identity_key IN (candidate keys)` — catches exact matches on any of the input's possible keys.
2. If no match, fall back to `findByStoredIdentityFields` which scans for any existing brand whose stored `domain` / `instagram_handle` / `tiktok_handle` column matches the input (regardless of which one is currently the row's identity_key).

The second pass is what makes migrate-up actually work. Example: brand stored with identity_key="domain:glossier.com" and ig_handle="glossier" already on the row. Later, you add "@glossier" alone — its only candidate key is "ig:glossier", which is NOT the existing row's identity_key. But the second pass finds the row by the stored `instagram_handle` column. Merge into the existing row. The test (`scripts/test-brand-identity.ts`) asserts this exact case.

**Migrate-up promotion logic is explicit and tested.** When an input's primary key has a higher priority rank than the existing brand's stored identity_key, the service promotes the row's identity_key to the new value AND fills in the new field. The test asserts: insert "Glossier" by name → identity_key="name:glossier"; later insert "Glossier + glossier.com" → same row's identity_key becomes "domain:glossier.com" with `promoted=true` returned in the result. Exactly what the prompt called for.

**CSV import is robust.** Validates required headers up front (returns early with a single skipped entry if missing). Caps at 500 rows and reports the remainder as skipped with row numbers. Per-row try/catch so one bad row doesn't kill the batch. Each successful import writes a `source_signals` row (signal_type='csv_import') with the original row JSON as evidence. Manual adds get the same treatment with signal_type='manual_seed'. Good audit trail for Phase 2c when fuzzy matching might want to undo a bad merge.

**Search includes identity_key and aliases**, not just name. So if Athena types "@glossier" into the search box, it matches the row whose identity_key is "ig:glossier" or whose aliases array contains "glossier" — even if the canonical name is "Glossier Inc". Subtle but useful.

**Shared `lib/server/action.ts`** got extracted with the `ActionResult<T>` type. Now `app/actions/brands.ts`, `app/actions/onboarding.ts`, `app/actions/media-kit.ts`, `app/actions/settings.ts` can all import from the same place instead of redeclaring. Tiny refactor, real value — addresses the prompt's "DON'T re-invent it" instruction.

**Seed `--seed-brands` is idempotent** because it goes through `findOrCreateBrand`. Re-running the seed against an already-seeded user merges into existing rows rather than creating duplicates. Good.

**CSV template route** returns proper Content-Type (`text/csv; charset=utf-8`) and Content-Disposition (filename="mira-brand-import-template.csv") so browsers download instead of render. Realistic example rows (Glossier, Tower 28).

**Test coverage hits the right cases:**
- 4 different ways to express @glossier (name, domain with junk, IG URL with trailing slash, TikTok URL) — all normalize to expected keys
- Different identity fields produce different keys (name vs. domain vs. handle don't collide accidentally)
- Migrate-up: name → name+domain → handle, all merge to one row, identity_key promotes correctly
- CSV: 5 valid + 2 invalid (missing name, invalid enum values), asserts created=5/skipped=2, asserts source_signals count matches, asserts identity_keys are unique per user

---

## Minor notes (none are blockers)

1. **`listBrandsForUser` and `findByStoredIdentityFields` both pull all brand rows into memory and filter/sort in JS.** Fine for the current scale (single user, dozens to hundreds of brands). Phase 2c (Apify auto-discovery) could push you to thousands fast — at that point both functions need to migrate to SQL filtering with proper indexes. Worth flagging in the Phase 2c prompt.

2. **The reverse migrate-down case is unhandled.** If you have a brand stored with identity_key="domain:glossier.com" and try to add a name-only entry "Glossier", it creates a duplicate row (the candidate-key lookup finds nothing, and `findByStoredIdentityFields` only checks domain/IG/TikTok columns, not name). This is fine for now — Wave 2 fuzzy matching in Phase 2c will catch it. Just be aware.

3. **Origin still out of sync.** Codex committed 4 commits locally but didn't push. Same pattern as last time. **Push before Phase 2b** so you have the Phase 2a baseline backed up.

4. **Local working tree got mangled again** — same Cowork sandbox mount issue. Many tracked files show `M` in `git status` but the diffs are filesystem-level truncation, not real changes. Run `git checkout -- .` to restore. (This is becoming a per-phase ritual — I'll start including the cleanup in audit reports going forward.)

5. **Pagination defaults are reasonable but unconfigurable.** `BRAND_PAGE_SIZE = 25` is hardcoded. Fine, just noting it's a magic number.

6. **One small UX quirk:** the dashboard "Brand Pool" card shows "Top categories: N" as a count rather than listing them, but then the badges below DO list them with counts. Slight redundancy in the layout. Trivial.

---

## What I want you to do before Phase 2b

Three quick things, two of which are just becoming routine:

1. **Push:** open your terminal in `C:\AA_Projects\mira-agent` and run `git push origin main`. The 4 Phase 2a commits aren't on GitHub yet.
2. **Restore working tree:** `git checkout -- .` to fix the truncated files.
3. **Quick manual smoke** (5 min):
   - `pnpm dev`, sign in, visit `/brands`
   - Click "Add a brand", fill in name + domain + IG handle, save → row appears in table
   - Try to add the same brand again with a different IG handle URL format → should merge (no duplicate row), `source_signals` count for that brand should now be 2 (you can verify via Supabase Studio if you want)
   - Click "Download template" → CSV downloads
   - Upload a small CSV with mixed valid/invalid rows → result summary shows correct counts
   - Search for part of a brand name → filters work
   - Toggle "Excluded" on a brand, give a reason → persists after reload

If anything breaks, screenshot and tell me.

---

## Phase 2 split — locking the rest of it in

I've changed my Phase 2 split twice now (originally said 2a/2b/2c/2d — keeping that, but want to be specific about what each contains). Locking it in:

- **Phase 2b** — Hunter.io contact enrichment + `brand_contacts` UI surfaces. Synchronous (Hunter API is fast), no worker infrastructure needed yet. Per-brand "Find contacts" button + bulk "Enrich all unenriched" job.
- **Phase 2c** — Worker infrastructure (Railway) + Playwright page scraping. Introduces the jobs/queue table and the worker pattern. Plus Wave 2 fuzzy matching for identity resolution (you'll need it once scraped sources start producing variant brand names).
- **Phase 2d** — Apify competitor reverse-lookup. Auto-discovers brands from creator IG accounts you specify as "competitors." Reuses the worker pattern from 2c. Auto-creates brand rows with source_signals.
- **Phase 2e** — Scoring engine + ranked UI. Per-deal-type rules-based scoring, scored ranking + filters in the brand pool UI. (This is technically a fifth phase — I called it 2d originally but adding the worker infrastructure as its own phase pushed everything down by one.)

Each phase has one major external dependency or one new analytical layer. Each gives you something usable on its own:
- After 2b: brands you've added by hand have contact info attached
- After 2c: brands without contacts on Hunter get filled in via page scraping
- After 2d: new brands surface automatically from competitor activity
- After 2e: queue becomes prioritized

The Phase 2b kickoff prompt is in `/outputs/mira-codex-prompts-next.md`, Section I.
