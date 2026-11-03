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
| `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Checkout; point the webhook at `/api/webhooks/stripe`. |
| `STORAGE_PROVIDER=s3`, `S3_*` | S3-compatible storage. |
| `CLAMAV_HOST` | Malware scanning. |
| `CRON_SECRET` | Enables `POST /api/jobs/run` (expire quotes, flush email outbox). |

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
