# Rentulo - BOD 8.6 - Customer and technical email sender roles (TEST only)

Status: source changes + local tests prepared; deployment to Supabase TEST requires
explicit staged verification. **Nothing in this change deploys to PROD.**

## Fixed sender policy

| Flow | From | Reply-To | Destination |
| --- | --- | --- | --- |
| Supabase Auth signup, password reset, email changes, other Auth mail | `Rentulo <rentulo@rentulo.com>` | `rentulo@rentulo.com` | Auth user |
| Reservation status / extension notifications | `Rentulo <rentulo@rentulo.com>` | `rentulo@rentulo.com` | Reservation participant |
| Overdue owner-debt reminders | `Rentulo <rentulo@rentulo.com>` | `rentulo@rentulo.com` | Owner |
| TEST notification monitoring alerts | `Rentulo Monitoring <support@rentulo.com>` | `support@rentulo.com` | `support@rentulo.com` |
| GDPR / privacy contact | `policy@rentulo.com` | unchanged | unchanged |

The sender addresses are intentionally fixed in the four mail-sending Edge
Functions. No shared `EMAIL_FROM` lookup is used in the four senders: one secret
can no longer accidentally turn customer emails into technical ones (or vice
versa). The existing `EMAIL_FROM` secret can remain untouched as a legacy value,
but must not be treated as a control for these senders. No new secrets are needed.

The source was audited for all direct `https://api.resend.com/emails` calls. The
regression test also enumerates every such call and fails if a future sender is
added without an explicitly reviewed role.

## Separate Supabase Auth SMTP sender (important rollback requirement)

The Auth Send Email Hook, currently enabled in TEST, uses `send-auth-email`.
**When enabled it bypasses SMTP. When disabled, Auth falls back to configured
SMTP, provided Email Provider is enabled.** Changing the Edge Function alone
will not change the Auth SMTP From address.

In **TEST** open Authentication -> Emails -> SMTP Settings. Inspect without
revealing credentials:

- Custom SMTP enabled, host `smtp.resend.com`, port and credentials still valid.
- Sender email address: `rentulo@rentulo.com`.
- Sender name: `Rentulo`.
- Do not change or clear the SMTP password, provider, or mail rate limits.
- If SMTP settings are incomplete, repair and independently test the fallback
  before relying on hook disable as a rollback. Do not assume SMTP survived a
  hook configuration change. Never share SMTP secrets or reset tokens in chat.

The verified `rentulo.com` domain is required in the Resend account. Confirm
that the `rentulo@rentulo.com` mailbox receives external replies. This is
independent of sender-domain verification.

## Safe TEST deployment, one step at a time

1. Git feature branch -> install only changed files -> `npm test` -> staged diff
   check -> commit -> PR -> CI -> merge -> local `git pull --ff-only origin main`.
2. Verify Resend domain and the SMTP fallback configuration described above.
   Keep the Send Email Hook enabled while making a sender change; do not
   accidentally reset SMTP credentials.
3. Deploy only the Auth sender change to **TEST**:
   `npx supabase functions deploy send-auth-email --project-ref vspposovhdgvbeukoivh --no-verify-jwt --use-api`.
   Immediately request one password recovery email using a TEST account.
   Verify sender and Reply-To are **both** `rentulo@rentulo.com`, status
   `Delivered` in Resend, and the verification link opens the correct page.
4. Deploy reservation mail to TEST:
   `npx supabase functions deploy send-reservation-email --project-ref vspposovhdgvbeukoivh --use-api`.
   Confirm real sends on the next safe normal booking action; do not create
   unnecessary paid bookings or backfill completed notifications.
5. Deploy overdue-debt reminders to TEST:
   `npx supabase functions deploy send-overdue-owner-debt-reminders --project-ref vspposovhdgvbeukoivh --no-verify-jwt --use-api`.
   Do **not** manufacture debts or manually invoke the cron for sender testing.
6. Deploy technical monitor to TEST only:
   `npx supabase functions deploy monitor-reservation-notifications --project-ref vspposovhdgvbeukoivh --no-verify-jwt --use-api`.
   Verify existing cron-job.org monitoring remains healthy; next natural alert
   must have technical From, To and Reply-To set to support. Do not deploy this
   TEST-only function to PROD.
7. Verify two-way customer reply handling using a safe TEST email and confirm
   the actual inbox receives it. Verify the sign-up and secure email-change
   flows separately without exposing verification tokens.

### Failure / rollback

- If Auth send fails, check the Edge Function logs and Resend status immediately.
  Disable the Auth Hook **only when a working SMTP fallback has been verified**.
- If the newly deployed reservation or reminder sender fails, stop further
  deployments and restore the previous vetted function version from Git
  rather than altering payment/reservation data or retrying blind.
- If monitoring fails, redeploy its previously vetted TEST-only version and
  inspect cron-job.org; do not create a second monitor job.
- Never rotate or expose `RESEND_API_KEY` or `SEND_EMAIL_HOOK_SECRET` to change
  a sender address. Never modify production Supabase `tfvgxrdjrpicgtvovehl`,
  production Stripe, live SMS, or DNS in this change.

### Source-only scope

No database migrations, reservations, account changes, emails, Stripe charges,
DNS or cron schedules are created by this ZIP. Automated tests validate
sender-policy separation but cannot prove inbox delivery or SMTP fallback.
QA is complete only after the staged TEST checks above.
