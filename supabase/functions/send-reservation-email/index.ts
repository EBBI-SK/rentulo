import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EmailEvent =
  | "new_request"
  | "approved"
  | "rejected"
  | "cancelled"
  | "paid"
  | "picked_up"
  | "returned"
  | "paid_cancelled";

type StandardEmailEvent = Exclude<EmailEvent, "paid_cancelled">;

type SupportedLanguage = "cs" | "sk" | "en" | "de" | "pl";

type PaidCancellationRow = {
  id: string;
  payment_id: string;
  cancelled_by_role: "renter" | "owner";
  cancellation_kind: string;
  refund_policy: string | null;
  payment_amount_minor: number | null;
  refund_amount_minor: number | null;
  external_cost_amount_minor: number | null;
  currency: string | null;
  financials_finalized_at: string | null;
};

type OwnerCancellationDebt = {
  amount_minor: number;
  currency: string;
  status: string;
  due_at: string;
};

const eventStatus: Record<EmailEvent, string> = {
  new_request: "pending",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  paid: "paid",
  picked_up: "picked_up",
  returned: "returned",
  paid_cancelled: "cancelled",
};

const templates: Record<SupportedLanguage, Record<StandardEmailEvent, readonly [string, string]>> = {
  cs: {
    new_request: ["Nová žádost o půjčení", "U vaší nabídky čeká nová žádost o půjčení."],
    approved: ["Žádost byla schválena", "Majitel vaši žádost schválil. Rezervaci nyní můžete zaplatit."],
    rejected: ["Žádost byla odmítnuta", "Majitel vaši žádost o půjčení odmítl."],
    cancelled: ["Rezervace byla zrušena", "Rezervace byla zrušena a termín je znovu volný."],
    paid: ["Rezervace byla zaplacena", "Platba byla potvrzena. Kontaktní údaje jsou nyní dostupné účastníkům rezervace."],
    picked_up: ["Věc byla vyzvednuta", "Majitel označil věc jako vyzvednutou."],
    returned: ["Věc byla vrácena", "Půjčení bylo označeno jako dokončené."],
  },
  sk: {
    new_request: ["Nová žiadosť o požičanie", "Pri vašej ponuke čaká nová žiadosť o požičanie."],
    approved: ["Žiadosť bola schválená", "Majiteľ vašu žiadosť schválil. Rezerváciu teraz môžete zaplatiť."],
    rejected: ["Žiadosť bola odmietnutá", "Majiteľ vašu žiadosť o požičanie odmietol."],
    cancelled: ["Rezervácia bola zrušená", "Rezervácia bola zrušená a termín je znova voľný."],
    paid: ["Rezervácia bola zaplatená", "Platba bola potvrdená. Kontaktné údaje sú teraz dostupné účastníkom rezervácie."],
    picked_up: ["Vec bola vyzdvihnutá", "Majiteľ označil vec ako vyzdvihnutú."],
    returned: ["Vec bola vrátená", "Požičanie bolo označené ako dokončené."],
  },
  en: {
    new_request: ["New rental request", "A new rental request is waiting for your listing."],
    approved: ["Request approved", "The owner approved your request. You can now complete the payment."],
    rejected: ["Request rejected", "The owner rejected your rental request."],
    cancelled: ["Reservation cancelled", "The reservation was cancelled and the dates are available again."],
    paid: ["Reservation paid", "Payment was confirmed. Contact details are now available to the reservation participants."],
    picked_up: ["Item picked up", "The owner marked the item as picked up."],
    returned: ["Item returned", "The rental was marked as completed."],
  },
  de: {
    new_request: ["Neue Mietanfrage", "Für Ihr Angebot wartet eine neue Mietanfrage."],
    approved: ["Anfrage bestätigt", "Der Eigentümer hat Ihre Anfrage bestätigt. Sie können jetzt die Zahlung abschließen."],
    rejected: ["Anfrage abgelehnt", "Der Eigentümer hat Ihre Mietanfrage abgelehnt."],
    cancelled: ["Reservierung storniert", "Die Reservierung wurde storniert und der Zeitraum ist wieder verfügbar."],
    paid: ["Reservierung bezahlt", "Die Zahlung wurde bestätigt. Die Kontaktdaten sind jetzt für die Beteiligten sichtbar."],
    picked_up: ["Gegenstand abgeholt", "Der Eigentümer hat den Gegenstand als abgeholt markiert."],
    returned: ["Gegenstand zurückgegeben", "Die Vermietung wurde als abgeschlossen markiert."],
  },
  pl: {
    new_request: ["Nowa prośba o wypożyczenie", "Nowa prośba o wypożyczenie oczekuje przy Twojej ofercie."],
    approved: ["Prośba została zaakceptowana", "Właściciel zaakceptował Twoją prośbę. Możesz teraz dokończyć płatność."],
    rejected: ["Prośba została odrzucona", "Właściciel odrzucił Twoją prośbę o wypożyczenie."],
    cancelled: ["Rezerwacja została anulowana", "Rezerwacja została anulowana, a termin jest ponownie dostępny."],
    paid: ["Rezerwacja została opłacona", "Płatność została potwierdzona. Dane kontaktowe są teraz dostępne dla uczestników rezerwacji."],
    picked_up: ["Rzecz została odebrana", "Właściciel oznaczył rzecz jako odebraną."],
    returned: ["Rzecz została zwrócona", "Wypożyczenie zostało oznaczone jako zakończone."],
  },
};

