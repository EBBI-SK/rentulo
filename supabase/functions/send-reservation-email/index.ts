import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shouldDeliverReservationEmail } from "../_shared/notification-email-policy.mjs";
import { pragueRentalInstant } from "../_shared/prague-rental-window.mjs";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

// Never send users to a different Rentulo environment. A missing SITE_URL
// uses the canonical address for this Supabase project; a mismatch fails closed.
function resolveRentuloSiteUrl(
  supabaseUrl: string | undefined,
  configuredSiteUrl: string | undefined,
): string | null {
  const projectUrl = (supabaseUrl || "").trim().replace(/\/+$/, "");
  const expectedUrl =
    projectUrl === "https://vspposovhdgvbeukoivh.supabase.co" ? "https://rentulo.eu" :
    projectUrl === "https://tfvgxrdjrpicgtvovehl.supabase.co" ? "https://rentulo.com" : null;
  if (!expectedUrl) return null;
  const configured = (configuredSiteUrl || "").trim();
  return !configured || configured === expectedUrl || configured === `${expectedUrl}/`
    ? expectedUrl
    : null;
}

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
  | "paid_cancelled"
  | "expiry_reminder_pending"
  | "expiry_reminder_approved"
  | "expired_pending"
  | "expired_approved"
  | "no_show"
  | "return_reminder_30m"
  | "return_reminder_2h"
  | "return_not_received";

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
  expiry_reminder_pending: "pending",
  expiry_reminder_approved: "approved",
  expired_pending: "expired",
  expired_approved: "expired",
  no_show: "no_show",
  return_reminder_30m: "picked_up",
  return_reminder_2h: "picked_up",
  return_not_received: "picked_up",
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
    expiry_reminder_pending: ["Žádost brzy vyprší", "Na vaši reakci zbývají nejvýše 4 hodiny. Rozhodněte o žádosti, jinak se termín automaticky uvolní."],
    expiry_reminder_approved: ["Čas na zaplacení končí", "Lhůta pro zaplacení brzy uplyne. Přesný termín je uveden níže. Pokud nezaplatíte včas, rezervace vyprší."],
    expired_pending: ["Žádost vypršela", "Majitel žádost nepotvrdil ve stanovené lhůtě. Rezervace vypršela a termín je znovu volný."],
    expired_approved: ["Nezaplacená rezervace vypršela", "Platbu jste nedokončili ve stanovené lhůtě. Rezervace vypršela a termín je znovu volný."],
    no_show: ["Věc nebyla vyzvednuta", "Věc jste si nevyzvedli do konce celého zaplaceného období. Rezervace byla automaticky ukončena, termín je opět dostupný a platba se automaticky nevrací. Pokud majitel věc nepřipravil, můžete případ reklamovat."],
    return_reminder_30m: ['Připomeňte potvrzení vrácení věci', 'Od sjednaného času vrácení uplynulo 30 minut. Pokud už máte věc zpět, potvrďte vrácení v Moje nabídky. Neznamená to, že nájemce věc nevrátil.'],
    return_reminder_2h: ['Vrácení stále není potvrzené', 'Od sjednaného času vrácení uplynuly 2 hodiny. Pokud máte věc zpět, potvrďte vrácení. Jen pokud se věc skutečně nevrátila, můžete v Moje nabídky nahlásit problém.'],
    return_not_received: ['Majitel nahlásil nevrácení věci', 'Majitel uvedl, že věc nebyla vrácena ve sjednaném termínu. Spojte se s majitelem a situaci vyřešte. Nahlášení automaticky neznamená pokutu ani změnu platby.'],
  },
  sk: {
    new_request: ["Nová žiadosť o požičanie", "Pri vašej ponuke čaká nová žiadosť o požičanie."],
    approved: ["Žiadosť bola schválená", "Majiteľ vašu žiadosť schválil. Rezerváciu teraz môžete zaplatiť."],
    rejected: ["Žiadosť bola odmietnutá", "Majiteľ vašu žiadosť o požičanie odmietol."],
    cancelled: ["Rezervácia bola zrušená", "Rezervácia bola zrušená a termín je znova voľný."],
    paid: ["Rezervácia bola zaplatená", "Platba bola potvrdená. Kontaktné údaje sú teraz dostupné účastníkom rezervácie."],
    picked_up: ["Vec bola vyzdvihnutá", "Majiteľ označil vec ako vyzdvihnutú."],
    returned: ["Vec bola vrátená", "Požičanie bolo označené ako dokončené."],
    expiry_reminder_pending: ["Žiadosť čoskoro vyprší", "Na vašu reakciu zostávajú najviac 4 hodiny. Rozhodnite o žiadosti, inak sa termín automaticky uvoľní."],
    expiry_reminder_approved: ["Čas na zaplatenie sa končí", "Lehota na zaplatenie čoskoro uplynie. Presný termín je uvedený nižšie. Ak nezaplatíte včas, rezervácia vyprší."],
    expired_pending: ["Žiadosť vypršala", "Majiteľ žiadosť nepotvrdil v stanovenej lehote. Rezervácia vypršala a termín je opäť voľný."],
    expired_approved: ["Nezaplatená rezervácia vypršala", "Platbu ste nedokončili v stanovenej lehote. Rezervácia vypršala a termín je opäť voľný."],
    no_show: ["Vec nebola vyzdvihnutá", "Vec ste si nevyzdvihli do konca celého zaplateného obdobia. Rezervácia sa automaticky ukončila, termín je opäť dostupný a platba sa automaticky nevracia. Ak majiteľ vec nepripravil, môžete prípad reklamovať."],
    return_reminder_30m: ['Pripomeňte si potvrdenie vrátenia veci', 'Od dohodnutého času vrátenia uplynulo 30 minút. Ak už máte vec späť, potvrďte vrátenie v Moje ponuky. Neznamená to, že nájomca vec nevrátil.'],
    return_reminder_2h: ['Vrátenie stále nie je potvrdené', 'Od dohodnutého času vrátenia uplynuli 2 hodiny. Ak máte vec späť, potvrďte vrátenie. Iba ak vec skutočne nebola vrátená, môžete v Moje ponuky nahlásiť problém.'],
    return_not_received: ['Majiteľ nahlásil nevrátenie veci', 'Majiteľ uviedol, že vec nebola vrátená v dohodnutom čase. Spojte sa s majiteľom a situáciu vyriešte. Nahlásenie automaticky neznamená pokutu ani zmenu platby.'],
  },
  en: {
    new_request: ["New rental request", "A new rental request is waiting for your listing."],
    approved: ["Request approved", "The owner approved your request. You can now complete the payment."],
    rejected: ["Request rejected", "The owner rejected your rental request."],
    cancelled: ["Reservation cancelled", "The reservation was cancelled and the dates are available again."],
    paid: ["Reservation paid", "Payment was confirmed. Contact details are now available to the reservation participants."],
    picked_up: ["Item picked up", "The owner marked the item as picked up."],
    returned: ["Item returned", "The rental was marked as completed."],
    expiry_reminder_pending: ["Rental request expires soon", "You have up to 4 hours left to respond. Approve or reject the request before its deadline."],
    expiry_reminder_approved: ["Payment deadline approaching", "The payment deadline is approaching. See the exact time below. Your reservation will expire unless payment is completed in time."],
    expired_pending: ["Rental request expired", "The owner did not approve the request within the deadline. The rental dates are available again."],
    expired_approved: ["Unpaid reservation expired", "You did not complete the payment before the deadline. The reservation has expired and the dates are available again."],
    no_show: ["Item not collected", "You did not collect the item by the end of the entire paid rental period. The reservation has closed automatically, the dates are available again and the payment is not automatically refunded. You may dispute a failure by the owner to provide the item."],
    return_reminder_30m: ['Please confirm the return if completed', '30 minutes have passed since the agreed return time. If you already have your item back, confirm its return in My listings. This does not mean the renter failed to return it.'],
    return_reminder_2h: ['The return is still unconfirmed', 'Two hours have passed since the agreed return time. If the item was returned, confirm it. Only if the item was not actually returned should you report a problem in My listings.'],
    return_not_received: ['Owner reported an item not returned', 'The owner reported that the item was not returned at the agreed time. Please contact the owner to resolve the matter. This report does not automatically impose a penalty or change any payment.'],
  },
  de: {
    new_request: ["Neue Mietanfrage", "Für Ihr Angebot wartet eine neue Mietanfrage."],
    approved: ["Anfrage bestätigt", "Der Eigentümer hat Ihre Anfrage bestätigt. Sie können jetzt die Zahlung abschließen."],
    rejected: ["Anfrage abgelehnt", "Der Eigentümer hat Ihre Mietanfrage abgelehnt."],
    cancelled: ["Reservierung storniert", "Die Reservierung wurde storniert und der Zeitraum ist wieder verfügbar."],
    paid: ["Reservierung bezahlt", "Die Zahlung wurde bestätigt. Die Kontaktdaten sind jetzt für die Beteiligten sichtbar."],
    picked_up: ["Gegenstand abgeholt", "Der Eigentümer hat den Gegenstand als abgeholt markiert."],
    returned: ["Gegenstand zurückgegeben", "Die Vermietung wurde als abgeschlossen markiert."],
    expiry_reminder_pending: ["Mietanfrage läuft bald ab", "Sie haben höchstens 4 Stunden, um zu reagieren. Entscheiden Sie vor Ablauf der Frist über die Anfrage."],
    expiry_reminder_approved: ["Zahlungsfrist endet bald", "Die Zahlungsfrist endet bald. Die genaue Uhrzeit steht unten. Ohne rechtzeitige Zahlung verfällt die Reservierung."],
    expired_pending: ["Mietanfrage abgelaufen", "Der Eigentümer hat die Anfrage nicht innerhalb der Frist bestätigt. Der Zeitraum ist wieder frei."],
    expired_approved: ["Unbezahlte Reservierung abgelaufen", "Sie haben die Zahlung nicht fristgerecht abgeschlossen. Die Reservierung ist abgelaufen und der Zeitraum wieder frei."],
    no_show: ["Gegenstand nicht abgeholt", "Sie haben den Gegenstand bis zum Ende des gesamten bezahlten Mietzeitraums nicht abgeholt. Die Buchung wurde automatisch beendet, der Zeitraum ist wieder frei und die Zahlung wird nicht automatisch erstattet. War der Gegenstand nicht verfügbar, können Sie dies reklamieren."],
    return_reminder_30m: ['Bitte bestätigen Sie die Rückgabe', 'Seit der vereinbarten Rückgabe sind 30 Minuten vergangen. Wenn Sie den Gegenstand bereits zurückerhalten haben, bestätigen Sie dies unter Meine Angebote. Dies ist keine Feststellung einer verspäteten Rückgabe.'],
    return_reminder_2h: ['Rückgabe weiterhin nicht bestätigt', 'Seit der vereinbarten Rückgabe sind zwei Stunden vergangen. Bestätigen Sie die Rückgabe, wenn Sie den Gegenstand zurückhaben. Melden Sie nur dann ein Problem, wenn er tatsächlich nicht zurückgegeben wurde.'],
    return_not_received: ['Eigentümer meldet ausstehende Rückgabe', 'Der Eigentümer hat gemeldet, dass der Gegenstand nicht rechtzeitig zurückgegeben wurde. Bitte klären Sie die Situation direkt mit dem Eigentümer. Durch die Meldung entstehen keine automatischen Strafen oder Zahlungsänderungen.'],
  },
  pl: {
    new_request: ["Nowa prośba o wypożyczenie", "Nowa prośba o wypożyczenie oczekuje przy Twojej ofercie."],
    approved: ["Prośba została zaakceptowana", "Właściciel zaakceptował Twoją prośbę. Możesz teraz dokończyć płatność."],
    rejected: ["Prośba została odrzucona", "Właściciel odrzucił Twoją prośbę o wypożyczenie."],
    cancelled: ["Rezerwacja została anulowana", "Rezerwacja została anulowana, a termin jest ponownie dostępny."],
    paid: ["Rezerwacja została opłacona", "Płatność została potwierdzona. Dane kontaktowe są teraz dostępne dla uczestników rezerwacji."],
    picked_up: ["Rzecz została odebrana", "Właściciel oznaczył rzecz jako odebraną."],
    returned: ["Rzecz została zwrócona", "Wypożyczenie zostało oznaczone jako zakończone."],
    expiry_reminder_pending: ["Prośba wkrótce wygaśnie", "Pozostały maksymalnie 4 godziny na decyzję. Odpowiedz na prośbę przed upływem terminu."],
    expiry_reminder_approved: ["Termin płatności wkrótce minie", "Termin płatności wkrótce minie. Dokładną godzinę podano poniżej. Jeśli nie zapłacisz w terminie, rezerwacja wygaśnie."],
    expired_pending: ["Prośba wygasła", "Właściciel nie zatwierdził prośby w wyznaczonym terminie. Daty są ponownie dostępne."],
    expired_approved: ["Nieopłacona rezerwacja wygasła", "Nie udało Ci się dokończyć płatności w wyznaczonym terminie. Rezerwacja wygasła, a daty są ponownie dostępne."],
    no_show: ["Rzecz nie została odebrana", "Nie odebrano rzeczy do końca całego opłaconego okresu najmu. Rezerwacja została automatycznie zakończona, termin jest ponownie dostępny, a płatność nie jest automatycznie zwracana. Jeśli właściciel nie udostępnił rzeczy, można zgłosić reklamację."],
    return_reminder_30m: ['Potwierdź zwrot rzeczy, jeśli już nastąpił', 'Minęło 30 minut od uzgodnionej godziny zwrotu. Jeśli rzecz została zwrócona, potwierdź to w Moich ofertach. Nie oznacza to, że najemca nie oddał rzeczy.'],
    return_reminder_2h: ['Zwrot nadal nie jest potwierdzony', 'Minęły 2 godziny od umówionego zwrotu. Jeśli rzecz wróciła, potwierdź zwrot. Zgłoś problem w Moich ofertach tylko wtedy, gdy rzecz rzeczywiście nie została oddana.'],
    return_not_received: ['Właściciel zgłosił brak zwrotu', 'Właściciel zgłosił, że rzecz nie została zwrócona w ustalonym terminie. Skontaktuj się z właścicielem i wyjaśnij sytuację. Zgłoszenie nie oznacza automatycznej kary ani zmiany płatności.'],
  },
};

