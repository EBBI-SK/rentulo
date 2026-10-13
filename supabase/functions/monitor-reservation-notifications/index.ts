import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// BOD 12 / P1-4: independent, explicitly enabled TEST-only alert transport.
// GitHub Actions (not Supabase pg_cron) calls this function every five minutes.
// Do not publish a browser-facing endpoint or deploy it to PROD.
type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
const runtime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;

const TEST_SUPABASE_URL = "https://vspposovhdgvbeukoivh.supabase.co";
const TEST_ALERT_TO = "ebbi@ebbi.sk";
const DB_TIMEOUT_MS = 4000;
const RESEND_TIMEOUT_MS = 8000;
const MAX_BATCH = 5;
const MAX_CONCURRENCY = 3;

type Alert = {
  alert_key: string;
  claim_token: string;
  alert_generation: number;
  issue_kind: "dead" | "overdue" | "stuck" | "worker_stale";
  reservation_number: string | null;
  detail: string;
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function matchesSecret(supplied: string | null, configured: string): boolean {
  const a = new TextEncoder().encode(supplied || "");
  const b = new TextEncoder().encode(configured);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

async function emailIdempotencyKey(alert: Alert): Promise<string> {
  const value = new TextEncoder().encode(
    `rentulo-test-monitor:${alert.alert_key}:${alert.alert_generation}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `rentulo-alert-${Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0")).join("")}`;
}

const issueNames: Record<Alert["issue_kind"], string> = {
  dead: "Neúspešne ukončená notifikácia – vyžaduje zásah",
  overdue: "Oneskorené spracovanie notifikácie",
  stuck: "Zaseknutá notifikácia",
  worker_stale: "Notifikačný worker / Cron prestal potvrdzovať úspešné behy",
};

async function sendAlert(
  alert: Alert,
  apiKey: string,
  from: string,
): Promise<{ sent: boolean; error?: string }> {
  const kind = issueNames[alert.issue_kind];
  if (!kind) return { sent: false, error: "Unknown monitor issue kind" };
  const reference = alert.reservation_number || "bez rezervácie";
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": await emailIdempotencyKey(alert),
      },
      body: JSON.stringify({
        from,
        to: [TEST_ALERT_TO],
        subject: `Rentulo TEST – alarm: ${kind}`,
        text: [
          "Automatický monitoring Rentulo TEST zaznamenal problém.",
          `Typ: ${kind}`,
          `Rezervácia: ${reference}`,
          `Podrobnosti: ${alert.detail}`,
          `Identifikátor incidentu: ${alert.alert_key} (výskyt ${alert.alert_generation})`,
          "",
          "Kontrola: Supabase TEST → reservation_notification_deliveries a reservation_notification_monitor_alerts.",
          "Upozornenie neznamená, že možno SMS znova odoslať. Nejasné SMS treba preveriť u poskytovateľa.",
        ].join("\n"),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch {
    return { sent: false, error: "Monitor email transport unavailable" };
  }
  const body = await response.json().catch(() => null);
  if (response.ok && typeof body?.id === "string") return { sent: true };
  return { sent: false, error: `Monitor email HTTP ${response.status}` };
}

runtime.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = (runtime.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  if (url !== TEST_SUPABASE_URL) return json({ error: "TEST environment only" }, 403);

  const configuredSecret = runtime.env.get("RENTULO_MONITOR_SECRET") || "";
  if (configuredSecret.length < 64 ||
    !matchesSecret(request.headers.get("x-rentulo-monitor-secret"), configuredSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const serviceKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendKey = runtime.env.get("RESEND_API_KEY") || "";
  const from = runtime.env.get("EMAIL_FROM") || "";
  // The recipient is intentionally fixed in this TEST-only implementation.
  if (!serviceKey || !resendKey || !from) {
    return json({ error: "Monitoring email credentials are not configured" }, 503);
  }

  const admin = createClient(url, serviceKey);
  let claimed;
  try {
    claimed = await admin.rpc("claim_reservation_notification_monitor_alerts", {
      p_limit: MAX_BATCH,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  } catch {
    console.error("monitor-reservation-notifications: alert claim failed");
    return json({ error: "Monitor database unavailable" }, 503);
  }
  if (claimed.error || !Array.isArray(claimed.data)) {
    console.error("monitor-reservation-notifications: alert claim failed");
    return json({ error: "Monitor database unavailable" }, 503);
  }
  const pending = claimed.data as Alert[];
  let next = 0;
  const result = { ok: true, claimed: pending.length, sent: 0, retried: 0, ack_failures: 0 };

  async function processAlert(alert: Alert): Promise<void> {
    const delivery = await sendAlert(alert, resendKey, from);
    try {
      const ack = await admin.rpc("finish_reservation_notification_monitor_alert", {
        p_alert_key: alert.alert_key,
        p_claim_token: alert.claim_token,
        p_generation: alert.alert_generation,
        p_sent: delivery.sent,
        p_error: delivery.error || null,
      }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (ack.error || ack.data !== true) {
        result.ack_failures++;
        console.error("monitor-reservation-notifications: alert acknowledgement failed");
        return;
      }
    } catch {
      result.ack_failures++;
      console.error("monitor-reservation-notifications: alert acknowledgement failed");
      return;
    }
    if (delivery.sent) result.sent++;
    else result.retried++;
  }

  async function drain(): Promise<void> {
    while (next < pending.length) await processAlert(pending[next++]);
  }
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENCY, pending.length) }, () => drain()
  ));

  if (result.retried > 0 || result.ack_failures > 0) {
    return json({ ...result, ok: false }, 503);
  }
  return json(result);
});
