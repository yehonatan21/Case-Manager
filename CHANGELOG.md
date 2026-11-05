# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Document checklists per service.** Service templates list the documents a case needs (required or optional, with a note for the client).
  - Staff request a template's checklist on a case in one step, choosing which items to include. The client gets one message with the whole list, and documents already requested are skipped.
  - Clients see the checklist with progress ("3 of 5 required documents provided"), and one to-do for all the required documents still missing.
  - Automatic reminders about missing required documents: one per case every N days, up to a maximum per document. Both are set under Settings → General; 0 turns reminders off.

- **Electronic signatures.** Staff request a signature on a PDF in a case; the client reviews it and signs with their full name, optionally drawing a signature too.
  - The signed copy is saved as a new version: each page stamped, plus a signature certificate page (signer, time, IP, device, method, SHA-256 of the original). Staff see the same evidence in the app.
  - Approving a quote is signed as well, and a signed PDF of the approved version is saved to the case's documents.
- **WhatsApp.** Updates on WhatsApp for users who opt in on their profile, through the Meta Cloud API (the provider can be swapped).
  - An admin connects the business number under Settings → Integrations; the credentials are checked with WhatsApp and stored encrypted.
  - Updates are sent as plain text within 24 hours of the user's last WhatsApp message, otherwise with an approved template.
  - Client replies arrive on a signed webhook and are added to the right case's messages, labelled "WhatsApp". Files they send are added to the case's documents. "STOP" opts out.

### Changed
- Grow can also be connected and disconnected from Settings → Integrations, next to WhatsApp.
- After a client uploads, the case goes back to the team only once every required requested document is in (it used to move on after any single upload).

### Fixed
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

[1.0.0]: https://github.com/yehonatan21/Case-Manager/releases/tag/1.0.0
