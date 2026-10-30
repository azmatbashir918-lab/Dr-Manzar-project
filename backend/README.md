# Dr. Manzar Node.js API - initial development release

Node.js 24+, Express 5 and the official MongoDB driver. **MongoDB is the only application database.** Authentication, MFA, publishing, uploads, payments, refunds, entitlements and downloads use MongoDB collections and transactions. Existing API routes and React request formats are retained. JSON payload/profile/revision fields are native documents; new revision/audit identifiers are UUID strings. Local development defaults to disk media; `MEDIA_STORAGE=mongodb` persists validated uploads in GridFS and uses disk as a disposable cache.

## Temporary Render hosting

See [DEPLOY-RENDER.md](../DEPLOY-RENDER.md) and the root `render.yaml` / `Dockerfile` for the **Free**, password-protected testing deployment. One HTTPS origin serves React and the API. Private testing explicitly requires secure cookies, a stable MFA key, GridFS and Resend HTTPS email; SMTP is not used on Render Free. `/healthz` is a minimal unauthenticated database-readiness check. The rest of the site requires testing credentials, except the Stripe endpoint which independently verifies signed webhooks. This testing profile does not enable a general production release. No cloud resource is created by these local files.

## Run

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd install
npm.cmd run dev
```

Set `MONGODB_URI` and `MONGODB_DB` privately before starting. Use Atlas or a local MongoDB replica set; a standalone MongoDB server is rejected because atomic payments, MFA and download claims require multi-document transactions. Default address: `http://127.0.0.1:8000/api/v1/health`. Health reports `database: "mongodb"` after an actual database ping. React origin is `http://localhost:5173`; Vite proxies requests. Startup fails if MongoDB cannot authenticate or connect rather than silently using a different database.

Run `npm.cmd test` for the current integration suite against a **real, isolated MongoDB replica set** using `mongodb-memory-server`. Tests never use your Atlas database or `.env` credentials. The test dependency downloads an official MongoDB binary, or use `MONGOMS_SYSTEM_BINARY` to supply an existing compatible `mongod` executable. Root shortcuts: `npm.cmd run dev:api` and `npm.cmd test`.

## MongoDB connection preparation

The official MongoDB driver and a read-only connection check are available. Set `MONGODB_URI` privately in `backend/.env` and `MONGODB_DB=dr_manzar`, then run `npm.cmd run check:mongodb` from `backend/`. The checker performs a ping, prints no URI/password, writes no records, and uses a 20-second overall deadline. Authentication errors require correcting the Atlas database-user credentials, including percent-encoding reserved characters in the URI. Never share the `.env` file.

MongoDB indexes protect unique emails, slugs, payment events and entitlement pairs. TTL indexes clean expired tokens asynchronously; expiry is also checked in every security-sensitive query. Transactions use a session propagated through awaited store operations, and no parallel queries run within one transaction. Download claims write the session/user/entitlement records to conflict with simultaneous logout, suspension or refund; accepted TOTP steps and recovery-code consumption are transactional.

## Owner bootstrap

Run `npm.cmd run create-admin` from this directory (or `npm.cmd run setup:admin` from the project root) in an interactive terminal. Enter your name, email and password; password entry is hidden and confirmed. Alternatively set `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` (at least 12 characters) in the current process environment first; remove the password variable afterwards. The command only creates a new owner; it will not silently promote an existing reader. Never commit credentials. Public signup always creates a reader.

## Authentication contract

JSON requests; prefix all endpoints below with `/api/v1`. Registration requires `name`, `email`, `password`, `acceptTerms: true`; optional `language` (`ur`/`en`) and `marketingConsent` (default false).

Development mail is saved as sensitive local JSON under `data/mail/`. Open the latest message locally to obtain the verification/reset link. Links carry tokens in a URL fragment; the future React screen must send that token to the API in JSON. There is no public mail-preview endpoint and tokens are not returned in API responses. Use SMTP settings and `MAIL_MODE=smtp` to send mail. Templates are currently English; translated email templates remain pending.

Login returns a secure-session cookie (HttpOnly, SameSite=Lax; Secure for production configuration) and a CSRF token. React requests must use `credentials: 'include'`. Read the current token from login or `GET /auth/me`; send it in `X-CSRF-Token` for protected mutations. Tokens expire after 8 hours. Password reset revokes all sessions. Failed logins use generic messages and are IP-rate-limited; distributed/account-level protection is pending. Do not add a reverse-proxy trust setting without validating your deployment's actual proxy chain.

