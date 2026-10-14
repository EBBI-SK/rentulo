// Stripe Checkout supports Rentulo's five UI locales; never trust an arbitrary
// locale from the browser. The locale is presentation-only, never financial.
export const RENTULO_STRIPE_LOCALES = Object.freeze(["cs", "sk", "en", "de", "pl"]);

export function normalizeStripeCheckoutLocale(value) {
  return typeof value === "string" && RENTULO_STRIPE_LOCALES.includes(value)
    ? value
    : "cs";
}

const ownerDebtProductNames = Object.freeze({
  cs: "Rentulo – Úhrada nákladů storna",
  sk: "Rentulo – Úhrada nákladov storna",
  en: "Rentulo – Payment of cancellation costs",
  de: "Rentulo – Zahlung der Stornokosten",
  pl: "Rentulo – Opłata za koszty anulowania",
});

// Existing owner-debt sessions used this exact ASCII product name and omitted
// locale. Keep it identical for pre-migration Stripe idempotency keys.
export const LEGACY_OWNER_DEBT_PRODUCT_NAME = "Rentulo - uhrada nakladu storna";

export function ownerDebtCheckoutProductName(locale) {
  return ownerDebtProductNames[normalizeStripeCheckoutLocale(locale)];
}
