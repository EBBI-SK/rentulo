const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007110000_add_owner_debt_overdue_reminders.sql"),
  "utf8",
);
const worker = fs.readFileSync(
  path.join(ROOT, "supabase/functions/send-overdue-owner-debt-reminders/index.ts"),
  "utf8",
);
const cronMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007120000_schedule_owner_debt_reminders.sql"),
  "utf8",
);

test("overdue debt reminder delivery log is backend-only and unique per debt", () => {
  assert.match(migration, /create table if not exists public\.owner_cancellation_debt_reminder_deliveries/i);
  assert.match(migration, /debt_id uuid not null unique/i);
  assert.match(migration, /status in \('sending', 'sent', 'failed', 'skipped'\)/i);
  assert.match(migration, /alter table public\.owner_cancellation_debt_reminder_deliveries enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.owner_cancellation_debt_reminder_deliveries[\s\S]*from public, anon, authenticated/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all).*owner_cancellation_debt_reminder_deliveries.*authenticated/i,
  );
});

test("reminder claim only selects overdue open owner debts and supports safe retries", () => {
  assert.match(migration, /create or replace function public\.claim_overdue_owner_debt_reminders/i);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/i);
  assert.match(migration, /d\.status = 'open'[\s\S]*d\.due_at <= v_now/i);
  assert.match(migration, /rd\.status = 'failed'/i);
  assert.match(migration, /rd\.status = 'sending'[\s\S]*rd\.claim_expires_at <= v_now/i);
  assert.match(migration, /for update of d skip locked/i);
  assert.match(migration, /c\.cancellation_kind = 'paid_refund'/i);
  assert.match(migration, /c\.cancelled_by_role = 'owner'/i);
  assert.match(migration, /r\.status = 'cancelled'/i);
});

test("reminder claim RPC is service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.claim_overdue_owner_debt_reminders\(integer\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_overdue_owner_debt_reminders\(integer\)[\s\S]*to service_role/i,
  );
});