**Staff exception:** owner/editor password verification returns HTTP 202 with `{mfaRequired,setupRequired,challenge,expiresIn:300}` and **no new session**. Staff must complete the MFA flow below. Readers retain the normal login flow.

## Admin two-factor authentication (implemented, API only)

1. `POST /auth/login` with the staff email/password obtains a short-lived challenge.
2. If `setupRequired` is true, `POST /auth/mfa/setup` with `{challenge}`. Add the returned manual `secret` to an authenticator app. `otpauthUri` is supplied for a future frontend to render as a QR code locally. Do not send secrets to an external QR service. Setup alone grants no admin access.
3. `POST /auth/mfa/verify` with `{challenge,code:"123456"}`. A valid authenticator code completes enrolment and returns the session cookie, user, CSRF token and **10 recovery codes, displayed once**. Store recovery codes securely offline. The setup challenge expires after five minutes and is single-use on success.
4. On subsequent sign-ins, `setupRequired` is false. Send the authenticator code directly to `/auth/mfa/verify` with the new challenge. No setup secret is returned again.
5. If the authenticator is unavailable, submit one stored recovery code as `code`. It is consumed once and creates an MFA-verified session; it does not disable MFA. No bypass/reset endpoint is provided. Authenticator replacement and recovery-code regeneration are separate future account-management work, not part of this step. Retain the remaining codes.

TOTP uses RFC 6238 SHA-1, six digits and 30-second periods, accepting one neighbouring period for clock drift. Each accepted time step is recorded to reject replay; an immediately reused code can therefore fail until the next period. Keep server/device clocks correct. Five failed MFA verifications lock the account's MFA attempts for 15 minutes, even if a new password challenge is requested. Challenge verification is also IP-rate-limited. Expired/used challenges require restarting sign-in.

Authenticator secrets are encrypted with AES-256-GCM and bound to the user; recovery codes and challenge tokens are stored as hashes. Set optional `MFA_ENCRYPTION_KEY` to 64 hex characters, or development will create `data/mfa.key` with a cryptographically random persistent key. **Back up this key separately and securely; losing or changing it prevents authenticator secret decryption.** Windows filesystem access must be restricted to the service account; POSIX file modes alone are not Windows ACL protection. Neither keys nor codes are logged. All auth responses use `Cache-Control: no-store`.

Admin endpoints require both an enrolled authenticator and an MFA-verified session. Pre-existing password-only staff sessions cannot access them. Completing initial setup revokes old sessions. Password resets revoke sessions and outstanding MFA challenges without removing the enrolled second factor. Suspension prevents challenge completion.

| Method | Route | Purpose |
|---|---|---|
| POST | `/auth/register` | Create reader and send verification; neutral response for existing email |
| POST | `/auth/resend-verification` | `{email}` |
| POST | `/auth/verify-email` | `{token}`; single use, 24-hour expiry |
| POST | `/auth/login` | `{email,password}`; verified email required |
| GET | `/auth/me` | Own profile and CSRF token |
| POST | `/auth/logout` | Revoke current session |
| POST | `/auth/forgot-password` | `{email}`; neutral response |
| POST | `/auth/reset-password` | `{token,password}`; single use, 30-minute expiry |
| PATCH | `/users/me` | Name, language, optional profile and marketing preference |

Profile fields: `profile: {country,city,phone,interests: []}`. Email/role/status cannot be changed with this endpoint.

## Content and admin APIs

| Method | Route | Access |
|---|---|---|
| GET | `/content/:kind` | Public published list; `q`, `limit`, `offset` |
| GET | `/content/:kind/:slug` | Public published detail |
| POST | `/enquiries` | Public, rate limited |
| GET/POST | `/admin/content/:kind` | Editor/owner list or create |
| PUT | `/admin/content/:id` | Editor/owner full replacement; preserves previous revision |
| GET | `/admin/content/:id/revisions` | Editor/owner revision history |
| GET | `/admin/content/:id/preview` | MFA staff: working draft, live snapshot and publication readiness |
| POST | `/admin/content/:id/publish` | MFA staff: validate and publish current working draft |
| POST | `/admin/content/:id/unpublish` | MFA staff: remove public version, retain editable draft |
| POST | `/admin/content/:id/revisions/:revisionId/restore` | MFA staff: restore this item's revision into a draft |
| GET | `/admin/users` | Owner; paginated |
| PATCH | `/admin/users/:id/status` | Owner; `{suspended,reason}`; owners protected |
| GET | `/admin/enquiries` | Editor/owner |
| GET | `/admin/audit` | Owner |
| GET | `/admin/orders` | Owner |

