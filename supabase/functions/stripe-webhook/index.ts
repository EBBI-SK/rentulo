import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

type StripeEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
};

type StripeSignature = {
  timestamp: number;
  signatures: string[];
};

type WebhookEventRow = {
  id: string;
  processing_status: string;
  attempt_count: number;
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

function createAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type AdminClient = ReturnType<typeof createAdminClient>;

const SIGNATURE_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function parseStripeSignature(header: string): StripeSignature | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t") {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        timestamp = parsed;
      }
    } else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

async function expectedStripeSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );

  return bytesToHex(new Uint8Array(signature));
}

async function verifyStripeSignature(
  secret: string,
  header: string,
  rawBody: string,
): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = await expectedStripeSignature(secret, parsed.timestamp, rawBody);
  return parsed.signatures.some((signature) => timingSafeHexEqual(signature, expected));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value) {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }

  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function updateEventStatus(
  admin: AdminClient,
  stripeEventId: string,
  processingStatus: "processing" | "processed" | "ignored" | "failed",
  values: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({
      processing_status: processingStatus,
      ...values,
    })
    .eq("stripe_event_id", stripeEventId);

  if (error) {
    console.error("stripe-webhook: event log update failed", error.message);
    return false;
  }

  return true;
}

async function beginEvent(
  admin: AdminClient,
  event: StripeEvent,
  object: Record<string, unknown>,
): Promise<{ row: WebhookEventRow; duplicateDone: boolean } | null> {
  const stripeEventId = asString(event.id);
  const eventType = asString(event.type);
  const objectType = asString(object.object) || null;
  const stripeObjectId = asString(object.id) || null;
  const stripeCreatedAt = Number.isSafeInteger(event.created)
    ? new Date(Number(event.created) * 1000).toISOString()
    : null;

  const inserted = await admin
    .from("stripe_webhook_events")
    .insert({
      stripe_event_id: stripeEventId,
      event_type: eventType,
      object_type: objectType,
      object_id: stripeObjectId,
      livemode: event.livemode === true,
      stripe_created_at: stripeCreatedAt,
      processing_status: "processing",
      attempt_count: 1,
      last_error: null,
    })
    .select("id, processing_status, attempt_count")
    .single();

  if (!inserted.error && inserted.data) {
    return {
      row: inserted.data as WebhookEventRow,
      duplicateDone: false,
    };
  }

  if (inserted.error?.code !== "23505") {
    console.error(
      "stripe-webhook: event log insert failed",
      inserted.error?.message || "unknown error",
    );
    return null;
  }

  const existing = await admin
    .from("stripe_webhook_events")
    .select("id, processing_status, attempt_count")
    .eq("stripe_event_id", stripeEventId)
    .single();

  if (existing.error || !existing.data) {
    console.error(
      "stripe-webhook: duplicate event lookup failed",
      existing.error?.message || "missing event",
    );
    return null;
  }

  const row = existing.data as WebhookEventRow;
  if (row.processing_status === "processed" || row.processing_status === "ignored") {
    return { row, duplicateDone: true };
  }

  const attemptCount = Math.max(0, Number(row.attempt_count) || 0) + 1;
  const reset = await admin
    .from("stripe_webhook_events")
    .update({
      processing_status: "processing",
      attempt_count: attemptCount,
      last_error: null,
    })
    .eq("stripe_event_id", stripeEventId)
    .select("id, processing_status, attempt_count")
    .single();

  if (reset.error || !reset.data) {
    console.error(
      "stripe-webhook: duplicate event reset failed",
      reset.error?.message || "missing event",
    );
    return null;
  }

  return {
    row: reset.data as WebhookEventRow,
    duplicateDone: false,
  };
}

async function sendPaidReservationEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  reservationId: string,
): Promise<{ ok: boolean; error: string | null }> {
  let emailResponse: Response;

  try {
    emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-reservation-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reservation_id: reservationId,
        event: "paid",
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("stripe-webhook: paid email request failed", message);
    return { ok: false, error: `Paid email request failed: ${message}` };
  }

  if (emailResponse.ok) {
    return { ok: true, error: null };
  }

  const responseBody = await emailResponse.text().catch(() => "");
  const message = responseBody
    ? `Paid email delivery failed (${emailResponse.status}): ${responseBody.slice(0, 500)}`
    : `Paid email delivery failed (${emailResponse.status})`;

  console.error("stripe-webhook: paid email delivery failed", message);
  return { ok: false, error: message };
}

