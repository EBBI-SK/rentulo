"use strict";

// Platform feedback only. Peer-to-peer reviews and Historie are untouched.
const platformReviewCopy = {
  cs: {
    title: "Zkušenosti s Rentulem", subtitle: "Přečtěte si, co říkají lidé, kteří Rentulo skutečně využili.", back: "← Zpět",
    count: "z {n} hodnocení", verified: "✓ Pouze ověřené zkušenosti", badge: "✓ Ověřený pronájem",
    empty: "Zatím tu nejsou žádná hodnocení. První zkušenosti přibudou po skutečných pronájmech.", error: "Hodnocení se teď nepodařilo načíst.", more: "Zobrazit další hodnocení ↓",
    writeTitle: "Chcete se podělit o zkušenost?", writeDescription: "Ohodnotit Rentulo můžete po dokončeném pronájmu.", write: "Napsat hodnocení", edit: "Upravit své hodnocení",
    signIn: "Pro napsání hodnocení se prosím přihlaste.", ineligible: "Hodnocení mohou napsat uživatelé po skutečně dokončeném pronájmu.",
    formTitle: "Jak se vám Rentulo používalo?", ratingLabel: "Vaše hodnocení", commentLabel: "Krátký komentář (nepovinný)", commentPlaceholder: "Co vám na Rentulu vyhovovalo a co by se dalo zlepšit?",
    privacy: "Zveřejníme pouze vaše křestní jméno a iniciálu příjmení. Do komentáře nepište osobní údaje.", cancel: "Zrušit", send: "Odeslat hodnocení",
    sending: "Odesílání…", success: "Děkujeme! Vaše hodnocení jsme přijali.\nPřed zveřejněním kontrolujeme pouze spam, urážky a osobní údaje. Zveřejňujeme všechna hodnocení, pozitivní i negativní, která neporušují pravidla.", sendError: "Hodnocení se nepodařilo odeslat. Zkuste to prosím znovu.",
    waiting: "Vaše hodnocení čeká na zveřejnění.", starAria: "{n} z 5 hvězdiček"
  },
  sk: {
    title: "Skúsenosti s Rentulom", subtitle: "Prečítajte si skúsenosti ľudí, ktorí Rentulo naozaj využili.", back: "← Späť",
    count: "z {n} hodnotení", verified: "✓ Iba overené skúsenosti", badge: "✓ Overený prenájom",
    empty: "Zatiaľ tu nie sú žiadne hodnotenia. Prvé skúsenosti pribudnú po skutočných prenájmoch.", error: "Hodnotenia sa teraz nepodarilo načítať.", more: "Zobraziť ďalšie hodnotenia ↓",
    writeTitle: "Chcete sa podeliť o skúsenosť?", writeDescription: "Rentulo môžete ohodnotiť po dokončenom prenájme.", write: "Napísať hodnotenie", edit: "Upraviť svoje hodnotenie",
    signIn: "Ak chcete napísať hodnotenie, prihláste sa.", ineligible: "Hodnotenie môžu napísať používatelia po skutočne dokončenom prenájme.",
    formTitle: "Ako sa vám Rentulo používalo?", ratingLabel: "Vaše hodnotenie", commentLabel: "Krátky komentár (nepovinný)", commentPlaceholder: "Čo sa vám páčilo a čo by sa dalo zlepšiť?",
    privacy: "Zverejníme iba krstné meno a iniciálu priezviska. Do komentára nepíšte osobné údaje.", cancel: "Zrušiť", send: "Odoslať hodnotenie",
    sending: "Odosielanie…", success: "Ďakujeme! Vaše hodnotenie sme prijali.\nPred zverejnením kontrolujeme iba spam, urážky a osobné údaje. Zverejňujeme všetky hodnotenia, pozitívne aj negatívne, ktoré neporušujú pravidlá.", sendError: "Hodnotenie sa nepodarilo odoslať. Skúste to znova.",
    waiting: "Vaše hodnotenie čaká na zverejnenie.", starAria: "{n} z 5 hviezdičiek"
  },
  en: {
    title: "Experiences with Rentulo", subtitle: "Read feedback from people who have actually used Rentulo.", back: "← Back",
    count: "from {n} ratings", verified: "✓ Verified experiences only", badge: "✓ Verified rental",
    empty: "There are no reviews yet. The first reviews will appear after completed rentals.", error: "Reviews could not be loaded right now.", more: "Load more reviews ↓",
    writeTitle: "Want to share your experience?", writeDescription: "You can rate Rentulo after a completed rental.", write: "Write a review", edit: "Edit your review",
    signIn: "Please sign in to write a review.", ineligible: "Only users with a confirmed completed rental can post a review.",
    formTitle: "How was your Rentulo experience?", ratingLabel: "Your rating", commentLabel: "Short comment (optional)", commentPlaceholder: "What worked well, and what could be improved?",
    privacy: "We only show your first name and last-name initial. Please do not include personal information.", cancel: "Cancel", send: "Submit review",
    sending: "Submitting…", success: "Thank you! We have received your review.\nBefore publication, we check only for spam, insults, and personal information. We publish all reviews, positive and negative, that follow the rules.", sendError: "We couldn't submit your review. Please try again.",
    waiting: "Your review is awaiting publication.", starAria: "{n} of 5 stars"
  },
  de: {
    title: "Erfahrungen mit Rentulo", subtitle: "Erfahrungen von Menschen, die Rentulo tatsächlich genutzt haben.", back: "← Zurück",
    count: "aus {n} Bewertungen", verified: "✓ Nur verifizierte Erfahrungen", badge: "✓ Verifizierte Miete",
    empty: "Noch keine Bewertungen. Die ersten Erfahrungen folgen nach abgeschlossenen Vermietungen.", error: "Bewertungen konnten nicht geladen werden.", more: "Weitere Bewertungen anzeigen ↓",
    writeTitle: "Möchten Sie Ihre Erfahrung teilen?", writeDescription: "Sie können Rentulo nach einer abgeschlossenen Miete bewerten.", write: "Bewertung schreiben", edit: "Bewertung bearbeiten",
    signIn: "Bitte melden Sie sich an, um eine Bewertung zu schreiben.", ineligible: "Nur Nutzer mit bestätigter abgeschlossener Miete dürfen bewerten.",
    formTitle: "Wie hat Ihnen Rentulo gefallen?", ratingLabel: "Ihre Bewertung", commentLabel: "Kurzer Kommentar (optional)", commentPlaceholder: "Was hat Ihnen gefallen, was könnte besser sein?",
    privacy: "Wir zeigen nur Ihren Vornamen und den Anfangsbuchstaben des Nachnamens. Bitte keine persönlichen Daten eintragen.", cancel: "Abbrechen", send: "Bewertung senden",
    sending: "Wird gesendet…", success: "Vielen Dank! Wir haben Ihre Bewertung erhalten.\nVor der Veröffentlichung prüfen wir nur auf Spam, Beleidigungen und personenbezogene Daten. Wir veröffentlichen alle Bewertungen, positive wie negative, sofern sie nicht gegen die Regeln verstoßen.", sendError: "Bewertung konnte nicht gesendet werden. Bitte erneut versuchen.",
    waiting: "Ihre Bewertung wartet auf Veröffentlichung.", starAria: "{n} von 5 Sternen"
  },
  pl: {
    title: "Opinie o Rentulo", subtitle: "Sprawdź opinie osób, które naprawdę skorzystały z Rentulo.", back: "← Wstecz",
    count: "z {n} ocen", verified: "✓ Tylko zweryfikowane opinie", badge: "✓ Zweryfikowany wynajem",
    empty: "Nie ma jeszcze opinii. Pierwsze pojawią się po zakończonych wynajmach.", error: "Nie udało się pobrać opinii.", more: "Pokaż więcej opinii ↓",
    writeTitle: "Chcesz podzielić się doświadczeniem?", writeDescription: "Możesz ocenić Rentulo po zakończonym wynajmie.", write: "Napisz opinię", edit: "Edytuj swoją opinię",
    signIn: "Zaloguj się, aby napisać opinię.", ineligible: "Oceny mogą dodawać tylko użytkownicy po potwierdzonym zakończeniu wynajmu.",
    formTitle: "Jak oceniasz korzystanie z Rentulo?", ratingLabel: "Twoja ocena", commentLabel: "Krótki komentarz (opcjonalnie)", commentPlaceholder: "Co działało dobrze, a co można poprawić?",
    privacy: "Wyświetlamy tylko imię i inicjał nazwiska. Nie wpisuj danych osobowych.", cancel: "Anuluj", send: "Wyślij opinię",
    sending: "Wysyłanie…", success: "Dziękujemy! Otrzymaliśmy Twoją opinię.\nPrzed publikacją sprawdzamy jedynie spam, obraźliwe treści i dane osobowe. Publikujemy wszystkie opinie, zarówno pozytywne, jak i negatywne, które nie naruszają zasad.", sendError: "Nie udało się wysłać opinii. Spróbuj ponownie.",
    waiting: "Twoja opinia oczekuje na publikację.", starAria: "{n} z 5 gwiazdek"
  }
};

