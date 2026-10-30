# Temporary free Render deployment

Status: deployment files prepared locally. This document does not mean a service is live.

The single **Free** Docker web service in `render.yaml` serves the React build and Node API on one HTTPS origin. MongoDB Atlas stores application records and durable uploads using GridFS. No paid disk, SQL database or paid service is declared. `NODE_ENV=production` enables Secure cookies; the explicit `private-testing` mode requires an outer password gate, a stable MFA key, HTTPS email and durable uploads. General production launch remains blocked.

## 1. Accounts and source

Create a free Render account and connect your GitHub account. Put this project in a **private GitHub repository**. Include `Dockerfile`, `.dockerignore`, `render.yaml`, `backend/src`, both package/lock files and frontend source. Exclude `.env`, `backend/data`, `backend/tools`, `backups`, logs and generated documents. The supplied ignore files exclude local secrets from the container build. Never upload the local `.env` to GitHub.

## 2. MongoDB Atlas

Fix and verify the existing Atlas database-user credentials locally with `npm.cmd run check:mongodb` from `backend`. Do not paste the URI into chat. Give the deployment user read/write access to `dr_manzar_testing`. Use this separate database for testing. In Atlas Network Access add the outbound IP ranges shown in your Render service's **Connect > Outbound** panel, plus your own IP if you will bootstrap the owner locally. Do not add unrestricted network access as a default.

GridFS bytes, records and indexes **share** Atlas Free's approximately 512 MB allowance. Use a few small sample books/audio recordings. This setup is unsuitable for a large library. Render's free disk is only a disposable cache/work area; files uploaded through the configured API are first persisted to GridFS. Existing local media is not automatically uploaded. Back up MongoDB records and the `media.files` / `media.chunks` collections together.

## 3. HTTPS email

Create a Resend free account, configure an allowed sender and create a sending API key. Put that key directly in Render's secret environment settings. Resend's default test sender can send only to the permitted account email; use your own verified sending domain to test registration for other recipients. A domain purchase is not required for testing with your own allowed email address. Render Free blocks standard SMTP ports, so this deployment uses the HTTPS email API.

## 4. Deploy the blueprint

In Render select **New > Blueprint**, connect the private repository and select this root `render.yaml`. Confirm the instance type is **Free** and no disk is attached. Provide these prompted secrets:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Your private Atlas connection string with correctly encoded credentials |
| `MFA_ENCRYPTION_KEY` | Stable 64-character hexadecimal key, stored privately; reuse an existing key if reusing accounts with enrolled MFA |
| `TEST_ACCESS_USER` | Outer testing username, 3–64 letters/numbers/underscores/hyphens |
| `TEST_ACCESS_PASSWORD` | Unique random testing password of at least 20 characters |
| `RESEND_API_KEY` | Sending API key |
| `MAIL_FROM` | Sender address permitted by Resend |

Generate a new MFA key locally only for a new testing database: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it out of source control and do not rotate it while enrolled accounts depend on it. Generate the outer password with a password manager. Share testing access privately.

The service automatically uses Render's `RENDER_EXTERNAL_URL` for its origin. If using a custom domain, set `APP_ORIGIN` to its exact HTTPS origin without a trailing slash. The Docker image listens on `0.0.0.0` and respects `PORT`. Render checks `/healthz`, which reveals only readiness, not credentials or records. The image uses the operating system's FFmpeg rather than the Windows development binary.

## 5. Owner bootstrap (Free Render has no service shell)

Create a private local `backend/.env.render.local` with the **same testing** Mongo URI, database and MFA key. Include the same deployment variables from above, plus `NODE_ENV=production`, `DEPLOYMENT_MODE=private-testing`, `MEDIA_STORAGE=mongodb`, `MAIL_MODE=resend`, and `APP_ORIGIN=https://your-actual-service.onrender.com`. Then run from `backend`:

```powershell
node --env-file=.env.render.local src/create-admin.js
```

Enter the owner details in the interactive prompts. Sign in online and enroll an authenticator. Never set a default owner password in the Docker image, build command or blueprint. Local owner creation uses the Atlas IP allowlist for your machine.

## 6. Review the running website

1. Open the actual Render URL and enter the outer testing credentials. Open both `/en` and `/ur`; refresh nested routes.
2. Register with an allowed email, verify the link, sign in, sign out and reset the password. Session cookies must be Secure, HttpOnly and SameSite=Lax.
3. Sign in as owner with MFA. Upload small sample cover, narration and PDF; publish bilingual content.
4. Restart the service and confirm the media still loads through MongoDB. Do not put real paid editions in a temporary demo.
5. Optionally set **test-only** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Render. The webhook URL is `/api/v1/payments/webhook`. Only this signed endpoint bypasses the outer password gate; normal account/CSRF/MFA and purchase permissions remain enforced. Test checkout, confirmed webhook, library downloads and full refunds. Live Stripe keys are rejected.

Render Free sleeps when idle, so the first request can be slow. It has usage limits and no uptime guarantee. Do not add keep-awake traffic. Media processing is bounded but large files can exceed the free instance's memory; use small samples. Rate limits currently share the reverse proxy address because broad proxy trust is intentionally disabled; suitable for a small private review, not load testing. Keep the reviewer group small and payments in test mode.

## Shut down and remove temporary data

Delete the testing Render service when finished. Separately back up or delete `dr_manzar_testing` in Atlas and revoke unused email keys. Deleting Render does not delete Atlas records or stored books. Keep any database/user used by other projects intact.

References: [Render Free](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec), [Render default environment](https://render.com/docs/environment-variables), [Atlas limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [GridFS](https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/), [Resend send email](https://resend.com/docs/api-reference/emails/send-email).
