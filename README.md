# Mira

Mira is Athena Huo's personal cold-outreach agent for brand sponsorships, gifting, affiliate, UGC, and ambassador deals. This repo starts as a single-user tool, with the database and RLS model shaped so it can become multi-tenant later without schema rewrites.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui
- Supabase Postgres, Auth, Storage, and RLS
- Vercel for the web app
- Railway worker code under `workers/`
- Anthropic for voice and media-kit generation
- Gmail OAuth helpers for a later send/read phase
- Apify, Hunter.io, and Playwright in later phases

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the env template:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in the required Supabase and Anthropic values:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ANTHROPIC_API_KEY=
   ```

   Optional but recommended for Phase 1c:

   ```bash
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   GOOGLE_OAUTH_CLIENT_ID=
   GOOGLE_OAUTH_CLIENT_SECRET=
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/gmail/callback
   GMAIL_TOKEN_ENCRYPTION_KEY=
   ```

   Generate the Gmail encryption key with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Start the app:

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). Sign up at `/signup`, complete onboarding at `/onboarding`, then you'll land on `/dashboard`.

## Supabase

Apply migrations to a fresh local Supabase database:

```bash
supabase start
supabase db reset
```

Generate TypeScript database types after migrations apply:

```bash
pnpm db:types
```

The checked-in `lib/db/types.ts` mirrors the current remote schema so the app and scripts are typed immediately.

For Docker-free remote schema updates:

```bash
supabase login --token "$SUPABASE_ACCESS_TOKEN"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
pnpm db:types
```

The Phase 1c migrations add private Supabase Storage under the `media-kits` bucket. PDFs are stored at `media-kits/<user_id>/<kit_id>.pdf`.

## Google OAuth Setup

Before clicking "Connect Gmail" in `/settings`, create a Google OAuth client:

1. In Google Cloud Console, create or open a project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen for an external test app and add your Gmail account as a test user.
4. Create an OAuth 2.0 Web application client.
5. Add `http://localhost:3000/api/gmail/callback` as an authorized redirect URI.
6. Copy the client ID and secret into `.env.local` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

Production will need the Vercel callback URL added too.

## Seed Athena's Profiles

After creating or identifying the target auth user, run:

```bash
   pnpm seed --user-id=<uuid>
   pnpm seed --user-id=<uuid> --seed-brands
```

The seed script creates:

- Athena's app-level `users` row
- `athena_hz` and `athena_huo` creator profiles
- One global outreach rules row
- One outreach rules row per creator profile

It does not seed voice style guides or media kits.

Pass `--seed-brands` to also create five example brand rows for the brand pool UI.

## RLS Test

Run:

```bash
pnpm test:rls
```

The script creates two temporary Supabase Auth users, signs in with the anon key, inserts one brand per user, and verifies user A cannot read, update, or delete user B's brand rows. It cleans up the temporary users at the end.

## Onboarding And Voice Tests

Run:

```bash
pnpm test:onboarding
pnpm test:voice-guide-shape
```

`pnpm test:onboarding` uses a fake voice guide generator and verifies account basics, creator profiles, voice samples, voice guide versioning, and onboarding completion. `pnpm test:voice-guide-shape` calls the real Anthropic API only when `ANTHROPIC_API_KEY` is set; otherwise it skips cleanly.

## Media Kit, Gmail, And PDF Tests

Run:

```bash
pnpm test:media-kit
pnpm test:gmail-encryption
pnpm test:pdf-render
```

`pnpm test:media-kit` uses a fake media kit generator and verifies media kit versioning. `pnpm test:gmail-encryption` checks AES-256-GCM refresh-token round trips and tamper detection. `pnpm test:pdf-render` renders a fixture kit to a PDF buffer without uploading to Storage.

## Brand Pool Tests

Run:

```bash
pnpm test:brand-identity
pnpm test:csv-import
```

`pnpm test:brand-identity` checks deterministic identity key normalization and merge promotion. `pnpm test:csv-import` imports a fixture CSV with valid and invalid rows, then verifies source signals and unique identity keys.

## Useful Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm db:types
pnpm seed --user-id=<uuid>
pnpm test:rls
pnpm test:onboarding
pnpm test:voice-guide-shape
pnpm test:media-kit
pnpm test:gmail-encryption
pnpm test:pdf-render
pnpm test:brand-identity
pnpm test:csv-import
```

## Repo Structure

- `app/` - Next.js App Router
- `components/` - UI components, with shadcn/ui primitives in `components/ui`
- `lib/` - shared utilities and service clients
- `lib/db/` - typed database helpers and generated Supabase types
- `lib/llm/` - Anthropic client and prompt helpers
- `lib/gmail/` - Gmail OAuth, encryption, and access-token helpers
- `lib/pdf/` - server-side PDF rendering
- `workers/` - Railway-deployed background workers
- `supabase/migrations/` - forward-only SQL migrations
- `prompts/` - versioned LLM prompts
- `docs/` - architecture docs and decisions