let platformReviewsClient = null;
let platformReviewCurrentUser = null;
let platformReviewMine = null;
let platformReviewSelectedRating = 0;
let platformReviewPageOffset = 0;
let platformReviewHasMore = true;
let platformReviewLoading = false;
let platformReviewSending = false;

function platformReviewLanguage() {
  const lang = typeof window.getRentuloLanguage === "function" ? window.getRentuloLanguage() : "cs";
  return platformReviewCopy[lang] ? lang : "cs";
}
function platformReviewTexts() { return platformReviewCopy[platformReviewLanguage()]; }
function platformReviewEl(id) { return document.getElementById(id); }
function platformReviewSetText(id, text) { const el = platformReviewEl(id); if (el) el.textContent = text; }
function platformReviewLocale() { return {cs:"cs-CZ",sk:"sk-SK",en:"en-GB",de:"de-DE",pl:"pl-PL"}[platformReviewLanguage()]; }

function platformReviewTranslatePage() {
  const t = platformReviewTexts();
  document.title = `${t.title} – Rentulo`;
  const values = {
    platformReviewsBack: t.back, platformReviewsTitle: t.title, platformReviewsSubtitle: t.subtitle,
    platformReviewsVerified: t.verified, platformReviewsEmpty: t.empty, platformReviewsLoadError: t.error,
    platformReviewsMore: t.more, platformReviewsWriteTitle: t.writeTitle,
    platformReviewsWriteDescription: t.writeDescription, platformReviewsWriteButton: platformReviewMine?.rating ? t.edit : t.write,
    platformReviewsFormTitle: t.formTitle, platformReviewsRatingLabel: t.ratingLabel,
    platformReviewsCommentLabel: t.commentLabel, platformReviewsPrivacy: t.privacy,
    platformReviewsCancel: t.cancel, platformReviewsSubmit: platformReviewSending ? t.sending : t.send
  };
  Object.entries(values).forEach(([id, value]) => platformReviewSetText(id, value));
  platformReviewEl("platformReviewsComment").placeholder = t.commentPlaceholder;
  platformReviewEl("platformReviewsStars").setAttribute("aria-label", t.ratingLabel);
  platformReviewEl("platformReviewsStars").querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-label", t.starAria.replace("{n}", button.dataset.rating));
  });
  const summary = platformReviewEl("platformReviewsSummary");
  if (!summary.hidden) {
    const count = Number(summary.dataset.count || 0);
    platformReviewSetText("platformReviewsCount", t.count.replace("{n}", String(count)));
    const avg = Number(summary.dataset.average);
    platformReviewSetText("platformReviewsAverage", avg.toLocaleString(platformReviewLocale(), {minimumFractionDigits:1,maximumFractionDigits:1}));
  }
  document.querySelectorAll(".platform-review-verified").forEach((badge) => { badge.textContent = t.badge; });
  document.querySelectorAll(".platform-review-date[data-review-date]").forEach((el) => {
    el.textContent = platformReviewDate(el.dataset.reviewDate);
  });
}