Kinds: `books`, `articles`, `pages`, `videos`. Drafts do not appear publicly. Content is **plain text**, not trusted HTML. Narration URL is mandatory for every translation included in a published item. Both translations are supported but missing translations remain absent; React must explain availability. HTTPS media URLs are references only; this release does not fetch or scan remote assets.

Example `POST /admin/content/books`:

```json
{
  "slug": "first-novel",
  "status": "draft",
  "translations": {
    "ur": {"title": "ناول", "summary": "تعارف", "body": "متن"},
    "en": {"title": "First novel", "summary": "Introduction", "body": "Sample"}
  },
  "category": "Novel",
  "publicationYear": 2020
}
```

For publication add `audioUrl` to each translation. It accepts an external HTTPS URL or the relative API path of an existing narration upload with matching language. Optional top-level `coverUrl`, `videoUrl`, `priceMinor` (integer minor currency units), `currency`, `digitalAvailable` and `digitalFileIds` are supported. `coverUrl` accepts either an external HTTPS URL or the relative API path of an existing uploaded cover. Digital publication requires a price/currency and at least one valid private PDF edition. Payments remain test-only; verified purchases unlock protected customer downloads. Search is basic literal matching over the live bilingual JSON, not linguistic/full-text ranking. Revision restore is implemented; scheduled publishing remains pending.

## Publishing workflow (implemented, API only)

1. Create content with `status: "draft"`. Edit with a full-body `PUT /admin/content/:id`, also using `status: "draft"`.
2. `GET /admin/content/:id/preview` returns `item` (the working copy), `live` (the current public version or null) and `readiness: {canPublish,issues}`. A draft can be previewed before narration or editions are ready. This is preview data for the future React admin, not a rendered HTML preview screen.
3. `POST /admin/content/:id/publish` with `{}` validates narration/media/file references and publishes the current working copy. Public URLs/search and checkout use this live snapshot.
4. Further draft edits, including slug changes, leave the existing live version untouched. Publishing again replaces the live snapshot and switches the public slug atomically. Old slugs have no automatic redirects yet.
5. `GET /admin/content/:id/revisions` returns previous working copies. `POST /admin/content/:id/revisions/:revisionId/restore` with `{}` restores a selected revision **as a draft**, records the displaced copy as another revision, and keeps the current live version unchanged. Preview and publish separately after review. A revision from another item is rejected.
6. `POST /admin/content/:id/unpublish` with `{}` removes the live snapshot and retains a draft. Withdrawal remains possible even if a referenced file is missing. Unpublishing does not delete files or purchase records.

For compatibility, POST/PUT content with `status: "published"` is also an explicit publish operation and validates the same requirements. Use draft status to avoid publishing edits immediately. Every state-changing action needs CSRF, MFA staff permissions and is audited. Failed saves/publishes roll back content, revisions and audit writes together; a conflicting live slug cannot replace another item's publication. Private edition identifiers are omitted from public content responses. Scheduling and rendered frontend previews are outside this backend step.

## Private digital-book storage (implemented, PDF editions only)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/admin/books/:bookId/files/:language` | Upload one private PDF edition (`en` or `ur`) |
| GET | `/api/v1/admin/books/:bookId/files` | List edition metadata for the book |
| GET | `/api/v1/admin/books/:bookId/files/:fileId/download` | MFA staff review download as an attachment |

Create the draft book first. Upload using `multipart/form-data` with exactly one file field named `document`, MIME `application/pdf` and extension `.pdf`; no extra fields. All endpoints require verified MFA staff access; upload additionally needs `X-CSRF-Token`. Limit: 50 MiB, 1-2000 pages, two concurrent validations per process, 20 uploads per IP/hour. A worker thread limits PDF validation to 15 seconds and 256 MiB managed heap so PDF parsing does not block the API event loop. These limits are not a full OS sandbox.

