# Urban Aid Report

Urban Aid Report is a focused civic reporting platform for neighborhood waste and drainage problems. Citizens can submit and track garbage collection, illegal dumping, overflowing bins, blocked drains, and waterlogging reports. Authority staff have a protected operations desk for review, assignment, and status updates.

The website interface is available in English and Hindi. The language selector saves the user's choice in the browser and applies it across the public site, citizen dashboard, and authority desk.

## Technology

- Frontend: semantic HTML, CSS, and vanilla JavaScript
- Backend: Node.js and Express
- Data and images: local in-memory demo storage
- Deployment target: Render

## Run locally

1. Install Node.js 18.18 or later.
2. Run `npm install`.
3. (Optional) Copy `.env.example` to `.env` to configure email notifications.
4. Run `npm start` and visit `http://localhost:3000`.

For development with server restarts, run `npm run dev`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port. Render provides this automatically. |
| `NODE_ENV` | No | Set to `production` on Render. |
| `ALLOWED_ORIGINS` | No | Comma-separated origins if the frontend is hosted separately. |
| `FALSE_REPORT_POINT_DEDUCTION` | No | Points deducted for each authority-confirmed case 3–5; defaults to 25 and cannot reduce a wallet below zero. |
| `SMTP_HOST` | No | SMTP server; defaults to Gmail's `smtp.gmail.com`. |
| `SMTP_PORT` | No | Gmail implicit-TLS port; this SMTP implementation requires `465`. |
| `SMTP_TLS_CA_FILE` | No | Optional PEM CA file used only when an approved network TLS inspection certificate must be trusted. Leave blank for direct Gmail SMTP. |
| `SMTP_USER` | No | Authority sender mailbox; configured locally as `urbanaidreport@gmail.com`. |
| `SMTP_APP_PASSWORD` | No | Gmail App Password stored only in the server environment. Never use or commit the account login password. |
| `EMAIL_FROM` | No | Sender label and mailbox shown to citizens. |

## False-report review workflow

Only an authenticated authority can record a false-report finding. The authority must enter a specific reason and evidence summary and attest that the finding is intentional. A duplicate, honest mistake, or an issue that staff could not locate does not alone establish intentional false reporting. The account-level count is visible in the citizen report history and authority case view. Cases 1 and 2 generate a warning email. Cases 3, 4, and 5 deduct the configured points for each finding, up to the citizen's available balance. Case 6 and later block the account from submitting new reports. Sign-in and read access remain available so the citizen can review the record and appeal. Repeat sanctions require a stable authenticated account; unauthenticated or unverified-email reports do not accumulate the count. Authority report updates, false-report decisions, and appeal decisions send an automatic email to the citizen. If delivery fails or email is not configured, the authority action remains recorded; configure SMTP and retry warning emails from the authority view where available.

For Gmail delivery, enable 2-Step Verification on the sender account, create an App Password in Google Account security settings, and set it as `SMTP_APP_PASSWORD` in the server's ignored `.env` file or deployment secret settings. Do not use the regular Gmail sign-in password. Email is sent directly through Gmail SMTP over TLS; the app password is never sent to the browser.

The server prints a sanitized SMTP configuration summary at startup; it never prints credentials. Delivery diagnostics distinguish TLS, authentication, DNS, timeout, connection, and SMTP rejection errors. A message is recorded as sent only after Gmail accepts the SMTP message data. The configured Gmail mode is implicit TLS on port 465.

To verify SMTP network access and Gmail authentication without sending an email, stop the server and run `npm run email:verify` from the project folder. It prints only the SMTP host/port and a sanitized result; it does not print the username, app password, or recipient.

