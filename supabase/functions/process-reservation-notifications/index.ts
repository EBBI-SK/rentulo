import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phoneToE164, smsMessage } from "../_shared/notification-sms.mjs";

// BOD 13: the only worker for reservation email AND opt-in SMS.
// Database triggers enqueue trusted events in one transactional outbox.
// Do not invoke this function from browsers; its only credential is the
// independently generated, Vault-backed Cron secret.

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
const runtime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;

type Channel = "email" | "sms";
type EventType =
  | "new_request" | "approved" | "rejected" | "cancelled"
  | "paid" | "picked_up" | "returned" | "paid_cancelled";
type Status = "sent" | "retry" | "simulated" | "skipped" | "dead";
type Claim = {
  delivery_id: string;
  claim_token: string;
  reservation_id: string;
  event_type: EventType;
  recipient_id: string;
  channel: Channel;
};
type DeliveryResult = {
  outcome: Status;
  messageId?: string;
  error?: string;
};


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function deliverEmail(
  url: string,
  roleKey: string,
  claim: Claim,
): Promise<DeliveryResult> {
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/send-reservation-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${roleKey}`,
        apikey: roleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reservation_id: claim.reservation_id,
        event: claim.event_type,
        recipient_id: claim.recipient_id,
        notification_delivery_id: claim.delivery_id,
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return { outcome: "retry", error: "Email transport unavailable" };
  }
  if (response.status === 409) {
    // Financial email rules can fail closed until a refund is really complete.
    return { outcome: "retry", error: "Email event not ready" };
  }
  if (!response.ok) {
    return { outcome: response.status === 403 ? "dead" : "retry", error: `Email transport HTTP ${response.status}` };
  }
  const body = await response.json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.results) || body.results.length !== 1 ||
      body.results[0]?.recipient_id !== claim.recipient_id) {
    return { outcome: "retry", error: "Email transport did not confirm recipient" };
  }
  const status = body.results[0]?.status;
  if (status === "sent" || status === "duplicate") return { outcome: "sent" };
  if (status === "skipped") return { outcome: "skipped", error: "Email notifications disabled or missing email" };
  return { outcome: "retry", error: "Email still being processed" };
}

async function deliverSms(
  // deno-lint-ignore no-explicit-any
  admin: any,
  projectUrl: string,
  claim: Claim,
): Promise<DeliveryResult> {
  const mode = (runtime.env.get("SMS_SEND_MODE") || "disabled").trim();
  if (mode === "disabled") return { outcome: "skipped", error: "SMS disabled" };
  if (mode !== "dry_run" && mode !== "live") {
    return { outcome: "dead", error: "Unknown SMS mode" };
  }

  const [profileResult, reservationResult] = await Promise.all([
    admin.from("profiles").select("phone, preferred_language, sms_notifications")
      .eq("id", claim.recipient_id).single(),
    admin.from("reservations").select("reservation_number")
      .eq("id", claim.reservation_id).single(),
  ]);
  if (profileResult.error || reservationResult.error) {
    return { outcome: "retry", error: "SMS recipient lookup failed" };
  }
  if (profileResult.data?.sms_notifications !== true) {
    return { outcome: "skipped", error: "SMS preference turned off" };
  }
  const phone = phoneToE164(profileResult.data.phone);
  if (!phone) return { outcome: "skipped", error: "Invalid or missing phone number" };
  const bodyText = smsMessage(
    claim.event_type,
    profileResult.data.preferred_language,
    String(reservationResult.data.reservation_number || ""),
  );
  if (!bodyText) return { outcome: "dead", error: "Unexpected SMS template or reference" };
  if (mode === "dry_run") return { outcome: "simulated" };

  // A live SMS cannot be sent accidentally when PROD is copied or deployed.
  // During BOD 13, TEST is the only eligible project, and a per-phone allowlist
  // is mandatory. PROD activation requires a separate approved change.
  if (projectUrl !== "https://vspposovhdgvbeukoivh.supabase.co") {
    return { outcome: "dead", error: "Live SMS is not permitted in this environment" };
  }
  const allowlist = (runtime.env.get("SMS_ALLOWED_NUMBERS") || "")
    .split(",").map(phoneToE164).filter(Boolean);
  if (!allowlist.includes(phone)) {
    return { outcome: "skipped", error: "Recipient is not on TEST SMS allowlist" };
  }
  const appId = Number(runtime.env.get("BULKGATE_APPLICATION_ID") || "");
  const appToken = runtime.env.get("BULKGATE_APPLICATION_TOKEN") || "";
  if (!Number.isSafeInteger(appId) || appId <= 0 || appToken.length < 10) {
    return { outcome: "dead", error: "SMS provider is not configured" };
  }

  let provider: Response;
  try {
    provider = await fetch("https://portal.bulkgate.com/api/1.0/simple/transactional", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: appId,
        application_token: appToken,
        number: phone.slice(1),
        text: bodyText,
        unicode: false,
        sender_id: "gSystem",
        duplicates_check: "on",
        tag: `rentulo-${claim.delivery_id}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // A timeout is ambiguous: the provider might have accepted the SMS.
    // Do not automatically retry and risk charging/sending a duplicate.
    return { outcome: "dead", error: "Ambiguous SMS timeout; manual review required" };
  }
  const result = await provider.json().catch(() => null);
  const accepted = provider.ok && result?.data?.status === "accepted" &&
    typeof result?.data?.sms_id === "string";
  if (accepted) return { outcome: "sent", messageId: result.data.sms_id };
  if (provider.status === 429) return { outcome: "retry", error: "SMS rate limit" };
  if (provider.status === 400) return { outcome: "skipped", error: "SMS provider rejected recipient or payload" };
  if (provider.status >= 500 || provider.ok) {
    return { outcome: "dead", error: "Ambiguous SMS provider response; manual review required" };
  }
  return { outcome: "dead", error: `SMS provider HTTP ${provider.status}` };
}

