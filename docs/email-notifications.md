# Email notifications

Email notifications are configured in **Notifications**, accessible from the project list and each project's header. Each dashboard account has its own sender; each owned project has separate recipients and rules. New installations default to notifications disabled.

## Configure from the dashboard

1. Enter the sender email, display name, SMTP hostname, port, encryption mode, SMTP username and mailbox authorization code/app password. Enable SMTP with your mailbox provider first.
2. Save the sender. The authorization code is encrypted on the server and never returned to the browser. Leave it blank to keep the saved value. Changing the SMTP hostname, port, encryption mode or username requires entering a new code.
3. Select a project, enter up to 20 recipients (separated by commas or new lines), and save its settings. Recipient settings can be saved before configuring a sender.
4. Click **Send test email**. Tests use the saved sender and recipients and work even while automatic notifications are disabled. Check the delivery history for the result.
5. Enable automatic notifications and choose the rules. Configuration changes take effect without restarting the collector.

Clearing the sender disables notifications for all projects owned by the current account. Sender settings and project rules are isolated between deployment instances.

## Rules and delivery

- **New issue:** first occurrence of a previously unseen issue fingerprint.
- **Regression:** a previously handled issue changes back to `open` after a newly reported event, following the existing release lifecycle rules.
- **Threshold:** an issue's cumulative occurrence count is at least the configured threshold. Set `0` to disable this condition. This is a lifetime count, not an error-rate or rolling-window rule.
- **Interval:** one notification per issue during the interval (default 30 minutes; minimum 1 minute). All trigger types share the interval. Once an issue is above the threshold, a later event after the interval can trigger another notification.
- Only newly reported events trigger alerts after enabling; existing historical issues are not mailed in bulk. Errors and failed HTTP requests are eligible. Performance events and successful requests are not.
- Local development events are retained in the dashboard but never create automatic email jobs or consume the notification interval. This applies to all projects without changing their saved rules: an explicit `development` environment, and Web/H5 pages hosted on `localhost` (including subdomains), IPv4/IPv6 loopback or `0.0.0.0`. The triggering event's page context is used, including older SDK page fields. If a local event first creates or reopens an issue, the corresponding alert condition is deferred until its next eligible occurrence; that email uses the deployed event's context, even with the threshold disabled. Deferred regressions still require an event at or after the recorded fix release; older or missing releases leave that condition pending. Disabling the project or the corresponding trigger clears these deferred conditions.
- Deployed `test`/`production` environments and private-network sites remain eligible. A failed request to a loopback API alone does not establish a local page. Native App/WebView localhost pages and events without a recognizable browser page remain eligible unless they explicitly report a development environment. For local debugging through a LAN IP/custom hostname or native/mini-program tools, configure the SDK's `environment: 'development'` to suppress automatic mail. Test emails are unaffected, and issue counts still include local events.

Notification jobs are saved with the ingested issue transaction in PostgreSQL. SMTP delivery runs separately, so SMTP failures do not fail event collection. One job is processed every two seconds per collector. Pending jobs survive restart. Disabling a project cancels its queued automatic notifications; delivery uses the project's current recipients. An email already being sent cannot be recalled.

History shows the latest 50 messages per project and retains completed records for 90 days in PostgreSQL. `sent` means the SMTP server accepted the message; it does not guarantee inbox delivery. Check spam and mailbox rules. SMTP failures are recorded using safe error codes, without including passwords or raw SMTP responses. Failed messages are not automatically retried. A delivery interrupted by a crash is marked `DELIVERY_UNKNOWN` after five minutes, without automatic resend, to avoid duplicate mail.

Tests are limited to one per account per minute. Use the test button again after correcting a failed configuration.

## Alert content

Alerts include the project, issue, cumulative count, platform, environment, event release/time, latest occurrence time, event/issue IDs and a dashboard link. HTTP alerts also include the request method, **full request URL** (scheme, host, path and query), status, duration and request error. H5/Web alerts include the **full page URL**, including hash routes; native App and mini-program alerts include the **page route**.