function platformReviewDate(dateString) {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(platformReviewLocale(), {year:"numeric",month:"numeric",day:"numeric"});
}

function platformReviewRenderCard(review) {
  const card = document.createElement("article");
  card.className = "platform-review-card";
  const author = document.createElement("div");
  author.className = "platform-review-author";
  const avatar = document.createElement("div");
  avatar.className = "platform-review-avatar";
  const name = String(review.display_name || "").trim();
  avatar.textContent = Array.from(name)[0]?.toLocaleUpperCase(platformReviewLocale()) || "R";
  const identity = document.createElement("div");
  identity.className = "platform-review-identity";
  const strong = document.createElement("strong");
  strong.className = "platform-review-name";
  strong.textContent = name;
  const date = document.createElement("time");
  date.className = "platform-review-date";
  date.dataset.reviewDate = review.published_at;
  date.dateTime = review.published_at;
  date.textContent = platformReviewDate(review.published_at);
  identity.append(strong, date);
  author.append(avatar, identity);
  const content = document.createElement("div");
  content.className = "platform-review-content";
  const stars = document.createElement("span");
  stars.className = "platform-review-stars";
  const rating = Number(review.rating);
  stars.textContent = "★".repeat(Math.max(0, Math.min(5, rating))) + "☆".repeat(Math.max(0, 5 - rating));
  stars.setAttribute("aria-label", platformReviewTexts().starAria.replace("{n}", String(rating)));
  const badge = document.createElement("span");
  badge.className = "platform-review-verified";
  badge.textContent = platformReviewTexts().badge;
  const comment = document.createElement("p");
  comment.className = "platform-review-comment";
  comment.textContent = String(review.comment || ""); // Never interpret user input as HTML.
  content.append(stars, badge, comment);
  card.append(author, content);
  return card;
}

