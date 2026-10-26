# Rentulo V1 - BOD 02 GDPR contact snapshots (TEST only)

**Baseline:** `EBBI-SK/rentulo` `main`, merge `9c76c0a` (PR #26).
**State:** Proposal for TEST review. The retention schedule and legal basis for
removing archived contacts have **not** yet been approved. No PROD changes.

## Verified TEST observations (20 October 2026)

- 2 deactivated profiles.
- 4 archived reservations with nonempty renter name, email and phone.
- Reservation status: 2 `cancelled` without payment rows, 2 `expired`, one of
  which has a Stripe payment row in `pending` state (`refund_status=not_requested`,
  `transfer_status=not_created`). Pending must not be treated as successful.
- 6 historical `reservation_email_deliveries` records contain `recipient_email`.
- `trg_protect_reservation_immutable_fields` protects renter contact snapshots.
- No irreversible cleanup of any of these records has been authorized.

## Patch contents

1. `supabase/migrations/20261020120000_bod02_gdpr_reservation_contacts_gate_TEST.sql`
   - Refuses non-TEST databases via existing Vault project identity guard.
   - Checks that the expected reservation immutability protection exists.
   - Creates an approval gate in the **disabled** state. No API role can update it.
   - Preserves all original immutable-field guards; adds a narrow exception only
     for blanking all three renter contact fields on an eligible reservation.
   - Adds a trusted-only function `gdpr_review_deactivated_renter_contacts`.
     Its default mode (`p_apply=false`) only returns aggregate counts. Its
     apply mode is blocked until the approval gate is explicitly activated by
     a privileged operator *after* documented legal approval.
   - Does not update existing reservation rows when the migration is installed.
   - Does not update any payment, refund, email/SMS, owner, offer or profile row.
2. `tests/bod02-gdpr-reservation-contacts-gate.test.js` - static regression
   checks of TEST protection, gate, target scope and unchanged history.
3. `docs/BOD02_GDPR_CONTACT_SCRUB_TEST.md` - this implementation note.

## Eligible and excluded reservations

Eligible only after later written retention approval: deactivated renter; closed
`cancelled`, `expired` or `rejected` reservation; at least one nonempty renter
contact snapshot; **no payment row**, no paid-refund cancellation and no
return incident. Renter contact snapshots are replaced with empty strings.
Reservation number, state, prices, dates, Stripe fields and other party data
remain untouched. This is intentionally conservative: even a `pending` Stripe
payment row blocks the operation until separately reviewed.

Legacy `reservation_email_deliveries.recipient_email` is **counted only**. Six
addresses need a separate justified retention decision; delivery evidence can
be relevant to disputes. Do not delete or redact these records yet.

The cleanup helper is **not automatically called** when an account is closed.
Automating future deactivations requires separate retention approval and review.

## Safe local validation before any deployment

On the existing local `main` checkout, place the three new files at their
paths and run:

```bash
npm test
npm run build
```

Review the diff, work on a separate TEST-only branch, commit and push only after
approval. Do not merge or deploy as part of this file handoff.

## Safe later TEST rollout (separate permission required)

1. Confirm Supabase **TEST** identity and the live guard definition before
   executing the migration. Apply it only after successful CI and separate user
   approval of a TEST SQL install. The SQL installs *no data cleanup*.
2. Verify `public.gdpr_reservation_contact_cleanup_gate.is_enabled` is `false`.
3. Inspect preview counts for each deactivated renter in trusted SQL Editor,
   without `p_apply=true`. Do not expose UUIDs or personal data in screenshots.
4. Verify normal edits cannot modify immutable reservation contacts. Test the
   failed apply path while the gate is disabled in a **rolled-back transaction**.
5. Seek the retention approval and classify pending Stripe payments, unresolved
   claims and email delivery proof. Only then discuss enabling the gate and
   applying a separately approved operation. There is no automatic cleanup.
6. A distinct production review and migration will be required eventually.

**Important:** These are structural/unit-test checks, not a claim of a successful
Supabase database integration test. The pre-existing 611 passing tests were
reported before this ZIP; they must be rerun with the new files.