Validation checks PDF header/trailer and parses document structure. Encrypted/unreadable PDFs, JavaScript/open actions, launch actions, embedded files, interactive forms/XFA and other explicitly blocked active features are rejected. Original accepted bytes are preserved, not rasterised or rewritten; stored metadata includes language, page count, byte count and SHA-256. This is **structural validation, not antivirus certification or proof every page renders correctly**. Malware scanning/content-disarm infrastructure and visual edition review remain production release work. EPUB uploads are not included in this step.

Example response:

```json
{
  "file": {
    "id": "generated-file-uuid",
    "bookId": "existing-book-uuid",
    "language": "ur",
    "mimeType": "application/pdf",
    "pageCount": 250,
    "bytes": 5000000,
    "sha256": "document-content-hash",
    "createdAt": 1793300000000
  }
}
```

Attach the returned identifier in the book working copy as `digitalFileIds: {"ur":"generated-file-uuid"}` (and/or `en`). Every reference must belong to the same book and language and its file must exist. An upload does not replace a previous edition or publish automatically. Upload a fresh immutable file and edit the working copy to change editions; older versions remain for revision review. New books cannot attach files before the draft exists.

`PRIVATE_BOOK_DIRECTORY` defaults to `data/private-books`. There is no static mount or permanent public download URL, and metadata responses do not contain filesystem paths. Public book JSON strips `digitalFileIds` and exposes only `digitalLanguages`. Staff downloads require MFA, use `Content-Disposition: attachment` and `Cache-Control: private, no-store`, and are audited. Readers—including buyers—cannot use staff routes; they use the separate purchase-library endpoints below.

Keep this directory out of frontend/public hosting and back up files plus database together. Windows access requires service-account ACLs; the process's file mode is not a complete Windows permissions policy. Never put these documents in cover/narration storage. If database persistence fails the new file is removed; interrupted processes may leave orphan files requiring later cleanup. File deletion, malware-scanner integration and storage-provider adapters are not implemented.

## Book-cover uploads (implemented, API only)

`POST /api/v1/admin/uploads/covers` requires a verified owner/editor session, completed MFA and `X-CSRF-Token`. Send `multipart/form-data` containing exactly one file in field `cover`, with no extra fields. Browser `FormData` sets its own Content-Type boundary; do not set that header manually.

Accepted originals: static JPEG (`.jpg`/`.jpeg`), PNG (`.png`) or WebP (`.webp`), with matching declared MIME type, extension and decoded format. Maximum 5 MiB and 24 megapixels. Empty/corrupt files, SVG, GIF, animation and mismatches are rejected. Twenty uploads per IP/hour and two active upload requests per process limit resource use.

The server decodes, auto-orients and resizes inside 1600 x 2400 without enlarging or cropping, then re-encodes as static WebP and strips original metadata. Only the fresh derivative is saved; originals and client filenames are discarded. This is raster validation/re-encoding, **not a general-purpose antivirus scanner**. Audio/PDF/paid-book uploads are not supported by this endpoint.

Example response:

```json
{
  "cover": {
    "id": "generated-uuid",
    "url": "/api/v1/media/covers/generated-uuid.webp",
    "mimeType": "image/webp",
    "width": 800,
    "height": 1200,
    "bytes": 12345
  }
}
```

Save the exact returned `cover.url` as the book's `coverUrl` when creating/updating its content record. Uploading does not attach the image automatically. To replace a cover, upload a fresh file then update that field. Missing local cover references are rejected. Old images remain available; deletion/orphan cleanup is future work.

`GET /api/v1/media/covers/:filename` serves only database-registered derivatives as `image/webp`, with no-sniff, public immutable caching and cross-origin image display enabled. These covers are **public immediately, including before a draft book is published**; do not upload confidential material here. The future React app should resolve the returned path against its configured API origin. Never resolve it against the frontend origin unless using an API reverse proxy.

Set `COVER_DIRECTORY` (default `data/covers`) for storage. This is local development storage, not a production object-storage adapter; back up files and database together. There is no directory listing or static exposure of the parent `data` directory. Metadata is recorded in `cover_uploads`; successful uploads are audited. A database failure removes the new derivative. Interrupted processes may still leave orphans requiring later maintenance.

Errors: 400 missing/extra fields, 401 unauthenticated, 403 permission/MFA/CSRF failure, 413 byte limit, 415 unsupported type/extension, 422 corrupt/mismatched/animated/oversized pixels, 429 rate/concurrency limit.

Enquiry: `{name,email,kind:"contact"|"speaking",message,language}`. It is stored; acknowledgement email and admin status editing are pending.

