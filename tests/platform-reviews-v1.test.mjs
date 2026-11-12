import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { shouldDeliverReservationEmail } from '../supabase/functions/_shared/notification-email-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261112100000_platform_reviews_v1_TEST.sql');
const sender = read('supabase/functions/send-reservation-email/index.ts');
const worker = read('supabase/functions/process-reservation-notifications/index.ts');
const home = read('index.html');
const page = read('zkusenosti.html');
const form = read('js/platform-reviews.js');

 test('reviews migration is TEST-only and leaves peer reviews/History untouched', () => {
  assert.match(migration, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(migration, /TEST-only; PROD requires a separately approved release/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_reviews/);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|UPDATE|INSERT INTO)\s+(?:TABLE\s+)?public\.reviews\b/i);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION.*save_review/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.platform_reviews FROM PUBLIC, anon, authenticated/);
});

 test('invitation needs a verified return and is scheduled exactly 24 hours later, once per account', () => {
  assert.match(migration, /OLD\.status::text <> 'picked_up' OR NEW\.status::text <> 'returned'/);
  assert.match(migration, /NEW\.gdpr_finalized_at \+ INTERVAL '24 hours'/);
  assert.match(migration, /reservation_one_platform_review_invitation_per_account/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /NEW\.gdpr_finalized_at < v_activated_at/);
  assert.match(sender, /isPlatformReviewInvite && !isWorkerDelivery/);
  assert.match(sender, /finalized \+ 24 \* 60 \* 60 \* 1000/);
  assert.match(sender, /verifiedReturn\.status !== "returned"/);
  assert.match(sender, /\.select\("status, gdpr_finalized_at"\)/);
  assert.match(worker, /platform_review_invite/);
});

 test('review invitation respects customer email opt-out and never uses SMS', () => {
  assert.equal(shouldDeliverReservationEmail('platform_review_invite', 'user@example.com', false), false);
  assert.equal(shouldDeliverReservationEmail('platform_review_invite', 'user@example.com', true), true);
  assert.equal(shouldDeliverReservationEmail('platform_review_invite', null, true), false);
  assert.match(migration, /'platform_review_invite', 'email'/);
  assert.doesNotMatch(migration, /'platform_review_invite', 'sms'/);
});

 test('public summaries only use moderated reviews and full names/user IDs are private', () => {
  assert.match(migration, /WHERE status = 'published'/);
  assert.match(migration, /AND comment <> ''/);
  assert.match(migration, /user_id uuid PRIMARY KEY/);
  assert.match(migration, /public\.platform_review_is_eligible\(v_user\)/);
  assert.match(migration, /p\.full_name/);
  assert.match(migration, /left\(v_parts\[2\], 1\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_platform_review\(integer, text\) TO authenticated/);
});

 test('homepage uses only a hidden, compact review strip until authentic data exists', () => {
  assert.match(home, /id="homePlatformReviews"[^>]*hidden/);
  assert.match(home, /home-platform-reviews\[hidden\]/);
  assert.match(home, /href="zkusenosti\.html"/);
  assert.match(read('js/home-page.js'), /if \(!Number\.isInteger\(count\) \|\| count <= 0/);
  assert.match(read('js/home-page.js'), /\.textContent = name/);
});

 test('review page is simple, five languages, and user text is never rendered as HTML', () => {
  assert.match(page, /id="platformReviewsForm"/);
  assert.match(page, /maxlength="500"/);
  assert.doesNotMatch(page, /chart|histogram|analytics|filter/i);
  for (const language of ['cs', 'sk', 'en', 'de', 'pl']) {
    assert.match(form, new RegExp(`\\b${language}: \\{`));
  }
  assert.match(form, /comment\.textContent = String\(review\.comment/);
  assert.match(form, /platformReviewsClient\.rpc\("submit_platform_review"/);
  assert.match(form, /window\.location\.assign\(platformReviewLoginUrl\(\)\)/);
});

 test('email routes to verified account login and then right back to the new review page', () => {
  const login = read('js/login-page.js');
  assert.match(sender, /\/zkusenosti\.html\?hodnotit=1/);
  assert.match(login, /case "zkusenosti\.html":/);
  assert.match(login, /returnUrl\.searchParams\.get\("hodnotit"\) === "1"/);
  assert.match(sender, /platformReviewEmailCopy: Record<SupportedLanguage/);
});

test('summary stars match the public average, including partial stars', () => {
  const css = read('css/platform-reviews.css');
  assert.match(css, /\.platform-reviews-summary-star-fill\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(form, /platformReviewRenderSummaryStars\(avg\)/);
  const source = form.match(/^function platformReviewRenderSummaryStars\(average\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(source, 'Expected the public-average star renderer');

  function render(average) {
    const host = {
      children: [],
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    };
    const mockDocument = {
      querySelector(selector) {
        assert.equal(selector, '.platform-reviews-summary-stars');
        return host;
      },
      createElement(tag) {
        assert.equal(tag, 'span');
        return {
          textContent: '', className: '', style: {}, children: [],
          appendChild(child) { this.children.push(child); }
        };
      }
    };
    const renderer = vm.runInNewContext(`(${source})`, { document: mockDocument });
    renderer(average);
    return host.children.map(star => star.children.length
      ? `${star.textContent}[${star.children[0].style.width}]`
      : star.textContent);
  }

  assert.deepEqual(render(4), ['★', '★', '★', '★', '☆']);
  assert.deepEqual(render(4.5), ['★', '★', '★', '★', '☆[50%]']);
  assert.deepEqual(render(3.7), ['★', '★', '★', '☆[70%]', '☆']);
  assert.deepEqual(render(5), ['★', '★', '★', '★', '★']);
  assert.deepEqual(render(1), ['★', '☆', '☆', '☆', '☆']);
});
