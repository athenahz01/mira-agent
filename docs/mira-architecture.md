# Mira — Architecture & Data Model

> Mira is Athena's third named AI agent (after Moana, the chief of staff, and Ingrid, the content strategist). Mira handles brand outreach: sourcing, pitching, follow-ups, and deal tracking.
> Owner: Athena Huo. Repo: `athenahz01/mira-agent`.
> Doc version: v0.2 — 2026-05-13. This doc is the source of truth for what gets built.

---

## 0. The one-paragraph product summary

Mira is a personal sales agent for creator–brand deals. She's the third named AI agent in Athena's team (alongside Moana, her chief of staff, and Ingrid, her content strategist). Mira runs across two of Athena's Instagram accounts (`@athena_hz` and `@athena_huo`), each with a distinct voice and audience, and she handles the full outbound pipeline: sourcing the right brands, researching them, drafting pitches in Athena's voice for the right deal type (paid, gifting, affiliate, UGC, ambassadorship), sending under approval via Gmail, handling replies and follow-ups, and tracking the deal through to payment. The differentiating bet is in two places: (1) **deal-type-aware sourcing** — different deal types want different brands — and (2) **a voice system that learns**, so emails stop sounding like AI within a few weeks of real use.

---

## 1. System overview

Three runtime environments, talking to one Postgres database:

```
┌──────────────────────────────┐      ┌────────────────────────────┐
│  Next.js app (Vercel)        │      │  Worker (Railway)          │
│  - UI: dashboard, queue,     │      │  - Brand discovery jobs    │
│    pipeline, drafts, settings│◄────►│  - Apify scrapers          │
│  - API routes (CRUD + auth)  │      │  - Page scrapers (Playwright)
│  - Short-lived LLM calls     │      │  - Long LLM tasks (research│
│    (single draft refinement) │      │    synthesis, batch drafts)│
│  - Gmail send + webhook recv │      │  - Scheduled cron (poll    │
└──────────────┬───────────────┘      │    inbox, fire follow-ups) │
               │                      └─────────────┬──────────────┘
               │                                    │
               └─────────────►  Supabase (Postgres + Auth + Storage + RLS)  ◄──┘
                                          │
                                          ▼
                                ┌──────────────────────┐
                                │  External services   │
                                │  - Anthropic API     │
                                │  - Gmail API         │
                                │  - Apify             │
                                │  - Hunter.io         │
                                │  - Google Cal (later)│
                                └──────────────────────┘
```

**Why this split:** Vercel serverless functions time out at 60s on Hobby, 300s on Pro. Anything that involves scraping multiple pages, running Apify actors, or doing deep multi-step LLM research will blow past that. Railway (which you already use for Moana/Ingrid) handles long-running jobs and the Apify polling loop. The Next.js app stays snappy and synchronous.

**Why single-tenant but multi-tenant-ready:** This is your tool first. But the data model assumes a `user_id` on every row from day one, so if you ever turn this into a product for other creators, you don't have to redo the schema. RLS policies enforce isolation at the database layer.

---

## 2. Two accounts, one agent — how that actually works

You asked for one agent that handles both `@athena_hz` (main, fashion/lifestyle/UGC) and `@athena_huo` (growing, college/grad life/female power/AI products/day-in-the-life). These accounts have **different audiences and pitch different brands**. Treating them as one account would produce confused pitches.