denoRuntime.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = (denoRuntime.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error("stripe-webhook: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const signatureHeader = req.headers.get("Stripe-Signature") || "";
  const rawBody = await req.text();

  if (!signatureHeader || !(await verifyStripeSignature(webhookSecret, signatureHeader, rawBody))) {
    return jsonResponse({ error: "Invalid Stripe signature" }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const stripeEventId = asString(event.id);
  const eventType = asString(event.type);
  const object = event.data?.object;

  if (!stripeEventId || !eventType || !object || typeof object !== "object") {
    return jsonResponse({ error: "Invalid Stripe event" }, 400);
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey);

  const eventState = await beginEvent(admin, event, object);
  if (!eventState) {
    return jsonResponse({ error: "Webhook event could not be recorded" }, 500);
  }

  if (eventState.duplicateDone) {
    return jsonResponse({ received: true, duplicate: true });
  }

  if (eventType !== "payment_intent.succeeded") {
    const ignored = await updateEventStatus(admin, stripeEventId, "ignored", {
      processed_at: new Date().toISOString(),
      last_error: null,
    });

    return ignored
      ? jsonResponse({ received: true, ignored: true })
      : jsonResponse({ error: "Webhook event could not be finalized" }, 500);
  }

  const paymentIntentId = asString(object.id);
  const paymentIntentStatus = asString(object.status);
  const currency = asString(object.currency).toLowerCase();
  const amountReceivedMinor = asInteger(object.amount_received);
  const chargeId = objectId(object.latest_charge);
  const metadata = object.metadata && typeof object.metadata === "object"
    ? object.metadata as Record<string, unknown>
    : {};
  const paymentId = asString(metadata.payment_id);
  const reservationId = asString(metadata.reservation_id);

  if (!paymentId || !reservationId || !isUuid(paymentId) || !isUuid(reservationId)) {
    const ignored = await updateEventStatus(admin, stripeEventId, "ignored", {
      processed_at: new Date().toISOString(),
      last_error: "Missing or invalid Rentulo payment metadata",
    });

    return ignored
      ? jsonResponse({ received: true, ignored: true })
      : jsonResponse({ error: "Webhook event could not be finalized" }, 500);
  }

  if (
    !paymentIntentId ||
    paymentIntentStatus !== "succeeded" ||
    currency !== "czk" ||
    amountReceivedMinor === null ||
    amountReceivedMinor <= 0
  ) {
    const failed = await updateEventStatus(admin, stripeEventId, "failed", {
      payment_id: paymentId,
      reservation_id: reservationId,
      last_error: "Invalid succeeded PaymentIntent payload",
    });

    return failed
      ? jsonResponse({ error: "Invalid succeeded PaymentIntent payload" }, 400)
      : jsonResponse({ error: "Webhook event could not be finalized" }, 500);
  }

  const completion = await admin.rpc("complete_stripe_payment_from_webhook", {
    p_payment_id: paymentId,
    p_reservation_id: reservationId,
    p_stripe_payment_intent_id: paymentIntentId,
    p_stripe_payment_intent_status: paymentIntentStatus,
    p_amount_received_minor: amountReceivedMinor,
    p_currency: currency,
    p_stripe_charge_id: chargeId,
  });

  if (completion.error) {
    console.error("stripe-webhook: payment completion failed", completion.error.message);
    await updateEventStatus(admin, stripeEventId, "failed", {
      payment_id: paymentId,
      reservation_id: reservationId,
      last_error: completion.error.message,
    });
    return jsonResponse({ error: "Payment completion failed" }, 500);
  }

  const paidEmail = await sendPaidReservationEmail(
    supabaseUrl,
    serviceRoleKey,
    reservationId,
  );

  if (!paidEmail.ok) {
    await updateEventStatus(admin, stripeEventId, "failed", {
      payment_id: paymentId,
      reservation_id: reservationId,
      last_error: paidEmail.error || "Paid reservation email failed",
    });
    return jsonResponse({ error: "Paid reservation email failed" }, 500);
  }

  const finalized = await updateEventStatus(admin, stripeEventId, "processed", {
    payment_id: paymentId,
    reservation_id: reservationId,
    processed_at: new Date().toISOString(),
    last_error: null,
  });

  if (!finalized) {
    return jsonResponse({ error: "Webhook event could not be finalized" }, 500);
  }

  return jsonResponse({ received: true });
});
