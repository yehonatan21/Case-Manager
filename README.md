# Case Manager — AI-assisted requests, quotes & cases

**Version 1.0.0** · [Changelog](CHANGELOG.md)

> **מערכת חכמה לניהול בקשות, שירותים ותיקים.** מבקשה חופשית של לקוח ועד השלמת השירות — בתהליך אחד, ברור, חכם ושקוף.
> הממשק בעברית (RTL) כברירת מחדל, עם מעבר מלא לאנגלית (LTR) בלחיצה אחת.

A responsive web app for service businesses:
1. A customer describes what they need in their own words, and an AI assistant turns it into a structured request.
2. Staff review it with an AI copilot and send a quote.
3. The customer approves, pays online and follows the case until it's done.

Staff can also open requests on a client's behalf.

- **Languages:** Hebrew (RTL, default) and English (LTR). The switcher is in every header. The choice is saved in a cookie and on the profile, so emails and push notifications arrive in the user's language.
- **Live:** production at https://case-manager-eta.vercel.app (branch `main`), dev at https://case-manager-git-dev-yehonatan21.vercel.app (branch `dev`).

| Customer: describe the need | Customer: AI conversation | Customer: case on mobile |
|---|---|---|
| ![Home](docs/screenshots/home-he.png) | ![Intake](docs/screenshots/intake-chat-he.png) | ![Mobile case](docs/screenshots/mobile-case-he.png) |
| **Staff: case workspace + AI copilot** | **Staff: quote editor** | **Staff dashboard (English)** |
| ![Workspace](docs/screenshots/case-workspace-he.png) | ![Quote editor](docs/screenshots/quote-editor-he.png) | ![Dashboard](docs/screenshots/dashboard-en.png) |

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [Roles and permissions](#roles-and-permissions)
- [Configuration](#configuration)
- [AI providers](#ai-providers)
- [Payments: Grow, Stripe, test checkout](#payments)
- [Push notifications](#push-notifications)
- [WhatsApp](#whatsapp)
- [Electronic signatures](#electronic-signatures)
- [Email](#email)
- [Google sign-in](#google-sign-in)
- [Deploy](#deploy)
- [Branches and environments](#branches-and-environments)
- [Testing and CI/CD](#testing-and-cicd)
- [Architecture](#architecture)
- [Security](#security)
- [Scripts](#scripts)
- [Out of scope](#out-of-scope)

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. No configuration is needed. By default the app uses:
- an embedded PostgreSQL (PGlite) in `.data/`
- an offline AI engine
- a test checkout
- local encrypted file storage
- emails printed to the console, and sign-in codes shown on screen

**Demo accounts** (seeded on first run in development or demo mode, sign in at `/login`):

| Email | Role |
|---|---|
| `admin@example.com` | Administrator |
| `manager@example.com` | Case manager |
| `staff@example.com` | Staff member |
| `finance@example.com` | Finance |
| `client@example.com` | Private customer (2 cases) |
| `biz@example.com` | Company customer (quote waiting for approval) |

To use real AI, set `ANTHROPIC_API_KEY` (Claude) or `OPENROUTER_API_KEY` (OpenRouter, including free models). For real PostgreSQL, run `docker compose up -d` and set `DATABASE_URL`.

## Features

| Area | What it does |
|---|---|
| **Free-text intake** | Home page prompt plus example chips, then an AI conversation: one question at a time, quick replies, "I don't know" / "Skip", about 7 questions, file attachments, and a live "what we understood so far" card. Works without an account. A manual form is available at any time (`/intake/manual`). |
| **Review & submit** | "Did we get it right?": every field is editable, and the customer's facts are kept separate from the assistant's interpretation. |
| **Accounts** | Passwordless sign-in with an emailed code (rate-limited, attempt-limited, stored hashed) or Google. One page for sign-in and registration. An unknown email is offered registration instead of a code. Customer type (private / business / company / other) with organisation details. Terms acceptance and a separate, plain-language AI-processing consent. |
| **Customer portal** | My cases (status, last update, required action). The case page shows "What needs to be done now?", a progress track of the real stages, a timeline, messages, documents, the quote and payments, and the contact person. Mobile bottom navigation. |
| **Staff area** | Dashboard (new, awaiting quote, pending quotes, active, waiting on client, overdue tasks) with "Needs attention now"; incoming-requests inbox; case list with filters; customers; payments; settings. |
| **Requests opened by staff** | Admins and case managers open a request for an existing client, or for a new one by email, from **Cases → New request** or a client's profile. It's assigned to the creator by default; the client is notified and can sign in with that email. |
| **Case workspace** | Three panes (details / work area / AI copilot): assign, validated status changes, urgency, category, client messages, internal notes, info requests, tasks, quotes, documents, history, client-timeline updates, complete/close. |
| **AI copilot** | Case summary: what the client wants, known facts **linked to their source**, missing info, complexities, next step. Also up to 3 recommended actions, clarifying-question drafts, rewrite / shorten / translate, thread summary, status-update drafts, task plans, quote drafts and document analysis. Anything customer-facing is a draft a person must send. |
| **Quotes** | Line items; VAT on top or included; currency, payment terms, timeline, disclaimers, validity; live preview of the customer view. AI drafts use prices **only** from the price list. Sent quotes are immutable, and revisions create new versions. Quotes expire automatically. |
| **Approval & payment** | The customer approves a specific version (identity, time, IP and a hash of the content are recorded), asks for clarification, or declines. One payment per quote through [Grow, Stripe or the test checkout](#payments). Only a verified payment activates the case. |
| **Document checklists** | Each service template lists the documents it needs (required or optional, with a note for the client). Staff request a whole checklist in one step: one message to the client, nothing requested twice. The client sees "3 of 5 required documents provided"; the case keeps waiting for the client until every required document is in. Automatic reminders go out every N days for missing required documents, up to a maximum (Settings → General). |
| **Documents** | Staff request documents and customers upload versioned files. Statuses: requested → uploaded → in review → approved, or a new version requested. Type and magic-byte validation, size limit, optional ClamAV scan, encryption at rest, permission-checked and audited downloads. |
| **Tasks** | Owner, due date, status, priority, client-action flag; service templates; AI-suggested plans reviewed before creation; "my tasks" and overdue views. |
| **Notifications** | In-app (bell and page), email, [push](#push-notifications) and [WhatsApp](#whatsapp) for every event, localized per recipient, through a retrying outbox. |
| **Electronic signatures** | Staff ask the client to sign a PDF (a power of attorney, an engagement letter). The client reviews it, types their full name, optionally draws a signature, agrees and signs. The signed copy (each page stamped, plus a signature certificate page) is saved as a new version. Approving a quote is signed too, and a signed quote PDF is saved to the case's documents. |
| **WhatsApp** | Clients (and staff) who opt in on their profile get updates on WhatsApp. Client replies land in the case's messages, labelled "WhatsApp", and files they send are added to the case's documents. "STOP" opts out. |
| **Realtime** | Server-Sent Events update open pages within about 2 seconds; polling on serverless hosts. |
| **Admin** | Team members and roles; general settings (VAT, currency, quote validity, SLA, question limit); service templates; price list; payment provider. |

**Status model.** Internal statuses map to simpler customer labels:

- **Internal:** `submitted → under_review ⇄ awaiting_information → quote_preparation → quote_sent → awaiting_payment → active ⇄ awaiting_client → completed → closed`, plus `cancelled` and `declined`.
- **Customer labels:** received → in review → quote ready → awaiting payment → in progress → completed.

`quote_sent`, `awaiting_payment` and `active` are reached only through the real action: sending a quote, the customer's approval, a verified payment. Every material action writes a case event with time, actor and visibility. Internal events and notes are never shown to customers.

## Roles and permissions

| Role | Can |
|---|---|
| **Admin** | Everything, including team members, settings, templates, prices and the payment provider. |
| **Case manager** | Unassigned new requests and the requests assigned to them; open requests for clients; quotes for their cases. |
| **Staff** | Only cases where they have an assigned task; no pricing. |
| **Finance** | Cases, quotes and payments, but no messages, documents or AI tools. |
| **Customer** | Only their own cases, and only client-facing data. |

Every check runs on the server (`src/lib/auth/permissions.ts`). A case you may not see answers "not found".

**Adding team members** (Settings → Users):
- A new email is invited and becomes active on first sign-in.
- An email registered as a client with no requests becomes a team account.
- A disabled member is re-enabled.
- Duplicates and clients with requests are refused with a clear reason.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example) for the complete list with comments.

| Variable | Purpose |
|---|---|
| `APP_SECRET` | **Required in production.** Signs sessions and codes and derives the encryption key. Never change it once set. |
| `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED`) | PostgreSQL. Empty: embedded PGlite in `.data/pglite`. |
| `APP_URL`, `APP_NAME` | Public URL (auto-detected on Vercel, Render, Railway, Fly) and name. |
| `ADMIN_EMAIL` | This address is ensured to be an administrator. |
| `DEMO_MODE` | Public demo: codes on screen, demo data, a warning banner. **Never with real data.** |
| `CRON_SECRET` | Protects `POST /api/jobs/run`. |
| `JOBS_INTERVAL_MINUTES` | Runs the jobs inside the server every N minutes instead of external cron. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, … | See [AI providers](#ai-providers). |
| `PAYMENT_PROVIDER`, `STRIPE_*`, `GROW_*` | See [Payments](#payments). |
| `VAPID_*` | Optional; see [Push notifications](#push-notifications). |
| `WHATSAPP_*` | Optional; see [WhatsApp](#whatsapp). |
| `SMTP_URL`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | See [Email](#email). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | See [Google sign-in](#google-sign-in). |
| `STORAGE_PROVIDER` (`local`, `database`, `s3`, `vercel-blob`), `S3_*`, `BLOB_READ_WRITE_TOKEN` | Where uploads are stored. Auto-selected when unset. |
| `MAX_UPLOAD_MB`, `CLAMAV_HOST`, `CLAMAV_PORT` | Upload limit; malware scanning. |

## AI providers

The AI features talk to one small interface, `AiProvider` in [`src/lib/ai/providers/types.ts`](src/lib/ai/providers/types.ts). Which provider answers is a setting:

| `AI_PROVIDER` | Uses | Reads documents? |
|---|---|---|
| `auto` (default) | The first configured of: Claude → OpenRouter → OpenAI-compatible. With none, the built-in offline engine. | — |
| `anthropic` | Claude (`ANTHROPIC_API_KEY`, `AI_MODEL`, default `claude-opus-5-5`) | Yes |
| `openrouter` | [OpenRouter](https://openrouter.ai) (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODELS`, `OPENROUTER_DATA_COLLECTION`) | No (offline analysis) |
| `openai-compatible` | Any OpenAI-style API: OpenAI, Groq, Mistral, Together, a local Ollama… (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_NAME`, `AI_JSON_SCHEMA`) | No (offline analysis) |
| `mock` | The offline engine only | — |

- **To replace the provider without code,** change the variables and redeploy.
- **To add a service,** write `src/lib/ai/providers/<name>.ts` exporting an `AiProvider` and add it to `registry` in [`src/lib/ai/providers/index.ts`](src/lib/ai/providers/index.ts).

The default OpenRouter model is free (`nvidia/nemotron-3.5-super-vl:free`, with `google/gemma-4-31b-it:free` as fallback). Free models have daily request limits, and free endpoints may log prompts. Before real clients use the app, switch to a paid model with `OPENROUTER_DATA_COLLECTION=deny`.

**Safety:**
- Output is validated against Zod schemas.
- Customer content is wrapped as untrusted data, against prompt injection.
- Emails, phone and ID numbers are removed before sending.
- Per-user rate limits apply.
- Copilot tools are disabled for customers who didn't consent to AI.
- Uploaded documents go only to providers that declare they read files.
- Every run is logged in `ai_runs` (provider, model, prompt version, output, latency, tokens).
- On failure, the app falls back to the manual flow without losing data.

## Payments

While Grow is connected it's used for every checkout. Otherwise `PAYMENT_PROVIDER` decides: `stripe` if `STRIPE_SECRET_KEY` is set, else the built-in test checkout (`mock`). Payment state only moves forward. Duplicate or out-of-order events are no-ops, and an amount that doesn't match the quote is rejected.

### Grow (Meshulam)

[Grow](https://grow.business) takes credit card, Bit, Apple Pay and Google Pay, in shekels.

**Connect.** As an admin, open **Payments → Connect Grow** (or **Settings → Integrations**) and enter the `userId` and `pageCode` from Grow, plus `apiKey` only if Grow gave you one.
- **Test mode** uses Grow's sandbox.
- The identifiers are stored encrypted, and only their last 4 characters are ever shown.
- Alternatively, set `GROW_USER_ID`, `GROW_PAGE_CODE` and `GROW_SANDBOX`.

**A payment:**
1. The customer confirms their full name (two words), Israeli mobile number and the terms. Grow requires these.
2. The app calls `createPaymentProcess` and sends the customer to Grow's page.
3. Grow posts a server update to `/api/webhooks/grow/<payment id>/<token>`. Grow doesn't sign these, so:
   - the token is an HMAC of the payment id;
   - the transaction is re-read from Grow (`getTransactionInfo`), and its amount must match the quote;
   - the update is then acknowledged with `approveTransaction`.
4. The customer returns through `/pay/return/<payment id>/success` to the case, which is now active.

**Going live.** Run a few sandbox payments. Ask Grow (support@grow.business) to enable server updates for your page and for a production review. Then enter the production identifiers with Test mode off.

### Stripe

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at `/api/webhooks/stripe`.

## Push notifications

Web Push reaches browsers and phones even when the site is closed.

- **Turning it on:** each person turns it on per device from **Notifications** (or the profile) with **Notifications on this device**. There's also a test button.
- **iPhone and iPad:** add the site to the home screen (Share → Add to Home Screen), open it from there, then turn notifications on.
- **What gets pushed:** every in-app notification also goes, encrypted, to all of the person's devices, through the same retrying outbox as email. Tapping a notification opens the right page.
- **Expired devices:** devices the push service reports as gone (404/410) are removed automatically.
- **Keys:** nothing to configure. Without `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, the app generates a key pair once and stores it encrypted. Set `VAPID_SUBJECT` (`mailto:` or `https:`) to choose the contact address push services see.
- **Allowed endpoints:** only the browser push services (Google, Mozilla, Apple, Microsoft), so the server can't be used to send requests to arbitrary hosts. `PUSH_EXTRA_HOSTS` exists for tests.
- **Files:**
  - [`public/sw.js`](public/sw.js): the service worker.
  - [`src/app/manifest.ts`](src/app/manifest.ts): the web app manifest.
  - [`src/lib/services/push.ts`](src/lib/services/push.ts): sending.

## Electronic signatures

**Documents.** On a case's Documents tab, staff press **Request signature** on a client-visible PDF (optionally with a note). The client is notified and gets a to-do; the case waits for them. The client opens **Review and sign**:
1. They open the document (it opens in the browser).
2. They type their full name (prefilled), and can also draw a signature with a mouse, finger or stylus. Drawing is optional, so keyboard and screen reader users can sign by name alone.
3. They agree to sign electronically, and press **Sign**.

The app then saves a new version of the document: the original, unchanged except for a one-line "signed electronically by …" stamp in each page's bottom margin, followed by a **signature certificate** page. The certificate lists the document, case, signer and email, the time (Israel time and UTC), IP address, browser and device, the method, the original's SHA-256 fingerprint and the signature ID, with the drawn signature or typed name. The previous version is kept. Staff see the same details under **Signature details**, plus the signed file's fingerprint.

- A request is for one exact version: if staff upload a newer version, the old request can't be signed. Request again.
- Staff can cancel a request that hasn't been signed. A document can't have two open requests.
- The client's to-do disappears, and the case goes back to the team, once nothing else is waiting on them.
- PDFs that can't be processed (password-protected or damaged) are refused with a clear message.

**Quotes.** The approval box asks for the same signature (full name, optional drawing). After approval, a PDF of the approved version with the certificate page is saved to the case's documents as "Signed quote (version N)". The approval itself is recorded as before (version, identity, time, IP, content hash).

**Legal standing.** This is an *electronic signature* under Israel's Electronic Signature Law, 5761-2001: the signer is identified by their sign-in (a one-time code to their email or Google), and the evidence above is kept. It is not a *certified* electronic signature (which needs a certification authority and a smart card or similar). For documents that legally require one, use a certified provider.

PDFs are built with [pdf-lib](https://pdf-lib.js.org); Hebrew is laid out with the Unicode bidirectional algorithm ([bidi-js](https://github.com/lojjic/bidi-js)) in the [Heebo](https://github.com/OdedEzer/heebo) font (SIL Open Font License, in [`assets/fonts`](assets/fonts)). Code: [`src/lib/services/signatures.ts`](src/lib/services/signatures.ts) and [`src/lib/pdf/`](src/lib/pdf/).

## WhatsApp

Updates go out through the [WhatsApp Business Platform (Meta Cloud API)](https://developers.facebook.com/docs/whatsapp/cloud-api), and client replies come back into the case. The provider sits behind an interface ([`src/lib/whatsapp/`](src/lib/whatsapp/)), so another provider (e.g. Twilio) can replace Meta without changing the rest of the app.

**Set up (once).**
1. In [Meta for Developers](https://developers.facebook.com/apps), create a Business app and add the WhatsApp product. Add your business number, and create a permanent System User access token with the `whatsapp_business_messaging` permission.
2. In WhatsApp Manager, create a **Utility** template named `case_update` (or any name) in Hebrew (`he`) and English (`en`), with four body variables: business name, update title, update text and link. The exact text is shown in the app under Settings → Integrations → WhatsApp. Wait for approval.
3. In the app, as an admin: **Settings → Integrations → Connect WhatsApp**. Enter the phone number ID, the access token, the app secret (App settings → Basic), the template name and its language codes. The app checks them with WhatsApp before saving them encrypted.
4. Copy the **Callback URL** and **Verify token** shown there into the Meta app (WhatsApp → Configuration → Webhook), and subscribe to the `messages` field.
5. Turn on WhatsApp updates on your own profile and press **Send me a test message**.

Alternatively, set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_TEMPLATE` (the template's languages are then `he` and `en`).

**How it works.**
- **Opt-in:** users turn on "Get updates on WhatsApp" on their profile with a mobile number (Israeli local numbers are converted to international format). WhatsApp requires an opt-in; nothing is sent without it.
- **Sending:** every notification for an opted-in user also gets a WhatsApp row in the outbox. Within 24 hours of the user's last WhatsApp message it's sent as plain text (WhatsApp's customer-service window); otherwise with the approved template. Temporary failures are retried; permanent ones (and failures WhatsApp reports later) are recorded on the row.
- **Replies:** `/api/webhooks/whatsapp` accepts only deliveries signed with the app secret (`X-Hub-Signature-256`), and each message is added once even if delivered twice. A reply to an update goes to that update's case; any other message goes to the client's most recently updated open case. A client with no open case gets a link to the portal. Messages from unknown numbers and from staff are ignored.
- **Files:** images and documents a client sends are downloaded (only from WhatsApp's own hosts) and added to the case's documents through the usual upload checks. A file that can't be added (e.g. a voice note) is noted in the case, and the client is sent the upload link.
- **Opting out:** "STOP" (or "הסר") turns WhatsApp off for that user and confirms; the profile setting does the same.
- **Cost:** Meta charges per template message (utility conversations). Replies within the 24-hour window are free.
- Code: [`src/lib/services/whatsapp.ts`](src/lib/services/whatsapp.ts) (opt-in, sending, webhook) and [`src/lib/whatsapp/meta.ts`](src/lib/whatsapp/meta.ts) (the Meta API).

## Email

Set `SMTP_URL` (for example Gmail with an app password: `smtps://you%40gmail.com:app-password@smtp.gmail.com:465`). `EMAIL_FROM` sets the sender address, and `EMAIL_FROM_NAME` the name recipients see.

Without SMTP, emails are printed to the server log, and in development they're listed at `/admin/mailbox`. For good deliverability, send from your own domain with SPF/DKIM set up. Gmail shows "me" / "אני" for mail you send to yourself.

## Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen and create an **OAuth client ID** of type **Web application**.
2. Add the redirect URI `https://<your-domain>/api/auth/google/callback`. For local development, also add `http://localhost:3000/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and redeploy.

Existing accounts sign in directly when the verified Google email matches. A new Google user confirms their details and accepts the terms.

## Deploy

### Vercel + Neon (free tiers; current setup)

1. Import the repository at [vercel.com/new](https://vercel.com/new). Vercel runs `npm run vercel-build`, which applies migrations, then builds.
2. Add the environment variables `APP_SECRET` (`openssl rand -hex 32`) and `CRON_SECRET`, plus any optional ones from [Configuration](#configuration).
3. In the **Storage** tab, add **Neon** (free; a region near Frankfurt). It sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Optionally add a private **Blob** store for files.
4. Redeploy.

On Vercel the app adapts:
- Migrations run in the build.
- Live updates poll instead of streaming.
- Quote expiry and outbox retries run from the daily cron in [`vercel.json`](vercel.json).
- Files go to Blob, or to the database if no Blob store is connected.

Vercel Hobby is for personal, non-commercial use. Neon's free compute pauses when idle.

### Render (paid, long-running server)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yehonatan21/Case-Manager)

[`render.yaml`](render.yaml) provisions a Docker web service, PostgreSQL 16, a 1 GB persistent disk for uploads, and generated secrets. It starts in demo mode. Before real use, set `SMTP_URL`, set `DEMO_MODE=false`, and sign in with your `ADMIN_EMAIL`.

### Docker (anywhere)

```bash
docker build -t case-manager .
```

```bash
docker run -p 3000:3000 -v case-data:/var/data -e APP_SECRET="$(openssl rand -hex 32)" -e DATABASE_URL=postgres://... -e APP_URL=https://cases.example.com -e JOBS_INTERVAL_MINUTES=5 case-manager
```

The image runs as a non-root user and keeps data under `/var/data`. Migrations run on start. It works on Railway, Fly.io, Koyeb, Cloud Run (with an external database and S3) or any VPS.

**Before real customers:**
- Set `DEMO_MODE=false` and `SMTP_URL`.
- Keep `APP_SECRET` stable.
- Remove demo data with `npm run db:remove-demo` (see [Scripts](#scripts)).

## Branches and environments

| Branch | Vercel environment | Address | Database |
|---|---|---|---|
| `main` | Production | https://case-manager-eta.vercel.app | Neon `main` branch |
| `dev` | Preview, with its own `dev`-scoped variables (`DEMO_MODE=true`, own secrets, `APP_URL`) | https://case-manager-git-dev-yehonatan21.vercel.app | Neon `dev` branch (separate) |

Feature branches open pull requests into `dev`, and `dev` is then released to `main`. Merging `dev` into `main` through a pull request makes GitHub delete `dev`, because "Automatically delete head branches" is on. Either protect `dev` with a ruleset ("Restrict deletions"), or fast-forward `main` to `dev` instead of using a pull request.

Merging a release pull request also adds a merge commit that exists only on `main`. The [`Sync dev with main`](.github/workflows/sync-dev.yml) workflow runs after every push to `main` and brings `dev` level again: it fast-forwards `dev` to `main`, or merges `main` into `dev` when `dev` already has unreleased work. So `main` is never ahead of `dev`. It needs `dev`'s ruleset to allow normal pushes (blocking only deletion and force pushes is fine).

## Testing and CI/CD

| Suite | Command | Covers |
|---|---|---|
| Unit + integration | `npm test` | Roles and permissions, document checklists and reminders, the full request → quote → payment lifecycle, sign-in security, intake ownership, storage encryption, staff-opened requests, team invites, Grow (fake API), AI providers (fake API), push (real encryption to a local push endpoint), WhatsApp (fake Meta API: sending, replies, files, opt-out), electronic signatures (real PDFs: stamping, certificate, evidence, versions, signed quotes), the service worker, demo-data cleanup, Google sign-in. In-memory PGlite; set `TEST_DATABASE_URL` for PostgreSQL. |
| HTTP | `API_BASE=http://localhost:3000 npm run test:api` | A running server: security headers, auth, CSRF, validation, cookie flags, role isolation, webhooks, Grow, push, WhatsApp and signature endpoints. |
| Browser | `BASE=http://localhost:3000 npm run e2e` | Playwright scripts in `e2e/`: accessibility (axe), the full journey (Hebrew/English, desktop/mobile), accounts, staff-opened requests, team, Grow (with a stand-in Grow API), push (with a stand-in push service), document checklists, WhatsApp (with a stand-in Meta API) and electronic signatures (requesting, drawing and signing, the signed PDF, signed quotes). |

The HTTP and browser suites need the server in demo mode (codes on screen). The Grow, push and WhatsApp scripts also need `GROW_API_URL=http://localhost:4010`, `PUSH_EXTRA_HOSTS=localhost:4012` and `WHATSAPP_API_URL=http://localhost:4014`:

```bash
npm run build && APP_SECRET=ci-only-secret-0123456789abcdef0123456789 DEMO_MODE=true PGLITE_DIR=.data/ci GROW_API_URL=http://localhost:4010 PUSH_EXTRA_HOSTS=localhost:4012 WHATSAPP_API_URL=http://localhost:4014 npm start
```

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every pull request and push to `main`:

| Job | What it does |
|---|---|
| **Type check, tests, build** | `tsc`; the tests on PGlite and on PostgreSQL 16; production build. |
| **Browser walkthrough** | Production server in demo mode, then the HTTP tests and all browser scripts. Screenshots are kept as an artifact. |
| **Docker image** | Builds the image; on `main` pushes it to `ghcr.io/<owner>/case-manager`. |
| **Deploy to Vercel** | Runs only with the `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets. Otherwise Vercel's Git integration deploys. |

[Dependabot](.github/dependabot.yml) opens weekly update PRs.

## Architecture

```
src/
  app/                 Next.js App Router pages and REST API (app/api/**), manifest.ts
  components/          UI (ui/ primitives, app/, intake/, case/, portal/, admin/)
  lib/
    db/                Drizzle schema, connection (PostgreSQL or PGlite), seed
    services/          Domain logic; every function checks permissions on the server
    ai/                Prompts, Zod output schemas, offline engine, providers/ (Claude, OpenRouter, OpenAI-compatible)
    payments/          Test checkout, Stripe, Grow
    auth/ i18n/ storage/ email/
public/                Service worker (sw.js) and app icons
drizzle/               SQL migrations
scripts/               migrate, seed, jobs, remove-demo-data
tests/                 Vitest unit, integration and HTTP tests
e2e/                   Playwright browser scripts
```

- **Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL / PGlite, Zod, web-push.
- **API:** REST endpoints under `/api`, also used by the UI. Mutations require a same-origin request, and authorization is checked per case on the server.
- **i18n:** `src/lib/i18n/he.ts` is the source of truth, and `en.ts` is type-checked against it. Every error code has a message in both languages (enforced by a test).
- **Multi-tenancy:** one operator for now. A `tenant_id` can be added to the top-level tables later.

## Security

- **Sessions:** httpOnly, SameSite cookies.
- **Sign-in codes:** hashed, single-use, time-limited, rate-limited and attempt-limited.
- **Requests:** same-origin checks on all mutations; security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- **Files:** encrypted at rest (AES-256-GCM, or S3 server-side encryption); content-type and magic-byte checks; optional malware scan; permission-checked, audited downloads.
- **Encrypted settings:** payment identifiers, WhatsApp credentials and push keys are stored encrypted with a key derived from `APP_SECRET`.
- **Webhooks:**
  - mock and Stripe events are verified by signature;
  - Grow's are checked with a per-payment token and re-read from Grow's API;
  - all of them are applied idempotently.
- **Push endpoints:** limited to the browser push services.
- **WhatsApp webhook:** only deliveries signed with the app secret are accepted; received files are fetched only from WhatsApp's hosts.
- **Audit log:** covers sign-in, team, settings, payment and case actions.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Develop / build / serve |
| `npm test` · `npm run test:api` · `npm run e2e` | Tests (see [Testing](#testing-and-cicd)) |
| `npm run typecheck` | TypeScript |
| `npm run db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (also automatic on start unless `AUTO_MIGRATE=false`) |
| `npm run db:seed -- --demo` | Insert demo data |
| `npm run db:remove-demo` | Preview removing the demo accounts and sample requests; add `-- --apply` to remove them (one transaction; real data kept) |
| `npm run jobs:run` | Run maintenance once: expire quotes, send document reminders, send pending emails, pushes and WhatsApp messages, prune old push and WhatsApp rows |

## Out of scope

Marketplace, native apps, subcontractors, accounting (receipts come from an external system), milestone payments, government integrations, advanced e-signatures, a no-code workflow designer, and AI that makes legal or financial decisions.
