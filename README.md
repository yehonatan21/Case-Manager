# Case Manager — AI-assisted requests, quotes & cases

> **מערכת חכמה לניהול בקשות, שירותים ותיקים.** מבקשה חופשית של לקוח ועד השלמת השירות — בתהליך אחד, ברור, חכם ושקוף.
> הממשק בעברית (RTL) כברירת מחדל, עם מעבר מלא לאנגלית (LTR) בלחיצה אחת.

A responsive web app where customers describe what they need in their own words, an AI assistant turns it into a structured request, staff review it with an AI copilot and send a quote, and the customer approves, pays and follows the case until it's done.

**Languages:** Hebrew (RTL, default) and English (LTR). The language switcher is in every header; the choice is stored in a cookie and on the user's profile (so emails arrive in their language too).

| Customer: describe the need | Customer: AI conversation | Customer: case on mobile |
|---|---|---|
| ![Home](docs/screenshots/home-he.png) | ![Intake](docs/screenshots/intake-chat-he.png) | ![Mobile case](docs/screenshots/mobile-case-he.png) |
| **Staff: case workspace + AI copilot** | **Staff: quote editor** | **Staff dashboard (English)** |
| ![Workspace](docs/screenshots/case-workspace-he.png) | ![Quote editor](docs/screenshots/quote-editor-he.png) | ![Dashboard](docs/screenshots/dashboard-en.png) |

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. That's it: with no configuration the app uses an embedded PostgreSQL (PGlite) in `.data/`, an offline AI engine, a test checkout, local encrypted file storage, and prints emails to the console. Sign-in codes are shown on screen in development.

**Demo accounts** (seeded automatically on first run, sign in at `/login`):

| Email | Role |
|---|---|
| `admin@example.com` | Administrator |
| `manager@example.com` | Case manager |
| `staff@example.com` | Staff member |
| `finance@example.com` | Finance |
| `client@example.com` | Private customer (2 cases) |
| `biz@example.com` | Company customer (quote waiting for approval) |

To use Claude, set `ANTHROPIC_API_KEY` (see `.env.example`). To use real PostgreSQL, `docker compose up -d` and set `DATABASE_URL`.

## Deploy

### Free: Vercel + Neon

Runs on free tiers: **Vercel Hobby** hosts the app (serverless) and **Neon** provides PostgreSQL. Uploaded files are stored encrypted in the database, or in **Vercel Blob** if you connect it. Vercel's Hobby plan is for personal, non-commercial use; for commercial use upgrade to Pro or use the Render/Docker options below.

1. **Import the project:** go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import `yehonatan21/Case-Manager`. Keep the detected Next.js settings. Vercel runs `npm run vercel-build`, which applies database migrations and then builds.
2. **Before the first deploy, add environment variables:**
   - `APP_SECRET`: a long random string. Generate one with `openssl rand -hex 32`, and never change it afterwards.
   - `DEMO_MODE`: `true` to try it right away (sign-in codes on screen, demo accounts).
   - `CRON_SECRET`: any random string. It protects the daily maintenance job.
   - Optional: `ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, `SMTP_URL`.
3. **Add the database:** in the project's **Storage** tab, choose **Neon → Create** (free plan, region close to Frankfurt) and connect it to the project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
4. **Optional:** in Storage, create a **Blob** store (private) to keep files outside the database.
5. **Redeploy** from the Deployments tab, so the build runs the migrations against Neon.

On Vercel the app adapts automatically:
- Migrations run once per build instead of on every cold start, over the direct connection.
- Live updates poll every 8 seconds instead of holding a streaming connection open.
- Quote expiry runs from the daily cron in [`vercel.json`](vercel.json). Notification emails are still sent immediately.
- Files go to Vercel Blob if a store is connected, and to the database otherwise.

Free-tier limits that apply: Neon's free compute pauses when idle, so the first request after a pause is slower, and storage is limited. Vercel Hobby limits function usage and allows only daily crons.

The same demo-mode and go-live notes apply as below: set `SMTP_URL` and `DEMO_MODE=false` before real use.

### Render (paid, long-running server)

**Render (one click).** The app needs a long-running Node server (realtime updates, background email delivery), managed PostgreSQL, persistent encrypted file storage and HTTPS. The included [`render.yaml`](render.yaml) Blueprint provisions all of it from this repository: a Docker web service (Frankfurt, health-checked at `/api/health`), PostgreSQL 16 reachable only from your services, a 1 GB persistent disk for uploads, generated secrets, and auto-deploy on every push.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yehonatan21/Case-Manager)

1. Click the button, sign in to Render and connect GitHub if asked.
2. Fill the prompted values — `ADMIN_EMAIL` (your email, becomes an administrator), and optionally `ANTHROPIC_API_KEY` and `SMTP_URL`. Review and approve the plan — a paid Starter web service (required for the persistent disk) and a `basic-256mb` PostgreSQL; Render shows the monthly cost before you confirm.
3. Wait for the first deploy, then open the `onrender.com` URL.

The Blueprint starts in **demo mode** (`DEMO_MODE=true`): sign-in codes appear on screen, demo accounts are seeded, and a banner warns that the environment is shared. **Before real customers use it:** set `SMTP_URL` (any SMTP provider), set `DEMO_MODE=false`, and sign in with your `ADMIN_EMAIL` (setting `ADMIN_EMAIL` creates that admin on the next start even if the database already exists). For a clean production database, create the Blueprint with `DEMO_MODE=false` from the start. Optional: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` switch payments to Stripe (webhook URL `https://<your-app>/api/webhooks/stripe`).

