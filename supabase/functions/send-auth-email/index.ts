// Supabase Auth's signed Send Email HTTP hook. Separate from reservation emails.
// Activation REPLACES Auth SMTP. Do not enable until the TEST smoke test plan is approved.
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { buildAuthEmailMessages } from "../_shared/auth-email-render.mjs";

const jsonResponse = (status: number, code: string) => new Response(
  JSON.stringify(status === 200 ? {} : { error: { http_code: status, message: code } }),
  { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse(405, "Method not allowed");

  // No JWT verification: Supabase Auth authenticates this webhook by signature.
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!/^v1,whsec_[A-Za-z0-9+/=]+$/.test(hookSecret) || !resendApiKey || !supabaseUrl) {
    return jsonResponse(503, "Auth mail hook is not configured");
  }

  // Verify *raw* bytes first; never process or log unverified OTPs.
  const raw = await request.text();
  if (raw.length > 65536) return jsonResponse(413, "Payload is too large");
  let event: unknown;
  try {
    const webhook = new Webhook(hookSecret.replace(/^v1,whsec_/, ""));
    event = webhook.verify(raw, Object.fromEntries(request.headers));
  } catch {
    return jsonResponse(401, "Invalid webhook signature");
  }

  const webhookId = request.headers.get("webhook-id") ?? "";
  if (!/^[A-Za-z0-9_.:-]{4,150}$/.test(webhookId)) return jsonResponse(400, "Invalid webhook ID");

  let messages: { to: string; subject: string; html: string; suffix: string }[];
  try {
    messages = buildAuthEmailMessages(event, { supabaseUrl });
  } catch {
    // Do not disclose user metadata, tokens or confirmation URLs in logs.
    return jsonResponse(422, "Unsupported or invalid Auth email event");
  }

  // Transactional Auth messages always use the customer identity, never the monitoring sender.
  const from = "Rentulo <rentulo@rentulo.com>";
  // Auth HTTP hooks have a 5-second overall deadline. Two confirmation emails
  // (secure email change) must be sent in parallel rather than serially.
  const deliveries = await Promise.all(messages.map(async (message) => {
    try {
      return await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `rentulo-auth-${webhookId}-${message.suffix}`,
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          reply_to: "rentulo@rentulo.com",
          subject: message.subject,
          html: message.html,
        }),
        signal: AbortSignal.timeout(3500),
      });
    } catch {
      return null;
    }
  }));
  // A 200 to Auth means *all* email requests were accepted by the provider.
  // Return a retryable error if any failed; Resend idempotency avoids duplicates.
  if (deliveries.some((result) => !result?.ok)) {
    return new Response(JSON.stringify({ error: { http_code: 503, message: "Mail provider unavailable" } }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "1" },
    });
  }
  return jsonResponse(200, "");
});
