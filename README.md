# Mira

Mira is Athena Huo's personal cold-outreach agent for brand sponsorships, gifting, affiliate, UGC, and ambassador deals. This repo starts as a single-user tool, with the database and RLS model shaped so it can become multi-tenant later without schema rewrites.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui
- Supabase Postgres, Auth, Storage, and RLS
- Vercel for the web app
- Railway worker code under `workers/`
- Anthropic, Gmail, Apify, Hunter.io, and Playwright in later phases

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the env template:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

4. Start the app:

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). Phase 1a intentionally goes straight to `/dashboard`; visible login and signup screens are deferred because Athena asked to bypass them for now.

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

The checked-in `lib/db/types.ts` mirrors the Phase 1a schema so the app and scripts are typed immediately.

## Seed Athena's Profiles

After creating or identifying the target auth user, run:

```bash
pnpm seed --user-id=<uuid>
```

The seed script creates:

- Athena's app-level `users` row
- `athena_hz` and `athena_huo` creator profiles
- One global outreach rules row
- One outreach rules row per creator profile

It does not seed voice style guides or media kits; those are Phase 1b.

## RLS Test

Run:

```bash
pnpm test:rls
```

The script creates two temporary Supabase Auth users, signs in with the anon key, inserts one brand per user, and verifies user A cannot read, update, or delete user B's brand rows. It cleans up the temporary users at the end.

## Useful Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm db:types
pnpm seed --user-id=<uuid>
pnpm test:rls
```

## Repo Structure

- `app/` - Next.js App Router
- `components/` - UI components, with shadcn/ui primitives in `components/ui`
- `lib/` - shared utilities and service clients
- `lib/db/` - typed database helpers and generated Supabase types
- `lib/llm/` - Anthropic client and prompt helpers
- `lib/gmail/` - Gmail helpers in later phases
- `workers/` - Railway-deployed background workers
- `supabase/migrations/` - forward-only SQL migrations
- `prompts/` - versioned LLM prompts
- `docs/` - architecture docs and decisions