Details are snapshotted from the event that triggers the notification, so an issue shared across hosts/pages or an event received out of order does not borrow context from another occurrence. URL user credentials and known authentication query/hash parameters are removed or masked. Request bodies, headers and arbitrary context are not included in email.

Relative browser request URLs are resolved against the reported full page URL. If the SDK did not report a host or page, the message marks the missing data instead of guessing. Existing queued messages keep their saved content. Historical events cannot be backfilled with information that was never collected.

For uni-app native/mini-program routes, use `@health-guard/sdk-uniapp@0.3.1` or later and rebuild/release the client. This fixes the global `getCurrentPages()` API lookup and prefers `$page.fullPath`, with `route`/`__route__` fallbacks. Updating the collector alone cannot add page routes to older installed clients.

## Deployment

Use PostgreSQL for persistent settings and the durable queue. Memory mode is intended for local evaluation and loses settings on restart.

Set `HEALTHGUARD_ENCRYPTION_KEY` to a base64-encoded, random 32-byte secret before saving sender settings. Generate it on the deployment host, for example with `openssl rand -base64 32`, and store it in a restricted environment file. Back it up separately from the database. All collector replicas for one instance must use the same key. Keep it stable across redeploys; replacing it prevents decryption of saved authorization codes. Never put it in a public repository or client-side environment variable. Missing or invalid keys disable sender configuration and delivery.

Optional environment variables:

- `HEALTHGUARD_DASHBOARD_URL`: canonical dashboard URL (including its base path, when applicable), used for project links in alert emails.
- `HEALTHGUARD_ALLOW_PRIVATE_SMTP=true`: allow private-network mail servers for deployments that intentionally use them. The default blocks private/loopback SMTP destinations. Hostnames are resolved and checked before connecting, and the connection uses the checked address.

Supported ports are 465 (implicit TLS), 587 and 25 (STARTTLS). TLS is required, certificates are verified, and authorization codes are encrypted using AES-256-GCM with the account ID as authenticated context. SMTP configuration follows the [Nodemailer SMTP transport documentation](https://nodemailer.com/smtp).

Database tables are created automatically on server startup. Existing users, projects and issues are preserved. When rolling back, retain the encryption key and the additive notification tables (including `notification_local_triggers` for deferred local conditions); an older collector ignores them.

## API / agent operations

All endpoints require a dashboard session bearer token. Agent repair tokens are not accepted. Project endpoints validate ownership and return 404 for inaccessible projects.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/notifications/sender` | Masked sender settings and `encryptionReady` |
| PUT | `/api/notifications/sender` | Save SMTP sender (`host`, `port`, `secure`, `username`, `fromEmail`, `fromName`, optional `password`) |
| DELETE | `/api/notifications/sender` | Remove sender and disable owned project rules |
| GET / PUT | `/api/apps/:appKey/notifications` | Read/save `enabled`, `recipients`, `onNewIssue`, `onRegression`, `threshold`, `cooldownMinutes` |
| POST | `/api/apps/:appKey/notifications/test` | Queue a test to saved recipients; returns 202 with `jobId` |
| GET | `/api/apps/:appKey/notifications/history` | Latest 50 delivery records for the project |

Agents must obtain explicit authorization before sending test emails or enabling real delivery. Do not put authorization codes in prompts, command-line arguments, logs, screenshots or issue notes. Use a protected credential file or let the operator enter them directly on the HTTPS dashboard.

## Validation

`yarn test`, `yarn type-check`, `yarn lint`, and `yarn build` cover the normal project checks. Set `TEST_DATABASE_URL` to an isolated PostgreSQL database to run the notification integration test, which creates and removes its own schema and verifies concurrent ingestion, durable settings, single job claims and interrupted-delivery recovery. Do not target a production database for this test.
