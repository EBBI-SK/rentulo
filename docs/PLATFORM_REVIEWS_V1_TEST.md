# Rentulo V1.0 – Zkušenosti s Rentulem (TEST only)

## Scope: agreed, and nothing else
- Homepage: one compact (about 1.5 cm) review strip near the existing footer with equal small vertical gaps, average/count, latest **published** real review and link. The strip remains **hidden** until at least one real published text exists. No placeholder rating appears on TEST or PROD.
- A dedicated, simple `zkusenosti.html` (no analytical charts) for public reviews and a short in-page form.
- A new platform-only review system. **DO NOT CHANGE the existing peer-review feature in `Historie` or reservation status logic.**
- After a confirmed actual return, add exactly one invitation **per account** to the existing email outbox, due in 24 hours; never for `no_show`, never by SMS. The existing `email_notifications` setting is respected.
- Only authenticated renters/owners with a confirmed completed rental may rate. One review per account, editable. 1–5 stars; comment is optional (max 500 chars). Moderation is based on content standards, **not** on the star rating.

## Files in this ZIP
- `index.html`, `js/home-page.js`: compact homepage strip only.
- `zkusenosti.html`, `css/platform-reviews.css`, `js/platform-reviews.js`: new separate reviews page.
- `js/login-page.js`: tiny safe login-return allowlist entry for `zkusenosti.html?hodnotit=1` (existing login flow unchanged).
- `supabase/migrations/20261112100000_platform_reviews_v1_TEST.sql`: new tables, scoped RPCs, trigger and existing outbox allowlists; hard-guarded to the TEST Supabase project.
- `supabase/functions/_shared/notification-email-policy.mjs`, `supabase/functions/process-reservation-notifications/index.ts`, `supabase/functions/send-reservation-email/index.ts`: add only the optional invitation event to existing transactional email infrastructure.
- `tests/platform-reviews-v1.test.mjs`: targeted verification.
- This file: TEST integration checklist and moderation guidance.

## Workflow (do not touch PROD)
1. Open current source in VS Code and create a **new working branch** from the same commit as the supplied ZIP (suggested name `feat/platform-reviews-v1-test`).
2. Copy only files in this ZIP into the existing repo, preserving directories; inspect `git diff --stat` and verify `historie.html`, `js/history-page.js` and original `reviews` table migrations are untouched.
3. Run `node --test tests/platform-reviews-v1.test.mjs tests/auth-redirects.test.js tests/reservation-email-links.test.js`. Do a page layout check on desktop + mobile.
4. Submit a PR to **TEST** only. Make no changes to PROD.
5. After code approval, apply the **TEST-only SQL migration** to the TEST Supabase environment; it explicitly rejects the production project. Deploy updated `send-reservation-email` and `process-reservation-notifications` Edge Functions to TEST only, using the existing TEST process.
6. Test reading and adding a review with an account that already has a genuinely completed returned rental. It is initially `pending` and cannot be seen publicly until moderated.
7. Test the first fresh booking returned **after activation** and confirm two queued optional emails with `next_attempt_at = gdpr_finalized_at + 24 hours`. At the due time confirm one email to each participant (unless their optional email preference is off). No invitation after `no_show`, or on later returns once invitation has been queued.
8. Approve a test review in Supabase (see below). Confirm the public list and homepage strip show the approved data and updated average/count. Approve and test a low-star review as well to demonstrate neutral moderation.
9. After TEST verification, review the privacy documentation for publishing names/initials and text, and prepare a separately approved PROD migration/deployment. Do **not** reuse the TEST-only migration on PROD.

## Moderation (TEST, using Supabase SQL Editor)
Reviews are saved with `status='pending'`; they are not automatically made public.

View pending records:
```sql
SELECT user_id, rating, comment, display_name, created_at
FROM public.platform_reviews
WHERE status='pending' ORDER BY created_at;
```

Publish a specific reviewed item (replace `<user_uuid>` with a verified user ID):
```sql
UPDATE public.platform_reviews
SET status='published', published_at=clock_timestamp()
WHERE user_id='<user_uuid>'::uuid AND status='pending';
```

Reject only spam, privacy violations or prohibited content, **never because of rating**:
```sql
UPDATE public.platform_reviews
SET status='rejected', published_at=NULL
WHERE user_id='<user_uuid>'::uuid AND status='pending';
```

## Notes / boundaries
- No new paid service, new cron, new navigation section or change to `Historie`.
- Use actual returns, not planned rental end, for the 24-hour delay.
- The email link is not a bearer token. It points to the public review page and after login uses the existing safe return link; the RPC still checks the server-verified completed-rental condition.
- Resend's existing delivery log and stable idempotency key continue to prevent duplicate sends.
- This release is not a claim that real email delivery has already been tested: TEST Supabase deployment and a due event are still required.