If email reports `self-signed certificate in certificate chain`, the current network or security software is presenting a TLS certificate chain Node.js does not trust. This occurs before Gmail checks the app password, so changing the password will not fix that TLS handshake. Ask the network administrator for the trusted root CA in PEM format, place the public certificate in a protected local file, set `SMTP_TLS_CA_FILE` to its path, and restart the server. The setting adds that CA alongside Node's regular roots; certificate and hostname validation remain enabled. Do not disable certificate verification or trust a certificate from an unknown source. A mobile-hotspot test can help establish whether the ordinary network is intercepting SMTP, but does not itself fix the network configuration.

Citizens see the authority's finding in their own report history and can submit one appeal, including while reporting is blocked. The authority must record a review note when accepting or upholding it. Accepting an appeal restores deducted points and returns the report to review; accepted findings no longer count toward the account threshold, and the reporting restriction clears when five or fewer confirmed cases remain. The appeal and point transactions remain auditable in the case record and wallet history.

The app currently runs in local demo mode and does not connect to Supabase. Reports, wallets, sanctions, and uploaded image previews are held in memory and reset when the server restarts; demo user accounts are stored in the ignored `.mock_users.json` file. Do not use this mode for production or real citizen data. Supabase migration files are retained in the repository but are not executed by the app.

## API summary

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Local demo service health. |
| `POST` | `/api/auth/signup` | Create a local demo citizen account. |
| `POST` | `/api/auth/login` | Password login with server-side role verification. |
| `GET` | `/api/auth/oauth/:provider` | Start Google, Facebook, or Apple OAuth. |
| `GET` | `/api/auth/session` | Return the current signed-in user. |
| `POST` | `/api/auth/logout` | Clear the current browser session. |
| `POST` | `/api/reports` | Authenticated citizens submit a multipart report with optional `image`; blocked accounts cannot submit. |
| `GET` | `/api/reports/mine` | Reports linked to the authenticated citizen account. |
| `GET` | `/api/reports?reporter_email=` | Citizen report tracker. |
| `GET` | `/api/reports/:id` | Public report detail without reporter contact data. |
| `GET` | `/api/reports/admin/all` | Authority report list; requires an authenticated Authority session. |
| `PATCH` | `/api/reports/:id` | Authority final category/severity, status, priority, assignment, and update; requires an authenticated Authority session. Selecting Rejected requires a reason, evidence summary, and explicit authority confirmation. |
| `POST` | `/api/reports/:id/false-report` | Backward-compatible authority decision endpoint; uses the same evidence-backed validation and sanction logic as Rejected status. |
| `POST` | `/api/reports/:id/false-report-warning-email/retry` | Authority retries a failed or unconfigured case 1–2 warning email. |
| `POST` | `/api/reports/:id/false-report-appeal` | Reporting citizen submits one appeal. |
| `POST` | `/api/reports/:id/false-report-appeal/review` | Authority accepts or upholds a pending appeal with a review note. |

Images are accepted only as genuine JPG, PNG, or WebP files up to 5 MB; the server checks both the declared type and file signature. Demo image previews are held in memory. Public tracking responses omit the reporter's name, email, and phone. Report-history list endpoints require the authenticated account and cannot be queried by another resident's email. New references use a 16-character random suffix; keep the reference private and share it only with people you trust.

## Deploy to Render

Create a new **Web Service** from this repository (demo mode only; data will not persist across restarts):

- Build command: `npm install`
- Start command: `npm start`
- Add SMTP environment variables only if email notifications are needed.

`render.yaml` contains the same service definition for Blueprint-based setup.

The Express server serves the entire frontend and listens on `process.env.PORT`, so no `localhost` URL is embedded in the app.

## Authentication and OAuth setup

Citizen accounts can be created from the login screen with email/password. The local demo server creates HTTP-only session cookies. Demo mode includes `admin@city.gov` / `password123` as an authority test account; do not use demo credentials in production.

Social login is unavailable in local demo mode. Public signup creates citizen accounts; use the seeded demo authority account for local UI review. Signed-in citizens see reports associated with their account automatically; reporter contact fields remain absent from public responses.