test("reminder worker is internal-only, verifies the Vault cron secret and uses the trusted claim RPC", () => {
  assert.match(worker, /req\.headers\.get\("x-rentulo-cron-secret"\)/);
  assert.match(worker, /\.rpc\(\s*"verify_overdue_owner_debt_cron_secret"/);
  assert.match(worker, /cronAuthorized !== true/);
  assert.match(worker, /return jsonResponse\(\{ error: "Unauthorized" \}, 401\)/);
  assert.match(worker, /\.rpc\(\s*"claim_overdue_owner_debt_reminders"/);
  assert.doesNotMatch(worker, /Authorization[\s\S]*service-role token/i);
});

test("reminder worker revalidates debt state immediately before sending", () => {
  assert.match(worker, /\.from\("owner_cancellation_debts"\)[\s\S]*\.select\("status, due_at, amount_minor, currency"\)/);
  assert.match(worker, /currentDebt\.status !== "open"/);
  assert.match(worker, /dueTime > Date\.now\(\)/);
  assert.match(worker, /"skipped"[\s\S]*Debt is no longer eligible for an overdue reminder/);
});

test("Resend delivery is idempotent per overdue debt and failed sends remain retryable", () => {
  assert.match(worker, /"Idempotency-Key": `owner-debt-overdue\/\$\{claim\.debt_id\}`/);
  assert.match(worker, /if \(!resendResponse\.ok\)[\s\S]*"failed"/);
  assert.match(worker, /setDeliveryStatus\(admin, claim\.delivery_id, "sent"/);
  assert.match(worker, /provider_message_id/);
});

test("overdue reminder explains the block and supports all five languages", () => {
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(worker, new RegExp(`\\n  ${language}: \\{`));
  }
  assert.match(worker, /nemůžete schvalovat nové rezervace/);
  assert.match(worker, /nemôžete schvaľovať nové rezervácie/);
  assert.match(worker, /cannot approve new reservations/);
  assert.match(worker, /keine neuen Reservierungen bestätigen/);
  assert.match(worker, /nie możesz akceptować nowych rezerwacji/);
  assert.match(worker, /moje-nabidky\.html/);
});

test("overdue reminder email matches Rentulo branding and preserves debt details", () => {
  assert.match(worker, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(worker, /background:#f7fbf9/);
  assert.match(worker, /background:#00835a;color:#ffffff/);
  assert.match(worker, /color:#103f32/);
  assert.match(worker, /formatCurrencyMinor/);
  assert.match(worker, /formatTimestampDate/);
});

test("overdue reminder cron enables the required Supabase extensions", () => {
  assert.match(cronMigration, /create extension if not exists pg_cron/i);
  assert.match(cronMigration, /create extension if not exists pg_net with schema extensions/i);
  assert.match(cronMigration, /create extension if not exists supabase_vault with schema vault/i);
});

test("overdue reminder cron keeps environment URL and authentication secret in Vault", () => {
  assert.match(cronMigration, /vault\.create_secret\([\s\S]*'rentulo_project_url'/i);
  assert.match(cronMigration, /'UNCONFIGURED'[\s\S]*'rentulo_project_url'/i);
  assert.match(cronMigration, /rentulo_owner_debt_cron_secret/i);
  assert.match(cronMigration, /replace\(gen_random_uuid\(\)::text, '-', ''\)/i);
  assert.doesNotMatch(cronMigration, /vspposovhdgvbeukoivh/i);
  assert.doesNotMatch(cronMigration, /service[_-]?role[_-]?key\s*[:=]/i);
});

test("cron secret verifier is service-role only", () => {
  assert.match(cronMigration, /create or replace function public\.verify_overdue_owner_debt_cron_secret/i);
  assert.match(cronMigration, /vault\.decrypted_secrets/i);
  assert.match(
    cronMigration,
    /revoke all on function public\.verify_overdue_owner_debt_cron_secret\(text\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    cronMigration,
    /grant execute on function public\.verify_overdue_owner_debt_cron_secret\(text\)[\s\S]*to service_role/i,
  );
});

test("overdue reminder cron runs hourly and invokes only the reminder Edge Function", () => {
  assert.match(cronMigration, /rentulo-send-overdue-owner-debt-reminders-hourly/);
  assert.match(cronMigration, /'0 \* \* \* \*'/);
  assert.match(cronMigration, /net\.http_post/i);
  assert.match(cronMigration, /functions\/v1\/send-overdue-owner-debt-reminders/);
  assert.match(cronMigration, /'x-rentulo-cron-secret', cfg\.cron_secret/);
  assert.match(cronMigration, /jsonb_build_object\('limit', 25\)/);
});

test("cron stays inert until a valid environment-specific Supabase project URL is configured", () => {
  assert.ok(
    cronMigration.includes(
      "where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'",
    ),
  );
  assert.match(cronMigration, /length\(cfg\.cron_secret\) >= 64/i);
});

// Regression for PostgreSQL 42702: RETURNS TABLE creates a PL/pgSQL output
// variable named debt_id, which conflicts with ON CONFLICT (debt_id).
// Keep the original function unchanged except for unambiguous constraint naming.
const claimFixMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261014100000_fix_owner_debt_reminder_claim_ambiguity.sql"),
  "utf8",
);

function claimFunctionDefinition(sql) {
  const match = sql.match(
    /create or replace function public\.claim_overdue_owner_debt_reminders\([\s\S]*?\$function\$;/i,
  );
  assert.ok(match, "Claim function definition must be present");
  return match[0];
}

test("overdue reminder claim migration fixes ambiguous debt_id without changing function logic", () => {
  const original = claimFunctionDefinition(migration);
  const repaired = claimFunctionDefinition(claimFixMigration);
  const ambiguousConflict = /on conflict \(debt_id\) do update/gi;
  const exactConstraint = "on conflict on constraint owner_cancellation_debt_reminder_deliveries_debt_id_key do update";

  assert.equal((original.match(ambiguousConflict) || []).length, 1);
  assert.equal(repaired, original.replace(ambiguousConflict, exactConstraint));
  assert.doesNotMatch(repaired, /on conflict\s*\(\s*debt_id\s*\)/i);
  assert.match(repaired, /for update of d skip locked/i);
  assert.match(repaired, /auth\.role\(\) <> 'service_role'/i);
});

test("overdue reminder claim repair remains transactional and service-role only", () => {
  assert.match(claimFixMigration, /\bbegin;[\s\S]*\bcommit;\s*$/i);
  assert.match(
    claimFixMigration,
    /revoke all on function public\.claim_overdue_owner_debt_reminders\(integer\)\s+from public, anon, authenticated;/i,
  );
  assert.match(
    claimFixMigration,
    /grant execute on function public\.claim_overdue_owner_debt_reminders\(integer\)\s+to service_role;/i,
  );
  assert.doesNotMatch(claimFixMigration, /\b(?:create|alter|drop)\s+(?:table|trigger|policy|extension)\b/i);
  assert.doesNotMatch(claimFixMigration, /\bcron\.schedule\s*\(/i);
});
