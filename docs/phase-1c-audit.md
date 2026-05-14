# Phase 1c Audit — Mira

Audited 2026-05-14 against the Phase 1c kickoff prompt.

## Verdict

**Pass. Ready for Phase 2a (sourcing).** No blockers. A handful of small notes below, none requiring fixes before moving on.

This is Mira's most security-sensitive phase yet (refresh tokens, OAuth state, file uploads), and Codex got the hard parts right. AES-256-GCM with random IVs, signed-then-DB-verified state nonces, path-prefix bucket policies that map cleanly to the upload path. Five well-named conventional commits. All ten verification checks PASS in Codex's report.

---

## What's strong

**Encryption.** `lib/gmail/encryption.ts` uses AES-256-GCM with a 12-byte random IV per encryption (correct for GCM), bundles iv+authTag+ciphertext into a single base64 payload, validates the env key is exactly 32 bytes hex, and throws if the key is missing — no silent fallback to plaintext. The encryption test verifies (a) different ciphertexts for the same input (proves random IVs), (b) roundtrip equality, and (c) tampered ciphertext fails decrypt (because GCM throws on auth tag mismatch).

**OAuth state protection.** `oauth_states` table stores a sha256 hash of a signed nonce. The connect route generates `nonce.HMAC(nonce)` with a 10-min TTL and stores the hash. The callback route verifies the HMAC via `timingSafeEqual` AND checks the hash exists in DB for the SAME user, isn't consumed, and isn't expired. After successful exchange, the state row is marked consumed. Defense in depth — even if the signed state were leaked, the second check ties it to the originating user.

**Refresh token rotation.** `getAccessToken()` in `lib/gmail/client.ts` checks if Google returns a new refresh_token (rare but possible) and re-encrypts + persists it. `last_refreshed_at` updates on every refresh. This means a long-running session won't accumulate stale tokens.

**Disconnect calls Google's revoke endpoint AND sets `revoked_at` locally.** Doesn't DELETE the credential row — preserves audit trail. Wraps the Google call in try/catch so local revocation always proceeds even if Google already revoked the token (idempotent).

**Storage bucket policies use path-prefix matching.** `(storage.foldername(name))[1] = auth.uid()::text` — the first path segment must equal the user's auth ID. The upload path in `app/actions/media-kit.ts` is `${context.userId}/${row.id}.pdf`, which matches exactly. Private bucket, 10MB limit, application/pdf-only mime type. All four CRUD operations have policies (even update, which is defensive given upsert behavior).

**Media kit schema is `.strict()`** with thoughtful refinements: `max_rate >= min_rate`, `content_pillars` between 3-5, `year between 2000 and 2100`, `engagement_rate` between 0 and 1. Codex used Sonnet (`claude-sonnet-4-5`) for generation — matching the spec, since this is a structured assembly task rather than reasoning-heavy creative writing.

**Versioning logic mirrors voice guides exactly.** `persistMediaKit` deactivates all prior kits for the profile, computes `nextVersion = max(version) + 1`, inserts new row as is_active=true. `test:media-kit` explicitly asserts v2 generation deactivates v1.

**Settings page lazily creates missing `outreach_rules` rows** so the global rule + per-profile rule always exist on first view. Good pattern.

**Rate benchmarks include the Fohr + IMH citation in a code comment** but the brand-facing copy says "rates are estimated from creator tier, deliverable complexity, usage rights, and current industry benchmarks" — no external sources named. Matches the decision you ratified.

**Scope discipline tight.** `git diff` for Phase 1c shows only files relevant to media kit, Gmail, settings, and tests. No drafting, sourcing, sending, or pipeline UI snuck in.

---

## Decisions Codex flagged (my read)

### Used `@react-pdf/renderer` for server-side PDF
Per the Phase 1c prompt's default. Renders to a Node Buffer in-process, no headless browser dependency, works in serverless. Right call.

### Past brand work conditionally skipped when empty
Schema allows empty array. Prompt explicitly says "If past brand work is empty, return an empty array." UI handles the empty case. Good.

### Followed prompt over architecture doc on Gmail token storage
Architecture doc said `users.gmail_oauth_token_ref` (a single column on `users`). Phase 1c prompt said use a dedicated `gmail_credentials` table with refresh-token rotation + revocation. Codex went with the prompt — correct, the dedicated table is the right shape (audit trail, rotation, multiple-account future-proofing).

---

## Minor notes (none are blockers)