// Expiration is delivered to both parties: use the recipient perspective, not one shared sentence.
const expiredOwnerIntros: Record<SupportedLanguage, Record<"expired_pending" | "expired_approved", string>> = {
  cs: {
    expired_pending: "Žádost jste nepotvrdili ve stanovené lhůtě. Rezervace vypršela a termín je znovu volný.",
    expired_approved: "Zájemce nedokončil platbu ve stanovené lhůtě. Rezervace vypršela a termín je znovu volný.",
  },
  sk: {
    expired_pending: "Žiadosť ste nepotvrdili v stanovenej lehote. Rezervácia vypršala a termín je opäť voľný.",
    expired_approved: "Záujemca nedokončil platbu v stanovenej lehote. Rezervácia vypršala a termín je opäť voľný.",
  },
  en: {
    expired_pending: "You did not approve the request before the deadline. The reservation has expired and the dates are available again.",
    expired_approved: "The renter did not complete the payment before the deadline. The reservation has expired and the dates are available again.",
  },
  de: {
    expired_pending: "Sie haben die Anfrage nicht fristgerecht bestätigt. Die Reservierung ist abgelaufen und der Zeitraum wieder frei.",
    expired_approved: "Der Mieter hat die Zahlung nicht fristgerecht abgeschlossen. Die Reservierung ist abgelaufen und der Zeitraum wieder frei.",
  },
  pl: {
    expired_pending: "Nie udało Ci się zatwierdzić prośby w wyznaczonym terminie. Rezerwacja wygasła, a daty są ponownie dostępne.",
    expired_approved: "Najemca nie dokończył płatności w wyznaczonym terminie. Rezerwacja wygasła, a daty są ponownie dostępne.",
  },
};

