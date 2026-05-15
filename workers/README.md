# Mira Worker

The worker is a long-running Node process for jobs that should not run inside
the Next.js request cycle. It currently handles:

- `page_scrape`: polite Playwright scraping of brand contact, press,
  partnership, and about pages.
- `instagram_scrape`: RapidAPI Instagram competitor reverse-lookup for
  sponsored brand tags.
- `auto_draft`: batch draft generation for the approval queue.
- `send_email`: drains approved messages whose scheduled send time has
  arrived and sends them through the connected Gmail account.

## Local Setup

Install worker dependencies from the repo root:

```bash
pnpm --dir workers install
pnpm --dir workers exec playwright install chromium
```

Required local env vars live in `../.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_KIND=page_scrape,instagram_scrape,auto_draft,send_email
WORKER_ID=local-mira-worker
RAPIDAPI_KEY=
RAPIDAPI_INSTAGRAM_HOST=instagram-scraper-stable-api.p.rapidapi.com
RAPIDAPI_INSTAGRAM_RATE_LIMIT_PER_MINUTE=30
ANTHROPIC_API_KEY=
ANTHROPIC_OPUS_MODEL=claude-opus-4-7
ANTHROPIC_SONNET_MODEL=claude-sonnet-4-5
```

`WORKER_ID` is optional. If omitted, the worker generates a UUID at startup.
`WORKER_KIND` accepts a single kind, a comma-separated list such as
`page_scrape,instagram_scrape,auto_draft`, or `all`.

Run locally from the repo root:

```bash
pnpm worker:dev
```

You should see:

```text
worker starting, id=<uuid>, kinds=page_scrape,instagram_scrape,auto_draft,send_email
```

Then open `/brands` or `/approvals`, enqueue a scrape or auto-draft job, and
watch the worker logs for claim/complete/fail messages.

## Railway Deployment

Phase 2c adds the deployment files but does not require deploying the service
yet. When ready:

1. Create a new Railway service from this repo.
2. Set the Dockerfile path to `workers/Dockerfile` if Railway does not pick up
   `workers/railway.toml` automatically.
3. Add env vars:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_KIND=page_scrape,instagram_scrape,auto_draft,send_email
WORKER_ID=railway-mira-worker-1
RAPIDAPI_KEY=
RAPIDAPI_INSTAGRAM_HOST=instagram-scraper-stable-api.p.rapidapi.com
RAPIDAPI_INSTAGRAM_RATE_LIMIT_PER_MINUTE=30
ANTHROPIC_API_KEY=
ANTHROPIC_OPUS_MODEL=claude-opus-4-7
ANTHROPIC_SONNET_MODEL=claude-sonnet-4-5
```

Use the same Supabase project as the Vercel app. `SUPABASE_SERVICE_ROLE_KEY`
is required because the worker claims jobs through the service-role-only
`claim_next_job` RPC and writes scrape results back to tenant-scoped tables.

For the cheaper one-worker Railway Hobby setup, use:

```bash
WORKER_KIND=page_scrape,instagram_scrape,auto_draft,send_email
```

The worker loop tries each kind in order on every tick and claims the first
available job. `WORKER_KIND=all` is a shorthand for all current kinds:
`page_scrape`, `instagram_scrape`, `auto_draft`, and `send_email`.

The Docker image uses the official Playwright base image, so Chromium is
already installed in the container.

## Scaling

Scale replicas in the Railway dashboard. Multiple replicas can run safely
because `claim_next_job` uses a Postgres `for update skip locked` lease. Each
worker gets one queued job at a time.

Keep replicas low for page scraping. This is polite contact-page scraping, not
high-volume crawling.

## Stuck Jobs

Check queued/running jobs:

```sql
select
  id,
  kind,
  status,
  attempts,
  max_attempts,
  next_attempt_at,
  locked_by,
  locked_until,
  error_message,
  payload_json
from public.jobs
order by created_at desc
limit 50;
```

If a worker crashes, jobs with expired leases stay visible as `running`. For
Phase 2c, inspect and manually reset one if needed:

```sql
update public.jobs
set
  status = 'queued',
  locked_by = null,
  locked_until = null,
  next_attempt_at = now()
where id = '<job-id>'
  and status = 'running'
  and locked_until < now();
```

Failed jobs stay failed for inspection after `max_attempts` is reached.