## English/Urdu narration uploads (implemented, API only)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/admin/uploads/narration/en` | Upload an English recording |
| POST | `/api/v1/admin/uploads/narration/ur` | Upload an Urdu recording |
| GET/HEAD | `/api/v1/media/narration/:filename` | Public MP3 playback, including byte-range seeking |

Upload requires an MFA-verified owner/editor session and `X-CSRF-Token`. Use `multipart/form-data` with one file field named `audio`; no other fields. The URL selects the language. The server records the admin-selected language; it does not recognise or translate speech. Read/send narration for each language separately.

Accepted sources: MP3 (`audio/mpeg`, `.mp3`), WAV (`audio/wav` or `audio/x-wav`, `.wav`), M4A (`audio/mp4` or `audio/x-m4a`, `.m4a`). Maximum source 50 MiB; decoded duration 0.25 seconds to 60 minutes. Missing/wrong language is rejected. Encoding padding may require trimming recordings very close to the maximum. Twenty uploads per IP/hour and two active jobs per process bound processing. Each decoder has a two-minute processing deadline; long/complex files may require splitting into shorter recordings.

The server checks extension/MIME/header agreement, forces the expected container and **actually decodes the samples** using FFmpeg. Network protocols are disabled, M4A external data references are disabled, no shell is involved, and client filenames never become storage names. The first audio stream is converted to a fresh 44.1 kHz mono, 96 kbit/s MP3; original tags, chapters, images/video and extra streams are discarded. The original never becomes a public asset. This is audio decoding/re-encoding, not a general antivirus service. Paid audiobooks/PDF files are outside this step.

The package includes a development FFmpeg executable; `npm install` downloads its platform-specific binary. Set `FFMPEG_PATH` to a maintained compatible executable if necessary. The bundled binary's security maintenance is separate from npm dependency audit; production release review must select/update the decoder and isolate processing workers before public deployment. No live deployment is enabled by this feature.

Example response:

```json
{
  "audio": {
    "id": "generated-uuid",
    "language": "ur",
    "url": "/api/v1/media/narration/generated-uuid.mp3",
    "mimeType": "audio/mpeg",
    "durationSeconds": 42.5,
    "bytes": 510000
  }
}
```

Copy the returned `audio.url` into the corresponding content translation's `audioUrl`, e.g. `translations.ur.audioUrl`. The content create/update APIs reject missing local recordings and language mismatches. External HTTPS audio URLs remain supported but are not downloaded or verified. To replace narration, upload a new file and update that translation, preserving content revisions. Old public files remain; orphan cleanup/deletion is not implemented.

For the future React player, resolve the path against the API origin and use it as an `<audio>` source. Full GET, HEAD and `Range: bytes=...` work; valid ranges return 206 for seeking. These recordings are **public immediately, even if the article is a draft**; use only approved public narration. Playback MIME is `audio/mpeg`, with no-sniff and cross-origin resource headers. Only database-registered generated filenames can be served; raw/work directories and unrelated files are inaccessible.

Storage: `AUDIO_DIRECTORY` defaults to `data/narration`; `AUDIO_WORK_DIRECTORY` defaults to `data/narration-work`. Keep them on the same volume for atomic promotion. Successful assets and language/duration metadata are stored in `narration_uploads` and audited. Sources/intermediate files are removed on success or normal failure; database failures also remove the derivative. A process crash can leave temporary/orphan files requiring later maintenance. Back up derivative files and database together.

Errors: 400 missing/extra fields or invalid language, 401 sign-in missing, 403 MFA/permissions/CSRF, 413 file size, 415 extension/MIME/form type, 422 decoding/duration/deadline failure, 429 rate/concurrency limit, 503 decoder unavailable.

## Stripe test APIs

Set test `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` locally. Live keys are rejected. No credentials have been added.

| Method | Route | Purpose |
|---|---|---|
| POST | `/payments/checkout` | Verified signed-in reader + CSRF; `{bookId}`; one digital book per session |
| POST | `/payments/webhook` | Stripe raw-body signature verification, no browser session |
| GET | `/orders` | Own orders |
| GET | `/orders/:id` | Own order detail; other buyers receive 404 |