> Keep `APP_SECRET` stable: it signs sessions and derives the key that encrypts stored files.

### Anywhere else (Docker)

 The [`Dockerfile`](Dockerfile) builds a small standalone image that runs as a non-root user and stores uploads (and the embedded database, if no `DATABASE_URL` is set) under `/var/data`:

```bash
docker build -t case-manager .
```

```bash
docker run -p 3000:3000 -v case-data:/var/data -e APP_SECRET="$(openssl rand -hex 32)" -e DATABASE_URL=postgres://... -e APP_URL=https://cases.example.com -e JOBS_INTERVAL_MINUTES=5 case-manager
```

This works on Railway, Fly.io, Koyeb, Google Cloud Run (with an external database and S3 storage) or any VPS. The public URL is detected automatically on Render, Railway and Fly; elsewhere set `APP_URL`. Migrations run automatically on start (serialised with a database lock). On serverless hosts other than Vercel, set `NEXT_PUBLIC_REALTIME=poll` at build time and `STORAGE_PROVIDER=database` (or S3).

### CI/CD

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every pull request and every push to `main`:

| Job | What it does |
|---|---|
| **Type check, tests, build** | `tsc`, the test suite on PGlite and on PostgreSQL 16, production build |
| **Browser walkthrough** | Starts the production server in demo mode and runs the full Playwright journey (Hebrew/English, desktop/mobile); screenshots are kept as a build artifact |
| **Docker image** | Builds the image on every run; on `main` pushes it to `ghcr.io/<owner>/case-manager` (`latest` + commit SHA) |
| **Deploy to Vercel** | After the checks pass: a preview deployment for each PR, production for `main`, then a health check. Enabled by the repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (create the token in Vercel → Account Settings → Tokens; the two IDs are in the project's Settings → General). |

If you use this workflow for deployments, turn off Vercel's own Git deployments so each commit isn't deployed twice: Vercel project → Settings → Git → Ignored Build Step → "Don't build anything". Without the secrets, the deploy job is skipped and Vercel's Git integration keeps deploying as before. [Dependabot](.github/dependabot.yml) opens weekly update PRs for npm packages and GitHub Actions.

## What's in the MVP

| Area | Implementation |
|---|---|
| **Free-text intake** | Home page prompt + example chips → AI conversation (one question at a time, quick replies, "I don't know"/"Skip", ~7 questions by default, file attachments, live "what we understood so far" card). Works without an account. |
| **Review & submit** | "Did we get it right?" — every field editable; customer facts kept separate from the assistant's interpretation; preliminary-classification notice. Manual form at any time (`/intake/manual`). |
| **Accounts** | Passwordless email OTP (rate-limited, attempt-limited, hashed codes), customer type (private/business/company/other) with organisation details, terms + separate plain-language AI-processing consent. |
| **Customer portal** | My cases (status, last update, required action), case page with **"What needs to be done now?"**, real-stage progress track (no fake percentages), timeline of real events, messages, documents, quote & payments, contact person. Mobile bottom navigation. |
| **Staff area** | Dashboard (new requests, awaiting quote, pending quotes, active, waiting on client, overdue tasks) + "Needs attention now" ranked by urgency/age/SLA; incoming requests inbox; case list with filters; customers; payments; settings. |
| **Case workspace** | Three panes — details / work area / AI copilot (tabs on small screens): assign, status changes (validated state machine), urgency, category, client messages, internal notes, info requests, tasks, quotes, documents, history, client-timeline updates, complete/close. |
| **AI copilot** | Case summary (what the client wants, known facts **with links to their source**, missing info, complexities, next step), max 3 recommended actions, clarifying-question drafts, rewrite/shorten/translate, thread summary, status-update drafts, task plans, quote drafts, document analysis. Every customer-facing output is a draft a person must send. |
| **Quotes** | Editor with line items, VAT on top or included, currency, payment terms, timeline, disclaimers, validity, live preview of the customer view, AI draft (prices **only** from the price list — missing prices are flagged, never invented). Sent quotes are immutable; revisions create new versions. |
| **Approval & payment** | Customer approves a specific version (identity, time, IP and a hash of the approved content are recorded), asks for clarification or declines. One payment per quote via hosted checkout (built-in test checkout or Stripe). Only a verified webhook moves the case to active; duplicate events are no-ops. |
| **Documents** | Staff request documents; customers upload (versioned); statuses requested → uploaded → in review → approved / new version needed with a note. Extension + magic-byte validation, size limit, ClamAV scanning, AES-256-GCM encryption at rest (or S3 SSE), permission-checked audited downloads (S3 presigned 60-second links). |
| **Tasks** | Title, description, owner, due date, status, priority, client-action flag; service templates; AI-suggested plans reviewed before creation; "my tasks"/overdue views. |
| **Notifications** | In-app (bell + page) and email for every event in the spec, localized per recipient, via a retrying outbox. |
| **Realtime** | Server-Sent Events push updates within ~2 seconds; the client falls back to polling and shows a notice when disconnected. |
| **Admin** | Staff users & roles (admin, case manager, staff, finance), general settings (VAT, currency, quote validity, SLA, question limit), service templates, price list. |

### Status model

Internal statuses (`submitted → under_review ⇄ awaiting_information → quote_preparation → quote_sent → awaiting_payment → active ⇄ awaiting_client → completed → closed`, plus `cancelled`, `declined`) are mapped to simpler customer labels (received → in review → quote ready → awaiting payment → in progress → completed). `quote_sent`, `awaiting_payment` and the move to `active` after payment can only happen through the real action (sending a quote, customer approval, verified payment). When the customer replies or uploads, the case returns from "waiting" to work automatically. Every material action writes a case event with time, actor and visibility; internal events and notes are never shown to customers.

## Architecture

```
src/
  app/                 Next.js App Router pages and REST API (app/api/**)
  components/          UI (ui/ primitives, intake/, case/, portal/, admin/)
  lib/
    db/                Drizzle schema, connection (PostgreSQL or PGlite), seed
    services/          Domain logic — every function enforces permissions server-side
    ai/                Claude client, versioned prompts, Zod output schemas, offline engine
    auth/              Sessions and role/ownership permissions
    i18n/              he.ts (source of truth), en.ts (type-checked to match), formatters
    payments/ storage/ email/
drizzle/               SQL migrations
tests/                 Vitest unit + integration tests
e2e/                   Playwright walkthrough of the full journey
```

- **Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL (PGlite for zero-setup development), Zod.
- **API:** the endpoints from the spec (`POST /api/intake`, `POST /api/cases`, `GET /api/cases/:id`, `PATCH /api/cases/:id/status`, `POST /api/cases/:id/messages|documents|quotes`, `POST /api/quotes/:id/approve`, `POST /api/payments/checkout`, `POST /api/webhooks/payments`, `POST /api/intake/:id/message` (= `ai/intake/next`), `POST /api/ai/case-summary|draft-quote|suggest-tasks`, …). The UI uses the same API. Mutations require a same-origin request; authorization is checked per case on the server.
- **AI layer:** a single server-side module; the browser never talks to the AI provider. Calls use Claude structured outputs validated by Zod schemas, adaptive thinking with an explicit effort level, and the server-side refusal fallback. Each run is logged in `ai_runs` (action, model, prompt version, output, latency, tokens, human approval). Customer content is wrapped as untrusted data (prompt-injection defence), direct identifiers are redacted before sending, per-user rate limits apply, and copilot tools are disabled for customers who didn't consent to AI processing. Without an API key, a deterministic offline engine provides the same features in a simpler form.
- **Multi-tenancy:** the MVP serves one operator, but no data hangs off a single admin user — a `tenant_id` can be added to the top-level tables later.

## Configuration

All settings are environment variables — see [`.env.example`](.env.example). Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection. Empty → embedded PGlite in `.data/pglite`. |
| `APP_SECRET` | **Required in production.** Signs codes and derives the file-encryption key. |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Enables Claude (default model `claude-opus-5-5`). |
| `EMAIL_PROVIDER=smtp`, `SMTP_URL` | Real email delivery. |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | Sender address, and the sender name recipients see (e.g. your business name). Note: Gmail shows "me" / "אני" instead of any name when you email yourself. |
| `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Checkout; point the webhook at `/api/webhooks/stripe`. |
| `STORAGE_PROVIDER=s3`, `S3_*` | S3-compatible storage. |
| `CLAMAV_HOST` | Malware scanning. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google" sign-in and registration (see below). |
| `CRON_SECRET` | Enables `POST /api/jobs/run` (expire quotes, flush email outbox). |
| `JOBS_INTERVAL_MINUTES` | Runs those jobs inside the server every N minutes instead of external cron. |
| `DEMO_MODE` | Public demo: codes on screen, demo data, warning banner. Never with real data. |

### Google sign-in

Customers can register at `/register` with an email code or with Google; "Continue with Google" also appears on the sign-in page and at the end of a new request. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen, then create an **OAuth client ID** of type **Web application**.
2. Add the authorized redirect URI `https://<your-domain>/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback` for local development).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and redeploy.

Existing accounts (including invited staff) sign in directly when the Google email matches and is verified. A new Google user only confirms their details, chooses a customer type and accepts the terms — no code needed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Develop / build / serve |
| `npm test` | Unit + integration tests (in-memory PGlite; set `TEST_DATABASE_URL` to run against PostgreSQL) |
| `npm run typecheck` | TypeScript |
| `npm run db:generate` | Generate a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (also done automatically on start unless `AUTO_MIGRATE=false`) |
| `npm run db:seed -- --demo` | Insert demo data |
| `npm run jobs:run` | Run maintenance jobs once |
| `npm run e2e` | Browser walkthrough of the full journey against a running dev server |

## Acceptance scenarios covered by tests

The integration suite (`tests/flow.test.ts`) and the browser walkthrough (`e2e/walkthrough.cjs`) cover the launch checklist: a vague private request becomes an editable summary; a business request; skipping questions; **AI failure → manual continuation without data loss**; clarification request and reply; quote created, edited and sent; approval and payment; **a failed payment does not activate the case**; **a duplicate payment webhook changes nothing**; staff status change visible to the customer; document upload, approval and new-version request; **a customer cannot open another customer's case**; malicious/forged uploads and webhooks are rejected; case completion; everything in Hebrew on mobile, and in English after switching language.

## Out of scope (per the MVP definition)

Marketplace, native apps, subcontractors, accounting (receipts come from an external system), milestone payments, government integrations, advanced e-signatures, a no-code workflow designer, and AI that makes legal or financial decisions.