const paidCancellationCopy = {
  cs: {
    renterSelf: [
      "Rezervace byla zrušena – vrácení platby",
      "Zrušili jste zaplacenou rezervaci. Vrácení platby bylo úspěšně zpracováno.",
      "Zaplaceno",
      "Skutečné náklady Stripe",
      "Vráceno",
      "Částka bude vrácena na původní platební metodu.",
    ],
    renterOwner: [
      "Rezervace byla zrušena majitelem – vrácení platby",
      "Majitel zrušil zaplacenou rezervaci. Byla vám vrácena celá zaplacená částka.",
      "Zaplaceno",
      "Vráceno",
      "Částka bude vrácena na původní platební metodu.",
    ],
    ownerRenter: [
      "Nájemce zrušil rezervaci",
      "Nájemce zrušil rezervaci. Termín je znovu volný.",
    ],
    ownerSelf: [
      "Zrušili jste zaplacenou rezervaci",
      "Zrušili jste zaplacenou rezervaci. Nájemci byla vrácena celá zaplacená částka.",
      "Nájemci vráceno",
      "Skutečné náklady Stripe k úhradě",
      "Splatnost",
      "Rentulo po vás požaduje pouze skutečný externí náklad vzniklý tímto stornem.",
    ],
  },
  sk: {
    renterSelf: [
      "Rezervácia bola zrušená – vrátenie platby",
      "Zrušili ste zaplatenú rezerváciu. Vrátenie platby bolo úspešne spracované.",
      "Zaplatené",
      "Skutočné náklady Stripe",
      "Vrátené",
      "Suma bude vrátená na pôvodnú platobnú metódu.",
    ],
    renterOwner: [
      "Rezervácia bola zrušená majiteľom – vrátenie platby",
      "Majiteľ zrušil zaplatenú rezerváciu. Bola vám vrátená celá zaplatená suma.",
      "Zaplatené",
      "Vrátené",
      "Suma bude vrátená na pôvodnú platobnú metódu.",
    ],
    ownerRenter: [
      "Nájomca zrušil rezerváciu",
      "Nájomca zrušil rezerváciu. Termín je znova voľný.",
    ],
    ownerSelf: [
      "Zrušili ste zaplatenú rezerváciu",
      "Zrušili ste zaplatenú rezerváciu. Nájomcovi bola vrátená celá zaplatená suma.",
      "Nájomcovi vrátené",
      "Skutočné náklady Stripe na úhradu",
      "Splatnosť",
      "Rentulo od vás požaduje iba skutočný externý náklad vzniknutý týmto stornom.",
    ],
  },
  en: {
    renterSelf: [
      "Reservation cancelled – payment refund",
      "You cancelled a paid reservation. The refund was processed successfully.",
      "Paid",
      "Actual Stripe costs",
      "Refunded",
      "The amount will be returned to the original payment method.",
    ],
    renterOwner: [
      "Reservation cancelled by owner – payment refund",
      "The owner cancelled the paid reservation. Your full payment was refunded.",
      "Paid",
      "Refunded",
      "The amount will be returned to the original payment method.",
    ],
    ownerRenter: [
      "Renter cancelled the reservation",
      "The renter cancelled the reservation. The dates are available again.",
    ],
    ownerSelf: [
      "You cancelled the paid reservation",
      "You cancelled the paid reservation. The renter received a full refund.",
      "Refunded to renter",
      "Actual Stripe costs to pay",
      "Due date",
      "Rentulo requests only the actual external cost caused by this cancellation.",
    ],
  },
  de: {
    renterSelf: [
      "Reservierung storniert – Rückerstattung",
      "Sie haben eine bezahlte Reservierung storniert. Die Rückerstattung wurde erfolgreich verarbeitet.",
      "Bezahlt",
      "Tatsächliche Stripe-Kosten",
      "Erstattet",
      "Der Betrag wird auf die ursprüngliche Zahlungsmethode zurückerstattet.",
    ],
    renterOwner: [
      "Reservierung vom Eigentümer storniert – Rückerstattung",
      "Der Eigentümer hat die bezahlte Reservierung storniert. Der gesamte bezahlte Betrag wurde erstattet.",
      "Bezahlt",
      "Erstattet",
      "Der Betrag wird auf die ursprüngliche Zahlungsmethode zurückerstattet.",
    ],
    ownerRenter: [
      "Mieter hat die Reservierung storniert",
      "Der Mieter hat die Reservierung storniert. Der Zeitraum ist wieder verfügbar.",
    ],
    ownerSelf: [
      "Sie haben die bezahlte Reservierung storniert",
      "Sie haben die bezahlte Reservierung storniert. Der Mieter hat eine vollständige Rückerstattung erhalten.",
      "An den Mieter erstattet",
      "Tatsächliche Stripe-Kosten zur Zahlung",
      "Fällig am",
      "Rentulo fordert nur die tatsächlich durch diese Stornierung entstandenen externen Kosten an.",
    ],
  },
  pl: {
    renterSelf: [
      "Rezerwacja anulowana – zwrot płatności",
      "Anulowałeś opłaconą rezerwację. Zwrot został pomyślnie przetworzony.",
      "Zapłacono",
      "Rzeczywiste koszty Stripe",
      "Zwrócono",
      "Kwota zostanie zwrócona na pierwotną metodę płatności.",
    ],
    renterOwner: [
      "Rezerwacja anulowana przez właściciela – zwrot płatności",
      "Właściciel anulował opłaconą rezerwację. Zwrócono całą zapłaconą kwotę.",
      "Zapłacono",
      "Zwrócono",
      "Kwota zostanie zwrócona na pierwotną metodę płatności.",
    ],
    ownerRenter: [
      "Najemca anulował rezerwację",
      "Najemca anulował rezerwację. Termin jest ponownie dostępny.",
    ],
    ownerSelf: [
      "Anulowałeś opłaconą rezerwację",
      "Anulowałeś opłaconą rezerwację. Najemca otrzymał pełny zwrot.",
      "Zwrócono najemcy",
      "Rzeczywiste koszty Stripe do zapłaty",
      "Termin płatności",
      "Rentulo wymaga wyłącznie rzeczywistego kosztu zewnętrznego powstałego w wyniku tego anulowania.",
    ],
  },
} as const;

