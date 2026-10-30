# Local React website

This frontend runs beside the existing Node.js backend. It is local-only; nothing is deployed. Vite proxies `/api` (including media/downloads/cookies) to `http://127.0.0.1:8000`. Open **http://localhost:5173**, matching the backend's default allowed browser origin.

For temporary hosted testing, the root Dockerfile builds React and serves it through Express on the same Render URL as the API, including nested English/Urdu routes. See [DEPLOY-RENDER.md](../DEPLOY-RENDER.md). The files are prepared locally; a live deployment still requires connected accounts and working secrets.

The backend requires MongoDB (Atlas or a local replica set). Configure its credentials before starting the API; authentication failures appear as an unavailable API. Frontend routes and request formats are unchanged.

## Start from the project folder

```powershell
# Terminal 1, if the API is not already running:
npm.cmd run dev:api

# Terminal 2:
npm.cmd run dev:web
```

Install frontend dependencies with `npm.cmd install --prefix frontend` when needed. Root scripts: `npm.cmd run build:web`, `npm.cmd run test:web`, `npm.cmd test` (backend). Only the development server proxies the API; `vite preview` previews static build output and is not the integrated testing environment.

## Pages to review

- `/en` and `/ur`: homepage based on the design PDF, including the arched portrait area, dark featured-book panel, five-book shelf, articles/video and newsletter/footer.
- `/en/books`, `/en/articles`, `/en/videos`: published catalogue, search and detail pages. Locale prefixes work for all screens.
- `/en/sign-up`, `/en/sign-in`, `/en/forgot-password`: registration, verification, session login, MFA and password recovery.
- `/en/account`: profile/preferences, real order status and purchased library.
- `/en/library` and `/ur/library`: purchased PDF editions and protected download actions.
- `/en/contact`: stored contact/speaking enquiries.
- `/en/admin`: protected content workspace, bilingual editing, narration/cover/private-PDF upload, preview readiness, publishing/unpublishing and revision restore; owner-only users/orders views.

Missing real portrait/book assets are labelled placeholders; no made-up author biography, book titles, reviews or sales are presented as facts. The homepage shows placeholder book designs only until published books exist. Catalogue pages show genuine empty states. Publish your own content from admin to replace the placeholders. For the biography page, create a `pages` item with slug `about`.

## First staff account

From the project folder run `npm.cmd run setup:admin` in an interactive terminal. Enter your name/email/password; password entry is hidden and confirmed. The command creates an owner directly in the local backend database. No shared/default credentials are created, and public signup creates readers only. The script also still accepts `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` environment variables; clear the password variable afterwards.

Sign in at `/en/sign-in` or `/en/admin`. On first staff sign-in, scan the locally generated QR with an authenticator or enter the displayed setup key. Verify the code and save the ten recovery codes offline. Codes/keys are never sent to an external QR service or saved in localStorage. Staff permissions and MFA are checked by the backend, not merely hidden in the interface.

## Verification and reset mail in local development

Without SMTP the backend saves messages in `backend/data/mail/*.json`. Open the newest matching message locally and follow its verify/reset link, or paste its one-time token into the corresponding page. Do not share those files. With SMTP configured, mail is sent normally. Authentication uses HttpOnly cookies plus a CSRF token held in memory. On reload `/auth/me` restores the session. The frontend stores only its language choice in localStorage.

## Suggested visual test

1. Open English and Urdu homepages; resize the browser to phone width and test the menu.
2. Sign up as a reader, verify email, sign in, change preferences, sign out and exercise recovery.
3. Sign in as staff with MFA. Create a draft book with one/both language titles; save before uploading a private PDF. Upload its cover, narration for each included language and private edition(s); save again.
4. Preview, resolve readiness issues and publish. Open its public detail page, play narration and verify the language switch.
5. Edit with Save draft; confirm the live version stays unchanged. Publish or restore an earlier revision as a draft. Unpublish and confirm the public page disappears.
6. Send a contact enquiry and inspect it in admin. Owners can review readers/orders and suspend/reactivate reader accounts with a reason.

Stripe is **test-only**, uses real backend endpoints and requires local test credentials. Checkout is not fabricated as successful. Signed paid webhooks unlock the exact language editions attached when checkout began. My Library downloads use fresh five-minute, single-use links tied to the signed-in buyer session. Full refund events revoke access; partial refunds retain it. A pending return-page order refreshes status automatically, and paid orders link to the library.

To test purchases, publish a book with private PDF edition(s), price/currency and narration; configure Stripe test credentials and forward signed webhook events to the backend. Complete a test checkout as a verified reader, then open the library. No fake purchase/grant button or bypass is included. Newsletter signup, shipping, refund initiation, disputes and page audio without supplied recordings remain pending. Admin preview uses actual backend readiness errors. Existing orders from before edition snapshots were introduced need explicit reconciliation; they are not assigned today's files automatically.

Google Fonts enhance English/Urdu typography; system fonts are fallbacks when offline. Browser automation was unavailable during the initial local setup; automated route-render checks, the Vite build and backend integration tests are separate from a full interactive browser QA pass. Production hosting, SEO pre-rendering, email translations and final policy/content approval remain later work.