1. **`lib/gmail/client.ts` bypasses RLS via the service role.** `getActiveCredential` and `getAccessToken` take a `userId` parameter and use a service-role Supabase client. This is fine for server-side code that's already verified the user (via `auth.getUser()` in the calling context). But in Phase 4 when polling workers call these per-user, the worker code MUST source `userId` from a verified context — never from an HTTP query param or untrusted input. Worth a comment in `client.ts` to flag this for future code reviewers. Easy add later.

2. **OAuth state HMAC secret falls back to the encryption key.** `signNonce` in `lib/gmail/oauth.ts` prefers `GOOGLE_OAUTH_CLIENT_SECRET` but falls back to `GMAIL_TOKEN_ENCRYPTION_KEY`. Reusing one secret for two purposes is suboptimal practice. Not a security hole (both are server-side env vars), but ideally we'd add a third dedicated secret like `OAUTH_STATE_SIGNING_KEY`. Trivial future fix.

3. **`scripts/test-pdf-render.ts` doesn't render the actual `MediaKitDocument` component.** It creates a stripped-down inline Document/Page just to confirm React-PDF can produce a valid PDF buffer. Real template is only exercised by Codex's headless browser smoke run. Component-level snapshot testing would catch template regressions cheaply.

4. **`scripts/test-media-kit.ts` doesn't exercise the Storage upload pipeline.** Generation+persistence is tested, but `renderMediaKitPdf`'s upload-and-sign path isn't covered by automated tests. Action code is straightforward — low-risk gap.

5. **`outreachRulesSchema` doesn't validate `max >= min` for minutes-between-sends at the Zod level.** DB CHECK constraint catches it, but the user gets a server error instead of inline form validation. Quick add.

6. **Empty `remote-public-schema.sql` at repo root** is still there from Phase 1a fixes. Just `rm` it.

7. **Dashboard "Edit voice" link STILL points to `?step=voice` (samples, step 3) instead of `?step=guide` (step 4).** Same nit I called out in the Phase 1b audit, never fixed. Trivial. The new "Edit" link on the Media Kits card correctly goes to `/kits`.

8. **Filesystem-level corruption on local working tree.** When I started the audit, several files (`middleware.ts`, `tsconfig.json`, `lib/db/types.ts`, etc.) appeared truncated mid-file when read directly — but `git show HEAD:<file>` returned the correct content. This is a Cowork sandbox mount issue (Windows ↔ Linux sync), not Codex's fault. **Recommendation:** if you want to keep working in the local repo, run `git checkout -- .` to restore the working tree from HEAD. The committed code is clean and what Codex actually shipped.

---

## What I want you to do before Phase 2a

Three small things — none would block Phase 2a starting, but get them out of the way:

1. **Restore the working tree:** `cd C:\AA_Projects\mira-agent && git checkout -- .` to overwrite the truncated local files with the clean committed versions. (Don't lose the untracked `docs/phase-1b-audit.md` and `docs/phase-1c-audit.md` — those are mine and are fine.)
2. **Delete the empty file:** `rm remote-public-schema.sql` (then commit as `chore: remove empty schema artifact`).
3. **Manual smoke once.** Sign in, visit /settings, verify all three sections render and save. Visit /kits, generate a kit, click "Download PDF", confirm the PDF opens and looks readable. (You don't need to actually click "Connect Gmail" — that requires the Google Cloud OAuth client to be set up first, which is a Phase 2 prerequisite.)

If anything's broken, tell me. Otherwise proceed to Phase 2a.

---

## Phase 2 split note

The original architecture doc said Phase 2 = "Sourcing engine MVP" covering connectors + enrichment + identity resolution + scoring + UI in one phase. That's too much for one audit checkpoint, especially because the connectors include multiple external integrations (Apify, Hunter.io, Playwright). My recommendation is to split Phase 2 into four sub-phases:

- **Phase 2a — Manual seed + CSV upload + brand identity resolution + brand pool listing UI**
  Foundation for the brands table. No scraping yet. Athena can paste in brands she's already eyeing, dedup happens automatically, view/tag/exclude in a basic list UI.
- **Phase 2b — Brand contact enrichment via Hunter.io + Playwright page scraping**
  Given a brand row with a domain, find PR/marketing emails. Stored in brand_contacts.
- **Phase 2c — Apify competitor reverse-lookup**
  Given competitor IG handles, scrape their recent #ad/sponsored posts to discover brands that pay creators in your tier. Auto-create brand rows.
- **Phase 2d — Scoring engine + scored ranking + filters in brand pool UI**
  Rules-based scoring per deal type, pipeline-ready ranking.

This gives four clean audit checkpoints. Each phase produces something you can use immediately.

The Phase 2a kickoff prompt is in `/outputs/mira-codex-prompts-next.md`, Section G.