function normalizeLanguage(value: unknown): SupportedLanguage {
  return value === "sk" || value === "en" || value === "de" || value === "pl"
    ? value
    : "cs";
}

const dateLocales: Record<SupportedLanguage, string> = {
  cs: "cs-CZ",
  sk: "sk-SK",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL",
};

function formatReservationDate(value: unknown, language: SupportedLanguage): string {
  const raw = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

  if (!match) {
    return raw;
  }

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  ));

  return new Intl.DateTimeFormat(dateLocales[language], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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

function formatCurrencyMinor(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(dateLocales[language], {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function paidCancellationMessage(
  language: SupportedLanguage,
  recipientIsOwner: boolean,
  cancellation: PaidCancellationRow,
  ownerDebt: OwnerCancellationDebt | null,
): { subject: string; intro: string; financialHtml: string } {
  const paymentAmount = formatCurrencyMinor(Number(cancellation.payment_amount_minor), language);
  const refundAmount = formatCurrencyMinor(Number(cancellation.refund_amount_minor), language);
  const externalCostAmount = formatCurrencyMinor(Number(cancellation.external_cost_amount_minor), language);
  const copy = paidCancellationCopy[language];

  if (!recipientIsOwner && cancellation.cancelled_by_role === "renter") {
    const [subject, intro, paidLabel, costLabel, refundLabel, note] = copy.renterSelf;
    return {
      subject,
      intro,
      financialHtml: `
        <div style="margin:18px 0;padding:16px;border:1px solid #d8e8e1;border-radius:12px;background:#f7fbf9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">
          <p style="margin:0 0 8px"><strong>${escapeHtml(paidLabel)}:</strong> ${escapeHtml(paymentAmount)}</p>
          <p style="margin:0 0 8px"><strong>${escapeHtml(costLabel)}:</strong> ${escapeHtml(externalCostAmount)}</p>
          <p style="margin:0"><strong>${escapeHtml(refundLabel)}:</strong> ${escapeHtml(refundAmount)}</p>
        </div>
        <p>${escapeHtml(note)}</p>`,
    };
  }

  if (!recipientIsOwner && cancellation.cancelled_by_role === "owner") {
    const [subject, intro, paidLabel, refundLabel, note] = copy.renterOwner;
    return {
      subject,
      intro,
      financialHtml: `
        <div style="margin:18px 0;padding:16px;border:1px solid #d8e8e1;border-radius:12px;background:#f7fbf9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">
          <p style="margin:0 0 8px"><strong>${escapeHtml(paidLabel)}:</strong> ${escapeHtml(paymentAmount)}</p>
          <p style="margin:0"><strong>${escapeHtml(refundLabel)}:</strong> ${escapeHtml(refundAmount)}</p>
        </div>
        <p>${escapeHtml(note)}</p>`,
    };
  }

  if (recipientIsOwner && cancellation.cancelled_by_role === "renter") {
    const [subject, intro] = copy.ownerRenter;
    return {
      subject,
      intro,
      financialHtml: "",
    };
  }

  const [subject, intro, refundLabel, costLabel, dueLabel, note] = copy.ownerSelf;
  const debtAmount = ownerDebt ? formatCurrencyMinor(ownerDebt.amount_minor, language) : externalCostAmount;
  const dueDate = ownerDebt ? formatTimestampDate(ownerDebt.due_at, language) : "";

  return {
    subject,
    intro,
    financialHtml: `
      <div style="margin:18px 0;padding:16px;border:1px solid #d8e8e1;border-radius:12px;background:#f7fbf9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">
        <p style="margin:0 0 8px"><strong>${escapeHtml(refundLabel)}:</strong> ${escapeHtml(refundAmount)}</p>
        <p style="margin:0 0 8px"><strong>${escapeHtml(costLabel)}:</strong> ${escapeHtml(debtAmount)}</p>
        ${dueDate ? `<p style="margin:0"><strong>${escapeHtml(dueLabel)}:</strong> ${escapeHtml(dueDate)}</p>` : ""}
      </div>
      <p>${escapeHtml(note)}</p>`,
  };
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = denoRuntime.env.get("RESEND_API_KEY");
  const emailFrom = denoRuntime.env.get("EMAIL_FROM");
  const siteUrl = (denoRuntime.env.get("SITE_URL") || "https://rentulo-seven.vercel.app").replace(/\/$/, "");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !emailFrom) {
    return response({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const isServiceRoleCall = authHeader === `Bearer ${serviceRoleKey}`;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let actorId: string | null = null;

  if (!isServiceRoleCall) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const actor = userData.user;

    if (userError || !actor) {
      return response({ error: "Unauthorized" }, 401);
    }

    actorId = actor.id;
  }

  let payload: { reservation_id?: string; event?: EmailEvent };
  try {
    payload = await req.json();
  } catch {
    return response({ error: "Invalid JSON" }, 400);
  }

  const reservationId = String(payload.reservation_id || "");
  const event = payload.event;

  if (!reservationId || !event || !(event in eventStatus)) {
    return response({ error: "Invalid request" }, 400);
  }

  if (isServiceRoleCall && event !== "paid" && event !== "paid_cancelled") {
    return response({ error: "Service role is only allowed for trusted payment email events" }, 403);
  }

  if (!isServiceRoleCall && event === "paid_cancelled") {
    return response({ error: "Paid cancellation email requires service role" }, 403);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("reservations")
    .select("id, offer_id, owner_id, renter_id, offer_name, start_date, end_date, status")
    .eq("id", reservationId)
    .single();

  if (reservationError || !reservation) {
    return response({ error: "Reservation not found" }, 404);
  }

  if (reservation.status !== eventStatus[event]) {
    return response({ error: "Reservation status does not match the email event" }, 409);
  }

  const actorIsOwner = actorId === reservation.owner_id;
  const actorIsRenter = actorId === reservation.renter_id;
  const ownerEvents: EmailEvent[] = ["approved", "rejected", "picked_up", "returned"];
  const renterEvents: EmailEvent[] = ["new_request", "paid", "cancelled"];

  if (
    !isServiceRoleCall &&
    ((ownerEvents.includes(event) && !actorIsOwner) ||
      (renterEvents.includes(event) && !actorIsRenter))
  ) {
    return response({ error: "User is not allowed to send this email event" }, 403);
  }

  let paidCancellation: PaidCancellationRow | null = null;
  let ownerDebt: OwnerCancellationDebt | null = null;

  if (event === "paid_cancelled") {
    const { data: cancellation, error: cancellationError } = await admin
      .from("reservation_cancellations")
      .select(
        "id, payment_id, cancelled_by_role, cancellation_kind, refund_policy, payment_amount_minor, refund_amount_minor, external_cost_amount_minor, currency, financials_finalized_at"
      )
      .eq("reservation_id", reservation.id)
      .single();

    if (cancellationError || !cancellation) {
      return response({ error: "Paid cancellation record not found" }, 409);
    }

    paidCancellation = cancellation as PaidCancellationRow;

    const paymentAmountMinor = Number(paidCancellation.payment_amount_minor);
    const refundAmountMinor = Number(paidCancellation.refund_amount_minor);
    const externalCostAmountMinor = Number(paidCancellation.external_cost_amount_minor);

    if (
      paidCancellation.cancellation_kind !== "paid_refund" ||
      !paidCancellation.financials_finalized_at ||
      paidCancellation.currency !== "czk" ||
      !Number.isSafeInteger(paymentAmountMinor) || paymentAmountMinor <= 0 ||
      !Number.isSafeInteger(refundAmountMinor) || refundAmountMinor <= 0 ||
      !Number.isSafeInteger(externalCostAmountMinor) || externalCostAmountMinor < 0 ||
      (
        paidCancellation.cancelled_by_role === "renter" &&
        paidCancellation.refund_policy !== "renter_external_cost_deducted"
      ) ||
      (
        paidCancellation.cancelled_by_role === "owner" &&
        paidCancellation.refund_policy !== "owner_full_refund_owner_cost"
      )
    ) {
      return response({ error: "Paid cancellation financials are not finalized" }, 409);
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("id, refund_status, stripe_refund_amount_minor")
      .eq("id", paidCancellation.payment_id)
      .single();

    if (
      paymentError || !payment ||
      payment.refund_status !== "succeeded" ||
      Number(payment.stripe_refund_amount_minor) !== refundAmountMinor
    ) {
      return response({ error: "Paid cancellation refund has not succeeded" }, 409);
    }

    if (paidCancellation.cancelled_by_role === "owner" && externalCostAmountMinor > 0) {
      const { data: debt, error: debtError } = await admin
        .from("owner_cancellation_debts")
        .select("amount_minor, currency, status, due_at")
        .eq("cancellation_id", paidCancellation.id)
        .single();

      if (
        debtError || !debt ||
        Number(debt.amount_minor) !== externalCostAmountMinor ||
        debt.currency !== "czk"
      ) {
        return response({ error: "Owner cancellation debt is inconsistent" }, 409);
      }

      ownerDebt = debt as OwnerCancellationDebt;
    }
  }

  let recipientIds: string[];
  if (event === "new_request" || event === "paid") {
    recipientIds = [reservation.owner_id];
  } else if (event === "paid_cancelled") {
    recipientIds = Array.from(new Set([reservation.renter_id, reservation.owner_id]));
  } else if (event === "cancelled") {
    recipientIds = [actorIsOwner ? reservation.renter_id : reservation.owner_id];
  } else {
    recipientIds = [reservation.renter_id];
  }

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, email, full_name, preferred_language, email_notifications")
    .in("id", recipientIds);

  if (profilesError) {
    return response({ error: "Recipient lookup failed" }, 500);
  }

  const results = [];

  for (const profile of profiles || []) {
    if (!profile.email || profile.email_notifications === false) {
      results.push({ recipient_id: profile.id, status: "skipped" });
      continue;
    }

    const language = normalizeLanguage(profile.preferred_language);
    const recipientIsOwner = profile.id === reservation.owner_id;
    const detailUrl = `${siteUrl}/${recipientIsOwner ? "moje-nabidky.html" : "moje-rezervace.html"}`;
    const offerName = reservation.offer_name || "Rentulo";
    const dateText = `${formatReservationDate(reservation.start_date, language)} \u2013 ${formatReservationDate(reservation.end_date, language)}`;

    let subject: string;
    let intro: string;
    let extraHtml = "";

    if (event === "paid_cancelled") {
      if (!paidCancellation) {
        return response({ error: "Paid cancellation record is unavailable" }, 500);
      }

      const paidMessage = paidCancellationMessage(
        language,
        recipientIsOwner,
        paidCancellation,
        ownerDebt,
      );
      subject = paidMessage.subject;
      intro = paidMessage.intro;
      extraHtml = paidMessage.financialHtml;
    } else {
      [subject, intro] = templates[language][event as StandardEmailEvent];
    }

    const { data: insertedLogRow, error: logError } = await admin
      .from("reservation_email_deliveries")
      .insert({
        reservation_id: reservation.id,
        event_type: event,
        recipient_id: profile.id,
        recipient_email: profile.email,
        status: "sending",
      })
      .select("id")
      .single();

    let logRow = insertedLogRow;

    if (logError) {
      if (logError.code !== "23505") {
        return response({ error: "Email delivery log failed" }, 500);
      }

      const { data: existingDelivery, error: existingDeliveryError } = await admin
        .from("reservation_email_deliveries")
        .select("id, status")
        .eq("reservation_id", reservation.id)
        .eq("event_type", event)
        .eq("recipient_id", profile.id)
        .single();

      if (existingDeliveryError || !existingDelivery) {
        return response({ error: "Existing email delivery lookup failed" }, 500);
      }

      if (existingDelivery.status !== "failed") {
        results.push({ recipient_id: profile.id, status: "duplicate" });
        continue;
      }

      const { data: retryLogRow, error: retryLogError } = await admin
        .from("reservation_email_deliveries")
        .update({
          recipient_email: profile.email,
          status: "sending",
          provider_message_id: null,
          error_message: null,
          sent_at: null,
        })
        .eq("id", existingDelivery.id)
        .select("id")
        .single();

      if (retryLogError || !retryLogRow) {
        return response({ error: "Failed email delivery could not be retried" }, 500);
      }

      logRow = retryLogRow;
    }

    if (!logRow) {
      return response({ error: "Email delivery log failed" }, 500);
    }

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#103f32;font-size:16px;line-height:1.5">
        <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.25;font-weight:700;color:#103f32">${escapeHtml(subject)}</h1>
        <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">${escapeHtml(intro)}</p>
        <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32"><strong>${escapeHtml(offerName)}</strong><br>${escapeHtml(dateText)}</p>
        ${extraHtml}
        <p style="margin:18px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5"><a href="${escapeHtml(detailUrl)}" style="display:inline-block;padding:12px 18px;background:#75d94f;color:#103f32;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.25;font-weight:700">Rentulo</a></p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#66736f">Rentulo</p>
      </div>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [profile.email],
        subject,
        html,
      }),
    });

    const resendBody = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      await admin
        .from("reservation_email_deliveries")
        .update({ status: "failed", error_message: JSON.stringify(resendBody).slice(0, 1000) })
        .eq("id", logRow.id);
      return response({ error: "Email provider rejected the message" }, 502);
    }

    await admin
      .from("reservation_email_deliveries")
      .update({
        status: "sent",
        provider_message_id: resendBody.id || null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", logRow.id);

    results.push({ recipient_id: profile.id, status: "sent" });
  }

  return response({ ok: true, results });
});