async function platformReviewLoadSummary() {
  try {
    const { data, error } = await platformReviewsClient.rpc("get_platform_review_summary");
    if (error) return;
    const summary = Array.isArray(data) ? data[0] : data;
    const count = Number(summary?.rating_count || 0);
    const average = Number(summary?.rating_average);
    const box = platformReviewEl("platformReviewsSummary");
    if (count > 0 && Number.isFinite(average)) {
      box.dataset.count = String(count);
      box.dataset.average = String(average);
      box.hidden = false;
      platformReviewTranslatePage();
    } else {
      box.hidden = true;
    }
  } catch (_error) {
    // The dedicated page remains usable without public statistics.
  }
}

async function platformReviewLoadMore() {
  if (!platformReviewsClient || platformReviewLoading || !platformReviewHasMore) return;
  platformReviewLoading = true;
  const more = platformReviewEl("platformReviewsMore");
  more.disabled = true;
  try {
    const { data, error } = await platformReviewsClient.rpc("get_platform_reviews", { p_offset: platformReviewPageOffset });
    if (error) throw error;
    const reviews = Array.isArray(data) ? data : [];
    reviews.forEach((review) => platformReviewEl("platformReviewsList").appendChild(platformReviewRenderCard(review)));
    platformReviewPageOffset += reviews.length;
    platformReviewHasMore = reviews.length === 6;
    more.hidden = !platformReviewHasMore;
    platformReviewEl("platformReviewsEmpty").hidden = platformReviewPageOffset > 0;
    platformReviewEl("platformReviewsLoadError").hidden = true;
  } catch (_error) {
    more.hidden = true;
    platformReviewEl("platformReviewsLoadError").hidden = false;
    platformReviewEl("platformReviewsEmpty").hidden = true;
  } finally {
    platformReviewLoading = false;
    more.disabled = false;
  }
}

function platformReviewSetRating(rating) {
  platformReviewSelectedRating = rating;
  platformReviewEl("platformReviewsStars").querySelectorAll("button").forEach((button) => {
    const active = Number(button.dataset.rating) <= rating;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(Number(button.dataset.rating) === rating));
  });
  platformReviewEl("platformReviewsSubmit").disabled = !rating || platformReviewSending;
}

function platformReviewShowMessage(text) {
  const el = platformReviewEl("platformReviewsWriteMessage");
  el.replaceChildren();
  if (text && text.includes("\n")) {
    const [heading, ...details] = text.split("\n");
    const bold = document.createElement("strong");
    bold.textContent = heading;
    const explanation = document.createElement("span");
    explanation.textContent = details.join(" ");
    explanation.style.display = "block";
    explanation.style.marginTop = "4px";
    explanation.style.fontWeight = "500";
    el.append(bold, explanation);
  } else {
    el.textContent = text;
  }
  el.hidden = !text;
}

function platformReviewLoginUrl() {
  return "prihlaseni.html?returnTo=" + encodeURIComponent("zkusenosti.html?hodnotit=1");
}