const noShowOwnerIntros: Record<SupportedLanguage, string> = {
  cs: "Zájemce si věc nevyzvedl během celého zaplaceného období. Rezervace byla ukončena, termín je uvolněn a Rentulo automaticky zpracovává vaši výplatu.",
  sk: "Záujemca si vec nevyzdvihol počas celého zaplateného obdobia. Rezervácia sa ukončila, termín sa uvoľnil a Rentulo automaticky spracúva vašu výplatu.",
  en: "The renter did not collect the item during the entire paid rental period. The reservation is closed, the dates are available again, and Rentulo is processing your payout automatically.",
  de: "Der Mieter hat den Gegenstand während des gesamten bezahlten Mietzeitraums nicht abgeholt. Die Buchung ist beendet, der Zeitraum ist wieder frei und Rentulo bearbeitet Ihre Auszahlung automatisch.",
  pl: "Najemca nie odebrał rzeczy przez cały opłacony okres najmu. Rezerwacja została zakończona, termin jest ponownie dostępny, a Rentulo automatycznie przetwarza wypłatę.",
};

const referenceLabels: Record<SupportedLanguage, { offer: string; reservation: string }> = {
  cs: { offer: "Číslo nabídky", reservation: "Číslo rezervace" },
  sk: { offer: "Číslo ponuky", reservation: "Číslo rezervácie" },
  en: { offer: "Listing number", reservation: "Reservation number" },
  de: { offer: "Angebotsnummer", reservation: "Reservierungsnummer" },
  pl: { offer: "Numer oferty", reservation: "Numer rezerwacji" },
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
  const siteUrl = resolveRentuloSiteUrl(supabaseUrl, denoRuntime.env.get("SITE_URL"));

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !emailFrom || !siteUrl) {
    console.error("send-reservation-email: missing or mismatched server configuration");
    return response({ error: "Missing or invalid server configuration" }, 500);
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

  let payload: {
    reservation_id?: string;
    event?: EmailEvent;
    recipient_id?: string;
    notification_delivery_id?: string;
  };
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

  const isWorkerDelivery = isServiceRoleCall &&
    typeof payload.recipient_id === "string" &&
    typeof payload.notification_delivery_id === "string";

  if (!isServiceRoleCall && (payload.recipient_id || payload.notification_delivery_id)) {
    return response({ error: "Only the trusted notification worker can select recipients" }, 403);
  }

  if (isServiceRoleCall && !isWorkerDelivery && event !== "paid" && event !== "paid_cancelled") {
    return response({ error: "Service role requires a claimed delivery for non-payment email events" }, 403);
  }

  if (isWorkerDelivery) {
    // The worker must own a real, claimed DB delivery: the server cannot
    // forge the recipient or bypass the transactional event outbox.
    const { data: delivery, error: deliveryError } = await admin
      .from("reservation_notification_deliveries")
      .select("id")
      .eq("id", payload.notification_delivery_id)
      .eq("reservation_id", reservationId)
      .eq("event_type", event)
      .eq("recipient_id", payload.recipient_id)
      .eq("channel", "email")
      .eq("status", "sending")
      .maybeSingle();
    if (deliveryError || !delivery) {
      return response({ error: "Claimed notification delivery not found" }, 403);
    }
  }

  if (!isServiceRoleCall && event === "paid_cancelled") {
    return response({ error: "Paid cancellation email requires service role" }, 403);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("reservations")
    .select("id, offer_id, owner_id, renter_id, offer_name, start_date, end_date, pickup_time, status, reservation_number, expires_at")
    .eq("id", reservationId)
    .single();

  if (reservationError || !reservation) {
    return response({ error: "Reservation not found" }, 404);
  }

  // Queued events are proof of the status *at the transaction time*.
  // A later transition must not silently drop an already queued email.
  // Normal browser calls still require the current status.
  const isExpiryEvent = event.startsWith("expiry_") || event.startsWith("expired_") || event === "no_show";
  const isReturnReminder = event === "return_reminder_30m" || event === "return_reminder_2h";
  const isReturnEvent = isReturnReminder || event === "return_not_received";
  if (!isServiceRoleCall && isReturnEvent) {
    return response({ error: "Return follow-up requires a claimed server delivery" }, 403);
  }
  if (isWorkerDelivery && isReturnEvent) {
    // No reminder after a confirmed return or an owner report, and no renter
    // alert after that report was resolved. Fail closed on lookup errors.
    const isExpectedRecipient = isReturnReminder
      ? payload.recipient_id === reservation.owner_id
      : payload.recipient_id === reservation.renter_id;
    if (!isExpectedRecipient) {
      return response({ error: "Invalid return follow-up recipient" }, 403);
    }
    const { data: issue, error: issueError } = await admin
      .from("reservation_return_incidents")
      .select("reported_at, resolved_at")
      .eq("reservation_id", reservation.id)
      .maybeSingle();
    if (issueError) {
      return response({ error: "Return follow-up state unavailable" }, 409);
    }
    const due = pragueRentalInstant(reservation.end_date, reservation.pickup_time);
    const elapsed = due === null ? -1 : Date.now() - due;
    const shouldSkip = reservation.status !== "picked_up" ||
      (isReturnReminder && (
        issue !== null ||
        (event === "return_reminder_30m" && (elapsed < 30 * 60000 || elapsed >= 120 * 60000)) ||
        (event === "return_reminder_2h" && elapsed < 120 * 60000)
      )) ||
      (event === "return_not_received" && (!issue || issue.resolved_at));
    if (shouldSkip) {
      return response({ ok: true, results: [
        { recipient_id: payload.recipient_id, status: "skipped" }
      ] });
    }
  }
  if (!isServiceRoleCall && isExpiryEvent) {
    return response({ error: "Expiration mail requires a claimed delivery" }, 403);
  }
  if (isWorkerDelivery && event.startsWith("expiry_reminder_") &&
      (reservation.status !== eventStatus[event] || !reservation.expires_at ||
       new Date(reservation.expires_at).getTime() <= Date.now())) {
    return response({ ok: true, results: [
      { recipient_id: payload.recipient_id, status: "skipped" }
    ] });
  }
  if (!isWorkerDelivery && reservation.status !== eventStatus[event]) {
    return response({ error: "Reservation status does not match the email event" }, 409);
  }
  if (isWorkerDelivery && event === "no_show" && reservation.status !== "no_show") {
    return response({ error: "No-show reservation state is inconsistent" }, 409);
  }
  if (isWorkerDelivery && event === "paid_cancelled" && reservation.status !== "cancelled") {
    return response({ error: "Paid cancellation status is inconsistent" }, 409);
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

  const { data: offerReference, error: offerReferenceError } = await admin
    .from("offers")
    .select("offer_number")
    .eq("id", reservation.offer_id)
    .single();

  if (offerReferenceError || !offerReference) {
    return response({ error: "Offer reference lookup failed" }, 500);
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
  if (isWorkerDelivery) {
    if (payload.recipient_id !== reservation.owner_id &&
        payload.recipient_id !== reservation.renter_id) {
      return response({ error: "Recipient is not in the reservation" }, 403);
    }
    recipientIds = [payload.recipient_id as string];
  } else if (event === "new_request" || event === "paid" || event === "expiry_reminder_pending") {
    recipientIds = [reservation.owner_id];
  } else if (event === "paid_cancelled" || event === "expired_pending" || event === "expired_approved" || event === "no_show") {
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
    // Transactional, deadline and financial emails bypass optional notification
    // preferences; only informational events respect email_notifications=false.
    if (!shouldDeliverReservationEmail(event, profile.email, profile.email_notifications)) {
      results.push({ recipient_id: profile.id, status: "skipped" });
      continue;
    }

    const language = normalizeLanguage(profile.preferred_language);
    const recipientIsOwner = profile.id === reservation.owner_id;
    const isExpirationNotice = event === "expired_pending" || event === "expired_approved" || event === "no_show";
    const detailUrl = `${siteUrl}/${isExpirationNotice ? "historie.html" : recipientIsOwner ? "moje-nabidky.html" : "moje-rezervace.html"}`;
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
      if (recipientIsOwner && (event === "expired_pending" || event === "expired_approved")) {
        intro = expiredOwnerIntros[language][event];
      }
      if (recipientIsOwner && event === "no_show") {
        intro = noShowOwnerIntros[language];
      }
      if (event.startsWith("expiry_reminder_") && reservation.expires_at) {
        const deadline = new Intl.DateTimeFormat(dateLocales[language], {
          dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague",
        }).format(new Date(reservation.expires_at));
        const label = {
          cs: "Nejpozději do", sk: "Najneskôr do", en: "Deadline",
          de: "Frist", pl: "Termin",
        }[language];
        extraHtml = `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(deadline)} (Praha)</p>`;
      }
      if (isReturnEvent && reservation.pickup_time) {
        const returnInstant = pragueRentalInstant(reservation.end_date, reservation.pickup_time);
        if (returnInstant !== null) {
          const dueLabel = {
            cs: "Sjednané vrácení", sk: "Dohodnuté vrátenie", en: "Agreed return",
            de: "Vereinbarte Rückgabe", pl: "Uzgodniony zwrot"
          }[language];
          const dueText = new Intl.DateTimeFormat(dateLocales[language], {
            dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague",
          }).format(new Date(returnInstant));
          extraHtml += `<p><strong>${escapeHtml(dueLabel)}:</strong> ${escapeHtml(dueText)} (Praha)</p>`;
        }
      }
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
        .select("id, status, created_at")
        .eq("reservation_id", reservation.id)
        .eq("event_type", event)
        .eq("recipient_id", profile.id)
        .single();

      if (existingDeliveryError || !existingDelivery) {
        return response({ error: "Existing email delivery lookup failed" }, 500);
      }

      if (existingDelivery.status === "sent") {
        results.push({ recipient_id: profile.id, status: "duplicate" });
        continue;
      }

      if (existingDelivery.status === "sending" &&
          Date.now() - new Date(existingDelivery.created_at).getTime() < 180000) {
        // Do not report success for a fresh in-flight request. The outbox
        // will retry later if its original worker died.
        results.push({ recipient_id: profile.id, status: "in_progress" });
        continue;
      }

      // Failed or stranded requests are safe to resubmit with Resend's
      // stable Idempotency-Key (same log row ID on every attempt).

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
        <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#103f32">${escapeHtml(referenceLabels[language].reservation)}: <strong>${escapeHtml(reservation.reservation_number)}</strong><br>${escapeHtml(referenceLabels[language].offer)}: <strong>${escapeHtml(offerReference.offer_number)}</strong></p>
        ${extraHtml}
        <p style="margin:18px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5"><a href="${escapeHtml(detailUrl)}" style="display:inline-block;padding:12px 18px;background:#75d94f;color:#103f32;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.25;font-weight:700">Rentulo</a></p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#66736f">Rentulo</p>
      </div>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `rentulo-${logRow.id}`,
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