The server reads price/currency from the live published book. It creates a pending order and snapshots the attached PDF editions/languages/titles before contacting Stripe, then records the Stripe session and returns `checkoutUrl`. Each book purchase includes the PDF language editions attached at that time; this is shown on the book page and Checkout description. Webhooks mark paid only after matching session, amount, currency, order metadata and paid status. Event processing and library grants are transactional and deduplicated. Cancel/expiry/failure never unlocks purchases. Unknown sessions are rejected for retry/reconciliation. A timeout creating checkout may leave a pending order: automated reconciliation is still pending. Confirmation pages cannot change payment or grant access.

## My Library and protected customer downloads (implemented)

| Method | Route (prefix `/api/v1`) | Purpose |
|---|---|---|
| GET | `/library` | Own active purchased PDF editions; `limit`/`offset` pagination |
| POST | `/library/:entitlementId/download-links` | `{}` + CSRF; issue a fresh five-minute download URL |
| GET | `/downloads/:token` | Redeem once, with the same buyer session that issued the link |

Verified email and an active login are required. A cryptographically random opaque token is hashed in the database; it is not a public file path or an entitlement ID. The URL is short-lived, bound to user/session and single-use. Requesting another link for the same edition/session replaces the previous link. Links and private responses use `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. Do not put download URLs into analytics or access logs, or send them to third-party services.

Downloads recheck order ownership, current paid status, entitlement revocation, session validity and file availability immediately before streaming. A response is an `application/pdf` attachment; HEAD is rejected without consuming a link, and Range requests are rejected so a claim cannot be reused for multiple fetches. Interrupted downloads require a new link. Opening a missing file does not spend the link, and missing/size-changed files return a recoverable error. Per-process rate limits apply to link issuance and redemption. Library metadata exposes title/language/page count/size/order ID, never filesystem paths or stored filenames.

`checkout.session.completed` (only when `payment_status=paid`) and `checkout.session.async_payment_succeeded` create one entitlement per snapshotted edition. Changing a book, replacing its attached PDF or unpublishing it afterwards does not replace or remove the purchased edition. The old private file must remain stored. Legacy paid orders with no snapshots require explicit reconciliation; this release never guesses the intended edition from today's content.

Listen for `charge.refunded` as well. Confirmed full refunds set the order to refunded and revoke its entitlements/issued links; late payment events cannot regrant them. Refund-before-payment ordering is recorded by payment intent. Partial refunds retain edition access and mark the order partially refunded. This is the current access rule for review; refund initiation UI, dispute/chargeback handling and an approved public refund policy remain separate work. Already downloaded bytes cannot be recalled.

React routes `/en/library` and `/ur/library`, the account panel and paid order page are connected. The UI requests a fresh link, fetches the PDF with session cookies, then hands it to the browser's download manager. A checkout-return page refreshes pending order status until the webhook confirms it. Stripe test credentials and a signed local webhook are needed for a real test-checkout demonstration; no fake paid/grant endpoint was added.

## Explicit remaining SRS work

This is a working development implementation, **not a production-ready completion of the SRS**. General production startup intentionally fails closed; only the explicitly configured password-protected private-testing profile is allowed for temporary review. A connected local React frontend is available at `http://localhost:5173`; see `../frontend/README.md` for startup and visual testing. The backend API contracts remain independently tested.

- Authenticator replacement/recovery-code regeneration; primary-login account-level/distributed throttling; stronger operational monitoring. Initial admin MFA and single-use recovery sign-in are implemented.
- Production PDF malware scanning/content disarm and storage-provider adapters. Private PDF storage, confirmed-payment entitlements, expiring customer download links, library, public covers and English/Urdu narration are implemented.
- Multi-item cart, guest purchase verification/linking, physical stock/shipping, taxes, refunds, confirmation emails and payment reconciliation.
- Email changes, profile export/deletion/retention jobs, role management and translated mail.
- Newsletter double opt-in/unsubscribe/campaigns and enquiry workflow.
- Scheduled publication, homepage settings and external-media verification. Draft/live separation, preview readiness, publish/unpublish and revision restore are implemented.
- Durable queued email delivery/retries (current direct delivery may fail after signup; use resend-verification to recover).
- Deployment selection, migration strategy, backups/restore checks, HTTPS/proxy setup and audit of the complete frontend/backend flow.

Use a MongoDB replica set (including Atlas) with persistent storage and backups. With `MEDIA_STORAGE=mongodb`, include GridFS `media.files` and `media.chunks` in backups. Local disk mode alone is unsuitable for an ephemeral hosting filesystem. Storage quota management, cache eviction and orphan reconciliation remain operational work before scaling or hosting a large library.
