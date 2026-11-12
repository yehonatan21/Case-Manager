# Case Manager — AI-assisted requests, quotes & cases

**Version 1.1.0** · [Changelog](CHANGELOG.md)

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
- [iPhone and Android app](#iphone-and-android-app)
- [WhatsApp](#whatsapp)
- [Electronic signatures](#electronic-signatures)
- [Meetings](#meetings)
- [Receipts and invoices](#receipts-and-invoices)
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
| **Accounts** | Passwordless sign-in with an emailed code (rate-limited, attempt-limited, stored hashed) or Google. One page for sign-in and registration. An unknown email is offered registration instead of a code. Customer type (private / business / company / other) with organisation details. Terms acceptance and a separate, plain-language AI-processing consent. A client whose account the team opened is asked once on the portal whether the team may use AI ("Yes, allow" / "No, thanks"); anyone can change it on their profile. |
| **Service types** | Built-in types plus custom ones. When no type fits a request (for example insurance claims or lawsuits), the intake assistant creates one, reusing a type with the same name if it exists. Admins add, rename or hide types under **Settings → Service types**. |
| **Customer portal** | My cases (status, last update, required action). The case page greets the client and leads with **one next step**: the most urgent thing, said plainly (for a requested document, the team's note on what exactly counts), with a button that does it — a requested document is photographed or uploaded right there, without switching tabs; approving, paying and signing open the quote or document. What remains is one line ("and 2 more documents after this") with the list folded underneath. Then a progress track of the real stages (and the work plan's stages with target dates), a timeline, messages, documents, the quote and payments, and the contact person with the usual reply time. Mobile bottom navigation. |
| **Staff area** | Dashboard (new, awaiting quote, pending quotes, active, waiting on client, overdue tasks) with "Needs attention now"; incoming-requests inbox; case list with filters and pages; customers, searched on the server by name, email, phone (in any format) or organization, 50 per page; payments; settings. Case search also covers the description and the client's phone. |
| **Attention center** | "Needs attention now" on the dashboard, from every part of the work: new requests (and ones past the first-response target), client replies, quote clarifications, declined and unpaid quotes, overdue tasks, uploaded documents to check, today's meetings, and — for admins and finance — failed payments and payment documents that couldn't be issued. **Mine** (the default) keeps your cases, your tasks and your meetings, plus what only your role handles (new requests for those who take them); **Everyone's** shows all you may see (`?attention=all`). Ranked by urgency, age and what's at stake; each item opens where it's handled (the case on the right tab, or Payments). |
| **Staff menu** | Grouped as Workspace (Dashboard, My Work), Operations (Incoming requests, Quotes, Cases, Tasks, Conversations, Meetings), Business (Customers, Payments, Reports) and System (Settings, Activity log); each role sees only its pages, and empty groups are hidden. The desktop sidebar collapses to icons (names shown on hover and keyboard focus) and remembers it; on phones it's a drawer from the start edge. Defined once in `src/config/admin-navigation.ts`. |
| **Finding records** | Quotes, Payments and Tasks share one **filter bar**, searched and paged on the server (50 a page), with the filters in the address so a filtered list can be reloaded, bookmarked or shared and Back returns to it. **Quotes:** case number, client or service; status; the day it last changed. **Payments:** case, client or service; status; provider; date range; amount range; sort by date or amount. **Tasks:** title or case; assignee; priority; status (open by default); due date range — on top of the My tasks / All tasks / Overdue tabs, which stay when filtering or clearing. Each list shows how many results match. |
| **Menu counters** | The menu counts only what waits on you: new requests (Incoming; admins and case managers), your own cases running late (My Work), your overdue tasks (Tasks) and conversations waiting for an answer (Conversations) — only on cases you may see, never a zero. Screen readers hear what a counter means ("3 overdue"). |
| **Search (Ctrl+K)** | **Ctrl+K** (⌘K on a Mac), or Search in the staff header, finds pages by name and records on the server: incoming requests, cases, clients and quotes — a few of each, each showing its type, name, number, client and status. Only what the person may see: their own cases for staff, no clients for finance, nothing for clients. Arrow keys and Enter to open, Esc to close; it says when nothing matches or the search failed. One service (`src/lib/services/global-search.ts`) behind `GET /api/admin/search`. |
| **Quick Create** | **+ New** in the staff header starts the common things from any page, with the forms that already exist: a new client request (admins, case managers), a new task or a client meeting (pick the case — searched by number, title or client — and it opens on that tab with the task field focused or the booking form open), and a calendar event (the Meetings page with the event form open). Each role sees only what it may do (finance: none). Keyboard: arrow keys, Home/End, Esc; a click outside closes it. |
| **Lists on phones** | Below tablet width the staff lists — cases, incoming requests, My Work, quotes, payments, tasks, clients and the activity log — are cards instead of wide tables: the title and status first, a few labelled details, and the whole card opens the record (My Work keeps its selection checkbox; payments keep the invoice action). No sideways scrolling. |
| **Date picker** | Every date field opens the app's own calendar (instead of the browser's, which looked different in each browser): the month as a grid, Sunday first, today ringed, the chosen day filled, days outside the allowed range disabled, and the chosen day spelled out ("Sunday, 15 November 2026 · in 5 days"). Quick picks: today, tomorrow, in a week, in a month; in a From/To filter, last 7 days, this month, last month, this year — filling both fields, with the days between shaded. Typing DD/MM/YYYY still works. Keyboard: arrows in reading direction, Home/End, PageUp/PageDown (Shift for years), Enter, Esc (inside a dialog it closes only the calendar). Beside the field on a wide screen, a sheet from the bottom with 44 px days on a phone. |
| **Settings** | Tabs: General, Users, Service templates, Service types, Automation, Price list, Integrations, System health. Only the open tab is loaded (`?tab=`, so a reload, a shared link, Back and Forward open it); another tab loads when chosen, with a loading state meanwhile. One component per tab in `src/components/admin/settings/`. |
| **My Work** | **My Work** (the work queue, `/admin/queue`; admins, case managers, staff) lists open cases most pressing first: late ones (past the case deadline or with a late task), then by urgency and the nearest deadline. Views: My work, Unassigned, Late, Due in 7 days, Waiting on the client, Waiting on others (an authority, a court), No activity for 7 days, All open, each with its count. Filters for search, service type, handler and urgency; **saved views** per user. Admins and case managers select cases and change the handler, urgency, status or deadline of all of them at once; each case gets its usual checks, and the ones that can't change are listed. **Team workload** shows each member's open, urgent, late and due-soon cases and their late tasks. |
| **Case deadlines** | Each case can have a deadline and a "waiting on someone outside the office" flag with who it waits for (team only, kept in the history). The handler is reminded the day before and on the day; admins, when nobody handles the case. A bar above every case shows who handles it, the next step, the deadline and the last activity. |
| **Work plans** | A service template can hold a work plan: **stages** with target days, and tasks in each stage. A task can wait for the one before it; it unlocks when that one is done, and its handler is notified then. Write it as text (Settings → Service templates): `## Stage | days`, `Task | days`, `> waits for the task above`, `* client action`, `(team)` for a stage clients don't see. Applying the template to a case creates the stages as milestones with dates (and sets the case deadline if it has none). A stage completes when its tasks are done, or by hand. Clients see their stages ("done", "in progress", "next", with target dates). |
| **Automation rules** | Settings → Automation: "when X happens on a case, do Y", for all cases or one service type. **When:** a new request arrives, all required documents are approved, the client approves a quote, a payment is received, the case moves to a status, a stage is completed. **Then:** create a task for the handler, notify the handler, or send the client a message (Hebrew and English, with `{client}`, `{number}`, `{title}`). Rules run inside the same transaction as the event and never start other rules. Each run is in the case history; the list shows how often each rule ran. |
| **Quote follow-up** | A sent quote with no answer gets one reminder to the client after N days and one note to the handler after M days (Settings → General; 0 = off). |
| **Conversations** | **Conversations** (admins, case managers, staff): client messages from all cases, in the app and on WhatsApp, those waiting for an answer first, with "new" marks. Filters: waiting for an answer, my cases, unassigned, all; search in the messages. Reply in place, with **saved replies** (Hebrew and English, `{client}` and `{number}` filled in) that admins and case managers manage there; the same saved replies are in the case's message composer. Email replies aren't brought into cases yet; that needs an inbound email service. |
| **Time and profit** | A **Time & costs** tab on each case: a timer (one running at a time; one left running overnight is stopped at 8 hours), time added by hand (billable or not), and expenses (fees, translation, courier). Admins set each team member's **cost per hour** in Settings → Users (only admins see it). Admins and finance see the case's profit: payments before VAT − time at cost rates − expenses. **Reports → Time and profitability**: hours per member (admins and case managers), and profit by service type with the most and least profitable cases (admins and finance); both in the Excel export too. |
| **Document checks** | Each document has **Details and checks** for staff: type, full name, document or ID number, dates of birth, issue and expiry. Staff fill them in and save (that confirms them); **Fill with AI** suggests them when the AI service can read files. The checks flag an expired document, one expiring within 6 months, a name that doesn't match the client (word by word, same alphabet), and ID numbers or dates of birth that differ between documents, with a summary at the top of the documents. Clients never see the details or the findings. |
| **Company accounts** | A client can be a company (Clients → the client → Company and contacts) with several contacts, each with a role and what they see. **Owner** and **billing** contacts approve quotes and pay; **owner** and **signatory** contacts sign. Contacts set to see "all the company's cases" follow and help with every case (messages, documents); others see only their own. A new contact gets an account and signs in with their email; the portal marks colleagues' cases "Opened for …". |
| **Requests opened by staff** | Admins and case managers open a request for an existing client, or for a new one by email, from **Cases → New request** or a client's profile. It's assigned to the creator by default; the client is notified and can sign in with that email. |
| **Case workspace** | The next step first (highlighted, red when late, with a button to the tasks), then who handles it, the deadline and the last activity. Three panes (details / work area / AI copilot); on wide screens the details and AI panes can be hidden to give the work area room (remembered per browser). Assign, validated status changes, urgency, category, client messages, internal notes, info requests, tasks, quotes, documents, history, client-timeline updates, complete/close. |
| **AI copilot** | Case summary: what the client wants, known facts **linked to their source**, missing info, complexities, next step. Also up to 3 recommended actions, clarifying-question drafts, rewrite / shorten / translate, thread summary, status-update drafts, task plans, quote drafts and document analysis. Anything customer-facing is a draft a person must send. |
| **Quotes** | Line items; VAT on top or included; currency, payment terms, timeline, disclaimers, validity; live preview of the customer view. AI drafts use prices **only** from the price list. Sent quotes are immutable, and revisions create new versions. Quotes expire automatically. |
| **Approval & payment** | The customer approves a specific version (identity, time, IP and a hash of the content are recorded), asks for clarification, or declines. One payment per quote through [Grow, Stripe or the test checkout](#payments). Only a verified payment activates the case. |
| **Document checklists** | Each service template lists the documents it needs (required or optional, with a note for the client). Staff request a whole checklist in one step: one message to the client, nothing requested twice. The client sees "3 of 5 required documents provided"; the case keeps waiting for the client until every required document is in. Automatic reminders go out every N days for missing required documents, up to a maximum (Settings → General). |
| **Documents** | Staff request documents and customers upload versioned files. Statuses: requested → uploaded → in review → approved, or a new version requested. Type and magic-byte validation, size limit, optional ClamAV scan, encryption at rest, permission-checked and audited downloads. |
| **Tasks** | Owner, due date, status, priority, client-action flag; service templates; AI-suggested plans reviewed before creation; "my tasks" and overdue views. |
| **Notifications** | In-app (bell and page), email, [push](#push-notifications) and [WhatsApp](#whatsapp) for every event, localized per recipient, through a retrying outbox. |
| **Receipts & invoices** | Every successful payment gets its document automatically: a tax invoice-receipt or receipt from [Green Invoice (Morning, חשבונית ירוקה)](#receipts-and-invoices) when connected (Settings → Integrations), emailed by the service and saved as a PDF in the case's documents; otherwise the app's own payment confirmation (not a tax document). Staff issue or retry by hand on the Payments page. |
| **Client satisfaction** | When a case is completed, the client is asked for a 1–5 rating with an optional comment, once. The team member is notified; staff see the rating on the case; Reports show the average, the spread, the response rate, recent comments and each member's rating. |
| **Reports** | **Reports** (admins, finance, case managers) for a period: revenue by month and by service type, the request → quote → approval → payment funnel, time to first response (and the share within the SLA), to quote and to completion, requests by service type and status, and each team member's workload. Finance sees revenue only, and case managers see everything except revenue. **Export to Excel** downloads it as an .xlsx with one sheet per section, plus the list of requests. |
| **Meetings** | Clients book a consultation (video, phone or at the office) from their case, in a free slot of the team member handling it. Staff book any time for themselves or a colleague. Change the time, cancel, add to any calendar (.ics), reminders to both sides. Team members set their hours on **Meetings**, and can connect Google Calendar: busy times are excluded and meetings are added with a Google Meet link. The **Meetings** page has a calendar by day, week or month with the app's meetings and the team member's Google Calendar events (admins can show the whole team's meetings). |
| **Electronic signatures** | Staff ask the client to sign a PDF (a power of attorney, an engagement letter). The client reviews it, types their full name, optionally draws a signature, agrees and signs. The signed copy (each page stamped, plus a signature certificate page) is saved as a new version. Approving a quote is signed too, and a signed quote PDF is saved to the case's documents. |
| **WhatsApp** | Clients (and staff) who opt in on their profile get updates on WhatsApp. Client replies land in the case's messages, labelled "WhatsApp", and files they send are added to the case's documents. "STOP" opts out. |
| **System health** | **Settings → System health** (admins) shows whether each part works: AI (provider, model, and whether the provider may keep prompts), email, WhatsApp, push, payments, receipts and invoices, Google Calendar, the scheduled jobs, and setup the public pages need (the accessibility coordinator, the business details). Each card says what is wrong and what to do, with the last success, the last failure and its error. Failed messages (last 7 days) and invoices can be retried from the page. The dashboard shows admins a warning when something isn't working. |
| **Realtime** | Server-Sent Events update open pages within about 2 seconds; polling on serverless hosts. |
| **Admin** | Team members and roles; general settings (VAT, currency, quote validity, SLA, question limit, the accessibility coordinator shown on the accessibility statement); service templates; price list; payment provider. |

**Status model.** Internal statuses map to simpler customer labels:

- **Internal:** `submitted → under_review ⇄ awaiting_information → quote_preparation → quote_sent → awaiting_payment → active ⇄ awaiting_client → completed → closed`, plus `cancelled` and `declined`.
- **Customer labels:** received → in review → quote ready → awaiting payment → in progress → completed.

`quote_sent`, `awaiting_payment` and `active` are reached only through the real action: sending a quote, the customer's approval, a verified payment. The one exception is starting work before any quote (from `under_review` or `quote_preparation`), for work paid another way or free of charge: only admins and case managers can do it, and they must choose a reason ("paid another way", "free of charge", or "other" with details). The reason is kept in the case history for the team only. Every material action writes a case event with time, actor and visibility. Internal events and notes are never shown to customers.

## Roles and permissions

| Role | Can |
|---|---|
| **Admin** | Everything, including team members, settings, templates, prices and the payment provider. |
| **Case manager** | Unassigned new requests and the requests assigned to them; open requests for clients; quotes for their cases. |
| **Staff** | Only cases where they have an assigned task; no pricing. |
| **Finance** | Cases, quotes and payments, but no messages, documents or AI tools. |
| **Customer** | Only their own cases, and only client-facing data. |

Every check runs on the server (`src/lib/auth/permissions.ts`). A case you may not see answers "not found".

**Staff pages** — who may open each one is a single table, `STAFF_PAGES` in `src/lib/auth/permissions.ts`. Each page checks it on the server (`requireStaffPage`), and the menu and Quick Create read the same table, so the menu never shows a page that would turn someone away. Anyone else is sent to the dashboard. Tests cover every page for every role.

| Page | Admin | Case manager | Staff | Finance |
|---|---|---|---|---|
| Dashboard, Cases | ✓ | ✓ | ✓ | ✓ |
| My Work, Tasks, Conversations, Meetings | ✓ | ✓ | ✓ | |
| Incoming requests, Customers, New request | ✓ | ✓ | | |
| Quotes, Reports | ✓ | ✓ | | ✓ |
| Payments | ✓ | | | ✓ |
| Settings, Activity log | ✓ | | | |

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
| `CRON_SECRET` | Protects `POST /api/jobs/run`. Also add it as a GitHub repository secret, so [the jobs run every 10 minutes](#scheduled-jobs). |
| `JOBS_INTERVAL_MINUTES` | Runs the jobs inside the server every N minutes instead of external cron. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, … | See [AI providers](#ai-providers). |
| `PAYMENT_PROVIDER`, `STRIPE_*`, `GROW_*` | See [Payments](#payments). |
| `VAPID_*` | Optional; see [Push notifications](#push-notifications). |
| `FCM_SERVICE_ACCOUNT`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_ENVIRONMENT`, `APP_URL_SCHEME` | Optional; the iPhone/Android app's push and sign-in. See [iPhone and Android app](#iphone-and-android-app). |
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
- **Robust replies:** a reply is accepted as plain JSON, inside a code fence, or with text around it. If a model writes the other fields into the first text field (some free models do), the app rebuilds them, or cuts them off, so customers never see raw JSON.
- **To add a service,** write `src/lib/ai/providers/<name>.ts` exporting an `AiProvider` and add it to `registry` in [`src/lib/ai/providers/index.ts`](src/lib/ai/providers/index.ts).

The default OpenRouter model is free (`nvidia/nemotron-3.5-super-vl:free`, with `google/gemma-4-31b-it:free` as fallback). Free models have daily request limits, and free endpoints may log prompts.

`OPENROUTER_DATA_COLLECTION` is `deny` by default: OpenRouter then uses only providers that don't keep or train on prompts, as the privacy policy promises. Most free models aren't available that way, so with a free model AI requests may fall back to the offline analysis; use a paid model for real clients. `allow` makes free models work again. The privacy policy and the AI consent text then say that the AI provider may store the content and use it to improve its models (instead of promising it won't), and System health shows a warning.

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

## iPhone and Android app

[`mobile/`](mobile/) is a native app for iPhone and Android (Capacitor) that opens the live site. Every screen, the Hebrew/RTL layout and every feature come from the server, so **a website release reaches the app without a store update**. What the app adds natively:

- **Push notifications:** browser push doesn't reach an app, so the app registers the phone with Apple (APNs) or Google (Firebase) and the same push outbox sends to it ([`native-push.ts`](src/lib/services/native-push.ts)). Turning it on is the same **Notifications on this device** switch. Needs `APNS_*` and `FCM_SERVICE_ACCOUNT` (see `.env.example`).
- **Google sign-in:** Google blocks sign-in inside apps, so it opens in the system browser and hands the app a one-time code, which only the app can redeem ([`app-sign-in.ts`](src/lib/services/app-sign-in.ts)). Email-code sign-in works as it is.
- **Camera:** document uploads offer the camera; the app declares camera and photo permission texts.
- **Payments:** the Grow payment page stays inside the app. These are real-world services, so Apple's in-app purchase doesn't apply.
- **Offline screen** when the site can't be reached, the app icon and a launch screen.

Building, signing, the Apple/Google keys and store submission: [**mobile/README.md**](mobile/README.md). CI builds both apps on every change to `mobile/` (the Android build is downloadable from the run), and the **Google Play release** workflow signs the Android app and uploads it to Play, with the store listing in [`mobile/store/google-play`](mobile/store/google-play).

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

## Receipts and invoices

**Connect (admin).** In Settings → Integrations → **Receipts & invoices**, choose Green Invoice (Morning) and enter an API key. In Green Invoice, keys are under Settings → Developer tools → API keys; the secret is shown only once.
- **Document type:** חשבונית מס קבלה (320) for VAT-registered businesses, or קבלה (400) for exempt ones.
- **Issue automatically:** on by default. When it's off, staff issue documents from the Payments page.
- **Email by the service:** Green Invoice emails the document to the client.
- **Sandbox:** keys from `sandbox.d.greeninvoice.co.il` produce test documents.

The app checks the keys with Green Invoice before saving them encrypted; afterwards only a hint is shown. Saving again without retyping the secret keeps it.

**What happens on a payment.** Right after a payment succeeds, a document is issued for exactly the amount paid, VAT included (VAT-exempt when the quote had none). It records the case and our payment id as its reference, and the client's or organisation's name and tax id. Its PDF is saved to the case's documents, where the client sees it, and the client is notified.
- Temporary errors (outages, rate limits) are retried by the jobs.
- A refusal marks the document as failed and notifies admins and finance. Fix it at Green Invoice, then press **Retry** on the Payments page.
- Each payment gets at most one document.

**Without a service** each payment gets the app's own **payment confirmation** PDF, which states that it isn't a tax document. In Israel, receipts and tax invoices must come from certified bookkeeping software.

The service sits behind an interface ([`src/lib/invoicing/`](src/lib/invoicing/)), so others (iCount, EZcount, Grow's documents) can be added alongside Green Invoice. Code: [`src/lib/services/invoices.ts`](src/lib/services/invoices.ts).

## Meetings

**Booking.** On a case's **Meetings** tab the client chooses a length (Settings → General: lengths, break between meetings, minimum notice, how many days ahead, office address), how to meet, a day and a free time. The times offered are the working hours of the team member handling the case (or of the admins and case managers if no one is assigned), minus their other meetings with the break around them, minus their Google Calendar's busy times when connected. Staff book from the same tab at any free time, also outside working hours, for themselves or a colleague. Either side can move or cancel a meeting.

**Notifications and reminders.** The other side is notified when a meeting is booked, moved or cancelled (in-app, email, push, WhatsApp). The daily job reminds both sides before a meeting, and again within 90 minutes of it when the job runs often enough. Vercel Hobby runs the job once a day, so the "starting soon" reminder needs a more frequent cron: an external scheduler calling `POST /api/jobs/run` with `Authorization: Bearer $CRON_SECRET`, or `JOBS_INTERVAL_MINUTES` on Docker or Render.

**Calendars.** Every meeting has an **Add to calendar** button: an .ics file that works with Google, Outlook and Apple calendars and updates in place when the meeting moves (same UID, increasing SEQUENCE).

**Google Calendar (optional, per team member).** On **Meetings → Connect Google Calendar** (or **Settings → Integrations** for admins), a team member allows access to their calendar. Busy times there aren't offered to clients, and booked meetings are added to it, with a Google Meet link for video meetings. Moving or cancelling updates the event. It uses the same Google OAuth client as Google sign-in, and the same redirect URI. In Google Cloud:
1. Enable the **Google Calendar API** for the project.
2. On the OAuth consent screen, add the scopes `calendar.events` and `calendar.freebusy`.
3. While the app is in testing, add the team members as test users. Publishing an app with these scopes needs Google's verification.

The refresh token is stored encrypted. If Google refuses or is unreachable, bookings still work and the problem is shown on the Meetings page.

**The calendar.** The top of **Meetings** is a calendar by day, week (from Sunday) or month, in Israel time: the team member's meetings in the app (each opens its case) and, when connected, the other events in their Google Calendar (each opens in Google Calendar; recurring events included). Each meeting appears once even though it's also a Google event. **New event** adds a team member's own event (a title, a day, a time or all day, notes, optionally a Google Meet link). With Google Calendar connected it's created there too, and editing or deleting it in the app changes it there; an event made before connecting is added when it's next saved. These events also block those times from client bookings. Admins choosing **Whole team** see everyone's meetings; a team member's own events and Google events are shown only to them. The view and date are in the address (`?view=week&date=2026-11-08`), so a view can be bookmarked.

Code: [`src/lib/services/meetings.ts`](src/lib/services/meetings.ts), [`src/lib/services/calendar.ts`](src/lib/services/calendar.ts), and the time zone and slot logic in [`src/lib/meetings.ts`](src/lib/meetings.ts). Times are computed in Israel time, `Asia/Jerusalem`, including the daylight-saving changes.

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

Sign-in codes and email updates go out through one of these, in this order:

1. **The service connected in the app** — **Settings → Integrations → Email** (admins): an SMTP server (Gmail with an app password, Outlook, your domain's mail host: server, port, SSL, username, password) or [Resend](https://resend.com) (an API key). Connecting sends a test email to you first and saves the details only if it's sent; the password or key is stored encrypted, and never shown again. **Send a test email** checks it any time, and System health shows it.
2. **`SMTP_URL` on the server**, as before (for example Gmail with an app password: `smtps://you%40gmail.com:app-password@smtp.gmail.com:465`). `EMAIL_FROM` sets the sender address, and `EMAIL_FROM_NAME` the name recipients see. Disconnecting the service in the app falls back to it.

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
- Quote expiry, reminders and outbox retries run every 10 minutes from a [GitHub Actions schedule](#scheduled-jobs), and once a day from the cron in [`vercel.json`](vercel.json) as a fallback.
- Files go to Blob, or to the database if no Blob store is connected.

Vercel Hobby is for personal, non-commercial use. Neon's free compute pauses when idle.

### Scheduled jobs

`POST /api/jobs/run` retries emails, push, WhatsApp messages and invoices, sends document and meeting reminders, and expires old quotes. Vercel Hobby's cron runs it only once a day, so [`.github/workflows/jobs.yml`](.github/workflows/jobs.yml) calls it every 10 minutes:

1. In GitHub, **Settings → Secrets and variables → Actions → New repository secret**: `CRON_SECRET`, with the same value as on Vercel.
2. Optional: a repository variable `JOBS_URL` to call another address (default: the production site's `/api/jobs/run`).

Without the secret the workflow only prints a warning. **Settings → System health** shows when the jobs last ran. On Docker or Render, `JOBS_INTERVAL_MINUTES` runs them inside the server instead.

### Backups

Two layers:
- **Neon's own restore** (Neon console → your project → **Restore**) brings the whole database back to any moment within the plan's history window. That's the fastest way back after a mistake.
- **Nightly backups of your own**, kept outside Neon. [`.github/workflows/backup.yml`](.github/workflows/backup.yml) runs every night (and by hand from **Actions → Nightly backup → Run workflow**). It:
  - copies every table into one file, gzipped and encrypted with its own key, `BACKUP_SECRET`;
  - **restores that file into an empty database and checks that every table matches**, so a backup that can't be restored fails loudly;
  - keeps the file as a workflow artifact for 30 days;
  - reports to the app: **Settings → System health → Backups** shows the last backup, its size and "restore tested", and warns when it's more than a day old.

**Setup:** add the repository secrets `BACKUP_DATABASE_URL` and `BACKUP_SECRET` (GitHub → Settings → Secrets and variables → Actions).
- `BACKUP_DATABASE_URL` is the production database's direct connection string. Neon → Connection details → turn off "Connection pooling"; a read-only role is best.
- `BACKUP_SECRET` is a new random value (`openssl rand -hex 32`). **Keep a copy in a password manager**: GitHub won't show it again, and without it the backups can't be read.

Stored files and saved integration keys stay encrypted inside the backup with the app's `APP_SECRET`, so restore into a database that the same deployment (same `APP_SECRET`) will use.

`CRON_SECRET` is already there for the scheduled jobs. Without the secrets the workflow only prints a warning.

**Restoring.** Download the artifact from the workflow run, then:

```bash
npm run db:restore -- case-manager-….cmbk --verify               # check the file (into a throwaway database)
npm run db:restore -- case-manager-….cmbk --into "<new database url>"  # restore into a NEW, empty database
```

The restore never overwrites data: it refuses a database that has rows. Create a new Neon branch or database, restore into it, check it, then point `DATABASE_URL` at it and redeploy. Locally, `npm run db:backup` backs up `DATABASE_URL`, or the embedded database in `PGLITE_DIR`.

### Removing the demo data

A database that was once seeded with `DEMO_MODE` keeps the demo accounts (`…@example.com`) and their sample requests. **Settings → System health** flags them, and an admin removes them there with **Remove demo data** (after a confirmation; make sure a backup exists first). From a terminal, `npm run db:remove-demo` previews and `-- --apply` removes. Turn `DEMO_MODE` off first.

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
| Unit + integration | `npm test` | Roles and permissions, document checklists and reminders, the full request → quote → payment lifecycle, sign-in security, intake ownership, storage encryption, staff-opened requests, team invites, Grow (fake API), AI providers (fake API), push (real encryption to a local push endpoint), WhatsApp (fake Meta API: sending, replies, files, opt-out), electronic signatures (real PDFs: stamping, certificate, evidence, versions, signed quotes), service types (assistant-created, deduplicated, admin-managed), AI consent, meetings (time zones and daylight saving, slots, booking, moving, cancelling, reminders, .ics, Google Calendar through a fake API), reports (periods, access by role, the numbers, the .xlsx file), receipts and invoices (Green Invoice through a fake API: connecting, issuing, PDFs, retries, manual issuing, the payment confirmation), client satisfaction, the service worker, demo-data cleanup, Google sign-in. In-memory PGlite; set `TEST_DATABASE_URL` for PostgreSQL. |
| HTTP | `API_BASE=http://localhost:3000 npm run test:api` | A running server: security headers, auth, CSRF, validation, cookie flags, role isolation, webhooks, Grow, push, WhatsApp and signature endpoints. |
| Performance | `BASE=http://localhost:3000 npm run perf` | Budgets per page in [`e2e/perf-budget.json`](e2e/perf-budget.json): JavaScript downloaded (≤ 300 KB), the server's median answer (≤ 1.5 s) and the load time (≤ 5 s) for the public pages and the main staff pages, each in a fresh browser. CI fails when a page goes over and lists the numbers in the run's summary. |
| Browser | `BASE=http://localhost:3000 npm run e2e` | Playwright scripts in `e2e/`: accessibility (axe with the WCAG 2.2 AA rules on 141 page states — every staff page and Settings tab, Quick Create and the search open, the collapsed menu, phone cards — plus keyboard checks: the drawer, sign-in errors, focus never hidden under the sticky header, 320 px reflow), the full journey (Hebrew/English, desktop/mobile), accounts, staff-opened requests, team, Grow (with a stand-in Grow API), push (with a stand-in push service), document checklists, WhatsApp (with a stand-in Meta API) electronic signatures (requesting, drawing and signing, the signed PDF, signed quotes), service types and AI consent, meetings (hours, booking a free slot, .ics, moving, cancelling), reports (sections by role, periods, the Excel export), receipts and ratings (with a stand-in Green Invoice API), production readiness (the accessibility coordinator, System health, starting work before payment, customer search), the Work queue (deadlines, views, bulk changes, saved views, team workload), workflows (work plans, automation rules, the Conversations inbox with saved replies), Release D (time and profit, document checks, company contacts), Release E (two-step sign-in, activity log, error tracking), Release F (the grouped, collapsible menu and the phone drawer) Release G (the filter bar on Quotes, Payments and Tasks, menu counters, the Settings tab in the address) Release H (Quick Create and the lists as cards on a phone) and Release I (Settings loading one tab at a time, and the page-access rules) Release J (Ctrl+K search and the case page's next step and side panels) and Release K (the attention center). |

The HTTP and browser suites need the server in demo mode (codes on screen). The Grow, push and WhatsApp scripts also need `GROW_API_URL=http://localhost:4010`, `PUSH_EXTRA_HOSTS=localhost:4012` and `WHATSAPP_API_URL=http://localhost:4014` (and `INVOICE_API_URL=http://localhost:4016/api/v1` for `e2e/invoices.cjs`, `RESEND_API_URL=http://localhost:4018` for `e2e/email-calendar.cjs`):

```bash
npm run build && APP_SECRET=ci-only-secret-0123456789abcdef0123456789 DEMO_MODE=true PGLITE_DIR=.data/ci GROW_API_URL=http://localhost:4010 PUSH_EXTRA_HOSTS=localhost:4012 WHATSAPP_API_URL=http://localhost:4014 INVOICE_API_URL=http://localhost:4016/api/v1 RESEND_API_URL=http://localhost:4018 npm start
```

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every pull request and push to `main`:

| Job | What it does |
|---|---|
| **Type check, tests, build** | `tsc`; the tests on PGlite and on PostgreSQL 16; production build. |
| **Browser walkthrough** | Production server in demo mode, then the HTTP tests, all browser scripts and the performance budgets. Screenshots and the numbers are kept as an artifact. |
| **Docker image** | Builds the image; on `main` pushes it to `ghcr.io/<owner>/case-manager`. |

Vercel deploys through its Git integration: production from `main`, and a preview of every other branch with the Preview settings (the dev database and address).

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

### Two-step sign-in for staff

Under **My account** (the link under your name in the menu), a team member turns on two-step sign-in: they scan a QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), type its first code, and save 10 single-use recovery codes, shown once. From then on, after the email code (or Google) the app asks for the code from the app, or a recovery code; the session doesn't count as signed in until then. The secret is stored encrypted, recovery codes only as hashes, a code can't be used twice, and wrong codes are limited (10 in 15 minutes).

- **Require it for everyone:** Settings → General → *Require two-step sign-in for all team members*. Team members without it are sent to My account to set it up before anything else (the API answers `mfa_setup_required`).
- **Lost phone:** an admin presses the reset button next to the person in Settings → Users; they set it up again. New recovery codes can be made any time under My account.

### Activity log

**Activity log** (admins) lists everything the app records — sign-ins, case and status changes, documents, quotes, payments, settings, connections — with who, when and from which IP. Filter by person, kind, text and dates; export the filtered list as CSV (opens in Excel with Hebrew).

### Error tracking

Errors on the server (API routes and page rendering) and in browsers are recorded in the app, no outside service needed: the same error from the same place is one entry with a count. Emails, ids, long numbers and keys are removed from messages. A new error notifies the admins (in the app and by email, at most once an hour per error), System health shows an **Errors** card, and its list shows each error with where it happened and its technical details; **Mark as fixed** closes it (if it happens again it comes back).

### More

To report a security problem, see [SECURITY.md](SECURITY.md). Dependabot opens weekly dependency updates into `dev` (`.github/dependabot.yml`).

- **Sessions:** httpOnly, SameSite cookies.
- **Sign-in codes:** hashed, single-use, time-limited, rate-limited and attempt-limited.
- **Requests:** same-origin checks on all mutations; security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- **Files:** encrypted at rest (AES-256-GCM, or S3 server-side encryption); content-type and magic-byte checks; optional malware scan; permission-checked, audited downloads.
- **Encrypted settings:** payment identifiers, invoicing keys, WhatsApp credentials, calendar tokens and push keys are stored encrypted with a key derived from `APP_SECRET`.
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