function platformReviewOpenForm() {
  if (!platformReviewCurrentUser) {
    window.location.assign(platformReviewLoginUrl());
    return;
  }
  if (!platformReviewMine?.eligible) {
    platformReviewShowMessage(platformReviewTexts().ineligible);
    return;
  }
  platformReviewShowMessage("");
  platformReviewEl("platformReviewsForm").hidden = false;
  platformReviewEl("platformReviewsWriteButton").hidden = true;
  platformReviewSetRating(Number(platformReviewMine.rating) || 0);
  platformReviewEl("platformReviewsComment").value = String(platformReviewMine.comment || "");
  platformReviewEl("platformReviewsStars").querySelector("button").focus();
}

async function platformReviewLoadOwn() {
  if (!platformReviewsClient) return;
  const write = platformReviewEl("platformReviewsWriteButton");
  try {
    const { data, error } = await platformReviewsClient.auth.getUser();
    if (error || !data?.user) {
      platformReviewCurrentUser = null;
      if (new URLSearchParams(location.search).get("hodnotit") === "1") {
        window.location.assign(platformReviewLoginUrl());
      }
      return;
    }
    platformReviewCurrentUser = data.user;
    const result = await platformReviewsClient.rpc("get_my_platform_review");
    if (result.error) throw result.error;
    platformReviewMine = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!platformReviewMine?.eligible) {
      write.hidden = true;
      platformReviewShowMessage(platformReviewTexts().ineligible);
      return;
    }
    platformReviewTranslatePage();
    if (new URLSearchParams(location.search).get("hodnotit") === "1") platformReviewOpenForm();
    else if (platformReviewMine.review_status === "pending") platformReviewShowMessage(platformReviewTexts().waiting);
  } catch (_error) {
    // Never show a submit form unless eligibility is verified by Supabase.
    write.hidden = true;
    platformReviewShowMessage(platformReviewTexts().sendError);
  }
}

async function platformReviewSubmit(event) {
  event.preventDefault();
  if (!platformReviewsClient || !platformReviewMine?.eligible || !platformReviewSelectedRating || platformReviewSending) return;
  platformReviewSending = true;
  const submit = platformReviewEl("platformReviewsSubmit");
  submit.disabled = true;
  submit.textContent = platformReviewTexts().sending;
  try {
    const comment = platformReviewEl("platformReviewsComment").value.trim();
    const { error } = await platformReviewsClient.rpc("submit_platform_review", {
      p_rating: platformReviewSelectedRating, p_comment: comment
    });
    if (error) throw error;
    platformReviewMine.rating = platformReviewSelectedRating;
    platformReviewMine.comment = comment;
    platformReviewMine.review_status = "pending";
    platformReviewEl("platformReviewsForm").hidden = true;
    platformReviewEl("platformReviewsWriteButton").hidden = false;
    platformReviewTranslatePage();
    platformReviewShowMessage(platformReviewTexts().success);
  } catch (_error) {
    platformReviewShowMessage(platformReviewTexts().sendError);
  } finally {
    platformReviewSending = false;
    submit.textContent = platformReviewTexts().send;
    submit.disabled = platformReviewSelectedRating === 0;
  }
}

async function platformReviewInitialize() {
  platformReviewTranslatePage();
  platformReviewEl("platformReviewsStars").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => platformReviewSetRating(Number(button.dataset.rating)));
  });
  platformReviewEl("platformReviewsMore").addEventListener("click", platformReviewLoadMore);
  platformReviewEl("platformReviewsWriteButton").addEventListener("click", platformReviewOpenForm);
  platformReviewEl("platformReviewsCancel").addEventListener("click", () => {
    platformReviewEl("platformReviewsForm").hidden = true;
    platformReviewEl("platformReviewsWriteButton").hidden = false;
    platformReviewShowMessage("");
  });
  platformReviewEl("platformReviewsForm").addEventListener("submit", platformReviewSubmit);
  platformReviewsClient = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  if (!platformReviewsClient) return;
  await Promise.all([platformReviewLoadSummary(), platformReviewLoadMore(), platformReviewLoadOwn()]);
}

document.addEventListener("DOMContentLoaded", platformReviewInitialize);
document.addEventListener("rentuloLanguageChanged", platformReviewTranslatePage);