Design decision: **one user, multiple `creator_profile` records.** Each profile has its own:
- Voice style guide (`@athena_hz` is warmer/fashion-y, `@athena_huo` is more grounded/tech-curious)
- Target brand categories (fashion/beauty/lifestyle vs. tech/AI tools/career/education brands)
- Rate card (different deliverable rates per account)
- Media kit (auto-generated per profile)
- Outreach calendar (so we don't pitch the same brand from both accounts simultaneously)

The brand pool is **shared** across profiles (one record per real-world brand), but each `campaign` is scoped to a specific profile. The sourcing engine knows that `@athena_huo` should never get a "warm fashion brand from a similar fashion creator" pitch, and `@athena_hz` should never pitch an AI dev tool. There's also a small set of brands that fit both (e.g., a beauty brand launching a "smart skincare" line might fit either, or a lifestyle tech brand) — for those, the system flags them and you pick the profile.

---

## 3. Data model

I'll describe each table with its purpose, key columns, and the reasoning behind non-obvious design choices. All tables have `id uuid pk`, `created_at`, `updated_at`, `user_id uuid` (RLS-enforced).

### 3.1 Identity & profile

**`users`**
You. Single row for now. Supabase Auth handles the actual auth row; this table is the app-level extension.
- `email`, `name`, `timezone`, `physical_address` (required for CAN-SPAM footer)
- `gmail_oauth_token_ref` — encrypted, points to Supabase Vault

**`creator_profiles`**
One per channel. Currently two: `@athena_hz` and `@athena_huo`.
- `handle` (e.g., `athena_hz`), `display_name`, `platform` (instagram primary, but extensible)
- `niche_tags[]` — `["fashion", "lifestyle", "ugc", "nyc", "asian-american"]` for `@athena_hz`; `["college", "grad-school", "female-power", "ai-tools", "career"]` for `@athena_huo`
- `audience_size_snapshot` (followers, updated weekly)
- `engagement_rate_snapshot`
- `tier` — derived: nano (<10k), micro (10–100k), mid (100k–500k), macro (500k+). Drives default rate suggestions.
- `aesthetic_keywords[]` — `["warm-toned", "soft-girl", "preppy-elevated"]` etc. Used in brand matching.
- `bio_extract`, `recent_post_themes[]` — refreshed monthly by the worker
- `voice_style_guide_id` — fk to versioned style guide
- `active` boolean
- `cross_pitch_cooldown_days` — default 90; don't pitch the same brand from both profiles within this window

**`voice_style_guides`** (versioned)
The voice system isn't a prompt suffix — it's a structured document that gets refined. Each guide is a JSON document plus a markdown rendering.
- `creator_profile_id`, `version`, `is_active`
- `style_doc_json` — see Section 7
- `learned_from` — array of message_ids marked "more like this" / "less like this"

**`media_kits`** (versioned per profile)
- `creator_profile_id`, `version`, `pdf_url` (Supabase Storage), `data_json`
- `data_json` includes: audience demos, top posts, deliverables offered, rate ranges, past collabs, contact info
- The agent regenerates a kit on demand and on a quarterly schedule

### 3.2 Brands & contacts

**`brands`**
One row per real-world brand. The brand pool is shared across profiles.
- `name` (canonical), `aliases[]` (e.g., "Rhode Skin" / "Rhode" / "Rhode Beauty")
- `domain`, `instagram_handle`, `tiktok_handle`
- `category[]` — `["beauty", "skincare", "celebrity-founded"]`
- `aesthetic_tags[]` — extracted from their IG (`["minimalist", "warm-tones", "elevated-everyday"]`)
- `size_estimate` — `["pre-launch", "indie-small", "indie-medium", "established-dtc", "legacy-large"]` — drives rate expectations and pitch register
- `creator_friendliness_score` — 0–100, learned from data (how often they work with creators in your tier)
- `pays_creators` boolean — null until known; flipped true when we see paid posts from similar creators or when you confirm
- `last_pitched_at` (most recent across all your profiles), `pitch_count`
- `source_signals_summary` — short denormalized blurb ("found via @sample_creator's tagged post, also in 3 fashion-creator's reels")

**`brand_contacts`**
One row per email/contact at a brand. A brand can have multiple contacts.
- `brand_id`, `email`, `name`, `role` (`pr`, `marketing`, `partnerships`, `founder`, `generic_info`, `unknown`)
- `source` — `["hunter", "page_scrape", "manual", "linkedin", "press_kit"]`
- `confidence` — 0–100
- `verified_at` — null until we get a non-bounce reply or you mark verified
- `last_emailed_at`, `bounce_count`, `marked_unreachable` boolean
- `unsubscribe_received_at` — kills all future outreach to this contact (CAN-SPAM compliance)

**`source_signals`** (raw evidence, append-only)
Every reason a brand entered your queue. Lets us reconstruct "why is this here" later, and lets the scoring model learn what signal types convert.
- `brand_id`, `signal_type` (`tagged_by_competitor_creator`, `aesthetic_match`, `manual_seed`, `inbound_dm`, `creator_friendly_directory`, `recent_funding`, etc.)
- `evidence_url`, `evidence_json` (e.g., the post that tagged them, the creator who tagged, that creator's tier)
- `weight` — initial weight by signal type, updated by the learning loop

### 3.3 Campaigns, messages, threads

**`campaigns`**
A campaign = one outreach push to one brand from one profile for one deal type. The atomic unit.
- `creator_profile_id`, `brand_id`, `deal_type` (`paid`, `gifting`, `affiliate`, `ugc`, `ambassador`)
- `status` — see Section 5 state machine
- `score` — fit score at creation time (frozen for analytics)
- `score_rationale_json` — why this brand, this profile, this deal type
- `hook_chosen` — the specific opener angle used in the eventual email
- `target_contact_id` — which `brand_contact` we're emailing
- `scheduled_send_at`, `sent_at`, `replied_at`, `closed_at`, `outcome` (`won`, `lost`, `ghost`, `not_a_fit`)
- `deal_value_usd` (if won)
- `notes` — free text, your edits

**`messages`**
Every draft and every sent email. Drafts are versioned per campaign.
- `campaign_id`, `version`, `kind` (`initial`, `follow_up_1`, `follow_up_2`, `reply`)
- `subject`, `body_text`, `body_html`
- `status` — `draft`, `pending_approval`, `approved`, `sent`, `bounced`, `replied`
- `approved_at`, `approved_by` (always you, but field exists for future)
- `gmail_message_id`, `gmail_thread_id` — once sent
- `model_used`, `prompt_hash` — for analytics on which prompt versions produce better drafts
- `was_edited_before_send` boolean, `edit_diff` — captures your edits to learn voice from

**`email_threads`**
Mirror of Gmail threads we participate in.
- `gmail_thread_id`, `campaign_id`, `last_message_at`, `participant_emails[]`

**`reply_classifications`**
When a reply comes in, the agent classifies it before drafting a response.
- `message_id` (the incoming reply), `category` (`interested`, `asks_rate`, `asks_more_info`, `decline_polite`, `decline_firm`, `out_of_office`, `wrong_person`, `unsubscribe`, `spam`, `other`)
- `confidence`, `summary` (1-sentence), `suggested_action` (`draft_reply`, `pause_campaign`, `move_to_negotiating`, `mark_lost`)

### 3.4 Follow-ups & sequences

**`follow_up_sequences`**
Per-campaign follow-up plan. Generated at send time, mutable.
- `campaign_id`
- `steps_json` — array of `{ step_number, send_after_days, angle, draft_status }`
- Default for cold outreach: step 1 at +7 days (new angle, not "bumping"), step 2 at +14 days (different angle or piece of social proof), then stop.
- Cancelled on any reply.

### 3.5 Deals, deliverables, payments

**`deals`** (created when campaign moves to `negotiating` or `won`)
- `campaign_id`, `agreed_value_usd`, `currency`, `payment_terms` (`net_30`, `upfront`, `split`, `gifting_only`)
- `contract_url`, `contract_status` (`draft`, `signed`, `none`)
- `usage_rights_scope`, `exclusivity_clauses_json` — flagged by contract review agent

**`deliverables`**
- `deal_id`, `kind` (`ig_reel`, `ig_static`, `ig_story`, `tiktok`, `ugc_video`, `ugc_photo_set`), `quantity`, `due_date`, `posted_url`, `status`

**`payments`**
- `deal_id`, `amount_usd`, `expected_at`, `received_at`, `status`

### 3.6 Voice & learning

**`voice_samples`**
Every piece of writing in your voice that we use as training signal.
- `creator_profile_id`, `source` (`website`, `ig_caption`, `tiktok_caption`, `email_sent`, `email_edited`, `manual_paste`)
- `text`, `metadata_json` (engagement metrics if applicable)
- `tag` — `excited`, `professional`, `bilingual`, `pitch`, `personal` etc.

**`feedback_marks`**
Your thumbs up/down on drafts and replies.
- `message_id` or `campaign_id`, `direction` (`positive`, `negative`), `note`

**`hook_library`**
Reusable opener angles tracked for performance.
- `hook_pattern` (e.g., "noticed-they-tagged-similar-creator", "founder-podcast-reference", "specific-product-detail", "shared-aesthetic-callout")
- `applies_to_deal_types[]`
- `creator_profile_id` (or null for cross-profile)
- `usage_count`, `reply_rate`, `positive_reply_rate`

### 3.7 Knobs & settings

**`outreach_rules`** (per user, with per-profile overrides)
- `max_sends_per_day` (per profile, default 15)
- `send_window_start_hour`, `send_window_end_hour`, `send_timezone`
- `min_minutes_between_sends`
- `excluded_brand_ids[]`, `excluded_categories[]`
- `auto_send_after_approval` — `false` initially; you batch-approve then a worker sends staggered
- `require_per_email_approval` — `true` initially, `false` once you trust it

---

## 4. The sourcing engine

This is the riskiest and most differentiating piece. Designed as a pipeline of pluggable connectors feeding into a scoring layer.

### 4.1 Connectors (each runs on a schedule on Railway)

**Connector A — Competitor reverse-lookup (Apify)**
- Input: list of seed creators in your tier and niche (you provide 5–10 per profile, agent suggests more)
- Output: every brand tagged in their last 90 days of posts, with the post URL, caption, and whether it was tagged as #ad/#partner
- Apify actor: there are well-maintained IG scraper actors. Use one that respects rate limits.

**Connector B — Aesthetic-similar brands (LLM + IG)**
- Input: seed brands you love + your aesthetic_keywords
- For each seed, find brands with similar aesthetic via:
  - "people also follow" relationships
  - Hashtag co-occurrence
  - LLM judgment on bio + recent posts
- Output: candidate brand list with an aesthetic-match rationale

**Connector C — Creator-friendly directories**
- Public lists: Shopify "brands that work with influencers" lists, beauty/fashion launch trackers (Glossy, Beauty Independent), Modern Retail's new-brand coverage, AngelList for early DTC, Product Hunt for tech/AI products (for `@athena_huo`)
- Output: brands with funding signals + recency

**Connector D — Manual seed + CSV upload**
- You paste brand names or upload a list. The agent enriches each row.

**Connector E — Inbound DM mining (later)**
- Read inbound DMs you've received from brands (manual paste for now, automated later via IG Graph API for business accounts). These are warm leads — high priority.

**Connector F — Recent funding / launch signals**
- Crunchbase RSS-ish, Modern Retail launch coverage, brand press release pages
- Brands that just raised tend to start influencer programs in the following 1–3 months

### 4.2 Brand identity resolution (dedup)

Same brand comes in from multiple connectors with different name spellings. Resolution logic:
1. Normalize: lowercase, strip punctuation, strip suffixes ("inc", "co", "the")
2. Match on `domain` first if present (highest confidence)
3. Match on `instagram_handle` second
4. Fuzzy match on `name` + `category` third
5. Manual review queue for ambiguous matches

### 4.3 Enrichment

Once a brand is in the pool, enrich:
- Hunter.io for contact discovery (domain → emails + roles)
- Page scrape `/contact`, `/press`, `/influencers`, `/collabs` pages (Playwright)
- Aesthetic tag extraction from their last 30 IG posts (LLM, cached 30 days)
- Size estimate from follower count + Shopify/web presence + Crunchbase
- `creator_friendliness_score` from: do they tag creators? do they have a creator program page? have similar-tier creators worked with them?

### 4.4 Scoring (deal-type-aware)

A brand gets one **base fit score** per `(creator_profile, brand)` pair, and then **deal-type modifiers** on top.

Base fit (0–100):
- Aesthetic match between brand and profile (LLM judgment, calibrated)
- Audience overlap proxy (does this brand's audience look like your audience?)
- Category match (fashion brand to fashion creator, etc.)
- Tier appropriateness (you don't pitch Chanel; you don't pitch a pre-launch indie that can't afford you for paid)

Deal-type modifiers:
- **Paid:** requires `pays_creators=true` OR strong signal that they do (similar-tier paid posts visible). Penalty if pre-launch or unfunded indie. Penalty for too-large brands that only work with macro.
- **Gifting:** wide tolerance. Bonus for "we have a PR list" signals. Penalty for cheap products (<$30 retail) unless aesthetic-perfect, because shipping a $15 product isn't worth your post.
- **Affiliate:** bonus for brands with public affiliate programs (LTK, ShopMy, Skimlinks, their own program). Penalty for brands with no affiliate infrastructure.
- **UGC:** bonus for brands actively buying UGC (visible signals: "we hire UGC creators," recent posts using clearly-UGC content). Different contact target — UGC asks often go to a different person.
- **Ambassador:** highest bar. Requires strong aesthetic + values + long-term fit signal.

The system produces a per-brand card with **the recommended deal type(s) and the score for each**, not a single "pitch this brand" verdict.

### 4.5 Cold-start: how the first 50 brands enter the system

Phase 1 of build, day 1 of use:
1. You give 5 seed brands per profile you'd genuinely love to work with
2. You give 5 seed competitor creators per profile you respect
3. Agent runs Connectors A + B + D and seeds ~100–200 brands per profile
4. Enrichment runs overnight
5. You wake up to ~30–50 scored brand cards per profile to review

You mark which brands are interesting, skip the rest. Those marks become training data for the scoring model.

---

## 5. The campaign state machine

```
            ┌─────────┐
            │ queued  │  ← brand sourced, scored, not yet researched
            └────┬────┘
                 │ research_complete
                 ▼
            ┌─────────┐
            │drafted  │  ← email written, awaiting your review
            └────┬────┘
                 │ approved              │ rejected
                 ▼                       ▼
            ┌─────────┐             ┌────────┐
            │approved │             │skipped │
            └────┬────┘             └────────┘
                 │ sent
                 ▼
            ┌─────────┐
            │  sent   │
            └────┬────┘
        ┌────────┼────────┬──────────┐
        │        │        │          │
        ▼ bounce ▼ open   ▼ reply    ▼ no_action_after_followups
   ┌────────┐ ┌──────┐ ┌──────────┐ ┌────────┐
   │bounced │ │opened│ │ replied  │ │ ghosted│
   └────────┘ └──┬───┘ └────┬─────┘ └────────┘
                 │          │
                 │ time→    │ classify
                 ▼          ▼
            follow_up_1   ┌─────────────────────┐
                 │        │ negotiating / won / │
                 ▼        │ lost / not_a_fit    │
            follow_up_2   └─────────────────────┘
                 │
                 ▼
            ghosted (terminal)
```

Transitions are explicit functions in the worker code, each with logging. No "set status field directly" — every transition runs through a function that can fire side effects (cancel follow-ups on reply, etc.).

---

## 6. The drafting pipeline

This is where most cold email tools fail. The mistake is "write an email with brand-specific variables." That always sounds AI. The right approach: **build a deep brief, then write from it like a human would.**

### 6.1 Per-campaign brief generation (worker, Claude Opus)

Before drafting, generate a brief:
```
{
  "why_this_brand_for_this_profile": "...",
  "brand_recent_signals": ["launched X on date Y", "founder appeared on Z podcast", "tagged creator @abc last week"],
  "potential_hooks": [
    { "hook_type": "specific-product", "content": "...", "strength": 0-100 },
    { "hook_type": "shared-aesthetic", "content": "...", "strength": 0-100 },
    ...
  ],
  "best_hook": <one>,
  "best_hook_reasoning": "...",
  "deal_type_recommendation": "...",
  "tone_register_recommendation": "warm-casual" | "warm-professional" | "professional",
  "deliverable_pitch": "1 IG reel + 3 stories for gifting" | "..." (concrete, not vague),
  "risk_flags": ["very_active_creator_program_so_competition_high", "..."]
}
```

This brief is stored on the campaign and reused for follow-ups (each follow-up picks the *next* hook from the candidates).

### 6.2 The "rationale-first" approval card

In the UI, every draft renders as:

```
┌────────────────────────────────────────────────┐
│  Brand: [logo] Rhode Skin                       │
│  Profile: @athena_hz   Deal type: Gifting (87)  │
│                                                 │
│  Why pitch: [2 sentences]                       │
│  Hook: [the specific opener angle, 1 line]      │
│  Recent signal: [what makes this timely]        │
│                                                 │
│  ── Subject (pick or edit) ──                  │
│  [variant 1]    [variant 2]    [variant 3]      │
│                                                 │
│  ── Body ──                                    │
│  [editable email body]                          │
│                                                 │
│  [Skip] [Edit then send later] [Approve & send] │
└────────────────────────────────────────────────┘
```

**Key UX rule:** the rationale and hook are *above* the body. If the rationale is weak you skip in 2 seconds without reading the body. This is the difference between reviewing 50 drafts/hour and 5 drafts/hour.

### 6.3 Edits become voice training data

When you edit a draft before sending, the diff gets stored as a `voice_sample` tagged `email_edited`. Over time, the style guide updates from these edits.

---

## 7. The voice style system

Not a prompt suffix. A structured, versioned doc. Initial v1 for `@athena_hz` (extracted from your website + the template you sent):

```json
{
  "profile_id": "<athena_hz>",
  "register_options": {
    "gifting": "warm-enthusiastic, light exclamation use OK, first-person, conversational",
    "paid": "warm-professional, no double exclamations, no 'huge fan' language, lead with a specific observation",
    "ugc": "professional-direct, lead with deliverable, no excess warmth",
    "affiliate": "casual-professional, brief, results-focused"
  },
  "vocabulary_likes": [
    "romanticizing", "everyday", "lifestyle moments", "looks",
    "warm-toned", "elevated everyday", "loved" (vs. "obsessed with")
  ],
  "vocabulary_avoid": [
    "huge fan", "loyal customer", "amazing products", "would love the opportunity",
    "best regards" (use a softer sign-off), "I look forward to" (boilerplate)
  ],
  "sentence_rhythm": "mix short punchy sentences with one longer descriptive one — never three long sentences in a row",
  "personal_anchors": [
    "Bay Area → NYC", "UC Berkeley + Cornell M.Eng", "drone content",
    "size 0-4 / 5'7 — useful for fit-relevant fashion pitches",
    "bilingual EN/ZH — useful for AAPI-focused brands"
  ],
  "deliverable_default_language": {
    "ig_reel": "a styled reel showcasing [product] in [context]",
    "ig_static": "a static post + 2-3 supporting stories",
    "ugc_video": "raw vertical UGC video for your usage"
  },
  "sign_offs": ["xx, Athena", "thanks so much — Athena", "best, Athena Huo"],
  "do_nots": [
    "do not say 'I'm a content creator' — say what kind specifically",
    "do not promise virality or guaranteed reach",
    "do not over-flatter — pick one specific thing and mean it"
  ]
}
```

A parallel guide for `@athena_huo` will lean toward "grounded, curious, slightly more direct, career-aware, AI-fluent without being jargon-y."

These guides get versioned. The agent picks the right register based on `deal_type` per campaign.

---

## 8. Gmail integration

### 8.1 OAuth scopes (minimal viable)
- `gmail.send` — send email
- `gmail.readonly` — read inbox for reply detection
- `gmail.modify` — apply labels (`Mira/Sent`, `Mira/Replied`)
- `gmail.labels` — create/manage those labels

### 8.2 Threading
Every campaign uses one Gmail thread. Follow-ups send as replies to the original, so the brand sees one conversation, not three new emails.

### 8.3 Send pacing rules (deliverability hygiene)
- Max 15 sends/day per profile (configurable, start lower)
- Min 4 minutes between sends, randomized to 4–11 minutes
- Send window: 9am–4pm in send_timezone (configurable)
- No sends on weekends by default (configurable)
- Warm-up phase: first 2 weeks cap at 5 sends/day

### 8.4 Deliverability flags
- Every email includes a plain-text version
- CAN-SPAM footer with your physical address + "reply to opt out" line (cleaner than a literal unsubscribe URL for 1:1 outreach, and legally compliant for genuine 1:1)
- Track bounce rate per profile; if >5% in a 7-day window, pause sending and alert
- SPF/DKIM/DMARC: since we're sending through Gmail directly, this is handled by Gmail. **But:** consider sending from a subdomain alias (e.g., `collabs@athenahuo.com` instead of `athenazhuo@gmail.com`) — this protects your personal inbox and looks more professional. We can configure this via Gmail "Send as" or set up Google Workspace.

### 8.5 Reply detection
- Vercel Cron polls inbox every 5 minutes during send window, every 30 minutes off-hours
- Use Gmail push notifications (Pub/Sub) once the polling pattern works — more efficient
- Each new message in a tracked thread → classify → notify you in-app + draft a response if appropriate

---

## 9. Negotiation copilot (Phase 6)

Once a reply lands in `interested` or `asks_rate`, surface:
- Suggested rate range given: your tier, this brand's size, similar deals you've closed, public benchmarks
- Drafted reply with the rate and a calendly-style next-step
- Counter-offer logic: if their offer is below your floor by >20%, draft a polite counter with rationale
- Walk-away signals: if they push too hard on usage rights or exclusivity, flag it

Contract review is a smaller LLM task: paste the agreement, agent flags risky clauses (perpetual usage rights, exclusivity scope, payment terms, kill fee absence, IP transfer).

---

## 10. Pipeline & analytics

### Kanban view
Columns: `Queued → Drafted → Sent → Opened → Replied → Negotiating → Won → Live → Paid`. Loss reasons captured at terminal states (`ghosted`, `declined`, `not_a_fit`, `walked_away`).

### Analytics dashboard
- Reply rate, by: brand category, deal type, hook type, send time-of-day, profile
- Time-to-first-reply distribution
- Won-deal value over time
- Best-performing hooks (these feed back into the hook library weights)
- Brand source ROI (which connector produces brands that actually convert)

### Learning loop (the part that makes it smarter)
Every closed-loop outcome (reply / no reply / won / lost) updates:
- `hook_library` reply rates
- `source_signals.weight` (which signal types predict good brands)
- Brand `creator_friendliness_score` (updates from your actual experience)
- Profile-level voice rules (from your edits)

---

## 11. API surface (Next.js routes)

```
auth/*                 — Supabase Auth wrappers
gmail/oauth/*          — OAuth start, callback, refresh
profiles               — CRUD on creator_profiles
brands                 — list, search, manual add, exclude
brands/:id             — detail, including all source_signals
brands/:id/research    — trigger fresh research
campaigns              — list (with filters), create
campaigns/:id          — detail
campaigns/:id/draft    — generate or regenerate draft
campaigns/:id/approve  — approve + schedule send
messages/:id/edit      — save edit, store diff as voice_sample
replies/:id/classify   — re-run classification
replies/:id/respond    — generate response draft
deals/:id              — CRUD
deliverables/:id       — update status
voice/style-guide/:id  — view, edit, version
analytics/*            — dashboard queries
settings/outreach-rules — read/write
```

### Worker jobs (Railway)
```
job: source_brands_for_profile(profile_id)     — runs daily
job: enrich_brand(brand_id)                    — on demand + after source
job: generate_research_brief(campaign_id)      — on demand
job: generate_draft(campaign_id)               — on demand + after brief
job: send_scheduled(campaign_id)               — runs every minute, picks up due sends
job: poll_inbox_for_replies()                  — every 5 min
job: classify_reply(message_id)                — on new reply
job: fire_follow_up(campaign_id, step)         — runs every hour
job: refresh_creator_profile_snapshots()       — weekly
job: regenerate_media_kit(profile_id)          — quarterly + on demand
```

---

## 12. Privacy, legal, hygiene

- **CAN-SPAM** (US): every outbound has your physical address and a clear way to opt out. Single-recipient personal outreach is a softer category than mass marketing, but we comply anyway.
- **GDPR**: avoid emailing EU brands without a legitimate interest basis, or include an unsubscribe URL when you do. Flag brands with EU domains in the UI.
- **Brand data storage**: we store public brand info only. No buying personal email lists. Hunter.io is fine — they aggregate public business info.
- **Instagram ToS**: Apify usage is in a gray zone. Use respectful rate limits. Never automate IG actions from your account; only read public data.
- **Gmail ToS**: fine as long as we're not sending bulk identical emails. Our usage is 1:1 personalized.

---

## 13. Phase rollout

Modular, ship pieces as ready (your preference). Each phase produces something usable.

**Phase 1a — Foundation & schema**
- Repo, Next.js + Supabase setup
- Auth (email/password), RLS on every table
- Full v1 schema migration (all tables created now, even if used later)
- Seed script for the two creator_profiles
- Minimal authed shell (login → empty /dashboard)

**Phase 1b — Onboarding & voice & Gmail**
- Onboarding flow: intake form for each profile
- Voice style guide v1 generation per profile (uses website + IG + manual inputs)
- First media kit drafts per profile
- Gmail OAuth connection + token storage
- Settings UI for outreach_rules and physical address (CAN-SPAM)

**Phase 2 — Sourcing engine MVP**
- Connector A (competitor reverse-lookup via Apify) for both profiles
- Connector D (manual seed + CSV)
- Enrichment: Hunter + page scraping
- Brand identity resolution
- Scoring v1 (rules-based, not ML)
- Brand pool UI: list, filter, mark interesting

**Phase 3 — Drafting**
- Research brief generation
- Draft generation per deal type
- Rationale-first approval card UI
- Edit-to-voice-sample loop
- Hook library seeding

**Phase 4 — Send + reply + follow-up**
- Gmail send with pacing
- Inbox polling + reply classification
- Follow-up state machine + sequence generation
- Daily approval queue UI

**Phase 5 — Pipeline + analytics**
- Kanban view
- Analytics dashboard
- Learning loop wiring

**Phase 6 — Negotiation copilot**
- Rate suggestion engine
- Counter-offer drafting
- Contract review

**Phase 7 — Polish & extensions**
- IG DM drafts (manual send)
- Inbound DM mining
- Subdomain email setup
- Connector B (aesthetic-similar)
- Connector F (funding/launch signals)

---

## 14. Resolved decisions (as of v0.2)

1. **Sender domain:** `zhengathenahuo@gmail.com`, with Gmail display name set to "Athena Huo." Configured in Phase 1b during Gmail OAuth setup. Subdomain (`collabs@athenahuo.com`) deferred — can migrate later without schema changes.
2. **Repo structure:** Single Next.js repo with `/workers` folder for Railway-deployed background jobs. Repo: `athenahz01/mira-agent`.
3. **`@athena_huo` landing page:** Not part of this project. Hold off.
4. **Profile architecture:** Two `creator_profile` records under one user, shared brand pool, 90-day cross-pitch cooldown.
5. **Cold-start seeds:** Collected during the Phase 1b onboarding flow (5–10 brands + 5–10 competitor creators per profile).
6. **Inbound brand DMs:** Starting fresh, no historical DMs to ingest on day 1.

## 15. Still open

- Exact LLM prompts (will live in `/prompts` folder, versioned — drafted per phase)
- Exact Apify actor selection and rate limit tuning (Phase 2)
- Onboarding UI screen-by-screen (Phase 1b)
- Rate suggestion algorithm specifics (Phase 6)
- Contract review prompt specifics (Phase 6)
- Pricing / cost projections — worth doing before Phase 2 since cost shapes sourcing volume

---

*End v0.2. Next revision after Phase 1a audit.*
