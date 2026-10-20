# Rentulo V1 / BOD 02 / Stage 2: guarded data-retention implementation

**Scope:** ONLY Supabase TEST project `vspposovhdgvbeukoivh`, rentulo.eu.
**Code base:** `EBBI-SK/rentulo` main after merged PR #31 (`9bb6700`).
**Status:** TEST-only implementation prepared for GitHub review. No SQL has
been executed merely by extracting this ZIP. PROD must not be touched.

## What this ZIP changes

The four new migrations must be applied in the exact filename order below,
AFTER the installed Stage 1 migration `20261020170000`:

1. `20261020170500_bod02_v1_trusted_finalized_timestamps_TEST.sql`
   - Server-controlled timestamps for NEW `returned`/`no_show` reservations
     and NEW transitions of offers to `deleted`.
   - Old records without proven closure time are NOT backfilled.
2. `20261020171000_bod02_v1_guarded_retention_TEST.sql`
   - Locked OFF global gate plus seven independently OFF category approvals;
     a global activation alone can NEVER erase all categories.
   - Aggregate dry-run preview, log of approved
     future executions and a daily pg_cron entry that is a NO-OP while OFF.
   - Covers ordinary in-app notifications (90 days), failed PIN counts
     (30 days after trusted closure), unneeded *sent* legacy email addresses
     (90 days after trusted closure), resolved delivery error text (90 days),
     old delivery provider IDs (12 months), processed Stripe error text
     (180 days), and resolved monitoring alerts (90 days).
   - Never deletes Stripe event IDs, payment/transfer/refund rows, reservation
     history, PIN confirmation timestamps or delivery deduplication keys.
   - Paid/legal-hold situations are excluded from automated maintenance.
3. `20261020172000_bod02_v1_owner_contacts_legal_hold_TEST.sql`
   - Adds legal-hold checks to the existing renter-contact cleanup function.
   - Adds OFF gate, preview and strictly guarded owner/pickup contact cleanup
     for trusted >=90-day closed and fully settled reservations.
   - Replaces the existing reservation immutability trigger FUNCTION with
     a copy preserving prior immutable columns and payment guards, plus a
     tightly scoped owner-contact exception. This is the HIGHEST-RISK DDL in
     the stage: inspect `pg_get_functiondef` and test real transitions in TEST.
   - NEVER removes `owner_name`, amounts, reservation number, legal history,
     transfer or financial audit records.
4. `20261020173000_bod02_v1_deleted_offer_photo_retention_TEST.sql`
   - OFF gate, candidate preview, protected one-photo claim/recheck/finish
     queue for deleted offers whose trusted deletion and all settlements
     are at least 30 days old, with no holds, disputes, open debts or
     shared Storage object.
   - An object may be deleted only by the separate TEST Edge worker below.

`supabase/functions/gdpr-cleanup-offer-photo/index.ts` is a one-photo-per-call
worker. It verifies the TEST URL, a long independent secret stored only in
TEST Supabase Edge Function settings (`RENTULO_GDPR_PHOTO_SECRET`), database
approval, trusted Storage path and last-moment DB conditions. It never uses a
browser-supplied path. **The worker is not deployed by installing this ZIP.**
An operator must separately configure the secret and deploy/test it. Never
copy the secret into source, screenshots, SQL logs or URLs.

`docs/BOD02_GDPR_RETENCNA_POLITIKA_V1.md` records the 16 approved internal
V1 decisions. This is a retention policy, not an instruction to erase
financial and legal evidence automatically.

## Why some records are not physically erased by this stage

- Reservation history with a nominal three-year rule is not blindly deleted:
  its foreign keys connect reservations, payments, incidents and reviews.
  A specific record's legal deadline, settlement and hold must first be
  assessed. There are no 3-year-old V1 reservations as of 20 October 2026.
- Stripe webhook IDs are idempotency protection; they remain even when
  unnecessary processed-error text is removed.
- A review may contain personally identifying free text. Deactivation's
  existing profile cleanup is retained, but identifiability in review text
  must be assessed case by case; blindly removing every review may corrupt
  ratings, while blindly preserving a name would violate the stated purpose.
- Deactivated account cleanup continues through the existing tested flow.
  Photos for owners who delete their accounts are already removed by that
  dedicated flow; the new photo queue handles deletion of individual offers.
- External provider logs and backups cannot be deleted using these SQL tables.
  Their processing/retention is covered by the provider checks in Stage 3.

## Installation / validation protocol (never apply to PROD)

1. Apply the ZIP to a current Stage 1 merged `main` on a new feature branch.
2. Run `npm test`, `npm run build`, `git diff --check`; review the diff.
3. Create PR, verify CI, merge and fast-forward local `main`.
4. Verify Supabase **TEST** project ref and OFF gate from Stage 1. In SQL
   Editor run each migration above in filename order, one at a time, and stop
   immediately on the first error. Do not use automatic DB push to PROD.
5. Run `docs/BOD02_ETAPA2_OVERENIE_TEST.sql`: expect `je_test=true`,
   `trusted_time_columns=2`, `trusted_time_triggers=2`,
   `guarded_internal_tables=6`, `total_retention_categories=7`,
   `enabled_retention_categories=0`, all four cleanup gates `false`, and exactly
   one inactive-until-enabled daily cron job.
6. The aggregate dry-run `gdpr_retention_maintenance(false)` must show
   seven categories and `applied_count=0` for each. Photo preview returns
   only a count. Neither operation changes any personal record.
7. Verify fresh TEST reservation transitions and offer deletion timestamps,
   legitimate payment and refund transitions, and rejected attempts to mutate
   immutable contact snapshots. Verify legal hold prevents eligibility.
8. If an operator later approves an actual TEST execution, use a separately
   documented, per-category authorization AND global control, and verify
   preview before *any* gate is
   changed. Do NOT enable all gates just because EBBI approved the policy.
9. The photo worker is only deployed after explicit separate TEST review.
   With the gate OFF a correctly authenticated invocation returns zero
   claims and must not delete or clear any Storage object.

**Important:** Stage 2 static tests and build cannot prove PostgreSQL trigger
integration or Storage deletion behavior. Stage 2 is not finally validated
until steps 4-9 have been inspected in the real TEST environment. It must
not run on PROD. Stage 3 can be prepared without prematurely enabling any
cleanup gate, and the end-to-end TEST scenarios may be executed together.
