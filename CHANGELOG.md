# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Two-step sign-in for staff.** An authenticator app (QR code to set up, 10 recovery codes) asked for after the email code or Google. Admins can require it for the whole team and reset it for someone who lost their phone. Under the new **My account** page.
- **Activity log** (admins): who did what and when — sign-ins, cases, documents, quotes, payments, settings — with filters by person, kind, text and dates, paging, and CSV export.
- **Error tracking.** Server and browser errors are recorded and grouped in the app (personal data removed), admins are notified of new ones, and System health has an Errors card and list with Mark as fixed.
- **A calendar on the Meetings page**, by day, week or month: your meetings in the app and the events in your Google Calendar, with today, previous and next. Admins can show the whole team's meetings.
- **Your own events on the calendar.** New event (a time or all day, notes, optionally a Google Meet link); with Google Calendar connected it's added there, and editing or deleting it here changes it there. Those times aren't offered to clients.
- **Connect the email service in the app.** Settings → Integrations → Email: an SMTP server (Gmail, Outlook, your domain) or Resend, checked with a test email and stored encrypted, for sign-in codes and email updates. `SMTP_URL` on the server still works, as the fallback.
- A security policy (`SECURITY.md`) on how to report a problem privately (GitHub's private vulnerability reporting, or the owner directly), and weekly Dependabot updates into `dev`.

### Changed
- **The staff menu is grouped** (Workspace, Operations, Business, System), and the Work queue is now **My Work**. The desktop menu **collapses to icons** (names on hover and keyboard focus) and remembers it; the phone drawer keeps the page behind it from scrolling. One menu definition for desktop and mobile.
- Cases open from the table by keyboard as by mouse: the case link covers the row (also "open in new tab").
- The staff area loads its two counters in parallel.
- **Dates are DD/MM/YYYY everywhere**, in Hebrew and English. Date fields always show and accept DD/MM/YYYY (the browser's own date field followed the browser's language, so a US-English browser showed MM/DD/YYYY), with a button for the calendar picker.
- **Times are 24-hour HH:MM** in every time field (event times, staff booking, working hours), whatever the browser's language; the colon is added while typing and the arrow keys change the time.
- The unused "Deploy to Vercel" CI job is removed; Vercel's Git integration deploys, and every preview uses the dev settings.

## [1.1.0] — 2026-11-08

### Added
- **Backups with a tested restore.** `npm run db:backup` writes an encrypted copy of every table and restores it into an empty database to check it; `npm run db:restore` checks a file or restores into a new database (it never overwrites data). A nightly GitHub Actions workflow runs the backup, keeps 30 days of files and reports to Settings → System health, which now has a Backups card.
- **Remove demo data from the app.** System health flags leftover demo accounts and an admin removes them with one button.
- **Time and profit.**
  - A Time & costs tab on each case: a timer, time added by hand, expenses.
  - Admins set a cost per hour for each team member.
  - Admins and finance see each case's profit (revenue before VAT − time cost − expenses).
  - Reports have a Time and profitability section (hours per member; profit by service type; most and least profitable cases), also in the Excel export.
- **Document checks.**
  - Staff confirm each document's key details (name, ID number, dates); AI can suggest them when it reads files.
  - The checks flag expired or soon-expiring documents, names that don't match the client, and ID numbers or dates of birth that differ between documents.
- **Company accounts with several contacts.**
  - A company's contacts each have a role: owner, contact, billing or signatory.
  - Each contact sees either all the company's cases or only their own.
  - Only owners and billing contacts approve and pay; only owners and signatories sign.
- **Work plans in service templates.** Stages with target days, and tasks that wait for the one before them. Applying a template creates the stages as milestones on the case, unlocks tasks as their prerequisites are done (notifying the handler), completes stages, and sets the case deadline. Clients see their stages and progress.
- **Automation rules** (Settings → Automation). When a request arrives, all required documents are approved, a quote is approved, a payment arrives, the case reaches a status or a stage completes, the rule creates a task, notifies the handler or messages the client. Rules can be limited to one service type.
- **Quote follow-up.** One reminder to the client and one note to the handler when a sent quote gets no answer (days set in Settings → General).
- **Conversations inbox** with saved replies. Client messages from all cases, those waiting for an answer first; reply in place. Saved replies in Hebrew and English are also in the case message composer.
- **Work queue.** One page of open cases, most pressing first (late, then urgency, then deadline), with views and counts: My work, Unassigned, Late, Due in 7 days, Waiting on the client, Waiting on others, No activity for 7 days, All open. Filters, saved views per user, and bulk changes (handler, urgency, status, deadline) for admins and case managers.
- **Team workload** for admins and case managers: each member's open, urgent, late and due-soon cases, and their late tasks.
- **Case deadlines and "waiting on others".** Set on the case (team only); the handler is reminded the day before and on the day. A summary bar above each case shows the handler, next step, deadline and last activity.
- **System health page** for admins: AI (provider, model, whether prompts may be kept), email, WhatsApp, push, payments, receipts and invoices, Google Calendar, the scheduled jobs, and the setup public pages need. Each problem says what to do. Failed messages and invoices can be retried from the page, and the dashboard warns admins when something isn't working.
- **Accessibility coordinator in Settings → General** (name, phone, email, reply time). The public accessibility statement shows these details instead of placeholders.
- **Scheduled jobs every 10 minutes** through a GitHub Actions workflow (needs the `CRON_SECRET` repository secret); Vercel's daily cron stays as a fallback.
- **Customer search and pages.** Customers are searched on the server by name, email, phone (in any format) or organization and filtered by type, 50 per page (the list used to stop at 500). Case search also covers the description and the client's phone, and the case list has pages.
- **Document checklists per service.** Service templates list the documents a case needs (required or optional, with a note for the client).
  - Staff request a template's checklist on a case in one step, choosing which items to include. The client gets one message with the whole list, and documents already requested are skipped.
  - Clients see the checklist with progress ("3 of 5 required documents provided"), and one to-do for all the required documents still missing.
  - Automatic reminders about missing required documents: one per case every N days, up to a maximum per document. Both are set under Settings → General; 0 turns reminders off.

- **Receipts and invoices.** Connect Green Invoice (Morning, חשבונית ירוקה) under Settings → Integrations; every successful payment then issues a tax invoice-receipt (or receipt), emailed by the service and saved as a PDF in the case. Without a service, a payment confirmation (not a tax document) is saved. Staff issue or retry by hand on the Payments page.
- **Client satisfaction.** Clients rate a completed case (1–5, optional comment); staff see it on the case and in Reports (average, spread, response rate, comments, per team member).
- **Reports.** A Reports page for admins, finance and case managers: revenue, the request → payment funnel, handling times, requests by service type and status, and team workload, for a chosen period, with an Excel export.
- **Meetings.** Clients book a consultation (video, phone or at the office) from their case, in a free slot of the team member handling it; staff book any free time. Both sides can move or cancel it, get notifications and reminders, and add it to any calendar (.ics). Team members set their hours on the new Meetings page and can connect Google Calendar: busy times are excluded, and meetings are added with a Google Meet link.
- **New service types from the assistant.** When no service type fits a request (for example insurance claims or lawsuits), the intake assistant creates one; requests with the same kind of service reuse it. Admins manage them under Settings → Service types (add, rename, hide).
- **AI consent for accounts the team opened.** Such clients are asked once on the portal whether the team may use AI; anyone can give or withdraw consent on their profile. Self-registered clients keep the answer they gave at registration.
- **Electronic signatures.** Staff request a signature on a PDF in a case; the client reviews it and signs with their full name, optionally drawing a signature too.
  - The signed copy is saved as a new version: each page stamped, plus a signature certificate page (signer, time, IP, device, method, SHA-256 of the original). Staff see the same evidence in the app.
  - Approving a quote is signed as well, and a signed PDF of the approved version is saved to the case's documents.
- **WhatsApp.** Updates on WhatsApp for users who opt in on their profile, through the Meta Cloud API (the provider can be swapped).
  - An admin connects the business number under Settings → Integrations; the credentials are checked with WhatsApp and stored encrypted.
  - Updates are sent as plain text within 24 hours of the user's last WhatsApp message, otherwise with an approved template.
  - Client replies arrive on a signed webhook and are added to the right case's messages, labelled "WhatsApp". Files they send are added to the case's documents. "STOP" opts out.

### Changed
- System health moved from the side menu into **Settings → System health**; the old address opens that tab.
- Each task's "done" checkbox now names its task for screen readers.
- **Starting work before payment needs a reason.** Moving a case to active from review or quote preparation (paid another way, free of charge) is limited to admins and case managers, who must choose a reason; it's kept in the case history for the team only.
- **AI privacy by default.** `OPENROUTER_DATA_COLLECTION` now defaults to `deny`, so prompts go only to providers that don't keep or train on them, as the privacy policy says. With a free model, AI requests may fall back to the offline analysis; use a paid model, or set `allow` knowingly. With `allow`, the privacy policy and the AI consent text say that the free AI provider may store the content and use it to improve its models, instead of promising it won't.
- Google Calendar can also be connected from Settings → Integrations; after Google's consent screen you return to the page you started from.
- Grow can also be connected and disconnected from Settings → Integrations, next to WhatsApp.
- After a client uploads, the case goes back to the team only once every required requested document is in (it used to move on after any single upload).

### Fixed
- Google sign-in no longer fails with "the Google sign-in attempt expired" when it was started in more than one tab (or the button was clicked twice): each attempt now has its own check cookie.
- The intake assistant no longer shows raw JSON when a model puts the other fields inside its reply text.
- The notifications bell's unread badge is no longer read twice by screen readers (WCAG 2.5.3).
- Tab bars no longer show horizontal and vertical scrollbars; they still scroll.

## [1.0.0] — 2026-11-05

First release.

### Customers
- Describe a need in free text (Hebrew or English); an AI assistant asks one question at a time and turns it into a structured request, with a manual form as an alternative.
- Review and edit the request before submitting. Customer facts are kept separate from the assistant's interpretation.
- Sign in or register with an emailed one-time code or with Google; an unknown email is offered registration.
- Customer portal: cases, "what needs to be done now", progress track, timeline, messages, documents, quotes and payments.
- Approve a quote, ask for clarification or decline it, and pay online.

### Staff
- Dashboard, incoming-requests inbox, case list, customers, payments, settings.
- Case workspace: assignment, validated status changes, client messages and internal notes, tasks, documents, quotes, history.
- AI copilot: case summary with sources, next steps, reply drafts, rewrite/translate, task plans, quote drafts, document analysis. Everything customer-facing is a draft a person sends.
- Admins and case managers can open a request for an existing or new client.
- Team members and roles (admin, case manager, staff, finance); adding someone whose email already has a client account.

### Payments
- Grow (Meshulam): credit card, Bit, Apple Pay, Google Pay; connected from the Payments page, identifiers stored encrypted; server updates verified with Grow's API.
- Stripe Checkout, and a built-in test checkout.

### AI
- Replaceable AI provider layer: Claude, OpenRouter (including free models), any OpenAI-compatible API, or an offline engine.
- PII redaction, prompt-injection defences, per-user rate limits, AI-consent enforcement, full run logging.

### Notifications
- In-app, email and Web Push (browsers and phones, including iPhone home-screen apps), localized per recipient, through a retrying outbox.

### Accessibility
- Meets WCAG 2.1 AA / Israeli Standard IS 5568 in automated testing (axe and Lighthouse), with keyboard, focus and screen-reader fixes, and an accessibility statement at `/accessibility`.

### Platform
- Hebrew (RTL) and English (LTR) throughout.
- Next.js 16, React 19, TypeScript, PostgreSQL (Neon) or embedded PGlite, Drizzle ORM.
- Deploys to Vercel + Neon (production on `main`, a separate dev environment and database on `dev`), Render, or Docker.
- Security: hashed single-use sign-in codes, rate limits, same-origin checks, encrypted files and secrets, verified idempotent webhooks, audit log.
- CI: type check, 173 unit and integration tests on PGlite and PostgreSQL, HTTP tests, and seven browser test scripts (journey, accounts, staff requests, team, Grow, push, accessibility).

[Unreleased]: https://github.com/yehonatan21/Case-Manager/compare/1.1.0...HEAD
[1.1.0]: https://github.com/yehonatan21/Case-Manager/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/yehonatan21/Case-Manager/releases/tag/1.0.0
