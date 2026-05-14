# Mira Worker

The worker is a long-running Node process for jobs that should not run inside
the Next.js request cycle. Phase 2c uses it for `page_scrape` jobs: polite
Playwright scraping of brand contact, press, partnership, and about pages.

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
WORKER_KIND=page_scrape
WORKER_ID=local-page-scrape
```

`WORKER_ID` is optional. If omitted, the worker generates a UUID at startup.

Run locally from the repo root:

```bash
pnpm worker:dev
```

You should see:

```text
worker starting, id=<uuid>, kind=page_scrape
```

Then open `/brands`, enqueue a page scrape job, and watch the worker logs for
claim/complete/fail messages.

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
WORKER_KIND=page_scrape
WORKER_ID=railway-page-scrape-1
```

Use the same Supabase project as the Vercel app. `SUPABASE_SERVICE_ROLE_KEY`
is required because the worker claims jobs through the service-role-only
`claim_next_job` RPC and writes scrape results back to tenant-scoped tables.

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
