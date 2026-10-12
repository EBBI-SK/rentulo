# BOD 12 – Reservation expiration (TEST-first)

This patch is based on `main` commit `e68ed19` (with BOD 12/P1-1 notification hardening).
**Never deploy to PROD without a separately approved production rollout.**

## Policy

- New `pending`: owner must respond within 24 hours after creation.
- On `pending -> approved`, renter gets a **new** 24-hour payment window.
- Each deadline ends **no later than the scheduled Europe/Prague pickup instant**.
- `paid`, `picked_up`, `returned`: no automatic expiry.
- A previously existing TEST `pending`/`approved` reservation with `expires_at IS NULL` is grandfathered; the migration **does not backfill or cancel old rows**. If such a pending request is subsequently approved, its new payment window applies.
- A `pending` or `approved` reservation marked `expired` no longer blocks the calendar. Its history preserves a clear `expiry_reason` (`owner_no_response` or `payment_timeout`). This is **not** an ordinary cancellation and creates **no** cancellation fee, refund, or owner debt.
- Reminders are queued once at up to four hours before the deadline; the existing email outbox delivers them. Both parties receive expiration emails. No new SMS event is enabled.

## Stripe safety invariant

A reservation with a payment may expire **only after Stripe explicitly confirms its matching Checkout Session is `expired` and `unpaid`**, and any attached PaymentIntent is confirmed `canceled`. An open Checkout Session is first asked to expire via Stripe. A `complete`, `processing`, inaccessible, inconsistent, or unknown Checkout never unlocks the date.

`create-checkout-session` durably records its claim **before** the provider call and clears `checkout_inflight_started_at` only after the known Checkout Session ID is saved. An in-flight or ambiguously terminated provider call blocks automatic expiration, even if a previous Checkout Session was already expired. The final database status change rechecks reservation, deadline, provider ID, in-flight flag, and payment state atomically. The Stripe webhook still uses its original payment/row locks and can finish a valid completed payment.

The fail-closed state is visible in the service-role-only table `public.reservation_expiration_issues`; no auto-release is attempted until safe.

## Recommended TEST installation order (manual, one step at a time)

1. Check the ZIP against `e68ed19` and run all tests. Commit/push to `main`; wait for successful GitHub CI.
2. In **Supabase TEST** (`vspposovhdgvbeukoivh`) run `20261012170000_add_expired_reservation_status.sql` **ALONE** (PostgreSQL enum value must commit before use).
3. Run `20261012171000_reservation_expiration_policy.sql` **ALONE**. The transaction includes all tables, guards, RPCs, outbox constraints and user reader changes.
4. Deploy **TEST** `create-checkout-session`, `send-reservation-email`, and `process-reservation-notifications` from the patch. Do not deploy only the newer worker without the matching database migration.
5. Deploy **TEST** new `expire-reservations` Edge Function. In its **Settings**, disable Supabase's gateway **Verify JWT** for this specific function: the scheduled `pg_net` request has no user JWT and is authenticated by the independent Vault Cron secret checked server-side before any database work. Keep JWT verification unchanged for every other function. Check its logs and `verify_reservation_notification_cron_secret` operation.
6. Only **after** the above is verified, run `20261012172000_schedule_reservation_expiration.sql` in **TEST** to enable the `*/5` Cron. It reuses the existing Vault TEST project URL and independent Cron secret. It cannot run at all while the URL is not configured.
7. Verify user pages on `rentulo.eu` and all five languages. **Do not touch PROD.**

> The SQL Editor may label the *branch* `main (PRODUCTION)` even in the separate TEST project. Verify the Supabase **project ID**, not that branch badge.

## Read-only TEST inspection

```sql
select reservation_number, status, expires_at, approved_at, expired_at, expiry_reason
from public.reservations
where expires_at is not null
order by created_at desc limit 20;

select reservation_id, reason, attempt_count, last_checked_at
from public.reservation_expiration_issues
order by last_checked_at desc;

select event_type, channel, status, count(*)
from public.reservation_notification_deliveries
where event_type like 'expiry_%' or event_type like 'expired_%'
group by event_type, channel, status
order by event_type, channel, status;

select jobname, schedule, active
from cron.job
where jobname = 'rentulo-expire-unpaid-reservations-every-5-minutes';
```

## Acceptance tests (TEST only)

1. Create a new TEST reservation; check `expires_at`, that no second overlapping reservation is allowed, and that the owner sees a localized deadline.
2. Approve it; check `approved_at` and newly calculated `expires_at`. Both dates remain visible to the correct user. No arbitrary owner SQL update may extend the deadline.
3. Check that the owner cannot approve after the deadline and the renter cannot begin a new Stripe Checkout after the payment deadline (including before Cron actually runs).
4. Test the worker without a payment and with an expired, unpaid Stripe Sandbox Checkout. Expect `expired` and the date freed once, with both parties receiving email.
5. Test a completed / pending / ambiguous Stripe Sandbox payment. Expect the date **not** to be released; inspect `reservation_expiration_issues`. An unknown provider outcome needs manual investigation, not a retry with guessed state.
6. Confirm reminder deduplication and no SMS for these new events, all five languages, and that normal payment/webhook/pickup/refund flows remain unchanged.

**Avoid changing live reservation deadlines manually in SQL just to force the test.** Prefer a fresh sandbox reservation whose pickup instant is soon enough for a natural test; never test on PROD data.
