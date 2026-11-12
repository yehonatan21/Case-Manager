# Google Play listing

The store listing for the Android app, in Hebrew (`iw-IL`, Google Play's code for Hebrew; the default
language) and English (`en-US`). The **Google Play release** workflow sends it to Play when run with
*Also update the store listing*; or copy it into Play Console → Grow → Store presence → Main store listing.

| File | Play's limit |
|---|---|
| `<lang>/title.txt` | 30 characters |
| `<lang>/short_description.txt` | 80 |
| `<lang>/full_description.txt` | 4,000 |
| `<lang>/changelogs/default.txt` | release notes, 500 |
| `<lang>/images/icon.png` | 512 × 512 |
| `<lang>/images/featureGraphic.png` | 1024 × 500 |
| `<lang>/images/phoneScreenshots/*.png` | 1080 × 1920, 2 to 8, in this order |

`npm run check` (in `mobile/`) fails if a text is missing or too long. The screenshots and the feature graphic
are taken from the site's demo data: `BASE=http://localhost:3000 node mobile/scripts/store-images.cjs`.
Update `changelogs/default.txt` before a release that changes what users see in the app itself.

## App content: answers for Play Console

Play Console → Policy → **App content**. These answers describe what the app does today; check them against
how your office actually uses it.

**Privacy policy:** `https://case-manager-eta.vercel.app/privacy` (your own domain once you have one).

**App access:** *All or some functionality is restricted*. Give the reviewer a demo account: an email address
you can read (they sign in with a code sent to it; tell them to ask for the code at that address, or create a
test account and pass them the code when they write). Without access, review is rejected.

**Ads:** No ads.

**Content rating:** questionnaire category *Utility, productivity, communication or other*; answer no to violence,
sexuality, language, drugs, gambling. Users can interact (messages with the office) — answer yes to
"users can interact or exchange content", and that it's with the business, not with other users.

**Target audience:** 18 and over.

**News app:** No. **Government app:** No. **Health app:** No.

**Financial features:** the app doesn't provide financial services itself. Payments go to the office through a
licensed payment provider (Grow) on its own page, for real-world services (no in-app purchases).

**Data safety** (what the app collects; nothing is sold, nothing is used for advertising):

| Data type | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| Name, email, phone number | Yes | No | Account management, app functionality | Required |
| Other info (customer type, organization name and number) | Yes | No | App functionality | Optional |
| Messages (with the office) | Yes | No | App functionality | Optional |
| Photos and videos, files and docs (uploaded documents) | Yes | No | App functionality | Optional |
| Purchase history (payments for the office's services) | Yes | No | App functionality | Required for paid services (kept after an account is deleted: financial records) |
| App interactions (page views, no personal identifiers; Vercel Analytics) | Yes | No | Analytics | Required |
| Device or other IDs (the push notification token) | Yes | No | App functionality (notifications) | Optional |

- Card details are entered on the payment provider's page and never reach the app: don't declare financial info.
- Service providers that process data on the office's behalf (hosting, email, the payment provider, the AI
  provider when the client agreed to AI processing) are not "sharing" under Play's definitions.
- **Encrypted in transit:** Yes. **Users can delete their account and data:** Yes, see below.

## Account deletion

Google Play requires apps where people create an account to let them delete it **in the app and on the web**.

- **In the app:** Profile → **Delete account**.
- **On the web** (the URL Play Console asks for in Data safety → *Delete account URL*):
  `https://case-manager-eta.vercel.app/delete-account` (your own domain once you have one). Signed out, it
  explains what's deleted and kept and links to sign-in; signed in, it has the same Delete button. It also shows
  the office's email (Settings → General → company email) for people who'd rather ask.
- **By the office:** an admin opens the client (Clients → the client) → **Delete this client's account**.

What's deleted and kept (for the Data safety form: *data is deleted*, except data kept for legal reasons):
the client's name, email, phone and WhatsApp number, sign-in, devices, notifications, intake conversations, and
every request without a payment are deleted at once. Payments, invoices and receipts (with the receipt PDFs), and
for paid requests the quote and the case number, are kept as the law requires for financial records — no longer
linked to the person's details in the app. Invoices issued by an invoicing service (Green Invoice) stay there as
issued.
