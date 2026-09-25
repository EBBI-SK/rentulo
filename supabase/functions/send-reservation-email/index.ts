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
  | "returned";

const eventStatus: Record<EmailEvent, string> = {
  new_request: "pending",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  paid: "paid",
  picked_up: "picked_up",
  returned: "returned",
};

const templates = {
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
} as const;

type SupportedLanguage = keyof typeof templates;

function normalizeLanguage(value: unknown): SupportedLanguage {
  return value === "sk" || value === "en" || value === "de" || value === "pl"
    ? value
    : "cs";
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

  if (isServiceRoleCall && event !== "paid") {
    return response({ error: "Service role is only allowed for paid email events" }, 403);
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

  let recipientIds: string[];
  if (event === "new_request" || event === "paid") {
    recipientIds = [reservation.owner_id];
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
    const [subject, intro] = templates[language][event];
    const recipientIsOwner = profile.id === reservation.owner_id;
    const detailUrl = `${siteUrl}/${recipientIsOwner ? "moje-nabidky.html" : "moje-rezervace.html"}`;
    const offerName = reservation.offer_name || "Rentulo";
    const dateText = `${reservation.start_date} – ${reservation.end_date}`;

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
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#103f32">
        <h1 style="font-size:24px">${escapeHtml(subject)}</h1>
        <p>${escapeHtml(intro)}</p>
        <p><strong>${escapeHtml(offerName)}</strong><br>${escapeHtml(dateText)}</p>
        <p><a href="${escapeHtml(detailUrl)}" style="display:inline-block;padding:12px 18px;background:#75d94f;color:#103f32;text-decoration:none;border-radius:10px;font-weight:700">Rentulo</a></p>
        <p style="font-size:12px;color:#66736f">Rentulo</p>
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
