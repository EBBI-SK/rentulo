import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type SupportedLanguage = "cs" | "sk" | "en" | "de" | "pl";

type ReminderClaim = {
  delivery_id: string;
  debt_id: string;
  owner_id: string;
  amount_minor: number;
  currency: string;
  due_at: string;
  recipient_email: string | null;
  recipient_name: string | null;
  preferred_language: string | null;
  reservation_id: string;
  offer_name: string | null;
};

type ReminderCopy = {
  subject: string;
  intro: string;
  amountLabel: string;
  dueLabel: string;
  blocked: string;
  action: string;
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

const encoder = new TextEncoder();

const reminderCopy: Record<SupportedLanguage, ReminderCopy> = {
  cs: {
    subject: "Neuhrazený náklad po zrušení rezervace",
    intro: "Splatnost nákladu vzniklého zrušením zaplacené rezervace uplynula.",
    amountLabel: "K úhradě",
    dueLabel: "Splatnost",
    blocked: "Dokud dlužnou částku neuhradíte, nemůžete schvalovat nové rezervace.",
    action: "Uhradit v Rentulo",
  },
  sk: {
    subject: "Neuhradený náklad po zrušení rezervácie",
    intro: "Splatnosť nákladu vzniknutého zrušením zaplatenej rezervácie uplynula.",
    amountLabel: "Na úhradu",
    dueLabel: "Splatnosť",
    blocked: "Kým dlžnú sumu neuhradíte, nemôžete schvaľovať nové rezervácie.",
    action: "Uhradiť v Rentulo",
  },
  en: {
    subject: "Overdue cancellation cost",
    intro: "The payment deadline for the cost caused by cancelling a paid reservation has passed.",
    amountLabel: "Amount due",
    dueLabel: "Due date",
    blocked: "Until this amount is paid, you cannot approve new reservations.",
    action: "Pay in Rentulo",
  },
  de: {
    subject: "Überfällige Kosten nach Stornierung",
    intro: "Die Zahlungsfrist für die durch die Stornierung einer bezahlten Reservierung entstandenen Kosten ist abgelaufen.",
    amountLabel: "Offener Betrag",
    dueLabel: "Fällig am",
    blocked: "Bis zur Zahlung dieses Betrags können Sie keine neuen Reservierungen bestätigen.",
    action: "In Rentulo bezahlen",
  },
  pl: {
    subject: "Zaległy koszt po anulowaniu rezerwacji",
    intro: "Termin płatności kosztu powstałego w wyniku anulowania opłaconej rezerwacji minął.",
    amountLabel: "Do zapłaty",
    dueLabel: "Termin płatności",
    blocked: "Do czasu uregulowania tej kwoty nie możesz akceptować nowych rezerwacji.",
    action: "Zapłać w Rentulo",
  },
};

const dateLocales: Record<SupportedLanguage, string> = {
  cs: "cs-CZ",
  sk: "sk-SK",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

function normalizeLanguage(value: unknown): SupportedLanguage {
  return value === "sk" || value === "en" || value === "de" || value === "pl"
    ? value
    : "cs";
}

function formatCurrencyMinor(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(dateLocales[language], {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function formatTimestampDate(value: unknown, language: SupportedLanguage): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return String(value ?? "");

  return new Intl.DateTimeFormat(dateLocales[language], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(date);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function setDeliveryStatus(
  admin: ReturnType<typeof createClient>,
  deliveryId: string,
  status: "sent" | "failed" | "skipped",
  values: Record<string, unknown> = {},
): Promise<void> {
  const updateValues: Record<string, unknown> = {
    status,
    claim_expires_at: null,
    updated_at: new Date().toISOString(),
    ...values,
  };

  if (status !== "sent") {
    updateValues.sent_at = null;
  }

  const { error } = await admin
    .from("owner_cancellation_debt_reminder_deliveries")
    .update(updateValues)
    .eq("id", deliveryId)
    .eq("status", "sending");

  if (error) throw error;
}

denoRuntime.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = denoRuntime.env.get("RESEND_API_KEY");
  const emailFrom = denoRuntime.env.get("EMAIL_FROM");
  const siteUrl = (denoRuntime.env.get("SITE_URL") || "https://rentulo-seven.vercel.app").replace(/\/$/, "");

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !emailFrom) {
    console.error("send-overdue-owner-debt-reminders: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  // Internal-only worker. Supabase Cron must call this function with the project
  // service-role token in the Authorization header.
  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken || !timingSafeTextEqual(accessToken, serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let limit = 25;
  const requestBody = await req.text();
  if (requestBody.trim()) {
    let payload: { limit?: unknown };
    try {
      payload = JSON.parse(requestBody) as { limit?: unknown };
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const requestedLimit = Number(payload.limit);
    if (Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100) {
      limit = requestedLimit;
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: claimsData, error: claimsError } = await admin.rpc(
    "claim_overdue_owner_debt_reminders",
    { p_limit: limit },
  );

  if (claimsError) {
    console.error("send-overdue-owner-debt-reminders: claim failed", claimsError);
    return jsonResponse({ error: "Reminder claim failed" }, 500);
  }

  const claims = (claimsData || []) as ReminderClaim[];
  const result = { claimed: claims.length, sent: 0, failed: 0, skipped: 0 };

  for (const claim of claims) {
    try {
      // Recheck the debt immediately before the side effect. A debt paid between
      // cron claim and email send must not receive an overdue reminder.
      const { data: currentDebt, error: debtError } = await admin
        .from("owner_cancellation_debts")
        .select("status, due_at, amount_minor, currency")
        .eq("id", claim.debt_id)
        .single();

      const dueTime = currentDebt?.due_at ? new Date(currentDebt.due_at).getTime() : Number.NaN;
      if (
        debtError ||
        !currentDebt ||
        currentDebt.status !== "open" ||
        currentDebt.currency !== "czk" ||
        Number(currentDebt.amount_minor) !== Number(claim.amount_minor) ||
        !Number.isFinite(dueTime) ||
        dueTime > Date.now()
      ) {
        await setDeliveryStatus(admin, claim.delivery_id, "skipped", {
          error_message: "Debt is no longer eligible for an overdue reminder",
        });
        result.skipped += 1;
        continue;
      }

      const recipientEmail = String(claim.recipient_email || "").trim();
      if (!recipientEmail) {
        await setDeliveryStatus(admin, claim.delivery_id, "skipped", {
          error_message: "Owner email is unavailable",
        });
        result.skipped += 1;
        continue;
      }

      const language = normalizeLanguage(claim.preferred_language);
      const copy = reminderCopy[language];
      const amountText = formatCurrencyMinor(Number(claim.amount_minor), language);
      const dueText = formatTimestampDate(claim.due_at, language);
      const offerName = String(claim.offer_name || "Rentulo").trim() || "Rentulo";
      const detailUrl = `${siteUrl}/moje-nabidky.html`;

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#103f32;font-size:16px;line-height:1.5">
          <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.25;font-weight:700;color:#103f32">${escapeHtml(copy.subject)}</h1>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">${escapeHtml(copy.intro)}</p>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32"><strong>${escapeHtml(offerName)}</strong></p>
          <div style="margin:18px 0;padding:16px;border:1px solid #d8e8e1;border-radius:12px;background:#f7fbf9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">
            <p style="margin:0 0 8px"><strong>${escapeHtml(copy.amountLabel)}:</strong> ${escapeHtml(amountText)}</p>
            <p style="margin:0"><strong>${escapeHtml(copy.dueLabel)}:</strong> ${escapeHtml(dueText)}</p>
          </div>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">${escapeHtml(copy.blocked)}</p>
          <p style="margin:18px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5"><a href="${escapeHtml(detailUrl)}" style="display:inline-block;padding:12px 18px;background:#75d94f;color:#103f32;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.25;font-weight:700">${escapeHtml(copy.action)}</a></p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#66736f">Rentulo</p>
        </div>`;

      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `owner-debt-overdue/${claim.debt_id}`,
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [recipientEmail],
          subject: copy.subject,
          html,
        }),
      });

      const resendBody = await resendResponse.json().catch(() => ({}));

      if (!resendResponse.ok) {
        await setDeliveryStatus(admin, claim.delivery_id, "failed", {
          error_message: JSON.stringify(resendBody).slice(0, 1000),
        });
        result.failed += 1;
        continue;
      }

      await setDeliveryStatus(admin, claim.delivery_id, "sent", {
        provider_message_id:
          typeof resendBody?.id === "string" ? resendBody.id : null,
        error_message: null,
        sent_at: new Date().toISOString(),
      });
      result.sent += 1;
    } catch (error) {
      console.error("send-overdue-owner-debt-reminders: delivery failed", {
        debt_id: claim.debt_id,
        error,
      });

      try {
        await setDeliveryStatus(admin, claim.delivery_id, "failed", {
          error_message: String(error).slice(0, 1000),
        });
      } catch (statusError) {
        console.error("send-overdue-owner-debt-reminders: failed to record delivery failure", statusError);
      }

      result.failed += 1;
    }
  }

  return jsonResponse({ ok: true, ...result });
});
