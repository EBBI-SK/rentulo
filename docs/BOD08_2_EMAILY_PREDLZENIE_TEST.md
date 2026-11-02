# Rentulo BOD 8.2 - Emails after reservation-extension outcomes (TEST only)

## Confirmed baseline - do not resend old mail

For R-000048 the old booking emails were already queued as `sent` on 2026-10-31:
`new_request`, `approved`, `paid`. On 2026-11-02 `picked_up` reached the
renter's Websupport mailbox and `extension_requested` reached the owner's
Gmail mailbox. The extension approval was shown in the app but had no email
outbox entry. The original booking events are NOT changed or resent.

## New events

- `extension_approved`: renter; additional CZK amount, new requested return
  date, real payment deadline, link to My reservations. The email makes clear
  that the extension is not effective until payment succeeds.
- `extension_rejected`: renter; original return date, link to My reservations.
- `extension_paid`: renter AND owner; verified paid state and Stripe evidence,
  additional CZK amount, confirmed new return date, participant-specific link.
- `extension_expired`: renter; original return date, link to My reservations.

The existing `extension_requested` owner email is preserved. All new types
are **essential emails** in Czech, Slovak, English, German and Polish.
SMS remains untouched. The SQL trigger queues emails only upon a real status
transition; the existing outbox/worker/Resend handles sending and retries.
Unique indexes from BOD 8.1 deduplicate by extension ID + event + recipient.
The sender also checks the claimed delivery, the correct reservation,
extension ID, recipient, state, action deadline and paid evidence.

## Install order - only after PR approval and local pull

1. From a clean feature branch on the user PC, place only the changed files.
   Run `npm test`, inspect `git diff --check` and create a PR to `main`.
   Merge only after all required CI and checks succeed, then pull `main`.
2. In **Supabase TEST SQL Editor only**, run the complete migration
   `supabase/migrations/20261102160000_bod8_2_extension_outcome_emails_TEST.sql`.
   It checks the TEST project URL in Vault and is transactional.
   Expected SQL Editor result: `Success. No rows returned`.
3. Only after the TEST migration succeeds, deploy to Supabase **TEST only**:

   ```powershell
   npx supabase functions deploy send-reservation-email --project-ref vspposovhdgvbeukoivh --use-api
   npx supabase functions deploy process-reservation-notifications --project-ref vspposovhdgvbeukoivh --no-verify-jwt --use-api
   ```

   The second command keeps the existing worker's known no-JWT Cron mode.
   NEVER deploy the new migration to the PROD project.
4. Optional: to queue the ONE **already-approved** R-000048 email that the
   old code omitted, and only while its payment deadline is still active,
   run `docs/sql/BOD08_2_BACKFILL_R000048_TEST.sql` in TEST SQL Editor.
   This explicitly targeted, idempotent SQL queues at most one email to its
   renter. It neither approves a new extension nor charges a card. If the
   reservation has already been paid, closed or expired, it queues nothing.
5. Check the outbox after the existing minute worker has processed it:

   ```sql
   SELECT
     r.reservation_number, d.event_type, d.channel, d.status,
     d.attempt_count, d.last_error, d.created_at, d.sent_at
   FROM public.reservation_notification_deliveries d
   JOIN public.reservations r ON r.id = d.reservation_id
   WHERE r.reservation_number = 'R-000048' AND d.channel = 'email'
   ORDER BY d.created_at;
   ```

   `sent` denotes provider-accepted sending, not guaranteed mailbox delivery.
   Check delivery in the corresponding mailbox. Never modify delivery statuses
   to force a second send.

## Testing constraints / production safety

- Do not create another test reservation, do not send an extra payment or
  force a settled dispute merely to test emails.
- Use unit tests for rejection/expiry and paid confirmation without touching
  real reservation state. R-000048 remains approved awaiting its top-up.
- This ZIP contains source files only: no API keys, contacts, CSV exports,
  screenshots, customer data or PROD migration.
- Run the database migration BEFORE deploying sender/worker to TEST, because
  the new event-type constraints and extension-specific outbox references must
  exist first. Existing PROD sender stays backward compatible with old booking
  events, but no extension outcome emails are enabled in PROD.