runtime.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = (runtime.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const roleKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const suppliedSecret = request.headers.get("x-rentulo-cron-secret") || "";
  if (!url || !roleKey || suppliedSecret.length < 64) {
    return json({ error: "Unauthorized" }, 401);
  }
  const admin = createClient(url, roleKey);
  const verified = await admin.rpc("verify_reservation_notification_cron_secret", {
    p_secret: suppliedSecret,
  });
  if (verified.error || verified.data !== true) return json({ error: "Unauthorized" }, 401);

  const params = await request.json().catch(() => ({}));
  const requestedLimit = Number(params?.limit);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 25) : 15;
  const claims = await admin.rpc("claim_reservation_notification_deliveries", {
    p_limit: limit,
  });
  if (claims.error || !Array.isArray(claims.data)) {
    console.error("process-reservation-notifications: queue claim failed");
    return json({ error: "Queue unavailable" }, 500);
  }

  const summary = { claimed: claims.data.length, sent: 0, simulated: 0, skipped: 0, retried: 0, dead: 0 };
  for (const claim of claims.data as Claim[]) {
    let result: DeliveryResult;
    try {
      result = claim.channel === "email"
        ? await deliverEmail(url, roleKey, claim)
        : claim.channel === "sms"
          ? await deliverSms(admin, url, claim)
          : { outcome: "dead", error: "Unknown channel" };
    } catch {
      result = { outcome: "retry", error: "Notification worker failed" };
    }
    const finished = await admin.rpc("finish_reservation_notification_delivery", {
      p_delivery_id: claim.delivery_id,
      p_claim_token: claim.claim_token,
      p_outcome: result.outcome,
      p_provider_message_id: result.messageId || null,
      p_error: result.error || null,
    });
    if (finished.error || finished.data !== true) {
      console.error("process-reservation-notifications: acknowledgement failed");
      return json({ error: "Queue acknowledgement failed", ...summary }, 500);
    }
    if (result.outcome === "retry") summary.retried += 1;
    else if (result.outcome === "dead") summary.dead += 1;
    else summary[result.outcome] += 1;
  }
  return json({ ok: true, ...summary });
});
