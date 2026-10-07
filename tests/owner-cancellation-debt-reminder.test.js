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

test("reminder worker is internal-only and uses the trusted claim RPC", () => {
  assert.match(worker, /timingSafeTextEqual\(accessToken, serviceRoleKey\)/);
  assert.match(worker, /return jsonResponse\(\{ error: "Unauthorized" \}, 401\)/);
  assert.match(worker, /\.rpc\(\s*"claim_overdue_owner_debt_reminders"/);
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

test("overdue reminder email keeps the existing Rentulo email visual language", () => {
  assert.match(worker, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(worker, /background:#f7fbf9/);
  assert.match(worker, /background:#75d94f/);
  assert.match(worker, /color:#103f32/);
  assert.match(worker, /formatCurrencyMinor/);
  assert.match(worker, /formatTimestampDate/);
});
