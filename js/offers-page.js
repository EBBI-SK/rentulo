    const PLATFORM_FEE_PERCENT = 10;
    const PLATFORM_FEE_MINIMUM_CZK = 70;

    const OFFERS_LOCALES = {
      cs: "cs-CZ",
      sk: "sk-SK",
      en: "en-GB",
      de: "de-DE",
      pl: "pl-PL"
    };

    function offersTranslate(key, fallback, values) {
      let text = typeof window.rentuloTranslate === "function"
        ? window.rentuloTranslate(key)
        : fallback;

      if (text === key) {
        text = fallback;
      }

      if (values && typeof values === "object") {
        Object.keys(values).forEach(function (name) {
          text = String(text).replaceAll("{" + name + "}", String(values[name]));
        });
      }

      return text;
    }

    function getOffersLocale() {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";

      return OFFERS_LOCALES[language] || OFFERS_LOCALES.cs;
    }

    function formatOffersNumber(value) {
      const numberValue = Number(value);

      if (!Number.isFinite(numberValue)) {
        return String(value === undefined || value === null ? "" : value);
      }

      return numberValue.toLocaleString(getOffersLocale());
    }

    function formatOffersMoney(value) {
      return formatOffersNumber(value) + " Kč";
    }

    function calculatePlatformFee(price) {
      const total = Number(price);

      if (!Number.isFinite(total) || total <= 0) {
        return 0;
      }

      return Math.max(
        Math.round(total * PLATFORM_FEE_PERCENT / 100),
        PLATFORM_FEE_MINIMUM_CZK
      );
    }

    function isMinimumPlatformFeeApplied(price, fee, percent) {
      const total = Number(price);
      const chargedFee = Number(fee);
      const feePercent = Number(percent);
      return Number.isFinite(total) && total > 0 &&
        Number.isFinite(chargedFee) && chargedFee === PLATFORM_FEE_MINIMUM_CZK &&
        Number.isFinite(feePercent) && feePercent > 0 &&
        Math.round(total * feePercent / 100) < PLATFORM_FEE_MINIMUM_CZK;
    }

    function formatOffersMoneyPerDay(value) {
      return formatOffersNumber(value) + " " + offersTranslate("offers.currencyPerDay", "Kč / den");
    }

    function formatOffersDate(value) {
      if (!value) {
        return "-";
      }

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      return date.toLocaleDateString(getOffersLocale());
    }

    function formatOffersDateTime(value) {
      if (!value) {
        return "-";
      }

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      return date.toLocaleString(getOffersLocale(), {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }

    function formatOwnerDebtMoney(amountMinor, currency) {
      const minor = Number(amountMinor);
      const normalizedCurrency = String(currency || "").toUpperCase();

      if (!Number.isSafeInteger(minor) || minor < 0 || normalizedCurrency !== "CZK") {
        return "-";
      }

      return new Intl.NumberFormat(getOffersLocale(), {
        style: "currency",
        currency: "CZK",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(minor / 100);
    }

    function getOffersPluralText(prefix, count, fallbacks) {
      const pluralCategory = new Intl.PluralRules(getOffersLocale()).select(Number(count));
      const supportedCategory = ["one", "few", "many", "other"].includes(pluralCategory)
        ? pluralCategory
        : "other";
      const suffix = supportedCategory.charAt(0).toUpperCase() + supportedCategory.slice(1);
      const fallback = fallbacks[supportedCategory] || fallbacks.other || "";

      return offersTranslate(prefix + suffix, fallback, {
        count: formatOffersNumber(count)
      });
    }

    function getRequestCountText(count) {
      return getOffersPluralText("offers.requestCount", count, {
        one: "1 žádost",
        few: "{count} žádosti",
        many: "{count} žádostí",
        other: "{count} žádostí"
      });
    }

    function getReservationCountText(count) {
      return getOffersPluralText("offers.reservationCount", count, {
        one: "1 rezervace",
        few: "{count} rezervace",
        many: "{count} rezervací",
        other: "{count} rezervací"
      });
    }

    function isReservationPhaseStatus(status) {
      const normalizedStatus = normalizeReservationStatus(status);

      return [
        RESERVATION_STATUS_APPROVED,
        RESERVATION_STATUS_PAID,
        RESERVATION_STATUS_PICKED_UP
      ].includes(normalizedStatus);
    }

    function getRequestPanelCountText(requests) {
      const reservationCount = requests.filter(function (reservation) {
        return isReservationPhaseStatus(reservation.status);
      }).length;
      const requestCount = requests.length - reservationCount;

      if (requestCount > 0 && reservationCount > 0) {
        return getRequestCountText(requestCount) + " · " + getReservationCountText(reservationCount);
      }

      if (reservationCount > 0) {
        return getReservationCountText(reservationCount);
      }

      return getRequestCountText(requestCount);
    }

    function getOfferRequestsButtonText(openRequests, ownerActionRequests) {
      const hasReservation = openRequests.some(function (reservation) {
        return isReservationPhaseStatus(reservation.status);
      });

      if (hasReservation) {
        return offersTranslate("offers.openRequests", "Žádosti a rezervace");
      }

      if (ownerActionRequests.length) {
        return offersTranslate("offers.handleRequests", "Vyřídit žádosti");
      }

      return offersTranslate("offers.showRequests", "Zobrazit žádosti");
    }

    
    

    let ownerOffers = [];
    let ownerReservations = [];
    let ownerCancellationDebts = [];
    // The backend decides eligibility using the Prague return instant.
    let ownerReturnFollowupOverview = new Map();
    let ownerCurrentUser = null;
    let ownerOffersLoadState = "idle";
    let ownerDebtsLoadState = "idle";
    let accountMessageState = null;

    function getStatusText(status) {
  return getReservationStatusText(status);
}

    function isOpenStatus(status) {
  return isOpenReservationStatus(
    normalizeReservationStatus(status)
  );
}

    function canShowContact(status) {
  return getReservationContactVisible(status);
}

    function isOwnerActionStatus(status) {
      const normalizedStatus = normalizeReservationStatus(status);

      return [
        RESERVATION_STATUS_PENDING,
        RESERVATION_STATUS_PAID,
        RESERVATION_STATUS_PICKED_UP
      ].includes(normalizedStatus);
    }

    function showAccountMessage(title, text, tone) {
      const messageBox = document.getElementById("accountMessage");

      if (!messageBox) {
        return;
      }

      messageBox.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        ${escapeHtml(text)}
      `;

      messageBox.classList.toggle("error", tone === "error");
      messageBox.classList.add("active");
    }

    function setAccountMessage(titleKey, titleFallback, textKey, textFallback, tone, values) {
      accountMessageState = {
        titleKey: titleKey,
        titleFallback: titleFallback,
        textKey: textKey,
        textFallback: textFallback,
        tone: tone || "success",
        values: values || null
      };

      renderAccountMessage();
    }

    function setAccountErrorMessage(textKey, textFallback) {
      setAccountMessage(
        textKey,
        textFallback,
        "",
        "",
        "error"
      );
    }

    function renderAccountMessage() {
      if (!accountMessageState) {
        return;
      }

      showAccountMessage(
        offersTranslate(accountMessageState.titleKey, accountMessageState.titleFallback),
        offersTranslate(
          accountMessageState.textKey,
          accountMessageState.textFallback,
          accountMessageState.values
        ),
        accountMessageState.tone
      );
    }

    function showAccountMessageFromStorage() {
      let savedState = "";

      try {
        savedState = sessionStorage.getItem("rentuloOfferSaved") || "";
      } catch (_error) {
        return;
      }

      if (savedState === "draft") {
        setAccountMessage(
          "offers.message.draftTitle",
          "Koncept byl uložen.",
          "offers.message.draftText",
          "Až budete připraveni, klikněte u nabídky na Zveřejnit."
        );

        try {
          sessionStorage.removeItem("rentuloOfferSaved");
        } catch (_error) {
          // The confirmation is optional when session storage is unavailable.
        }
        return;
      }

      if (savedState === "active") {
        setAccountMessage(
          "offers.message.publishedTitle",
          "Nabídka byla zveřejněna.",
          "offers.message.publishedText",
          "Vaše nabídka je teď viditelná ve výsledcích vyhledávání."
        );

        try {
          sessionStorage.removeItem("rentuloOfferSaved");
        } catch (_error) {
          // The confirmation is optional when session storage is unavailable.
        }
      }
    }

    function renderLoadingState() {
      document.getElementById("offersList").innerHTML = `
        <section class="account-empty-state">
          <h2>${offersTranslate("offers.loadingTitle", "Načítám nabídky...")}</h2>
          <p>${offersTranslate("offers.loadingText", "Chvíli strpení, načítáme vaše nabídky a žádosti ze Supabase.")}</p>
        </section>
      `;
    }

    function renderEmptyState() {
      document.getElementById("offersList").innerHTML = `
        <section class="account-empty-state">
          <h2>${offersTranslate("offers.emptyTitle", "Zatím nemáte žádné vlastní nabídky.")}</h2>
          <p>${offersTranslate("offers.emptyText", "Přidejte první věc, kterou chcete půjčovat lidem ve svém okolí.")}</p>
        </section>
      `;
    }

    function renderLoadErrorState() {
      document.getElementById("offersList").innerHTML = `
        <section class="account-empty-state">
          <h2>${offersTranslate("offers.loadErrorTitle", "Nabídky se nepodařilo načíst.")}</h2>
          <p>${offersTranslate("offers.loadErrorText", "Obnovte stránku a zkuste to prosím znovu.")}</p>
        </section>
      `;
    }

    function normalizeOwnerDebt(row) {
      return {
        id: row.id || "",
        amountMinor: Number(row.amount_minor),
        currency: String(row.currency || "").toLowerCase(),
        status: String(row.status || "").toLowerCase(),
        dueAt: row.due_at || ""
      };
    }

    function isOwnerDebtOverdue(debt) {
      if (!debt || debt.status !== "open" || !debt.dueAt) {
        return false;
      }

      const dueAtMs = Date.parse(debt.dueAt);
      return Number.isFinite(dueAtMs) && dueAtMs <= Date.now();
    }

    function hasOverdueOwnerDebt() {
      return ownerCancellationDebts.some(isOwnerDebtOverdue);
    }

    function getOwnerDebtStatusText(debt) {
      if (debt.status === "paid") {
        return offersTranslate("offers.debt.statusPaid", "Uhrazeno");
      }

      if (debt.status === "waived") {
        return offersTranslate("offers.debt.statusWaived", "Odpuštěno");
      }

      if (isOwnerDebtOverdue(debt)) {
        return offersTranslate("offers.debt.statusOverdue", "Po splatnosti");
      }

      return offersTranslate("offers.debt.statusOpen", "K úhradě");
    }

    function renderOwnerDebtSection() {
      const section = document.getElementById("ownerDebtsSection");

      if (!section) {
        return;
      }

      if (ownerDebtsLoadState === "error") {
        section.hidden = false;
        section.innerHTML = `
          <div class="owner-debts-header">
            <div>
              <h2>${offersTranslate("offers.debt.heading", "Úhrady po zrušení rezervace")}</h2>
            </div>
          </div>
          <div class="owner-debts-load-error">
            ${offersTranslate("offers.debt.loadError", "Údaje o úhradách se nepodařilo načíst. Obnovte stránku a zkuste to znovu.")}
          </div>
        `;
        return;
      }

      if (!ownerCancellationDebts.length) {
        section.hidden = true;
        section.innerHTML = "";
        return;
      }

      const overdueDebtExists = hasOverdueOwnerDebt();
      const overdueWarning = overdueDebtExists
        ? `<div class="owner-debt-overdue-warning">${offersTranslate(
            "offers.debt.overdueWarning",
            "Máte úhradu po splatnosti. Dokud ji neuhradíte, nemůžete potvrzovat nové rezervace."
          )}</div>`
        : "";

      const rowsHtml = ownerCancellationDebts.map(function (debt) {
        const overdue = isOwnerDebtOverdue(debt);
        const statusClass = debt.status === "paid" || debt.status === "waived"
          ? "is-settled"
          : overdue
            ? "is-overdue"
            : "";
        const statusBadgeClass = debt.status === "paid"
          ? "is-paid"
          : debt.status === "waived"
            ? "is-waived"
            : overdue
              ? "is-overdue"
              : "";
        const payAction = debt.status === "open"
          ? `
            <button
              type="button"
              class="owner-debt-pay"
              data-offers-action="pay-owner-debt"
              data-debt-id="${escapeHtml(debt.id)}"
            >
              ${offersTranslate("offers.debt.pay", "Uhradit")}
            </button>
          `
          : "";

        return `
          <article class="owner-debt-row ${statusClass}">
            <div
              class="owner-debt-field owner-debt-main"
              data-owner-debt-label="${escapeHtml(offersTranslate("offers.debt.reasonLabel", "Důvod"))}"
            >
              <strong class="owner-debt-title">${offersTranslate("offers.debt.reason", "Náklad po zrušení zaplacené rezervace")}</strong>
              <span class="owner-debt-reference">${offersTranslate("offers.debt.reference", "Referenční ID")}: ${escapeHtml(debt.id)}</span>
            </div>

            <div
              class="owner-debt-field owner-debt-amount"
              data-owner-debt-label="${escapeHtml(offersTranslate("offers.debt.amount", "Částka"))}"
            >
              <span class="owner-debt-value">${escapeHtml(formatOwnerDebtMoney(debt.amountMinor, debt.currency))}</span>
            </div>

            <div
              class="owner-debt-field owner-debt-due"
              data-owner-debt-label="${escapeHtml(offersTranslate("offers.debt.due", "Splatnost"))}"
            >
              <span class="owner-debt-value">${escapeHtml(formatOffersDateTime(debt.dueAt))}</span>
            </div>

            <div
              class="owner-debt-field owner-debt-status-field"
              data-owner-debt-label="${escapeHtml(offersTranslate("offers.debt.status", "Stav"))}"
            >
              <span class="owner-debt-status ${statusBadgeClass}">${escapeHtml(getOwnerDebtStatusText(debt))}</span>
            </div>

            <div
              class="owner-debt-field owner-debt-action"
              data-owner-debt-label="${escapeHtml(offersTranslate("offers.debt.action", "Akce"))}"
            >
              ${payAction}
            </div>
          </article>
        `;
      }).join("");

      section.hidden = false;
      section.innerHTML = `
        <div class="owner-debts-header">
          <div>
            <h2>${offersTranslate("offers.debt.heading", "Úhrady po zrušení rezervace")}</h2>
            <p>${offersTranslate("offers.debt.description", "Zde vidíte skutečné externí náklady vzniklé při zrušení zaplacené rezervace.")}</p>
          </div>
        </div>
        ${overdueWarning}
        <div class="owner-debt-list">${rowsHtml}</div>
      `;
    }

    function normalizeOffer(row) {
      return {
        id: row.id,
        offerNumber: row.offer_number || "",
        ownerId: row.owner_id,
        name: row.name || "",
        category: row.category || "",
        description: row.description || "",
        city: row.city || row.pickup_city || "-",
        postalCode: row.postal_code || "",
        price: Number(row.price_per_day || 0),
        status: row.status || "active",
        photoUrl: row.photo_url || "",
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || ""
      };
    }

    function normalizeReservation(row) {
      return {
        id: row.id,
        reservationNumber: row.reservation_number || "",
        offerNumber: row.offer_number || "",
        offerId: row.offer_id,
        ownerId: row.owner_id,
        renterId: row.renter_id,

        offerName: row.offer_name || "",
        category: row.category || "",
        city: row.city || "",

        pricePerDay: Number(row.price_per_day || 0),

        startDate: row.start_date || row.date_from || "",
        endDate: row.end_date || row.date_to || "",
        pickupTime: row.pickup_time || "",
        cancellationCutoffAt: row.cancellation_cutoff_at || "",
        expiresAt: row.expires_at || "",
        approvedAt: row.approved_at || "",
        expiredAt: row.expired_at || "",
        expiryReason: row.expiry_reason || "",
        days: Number(row.total_days || row.days || 0),
        totalPrice: Number(row.total_price || 0),

        platformFeePercent: Number(row.platform_fee_percent || PLATFORM_FEE_PERCENT),
        platformFeeAmount: Number(row.platform_fee_amount || 0),
        ownerPayout: Number(row.owner_payout || 0),

        renterName: row.renter_name || "",
        renterEmail: row.renter_email || "",
        renterPhone: row.renter_phone || "",

        ownerName: row.owner_name || "",

        status: normalizeReservationStatus(
  row.status || RESERVATION_STATUS_PENDING
),
        contactVisibleAfterPayment: Boolean(row.contact_visible_after_payment),

        createdAt: row.created_at || "",
        updatedAt: row.updated_at || ""
      };
    }

    async function loadOwnerData(supabaseUser) {
      ownerOffersLoadState = "loading";
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        ownerOffersLoadState = "error";
        setAccountErrorMessage("offers.error.supabaseConfig", "Služba je dočasně nedostupná. Obnovte stránku a zkuste to znovu.");
        return false;
      }

      if (!supabaseUser) {
        window.location.href = "prihlaseni.html";
        return false;
      }

      const offersResult = await supabaseClient
        .from("offers")
        .select("*")
        .eq("owner_id", supabaseUser.id)
        .neq("status", "deleted")
        .order("created_at", {
          ascending: false
        });

      if (offersResult.error) {
        ownerOffersLoadState = "error";
        console.error(offersResult.error);
        setAccountErrorMessage("offers.error.loadListings", "Nabídky se nepodařilo načíst. Obnovte stránku a zkuste to znovu.");
        return false;
      }

      const reservationsResult =
        typeof window.getRentuloReservationsData === "function"
          ? await window.getRentuloReservationsData()
          : {
              data: [],
              error: new Error("Shared reservation data loader is unavailable.")
            };

      const ownerReservationRows = !reservationsResult.error && Array.isArray(reservationsResult.data)
        ? reservationsResult.data.filter(function (reservation) {
            return reservation.owner_id === supabaseUser.id;
          })
        : [];

      if (reservationsResult.error) {
        ownerOffersLoadState = "error";
        console.error(reservationsResult.error);
        setAccountErrorMessage("offers.error.loadRequests", "Žádosti se nepodařilo načíst. Obnovte stránku a zkuste to znovu.");
        return false;
      }

      ownerDebtsLoadState = "loading";
      const ownerDebtsResult = await supabaseClient.rpc("get_my_owner_cancellation_debts");

      if (ownerDebtsResult.error) {
        ownerDebtsLoadState = "error";
        ownerCancellationDebts = [];
        console.error(ownerDebtsResult.error);
      } else {
        ownerDebtsLoadState = "ready";
        ownerCancellationDebts = Array.isArray(ownerDebtsResult.data)
          ? ownerDebtsResult.data.map(normalizeOwnerDebt)
          : [];
      }

      ownerOffers = Array.isArray(offersResult.data)
        ? offersResult.data.map(normalizeOffer)
        : [];

      const extensionResult = await supabaseClient.rpc("get_my_reservation_extensions");
      if (extensionResult.error || !Array.isArray(extensionResult.data)) {
        ownerOffersLoadState = "error";
        console.error("Reservation extensions could not be loaded", extensionResult.error);
        setAccountErrorMessage("offers.error.loadRequests", "Žádosti se nepodařilo načíst. Obnovte stránku.");
        return false;
      }
      ownerReservations = RentuloReservationExtensions.attachPaidExtensions(
        ownerReservationRows.map(normalizeReservation), extensionResult.data
      );

      // Fail closed if the TEST migration is not installed or the query fails.
      // Reporting an unreturned item is never enabled by the browser clock.
      ownerReturnFollowupOverview = new Map();
      if (ownerReservations.some(function (reservation) {
        return normalizeReservationStatus(reservation.status) === RESERVATION_STATUS_PICKED_UP;
      })) {
        const returnOverviewResult = await supabaseClient.rpc("get_my_return_followup_overview");
        if (returnOverviewResult.error) {
          console.error("Return follow-up overview unavailable:", returnOverviewResult.error);
        } else if (Array.isArray(returnOverviewResult.data)) {
          returnOverviewResult.data.forEach(function (row) {
            ownerReturnFollowupOverview.set(String(row.reservation_id), {
              canReport: row.can_report === true,
              reportedAt: row.reported_at || "",
              resolvedAt: row.resolved_at || ""
            });
          });
        }
      }

      ownerOffersLoadState = "ready";
      return true;
    }

    function getOfferDisplayName(offer) {
      return getOfferName(offer, offersTranslate("offers.itemFallback", "Věc k půjčení"));
    }

    function getOfferCity(offer) {
      return offer.city || "-";
    }

function getOfferStatus(offer) {
      if (offer.status === "draft") {
        return offersTranslate("offers.status.draft", "Koncept");
      }

      if (offer.status === "active") {
        return offersTranslate("offers.status.active", "Aktivní");
      }

      if (offer.status === "hidden") {
        return offersTranslate("offers.status.hidden", "Neaktivní");
      }

      if (offer.status === "deleted") {
        return offersTranslate("offers.status.deleted", "Smazané");
      }

      return offer.status || offersTranslate("offers.status.active", "Aktivní");
    }

    function isOfferDraft(offer) {
      return offer.status === "draft";
    }

    function isOfferHidden(offer) {
      return offer.status === "hidden";
    }

    function isOfferActive(offer) {
      return offer.status === "active";
    }

    function getOfferPhoto(offer) {
      return offer.photoUrl || "";
    }

    function renderToolImage(offer) {
      const photo = getOfferPhoto(offer);
      const offerName = getOfferDisplayName(offer);

      if (photo) {
        return `
          <div class="tool-image">
            <img src="${escapeHtml(photo)}" alt="${escapeHtml(offerName)}">
          </div>
        `;
      }

      return `
        <div class="tool-image">
          <div class="tool-image-icon"></div>
        </div>
      `;
    }

    
    

    async function payOwnerCancellationDebt(debtId) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient || !debtId) {
        setAccountErrorMessage(
          "offers.debt.paymentError",
          "Platbu se nepodařilo zahájit. Obnovte stránku a zkuste to znovu."
        );
        return;
      }

      const result = await supabaseClient.functions.invoke(
        "create-owner-debt-checkout",
        {
          body: {
            debt_id: debtId,
            locale: typeof window.getRentuloLanguage === "function"
              ? window.getRentuloLanguage()
              : "cs"
          }
        }
      );

      if (result.error) {
        console.error("Owner debt Checkout could not be created:", result.error);
        setAccountErrorMessage(
          "offers.debt.paymentError",
          "Platbu se nepodařilo zahájit. Zkuste to prosím znovu."
        );
        return;
      }

      const checkoutUrl = result.data && typeof result.data.url === "string"
        ? result.data.url.trim()
        : "";

      if (!checkoutUrl) {
        console.error("Owner debt Checkout did not return a valid URL.");
        setAccountErrorMessage(
          "offers.debt.paymentError",
          "Platbu se nepodařilo zahájit. Zkuste to prosím znovu."
        );
        return;
      }

      window.location.href = checkoutUrl;
    }

    function showOwnerDebtCheckoutReturnMessage() {
      const params = new URLSearchParams(window.location.search);
      const paymentState = params.get("debt_payment");

      if (paymentState !== "success" && paymentState !== "cancelled") {
        return;
      }

      if (paymentState === "success") {
        setAccountMessage(
          "offers.debt.paymentSuccessTitle",
          "Platba byla odeslána.",
          "offers.debt.paymentSuccessText",
          "Jakmile Stripe platbu potvrdí, stav úhrady se v Rentulo aktualizuje."
        );
      } else {
        setAccountMessage(
          "offers.debt.paymentCancelledTitle",
          "Platba nebyla dokončena.",
          "offers.debt.paymentCancelledText",
          "Dluh zůstává k úhradě. Platbu můžete spustit znovu tlačítkem Uhradit.",
          "error"
        );
      }

      params.delete("debt_payment");
      const query = params.toString();
      const cleanUrl = window.location.pathname + (query ? "?" + query : "") + window.location.hash;
      window.history.replaceState({}, "", cleanUrl);
    }

    async function updateReservationStatus(reservationId, newStatus) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        setAccountErrorMessage("offers.error.supabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku.");
        return null;
      }

      const { data: updatedReservations, error } = await supabaseClient
  .rpc("change_my_reservation_status", {
    p_reservation_id: reservationId,
    p_new_status: newStatus
  });

const data = Array.isArray(updatedReservations)
  ? updatedReservations[0] || null
  : null;

      if (error) {
        console.error(error);

        if (
          newStatus === RESERVATION_STATUS_APPROVED
          && String(error.message || "").includes("OWNER_OVERDUE_CANCELLATION_DEBT")
        ) {
          setAccountErrorMessage(
            "offers.debt.approvalBlocked",
            "Rezervaci nelze potvrdit, dokud neuhradíte částku po splatnosti."
          );
          return null;
        }

        setAccountErrorMessage("offers.error.saveStatus", "Stav rezervace se nepodařilo uložit. Zkuste to prosím znovu.");
        return null;
      }

      

      return data ? normalizeReservation(data) : null;
    }

    async function approveReservation(reservationId) {
      const updated = await updateReservationStatus(
  reservationId,
  RESERVATION_STATUS_APPROVED
);
      await reloadAndReopen(reservationId, "open");
    }

    async function rejectReservation(reservationId) {
     const updated = await updateReservationStatus(
  reservationId,
  RESERVATION_STATUS_REJECTED
);
      await reloadAndReopen(reservationId, "history");
    }


    async function cancelApprovedReservation(reservationId) {
      const reservation = ownerReservations.find(function (item) {
        return String(item.id) === String(reservationId);
      });

      if (!reservation || !canOwnerCancelReservation(reservation)) {
        setAccountErrorMessage(
          "reservations.error.cannotCancel",
          "Tuto rezervaci už nelze běžně zrušit."
        );
        return;
      }

      if (!isReservationCancellationWindowOpen(reservation)) {
        setAccountErrorMessage(
          "reservations.error.cannotCancel",
          getReservationCancellationCutoffText()
        );
        renderOffers({ autoOpenFromUrl: false });
        return;
      }

      const normalizedStatus = normalizeReservationStatus(reservation.status);

      if (normalizedStatus === RESERVATION_STATUS_PAID) {
        const supabaseClient = getSupabaseClient();

        if (!supabaseClient) {
          setAccountErrorMessage(
            "offers.error.supabaseMissing",
            "Služba je dočasně nedostupná. Obnovte stránku."
          );
          return;
        }

        const previewResult = await requestPaidReservationCancellation(
          supabaseClient,
          reservationId,
          "preview"
        );

        if (previewResult.error || !previewResult.data) {
          console.error("Náhled storna zaplacené rezervace se nepodařilo načíst:", previewResult.error);
          setAccountErrorMessage(
            "reservations.cancelPaid.previewError",
            "Přesné vyúčtování storna se nepodařilo načíst. Zkuste to prosím znovu."
          );
          return;
        }

        const confirmed = await openOwnerReservationCancelModal(
          reservation,
          previewResult.data
        );

        if (!confirmed) {
          return;
        }

        if (!isReservationCancellationWindowOpen(reservation)) {
          setAccountErrorMessage(
            "reservations.error.cannotCancel",
            getReservationCancellationCutoffText()
          );
          renderOffers({ autoOpenFromUrl: false });
          return;
        }

        const confirmResult = await requestPaidReservationCancellation(
          supabaseClient,
          reservationId,
          "confirm"
        );

        if (confirmResult.error || !confirmResult.data) {
          console.error("Storno zaplacené rezervace se nepodařilo dokončit:", confirmResult.error);
          setAccountErrorMessage(
            "reservations.cancelPaid.confirmError",
            "Storno se nepodařilo dokončit. Zkuste to prosím znovu; opakovaný pokus nevytvoří druhý refund."
          );
          return;
        }

        const externalCostMinor = Number(confirmResult.data.external_cost_amount_minor);
        const successKey = externalCostMinor > 0
          ? "reservations.cancelPaid.ownerSuccess"
          : "reservations.cancelPaid.ownerSuccessNoCost";
        const successFallback = externalCostMinor > 0
          ? "Rezervace byla zrušena. Nájemci Stripe vrací {refundAmount}. Náklad {externalCost} vám Rentulo vyúčtuje se splatností 7 dní."
          : "Rezervace byla zrušena. Nájemci Stripe vrací {refundAmount} a nevznikl vám žádný náklad k úhradě.";

        setAccountMessage(
          "reservations.state.cancelledTitle",
          "Rezervace byla zrušena",
          successKey,
          successFallback,
          "success",
          {
            refundAmount: formatPaidCancellationMinorMoney(
              confirmResult.data.refund_amount_minor
            ),
            externalCost: formatPaidCancellationMinorMoney(
              confirmResult.data.external_cost_amount_minor
            )
          }
        );

        await reloadAndReopen(reservationId, "history");
        return;
      }

      const confirmed = await openOwnerReservationCancelModal(reservation);

      if (!confirmed) {
        return;
      }

      if (!isReservationCancellationWindowOpen(reservation)) {
        setAccountErrorMessage(
          "reservations.error.cannotCancel",
          getReservationCancellationCutoffText()
        );
        renderOffers({ autoOpenFromUrl: false });
        return;
      }

      const updated = await updateReservationStatus(
        reservationId,
        RESERVATION_STATUS_CANCELLED
      );

      if (!updated) {
        return;
      }


      setAccountMessage(
        "reservations.state.cancelledTitle",
        "Rezervace byla zrušena",
        "reservations.success.cancelled",
        "Rezervace byla zrušena a přesunuta do Historie."
      );

      await reloadAndReopen(reservationId, "history");
    }

    async function markReservationPickedUp(reservationId) {
      const updated = await updateReservationStatus(
  reservationId,
  RESERVATION_STATUS_PICKED_UP
);
      await reloadAndReopen(reservationId, "open");
    }


    // This is NOT an automatic no-show or an ordinary cancellation.
    // Only the owner may explicitly report that a collected item was not returned.
    let returnIssueModalResolve = null;
    let returnIssueModalReturnFocus = null;

    function getReturnIssueModalElements() {
      return {
        overlay: document.getElementById("returnIssueModal"),
        title: document.getElementById("returnIssueModalTitle"),
        description: document.getElementById("returnIssueModalDescription"),
        label: document.getElementById("returnIssueModalLabel"),
        input: document.getElementById("returnIssueModalInput"),
        feedback: document.getElementById("returnIssueModalFeedback"),
        cancel: document.querySelector('[data-return-issue-modal="cancel"]'),
        confirm: document.querySelector('[data-return-issue-modal="confirm"]')
      };
    }

    function refreshReturnIssueModalText() {
      const el = getReturnIssueModalElements();
      if (!el.overlay) return;
      el.title.textContent = offersTranslate("offers.returnIssue.title", "Nahlásit nevrácení věci?");
      el.description.textContent = offersTranslate("offers.returnIssue.description", "Nahlaste pouze skutečný problém. Pokud už máte věc zpět, použijte Potvrdit vrácení. Nahlášení automaticky nespouští pokutu ani změnu platby.");
      el.label.textContent = offersTranslate("offers.returnIssue.label", "Co se stalo? (15–500 znaků)");
      el.cancel.textContent = offersTranslate("offers.returnIssue.cancel", "Zpět");
      el.confirm.textContent = offersTranslate("offers.returnIssue.confirm", "Odeslat hlášení");
    }

    function closeReturnIssueModal(description) {
      const el = getReturnIssueModalElements();
      if (!el.overlay || el.overlay.hidden) return;
      el.overlay.hidden = true;
      el.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("offers-modal-open");
      const resolve = returnIssueModalResolve;
      const focusTarget = returnIssueModalReturnFocus;
      returnIssueModalResolve = null;
      returnIssueModalReturnFocus = null;
      if (resolve) resolve(description);
      if (!description && focusTarget && focusTarget.isConnected) {
        requestAnimationFrame(function () { focusTarget.focus(); });
      }
    }

    function initializeReturnIssueModal() {
      if (document.getElementById("returnIssueModal")) return;
      const overlay = document.createElement("div");
      overlay.className = "offers-confirm-modal";
      overlay.id = "returnIssueModal";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = [
        '<div class="offers-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="returnIssueModalTitle" aria-describedby="returnIssueModalDescription">',
        '<h2 id="returnIssueModalTitle"></h2>',
        '<p id="returnIssueModalDescription"></p>',
        '<label class="return-issue-modal-label" id="returnIssueModalLabel" for="returnIssueModalInput"></label>',
        '<textarea class="return-issue-modal-input" id="returnIssueModalInput" rows="4" minlength="15" maxlength="500" required></textarea>',
        '<p class="return-issue-modal-feedback" id="returnIssueModalFeedback" role="alert" aria-live="polite"></p>',
        '<div class="offers-confirm-actions">',
        '<button class="offers-modal-button offers-modal-keep" type="button" data-return-issue-modal="cancel"></button>',
        '<button class="offers-modal-button offers-modal-delete" type="button" data-return-issue-modal="confirm"></button>',
        '</div></div>'
      ].join("");
      document.body.appendChild(overlay);
      refreshReturnIssueModalText();
      overlay.addEventListener("click", function (event) {
        const button = event.target.closest("[data-return-issue-modal]");
        if (button && button.dataset.returnIssueModal === "cancel") {
          closeReturnIssueModal(null);
        } else if (button && button.dataset.returnIssueModal === "confirm") {
          const el = getReturnIssueModalElements();
          const value = el.input.value.trim();
          if (value.length < 15 || value.length > 500) {
            el.feedback.textContent = offersTranslate("offers.returnIssue.validation", "Popište skutečnou událost alespoň 15 a nejvýše 500 znaky.");
            el.input.focus();
            return;
          }
          closeReturnIssueModal(value);
        } else if (event.target === overlay) {
          closeReturnIssueModal(null);
        }
      });
      document.addEventListener("keydown", function (event) {
        if (overlay.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          closeReturnIssueModal(null);
        } else if (event.key === "Tab") {
          const el = getReturnIssueModalElements();
          const focusable = [el.input, el.cancel, el.confirm];
          if (event.shiftKey && document.activeElement === focusable[0]) {
            event.preventDefault();
            focusable[2].focus();
          } else if (!event.shiftKey && document.activeElement === focusable[2]) {
            event.preventDefault();
            focusable[0].focus();
          }
        }
      });
    }

    function openReturnIssueModal() {
      initializeReturnIssueModal();
      const el = getReturnIssueModalElements();
      el.input.value = "";
      el.feedback.textContent = "";
      refreshReturnIssueModalText();
      returnIssueModalReturnFocus = document.activeElement;
      el.overlay.hidden = false;
      el.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("offers-modal-open");
      return new Promise(function (resolve) {
        returnIssueModalResolve = resolve;
        requestAnimationFrame(function () { el.input.focus(); });
      });
    }

    async function reportReservationNotReturned(reservationId) {
      const reservation = ownerReservations.find(function (row) {
        return String(row.id) === String(reservationId);
      });
      const overview = ownerReturnFollowupOverview.get(String(reservationId));
      if (!reservation || normalizeReservationStatus(reservation.status) !== RESERVATION_STATUS_PICKED_UP ||
          !overview || !overview.canReport || overview.reportedAt) {
        setAccountErrorMessage("offers.returnIssue.unavailable", "Nahlášení zatím není dostupné. Obnovte stránku a ověřte vrácení.");
        return;
      }
      const description = await openReturnIssueModal();
      if (!description) return;
      const supabaseClient = getSupabaseClient();
      if (!supabaseClient) {
        setAccountErrorMessage("offers.returnIssue.error", "Hlášení se nepodařilo odeslat. Zkuste to znovu.");
        return;
      }
      const result = await supabaseClient.rpc("report_my_reservation_not_returned", {
        p_reservation_id: reservationId,
        p_description: description
      });
      if (result.error) {
        console.error("Return incident reporting failed:", result.error);
        setAccountErrorMessage("offers.returnIssue.error", "Hlášení se nepodařilo odeslat. Zkuste to znovu.");
        await reloadAndReopen(reservationId, "open");
        return;
      }
      await reloadAndReopen(reservationId, "open");
      setAccountMessage(
        "offers.returnIssue.successTitle", "Nevrácení bylo nahlášeno",
        "offers.returnIssue.successText", "Hlášení bylo uloženo a nájemce obdrží e-mail. Po skutečném vrácení potvrďte vrácení věci."
      );
    }

    async function markReservationReturned(reservationId) {
      const updated = await updateReservationStatus(
  reservationId,
  RESERVATION_STATUS_RETURNED
);
      await reloadAndReopen(reservationId, "history");
    }

    function ownerOfferHasPhoto(offerId) {
      const offer = ownerOffers.find(function (item) {
        return String(item.id) === String(offerId);
      });
      if (!offer || !String(offer.photoUrl || "").trim()) {
        setAccountErrorMessage(
          "offers.photoRequiredBeforePublish",
          "Než nabídku zveřejníte nebo aktivujete, otevřete Upravit nabídku a přidejte alespoň jednu fotografii věci."
        );
        return false;
      }
      return true;
    }

    async function publishOffer(offerId) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        setAccountErrorMessage("offers.error.supabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku.");
        return;
      }

      if (!ownerOfferHasPhoto(offerId)) {
        return;
      }

      const { error } = await supabaseClient
        .from("offers")
        .update({
          status: "active"
        })
        .eq("id", offerId);

      if (error) {
        console.error(error);
        setAccountErrorMessage("offers.error.publish", "Nabídku se nepodařilo zveřejnit.");
        return;
      }

      setAccountMessage(
        "offers.message.draftPublishedTitle",
        "Koncept byl zveřejněn.",
        "offers.message.draftPublishedText",
        "Nabídka je teď aktivní a viditelná ve výsledcích."
      );
      await initializeOwnerOffersPage();
    }

    async function changeOfferVisibility(offerId, newStatus) {
      if (newStatus === "active" && !ownerOfferHasPhoto(offerId)) {
        return;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        setAccountMessage(
          "offers.message.statusChangeErrorTitle",
          "Změnu stavu se nepodařilo uložit.",
          "offers.message.statusChangeErrorText",
          "Nabídka zůstala beze změny. Obnovte stránku a zkuste to prosím znovu.",
          "error"
        );
        return;
      }

      const { data: updatedOffer, error } = await supabaseClient
        .from("offers")
        .update({ status: newStatus })
        .eq("id", offerId)
        .select("id, status")
        .maybeSingle();

      if (error || !updatedOffer || updatedOffer.status !== newStatus) {
        console.error(error);
        setAccountMessage(
          "offers.message.statusChangeErrorTitle",
          "Změnu stavu se nepodařilo uložit.",
          "offers.message.statusChangeErrorText",
          "Nabídka zůstala beze změny. Obnovte stránku a zkuste to prosím znovu.",
          "error"
        );
        return;
      }

      if (newStatus === "hidden") {
        setAccountMessage(
          "offers.message.deactivatedTitle",
          "Nabídka byla deaktivována.",
          "offers.message.deactivatedText",
          "Nabídka už není viditelná ve výsledcích. Kdykoli ji můžete znovu aktivovat."
        );
      } else {
        setAccountMessage(
          "offers.message.activatedTitle",
          "Nabídka byla aktivována.",
          "offers.message.activatedText",
          "Nabídka je znovu viditelná ve výsledcích."
        );
      }

      await initializeOwnerOffersPage();
    }

    let offerDeleteModalResolve = null;
    let offerDeleteModalReturnFocus = null;

    function getOfferDeleteModalElements() {
      return {
        overlay: document.getElementById("offerDeleteModal"),
        title: document.getElementById("offerDeleteModalTitle"),
        description: document.getElementById("offerDeleteModalDescription"),
        cancelButton: document.querySelector('[data-offers-delete-modal-action="cancel"]'),
        confirmButton: document.querySelector('[data-offers-delete-modal-action="confirm"]')
      };
    }

    function refreshOfferDeleteModalText() {
      const elements = getOfferDeleteModalElements();

      if (elements.title) {
        elements.title.textContent = offersTranslate(
          "offers.deleteModal.title",
          "Smazat nabídku?"
        );
      }

      if (elements.description) {
        elements.description.textContent = offersTranslate(
          "offers.confirmDelete",
          "Opravdu chcete tuto nabídku smazat?"
        );
      }

      if (elements.cancelButton) {
        elements.cancelButton.textContent = offersTranslate(
          "offers.deleteModal.keep",
          "Ponechat nabídku"
        );
      }

      if (elements.confirmButton) {
        elements.confirmButton.textContent = offersTranslate(
          "offers.delete",
          "Smazat nabídku"
        );
      }
    }

    function closeOfferDeleteModal(confirmed) {
      const elements = getOfferDeleteModalElements();

      if (!elements.overlay || elements.overlay.hidden) {
        return;
      }

      elements.overlay.hidden = true;
      elements.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("offers-modal-open");

      const resolve = offerDeleteModalResolve;
      const returnFocus = offerDeleteModalReturnFocus;

      offerDeleteModalResolve = null;
      offerDeleteModalReturnFocus = null;

      if (resolve) {
        resolve(Boolean(confirmed));
      }

      if (!confirmed && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        requestAnimationFrame(function () {
          if (returnFocus.isConnected) {
            returnFocus.focus();
          }
        });
      }
    }

    function openOfferDeleteModal() {
      const elements = getOfferDeleteModalElements();

      if (!elements.overlay) {
        console.error("Offer delete confirmation modal is missing.");
        return Promise.resolve(false);
      }

      offerDeleteModalReturnFocus = document.activeElement;
      refreshOfferDeleteModalText();

      elements.overlay.hidden = false;
      elements.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("offers-modal-open");

      return new Promise(function (resolve) {
        offerDeleteModalResolve = resolve;

        requestAnimationFrame(function () {
          if (elements.cancelButton) {
            elements.cancelButton.focus();
          }
        });
      });
    }

    function initializeOfferDeleteModal() {
      const elements = getOfferDeleteModalElements();

      if (!elements.overlay) {
        return;
      }

      elements.overlay.addEventListener("click", function (event) {
        const actionButton = event.target.closest("[data-offers-delete-modal-action]");

        if (actionButton) {
          closeOfferDeleteModal(
            actionButton.dataset.offersDeleteModalAction === "confirm"
          );
          return;
        }

        if (event.target === elements.overlay) {
          closeOfferDeleteModal(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (elements.overlay.hidden) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeOfferDeleteModal(false);
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const focusable = [elements.cancelButton, elements.confirmButton].filter(Boolean);

        if (focusable.length < 2) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }


    let ownerReservationCancelModalResolve = null;
    let ownerReservationCancelModalReservation = null;
    let ownerReservationCancelModalQuote = null;
    let ownerReservationCancelModalReturnFocus = null;

    function ensureOwnerReservationCancelModal() {
      if (document.getElementById("ownerReservationCancelModal")) {
        return;
      }

      const overlay = document.createElement("div");
      overlay.className = "offers-confirm-modal";
      overlay.id = "ownerReservationCancelModal";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = [
        '<div class="offers-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ownerReservationCancelModalTitle" aria-describedby="ownerReservationCancelModalDescription">',
        '<h2 id="ownerReservationCancelModalTitle"></h2>',
        '<p id="ownerReservationCancelModalDescription"></p>',
        '<div class="offers-confirm-actions">',
        '<button type="button" class="offers-modal-button offers-modal-keep" data-owner-reservation-cancel-modal-action="keep"></button>',
        '<button type="button" class="offers-modal-button offers-modal-delete" data-owner-reservation-cancel-modal-action="confirm"></button>',
        '</div>',
        '</div>'
      ].join("");
      document.body.appendChild(overlay);
    }

    function getOwnerReservationCancelModalElements() {
      return {
        overlay: document.getElementById("ownerReservationCancelModal"),
        title: document.getElementById("ownerReservationCancelModalTitle"),
        description: document.getElementById("ownerReservationCancelModalDescription"),
        keepButton: document.querySelector('[data-owner-reservation-cancel-modal-action="keep"]'),
        confirmButton: document.querySelector('[data-owner-reservation-cancel-modal-action="confirm"]')
      };
    }

    function refreshOwnerReservationCancelModalText() {
      if (!ownerReservationCancelModalReservation) {
        return;
      }

      const elements = getOwnerReservationCancelModalElements();
      const normalizedStatus = normalizeReservationStatus(
        ownerReservationCancelModalReservation.status
      );
      const isPaidCancellation =
        normalizedStatus === RESERVATION_STATUS_PAID &&
        ownerReservationCancelModalQuote;
      const startDate = formatOffersDate(ownerReservationCancelModalReservation.startDate);
      const endDate = formatOffersDate(ownerReservationCancelModalReservation.endDate);

      if (elements.title) {
        elements.title.textContent = isPaidCancellation
          ? offersTranslate(
              "reservations.cancelPaid.title",
              "Zrušit zaplacenou rezervaci?"
            )
          : offersTranslate(
              "reservations.cancelModal.title",
              "Zrušit rezervaci?"
            );
      }

      if (elements.description) {
        if (isPaidCancellation) {
          const externalCostMinor = Number(
            ownerReservationCancelModalQuote.external_cost_amount_minor
          );
          const descriptionKey = externalCostMinor > 0
            ? "reservations.cancelPaid.ownerDescription"
            : "reservations.cancelPaid.ownerDescriptionNoCost";
          const descriptionFallback = externalCostMinor > 0
            ? "Nájemci vrátíme celou zaplacenou částku {refundAmount}. Skutečné náklady Stripe: {externalCost}. Rentulo vám tuto částku vyúčtuje se splatností 7 dní od storna."
            : "Nájemci vrátíme celou zaplacenou částku {refundAmount}. Skutečné náklady Stripe jsou {externalCost}, takže vám nevznikne žádná částka k úhradě.";

          elements.description.textContent = offersTranslate(
            descriptionKey,
            descriptionFallback,
            {
              refundAmount: formatPaidCancellationMinorMoney(
                ownerReservationCancelModalQuote.refund_amount_minor
              ),
              externalCost: formatPaidCancellationMinorMoney(
                ownerReservationCancelModalQuote.external_cost_amount_minor
              )
            }
          );
        } else {
          elements.description.textContent = offersTranslate(
            "reservations.cancelModal.description",
            "Opravdu chcete tuto rezervaci zrušit? Termín {startDate} – {endDate} se znovu uvolní.",
            { startDate: startDate, endDate: endDate }
          );
        }
      }

      if (elements.keepButton) {
        elements.keepButton.textContent = offersTranslate(
          "reservations.cancelModal.keep",
          "Ponechat rezervaci"
        );
      }

      if (elements.confirmButton) {
        elements.confirmButton.textContent = isPaidCancellation
          ? offersTranslate(
              "reservations.cancelPaid.confirm",
              "Zrušit a vrátit platbu"
            )
          : offersTranslate(
              "reservations.cancel",
              "Zrušit rezervaci"
            );
      }
    }

    function closeOwnerReservationCancelModal(confirmed) {
      const elements = getOwnerReservationCancelModalElements();

      if (!elements.overlay || elements.overlay.hidden) {
        return;
      }

      if (elements.overlay.contains(document.activeElement)) {
        const activeElement = document.activeElement;

        if (activeElement && typeof activeElement.blur === "function") {
          activeElement.blur();
        }
      }

      elements.overlay.hidden = true;
      elements.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("offers-modal-open");

      const resolve = ownerReservationCancelModalResolve;
      const returnFocus = ownerReservationCancelModalReturnFocus;

      ownerReservationCancelModalResolve = null;
      ownerReservationCancelModalReservation = null;
      ownerReservationCancelModalQuote = null;
      ownerReservationCancelModalReturnFocus = null;

      if (resolve) {
        resolve(Boolean(confirmed));
      }

      if (!confirmed && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        requestAnimationFrame(function () {
          if (returnFocus.isConnected) {
            returnFocus.focus();
          }
        });
      }
    }

    function openOwnerReservationCancelModal(reservation, quote) {
      ensureOwnerReservationCancelModal();
      const elements = getOwnerReservationCancelModalElements();

      if (!elements.overlay) {
        console.error("Owner reservation cancellation modal is missing.");
        return Promise.resolve(false);
      }

      ownerReservationCancelModalReservation = reservation;
      ownerReservationCancelModalQuote = quote || null;
      ownerReservationCancelModalReturnFocus = document.activeElement;
      refreshOwnerReservationCancelModalText();

      elements.overlay.hidden = false;
      elements.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("offers-modal-open");

      return new Promise(function (resolve) {
        ownerReservationCancelModalResolve = resolve;

        requestAnimationFrame(function () {
          if (elements.keepButton) {
            elements.keepButton.focus();
          }
        });
      });
    }

    function initializeOwnerReservationCancelModal() {
      ensureOwnerReservationCancelModal();
      const elements = getOwnerReservationCancelModalElements();

      if (!elements.overlay) {
        return;
      }

      elements.overlay.addEventListener("click", function (event) {
        const actionButton = event.target.closest(
          "[data-owner-reservation-cancel-modal-action]"
        );

        if (actionButton) {
          closeOwnerReservationCancelModal(
            actionButton.dataset.ownerReservationCancelModalAction === "confirm"
          );
          return;
        }

        if (event.target === elements.overlay) {
          closeOwnerReservationCancelModal(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (elements.overlay.hidden) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeOwnerReservationCancelModal(false);
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const focusable = [elements.keepButton, elements.confirmButton].filter(Boolean);

        if (focusable.length < 2) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    async function deleteOffer(offerId) {
      const blockingReservations = ownerReservations.filter(function (reservation) {
        return String(reservation.offerId) === String(offerId) && isOpenStatus(reservation.status);
      });

      if (blockingReservations.length > 0) {
        setAccountErrorMessage("offers.error.deleteBlocked", "Tuto nabídku nelze smazat, protože k ní existuje otevřená rezervace.");
        return;
      }

      const reallyDelete = await openOfferDeleteModal();

      if (!reallyDelete) {
        return;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        setAccountErrorMessage("offers.error.supabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku.");
        return;
      }

      const { error } = await supabaseClient
        .from("offers")
        .update({
          status: "deleted"
        })
        .eq("id", offerId);

      if (error) {
        console.error(error);
        setAccountErrorMessage("offers.error.delete", "Nabídku se nepodařilo smazat.");
        return;
      }

      await initializeOwnerOffersPage();
    }

    async function reloadAndReopen(reservationId, panelType) {
      if (typeof window.invalidateRentuloReservationsData === "function") {
        window.invalidateRentuloReservationsData();
      }

      const loaded = await loadOwnerData(ownerCurrentUser);

      if (!loaded) {
        renderLoadErrorState();
        return;
      }

      renderOffers();

      if (typeof window.refreshRentuloNotificationBadge === "function") {
        await window.refreshRentuloNotificationBadge();
      }

      setTimeout(function () {
        reopenReservationAfterRender(reservationId, panelType);
      }, 0);
    }

    function getOfferIdByReservationId(reservationId) {
      const reservation = ownerReservations.find(function (item) {
        return String(item.id) === String(reservationId);
      });

      return reservation ? reservation.offerId : "";
    }

    function reopenReservationAfterRender(reservationId, panelType) {
      const offerId = getOfferIdByReservationId(reservationId);

      if (!offerId || panelType === "history") {
        return;
      }

      const openPanel = document.getElementById("open-panel-" + offerId);

      if (openPanel) {
        openPanel.classList.add("open");
      }
    }

    function renderRequestNote(status) {
      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PENDING) {
        return "";
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_APPROVED) {
        return `<p class="request-note">${offersTranslate("offers.note.approved", "Žádost byla potvrzena. Čeká se na platbu zákazníka.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PAID) {
        return `<p class="request-note success">${offersTranslate("offers.note.paid", "Rezervace je zaplacena. Až věc předáte zájemci, potvrďte předání.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PICKED_UP) {
return `<p class="request-note success">${offersTranslate("offers.note.pickedUp", "Věc byla předána. Po skutečném vrácení potvrďte vrácení v Rentulu; tím se zahájí zpracování výplaty, pokud již neproběhla. PIN už nelze znovu použít.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_RETURNED) {
        return `<p class="request-note success">${offersTranslate("offers.note.returned", "Vrácení věci bylo potvrzeno. Rezervace je dokončená. Pokud ještě nebyla provedena výplata, Rentulo ji automaticky předá Stripe ke zpracování; připsání na účet může trvat několik dní.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_REJECTED) {
        return `<p class="request-note">${offersTranslate("offers.note.rejected", "Žádost byla odmítnuta. Nabídka už touto žádostí není blokovaná.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_EXPIRED) {
        return `<p class="request-note">${offersTranslate("reservations.expiration.expiredNote", "Lhůta vypršela a termín je znovu volný.")}</p>`;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_CANCELLED) {
        return `<p class="request-note">${offersTranslate("offers.note.cancelled", "Rezervace byla zrušena. Nabídka už touto žádostí není blokovaná.")}</p>`;
      }

      return "";
    }

    function getRequestStatusClass(status) {
  const normalizedStatus = normalizeReservationStatus(status);

  if (
    normalizedStatus === RESERVATION_STATUS_PAID ||
    normalizedStatus === RESERVATION_STATUS_PICKED_UP
  ) {
    return "paid";
  }

  if (isClosedReservationStatus(normalizedStatus)) {
    return "finished";
  }

  if (normalizedStatus === RESERVATION_STATUS_APPROVED) {
    return "active";
  }

  return "";
}


    function disableOwnerReservationCancellationButton(button) {
      if (button && button.isConnected) button.remove();
    }

    function scheduleOwnerReservationCancellationCutoff(button) {
      if (!button || button.disabled) {
        return;
      }

      const cutoffMs = Number(button.dataset.cancelCutoff);

      if (!Number.isFinite(cutoffMs)) {
        return;
      }

      const remaining = cutoffMs - Date.now();

      if (remaining <= 0) {
        disableOwnerReservationCancellationButton(button);
        return;
      }

      if (button.dataset.ownerCancelCutoffScheduled === "true") {
        return;
      }

      button.dataset.ownerCancelCutoffScheduled = "true";

      window.setTimeout(function () {
        if (!button.isConnected) {
          return;
        }

        delete button.dataset.ownerCancelCutoffScheduled;

        if (Date.now() >= cutoffMs) {
          disableOwnerReservationCancellationButton(button);
          return;
        }

        scheduleOwnerReservationCancellationCutoff(button);
      }, Math.min(remaining + 50, 2147483647));
    }

    function refreshOwnerReservationCancellationCutoffs() {
      document
        .querySelectorAll('[data-offers-action="cancel-reservation"][data-cancel-cutoff]')
        .forEach(scheduleOwnerReservationCancellationCutoff);
    }

    function renderOwnerReservationCancellationAction(reservation) {
      if (!canOwnerCancelReservation(reservation)) {
        return "";
      }

      const reservationId = reservation.id;
      const label = offersTranslate("reservations.cancel", "Zrušit rezervaci");
      const cutoff = getReservationCancellationCutoffAt(reservation);
      const explanation = getReservationCancellationCutoffText();

      if (cutoff && !isReservationCancellationWindowOpen(reservation)) {
        return ""; // Cutoff enforced by the database; no inactive control in the row.
      }

      const cutoffAttribute = cutoff
        ? ' data-cancel-cutoff="' + cutoff.getTime() + '"'
        : "";

      return [
        '<button class="small-button light reservation-cancel-action" type="button" data-offers-action="cancel-reservation" data-reservation-id="',
        escapeHtml(reservationId),
        '"',
        cutoffAttribute,
        '>',
        escapeHtml(label),
        '</button>'
      ].join("");
    }

    function activeOwnerExtension(reservation) {
      const extensions = reservation.extensions || [];
      const active = extensions.filter(function (extension) {
        return extension.status === "pending" || extension.status === "approved";
      });
      return active.length ? active[active.length-1] : null;
    }

    async function decideOwnerExtension(extensionId, reservationId, approve) {
      const result = await getSupabaseClient().rpc("decide_reservation_extension", {
        p_extension_id: extensionId, p_approve: approve,
      });
      if (result.error || result.data !== true) {
        console.error("Extension decision failed", result.error);
        setAccountErrorMessage("offers.error.loadRequests", RentuloReservationExtensions.t("error"));
        return;
      }
      await reloadAndReopen(reservationId,"open");
      if (typeof window.refreshRentuloNotificationBadge === "function") {
        await window.refreshRentuloNotificationBadge();
      }
    }

    function renderRequestActions(reservation, status) {
      const reservationId = reservation.id;
      const actions = [];

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PENDING) {
        if (hasOverdueOwnerDebt()) {
          const blockedText = offersTranslate(
            "offers.debt.approvalBlocked",
            "Rezervaci nelze potvrdit, dokud neuhradíte částku po splatnosti."
          );
          actions.push(`
            <button class="small-button" type="button" disabled aria-disabled="true" title="${escapeHtml(blockedText)}">${offersTranslate("offers.action.approve", "Potvrdit")}</button>
          `);
        } else {
          actions.push(`
            <button class="small-button" type="button" data-offers-action="approve-reservation" data-reservation-id="${escapeHtml(reservationId)}">${offersTranslate("offers.action.approve", "Potvrdit")}</button>
          `);
        }

        actions.push(`
          <button class="small-button light" type="button" data-offers-action="reject-reservation" data-reservation-id="${escapeHtml(reservationId)}">${offersTranslate("offers.action.reject", "Odmítnout")}</button>
        `);
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_APPROVED) {
        actions.push(renderOwnerReservationCancellationAction(reservation));
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PAID) {
        actions.push(`
          <button class="small-button orange" type="button" hidden data-offers-action="mark-picked-up" data-reservation-id="${escapeHtml(reservationId)}">
            ${offersTranslate("offers.action.pickedUp", "Potvrdit předání")}
          </button>
        `);
        actions.push(renderOwnerReservationCancellationAction(reservation));
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PICKED_UP) {
        actions.push(`
          <button class="small-button orange" type="button" data-offers-action="mark-returned" data-reservation-id="${escapeHtml(reservationId)}">
            ${offersTranslate("offers.action.returned", "Potvrdit vrácení")}
          </button>
        `);
        const followup = ownerReturnFollowupOverview.get(String(reservationId));
        if (followup && followup.reportedAt && !followup.resolvedAt) {
          actions.push(`<span class="return-issue-reported">${escapeHtml(offersTranslate("offers.returnIssue.reported", "Nevrácení nahlášeno"))}</span>`);
        } else if (followup && followup.canReport) {
          actions.push(`
            <button class="small-button light" type="button" data-offers-action="report-return-missing" data-reservation-id="${escapeHtml(reservationId)}">
              ${escapeHtml(offersTranslate("offers.returnIssue.action", "Nahlásit nevrácení"))}
            </button>
          `);
        }
      }

      const extension = activeOwnerExtension(reservation);
      if (extension) {
        if (extension.status === "pending") {
          if (hasOverdueOwnerDebt()) {
            const blockedText = offersTranslate("offers.debt.approvalBlocked",
              "Rezervaci nelze potvrdit, dokud neuhradíte částku po splatnosti.");
            actions.unshift(`<button class="small-button" type="button" disabled
              aria-disabled="true" title="${escapeHtml(blockedText)}">
              ${escapeHtml(RentuloReservationExtensions.t("approve"))}</button>`);
          } else {
            actions.unshift(`<button class="small-button" type="button" data-offers-action="approve-extension"
              data-reservation-id="${escapeHtml(reservationId)}" data-extension-id="${escapeHtml(extension.id)}">
              ${escapeHtml(RentuloReservationExtensions.t("approve"))}</button>`);
          }
          actions.unshift(`<button class="small-button light" type="button" data-offers-action="reject-extension"
            data-reservation-id="${escapeHtml(reservationId)}" data-extension-id="${escapeHtml(extension.id)}">
            ${escapeHtml(RentuloReservationExtensions.t("reject"))}</button>`);
        }
      }
      return actions.join("");
    }

    function renderReservationContactBlock(reservation) {
      // Contacts are returned to the owner only after verified payment.
      if (!canShowContact(reservation.status)) {
        return "";
      }

      const renterEmail = reservation.renterEmail || offersTranslate("offers.emailMissing", "E-mail není uložen");
      const renterPhone = reservation.renterPhone || offersTranslate("offers.phoneMissing", "Telefon není uložen");

      return `
        <div class="request-contact-box owner-reservation-contacts">
          <span>${offersTranslate("offers.contact.phone", "Telefon")}: <strong>${escapeHtml(renterPhone)}</strong></span>
          <span>${offersTranslate("offers.contact.email", "E-mail")}: <strong>${escapeHtml(renterEmail)}</strong></span>
        </div>
      `;
    }
    function renderRequestDetailContent(reservation, status) {
      const price = reservation.totalPrice;
      const platformFee = reservation.platformFeeAmount || calculatePlatformFee(price);
      const ownerPayout = reservation.ownerPayout || price - platformFee;
      const minimumFeeNote = isMinimumPlatformFeeApplied(price, platformFee, reservation.platformFeePercent)
        ? `<small class="owner-fee-minimum-note">(${escapeHtml(offersTranslate("offers.detail.minimumFee", "minimální provize"))})</small>`
        : "";

      return `
        <div class="request-detail-inner">
          <div class="owner-payment-summary">
            <span class="owner-payment-item">
              <span>${offersTranslate("offers.detail.customerPrice", "Cena pro z\u00e1kazn\u00edka")}</span>
              <strong>${escapeHtml(formatOffersMoney(price))}</strong>
            </span>
            <span class="owner-payment-item">
              <span>${offersTranslate("offers.detail.fee", "Provize Rentulo")}</span>
              <strong>${escapeHtml(formatOffersMoney(platformFee))}</strong>
              ${minimumFeeNote}
            </span>
            <span class="owner-payment-item">
              <span>${offersTranslate("offers.detail.ownerReceives", "Vy dostanete")}</span>
              <strong>${escapeHtml(formatOffersMoney(ownerPayout))}</strong>
            </span>
          </div>

          ${renderReservationContactBlock(reservation)}

          ${renderRequestNote(status)}
          ${(() => {
            const followup = ownerReturnFollowupOverview.get(String(reservation.id));
            return followup && followup.reportedAt && !followup.resolvedAt
              ? `<p class="request-note">${escapeHtml(offersTranslate("offers.returnIssue.reportedNote", "Nevrácení je evidováno. Po skutečném vrácení věci použijte Potvrdit vrácení; tím se hlášení uzavře."))}</p>`
              : "";
          })()}
        </div>
      `;
    }

    function renderOwnerRequestDeadline(reservation) {
      if (!reservation.expiresAt || normalizeReservationStatus(reservation.status) !== RESERVATION_STATUS_APPROVED) return "";
      const date = new Date(reservation.expiresAt);
      if (Number.isNaN(date.getTime())) return "";
      const lang = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage() : "cs";
      const locales = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB", de: "de-DE", pl: "pl-PL" };
      const formatted = new Intl.DateTimeFormat(locales[lang] || "cs-CZ", {
        dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague"
      }).format(date);
      const expired = date.getTime() <= Date.now();
      const key = expired ? "reservations.expiration.review" : "offers.expiration.customerPaymentDeadline";
      const label = expired ? "Lhůta uplynula – ověřujeme stav" : "Zákazník má zaplatit do";
      return `<small class="reservation-expiration-note">${escapeHtml(offersTranslate(key, label))}: ${escapeHtml(formatted)}</small>`;
    }

    function renderRequest(reservation) {
      const status = reservation.status;
      const statusText = getStatusText(status);

      const renterName = reservation.renterName || offersTranslate("offers.renterFallback", "Zájemce");
      const renterEmail = canShowContact(status)
        ? reservation.renterEmail || offersTranslate("offers.emailMissing", "E-mail není uložen")
        : offersTranslate("offers.contact.afterPayment", "Kontakt se zobrazí po zaplacení");

      const startDate = reservation.startDate;
      const endDate = reservation.endDate;
      const reservationId = reservation.id;

      const actionButtons = renderRequestActions(reservation, status);
      const activeExtension = (reservation.extensions || []).find(function (extension) {
        return extension.status === "pending" || extension.status === "approved";
      });

      return `
        <article class="request-card" id="request-card-${escapeHtml(reservationId)}"
          data-owner-extension-pending="${activeExtension?.status === 'pending' ? 'true' : 'false'}"
          data-owner-status="${escapeHtml(normalizeReservationStatus(status))}"
          data-owner-number="${escapeHtml(reservation.reservationNumber || "")}"
          data-owner-date="${escapeHtml(startDate || "")}"
          data-owner-renter="${escapeHtml(renterName)}">
          <div class="request-row">
            <div class="request-main">
              <span class="request-name">${escapeHtml(renterName)}</span>
              <span class="request-email">${escapeHtml(renterEmail)}</span>
              ${reservation.reservationNumber ? `<span class="request-email"><span class="owner-reservation-reference-prefix">${escapeHtml(offersTranslate("reference.reservation", "Číslo rezervace"))}: </span>${escapeHtml(reservation.reservationNumber)}</span>` : ""}
              ${renderOwnerRequestDeadline(reservation)}
              ${activeExtension ? `<small class="owner-extension-summary">${escapeHtml(
                typeof RentuloReservationExtensions !== "undefined" ? RentuloReservationExtensions.t(
                  activeExtension.status === "pending" ? "ownerPending" : "ownerApproved"
                ) : "Prodloužení pronájmu"
              )} ${escapeHtml(formatOffersDate(activeExtension.new_end_date))}
                  · ${escapeHtml(formatOffersMoney(activeExtension.amount_total))}</small>` : ""}
            </div>

            <div class="request-date">
              ${escapeHtml(formatOffersDate(startDate))} – ${escapeHtml(formatOffersDate(endDate))}
              ${reservation.pickupTime ? `<small class="owner-pickup-time">${escapeHtml(offersTranslate("reservations.pickupTimeShort", "Převzetí"))}: ${escapeHtml(String(reservation.pickupTime).slice(0, 5))}</small>` : ""}
            </div>

            <div class="owner-reservation-price"><strong>${escapeHtml(formatOffersMoney(reservation.totalPrice))}</strong></div>
            <span class="request-status ${getRequestStatusClass(status)}">${escapeHtml(statusText)}</span>

            <div class="row-actions">
              ${actionButtons}
            </div>
          </div>

          ${renderReservationContactBlock(reservation)}
        </article>
      `;
    }

    function toggleRequestDetail(reservationId, button) {
      const detail = document.getElementById("request-detail-" + reservationId);

      if (!detail) {
        return;
      }

      const isOpen = detail.classList.contains("open");

      if (isOpen) {
        detail.classList.remove("open");
        button.textContent = offersTranslate("offers.detail.show", "Detail");
        return;
      }

      detail.classList.add("open");
      button.textContent = offersTranslate("offers.hideDetail", "Skrýt detail");
    }

    function renderRequestPanel(panelId, title, requests, content) {
      const countText = getRequestPanelCountText(requests);

      return `
        <section class="request-panel" id="${escapeHtml(panelId)}">
          <div class="request-panel-header">
            <h3>${escapeHtml(title)}</h3>
            <span>${escapeHtml(countText)}</span>
          </div>

          <div class="request-list">
            ${content}
          </div>
        </section>
      `;
    }

    function toggleOfferRequests(offerId) {
      const openPanel = document.getElementById("open-panel-" + offerId);
      const isOpen = openPanel && openPanel.classList.contains("open");

      if (isOpen) {
        openPanel.classList.remove("open");
        return;
      }

      if (openPanel) {
        openPanel.classList.add("open");
      }

      setTimeout(function () {
        if (openPanel) {
          openPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 0);
    }

function renderSimpleOffer(offer, requests) {
  const offerId = String(offer.id);
  const offerName = getOfferDisplayName(offer);
  const offerCity = getOfferCity(offer);
  const offerPrice = getOfferPrice(offer);
  const openPanelId = "open-panel-" + offerId;
  const isDraft = isOfferDraft(offer);
  const isHidden = isOfferHidden(offer);
  const isActive = isOfferActive(offer);

  const openRequests = requests.filter(function (reservation) {
    return isOpenStatus(reservation.status);
  });

  const ownerActionRequests = openRequests.filter(function (reservation) {
    return isOwnerActionStatus(reservation.status);
  });

  const requestText = getRequestPanelCountText(openRequests);

  const openContent = openRequests.length
    ? openRequests.map(renderRequest).join("")
    : `<p class="request-empty-note">${offersTranslate("offers.noOpenRequests", "U této nabídky teď není žádná otevřená žádost.")}</p>`;

  const primaryActionHtml = isDraft
    ? `<button
        type="button"
        class="offer-primary-button orange"
        data-offers-action="publish-offer"
        data-offer-id="${escapeHtml(offerId)}"
      >
        ${offersTranslate("offers.publish", "Zveřejnit nabídku")}
      </button>`
    : openRequests.length
      ? `<button
          type="button"
          class="offer-primary-button ${ownerActionRequests.length ? "urgent" : ""}"
          data-offers-action="open-offer-requests"
          data-offer-id="${escapeHtml(offerId)}"
        >
          ${getOfferRequestsButtonText(openRequests, ownerActionRequests)}
        </button>`
      : "";

  const visibilityActionHtml = isActive
    ? `<button class="offer-visibility-action deactivate" type="button" data-offers-action="deactivate-offer" data-offer-id="${escapeHtml(offerId)}">${offersTranslate("offers.deactivate", "Deaktivovat nabídku")}</button>`
    : isHidden
      ? `<button class="offer-visibility-action activate" type="button" data-offers-action="activate-offer" data-offer-id="${escapeHtml(offerId)}">${offersTranslate("offers.activate", "Aktivovat nabídku")}</button>`
      : "";

  const directOfferActionsHtml = `
    ${isActive ? `<a href="detail.html?id=${encodeURIComponent(offerId)}">${offersTranslate("offers.publicDetail", "Detail nabídky")}</a>` : ""}
    ${visibilityActionHtml}
    <a href="edit-nabidka.html?id=${encodeURIComponent(offerId)}">${offersTranslate("offers.edit", "Upravit nabídku")}</a>
    ${openRequests.length ? "" : `<button class="offer-delete-action danger" type="button" data-offers-action="delete-offer" data-offer-id="${escapeHtml(offerId)}">${offersTranslate("offers.delete", "Smazat nabídku")}</button>`}
  `;

  return `
    <div class="simple-offer-record" data-owner-offer-number="${escapeHtml(offer.offerNumber || "")}">
      <article class="simple-offer-row">
        <div class="simple-offer-main">
          ${renderToolImage(offer)}

          <div class="simple-offer-info">
            <strong class="simple-offer-name">${escapeHtml(offerName)}</strong>
            <span class="simple-offer-meta">${escapeHtml(offerCity)}${offer.offerNumber ? ` · ${escapeHtml(offersTranslate("reference.offer", "Číslo nabídky"))}: ${escapeHtml(offer.offerNumber)}` : ""}</span>
          </div>
        </div>

        <div class="simple-offer-value">
          ${escapeHtml(formatOffersMoneyPerDay(offerPrice))}
        </div>

        <div class="simple-offer-value">
          ${escapeHtml(requestText)}
        </div>

        <div class="simple-offer-value simple-offer-status status-${escapeHtml(String(offer.status || "active").toLowerCase())}">
          ${escapeHtml(getOfferStatus(offer))}
        </div>

        <div class="simple-offer-actions">
          ${primaryActionHtml}
          ${directOfferActionsHtml}
        </div>
      </article>

      ${renderRequestPanel(openPanelId, offersTranslate("offers.openRequests", "Žádosti a rezervace"), openRequests, openContent)}
    </div>
  `;
}
    function renderOffers(options) {
      if (ownerOffersLoadState === "error") {
        renderLoadErrorState();
        return;
      }

      if (!ownerOffers.length) {
        renderEmptyState();
        return;
      }

      const offersRowsHtml = ownerOffers.map(function (offer) {
        const offerId = String(offer.id);

        const offerRequests = ownerReservations.filter(function (reservation) {
          return String(reservation.offerId) === String(offerId);
        });

        return renderSimpleOffer(offer, offerRequests);
      }).join("");

      document.getElementById("offersList").innerHTML = `
        <section class="offers-card-list">
          ${offersRowsHtml}
        </section>
      `;

      if (!options || options.autoOpenFromUrl !== false) {
        autoOpenActionOfferFromUrl();
      }

      window.setTimeout(refreshOwnerReservationCancellationCutoffs, 0);
    }

    function captureOffersUiState() {
      const openElementIds = Array.from(
        document.querySelectorAll("#offersList .open[id]")
      ).map(function (element) {
        return element.id;
      });
      return {
        openElementIds: openElementIds
      };
    }

    function restoreOffersUiState(state) {
      if (!state) {
        return;
      }

      state.openElementIds.forEach(function (elementId) {
        const element = document.getElementById(elementId);

        if (!element) {
          return;
        }

        element.classList.add("open");

        if (elementId.startsWith("request-detail-")) {
          const reservationId = elementId.replace("request-detail-", "");
          const detailButton = Array.from(
            document.querySelectorAll('[data-offers-action="toggle-request-detail"]')
          ).find(function (button) {
            return button.dataset.reservationId === reservationId;
          });

          if (detailButton) {
            detailButton.textContent = offersTranslate("offers.hideDetail", "Skrýt detail");
          }
        }
      });
    }

    function rerenderOffersForLanguageChange() {
      const uiState = captureOffersUiState();
      renderOffers({ autoOpenFromUrl: false });
      restoreOffersUiState(uiState);
    }

    function autoOpenActionOfferFromUrl() {
      const params = new URLSearchParams(window.location.search);

      if (params.get("open") !== "actions") {
        return;
      }

      const firstActionReservation = ownerReservations.find(function (reservation) {
        const normalizedStatus = normalizeReservationStatus(reservation.status);

return [
  RESERVATION_STATUS_PENDING,
  RESERVATION_STATUS_PAID,
  RESERVATION_STATUS_PICKED_UP
].includes(normalizedStatus);
      });

      const firstOpenReservation = firstActionReservation || ownerReservations.find(function (reservation) {
        return isOpenStatus(reservation.status);
      });

      if (!firstOpenReservation) {
        return;
      }

      const offerId = String(firstOpenReservation.offerId || "");
      const reservationId = String(firstOpenReservation.id || "");

      if (!offerId || !reservationId) {
        return;
      }

      setTimeout(function () {
        const openPanel = document.getElementById("open-panel-" + offerId);

        if (openPanel) {
          openPanel.classList.add("open");
        }

        const requestCard = document.getElementById("request-card-" + reservationId);

        if (requestCard) {
          requestCard.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      }, 0);
    }

    async function handleOffersActionClick(event) {
      const actionButton = event.target.closest("[data-offers-action]");

      if (!actionButton) {
        return;
      }

      event.preventDefault();

      const action = actionButton.dataset.offersAction;
      const reservationId = actionButton.dataset.reservationId || "";
      const offerId = actionButton.dataset.offerId || "";
      const debtId = actionButton.dataset.debtId || "";

      const mutationActions = new Set([
        "approve-extension", "reject-extension",
        "approve-reservation",
        "reject-reservation",
        "cancel-reservation",
        "mark-picked-up",
        "mark-returned",
        "report-return-missing",
        "publish-offer",
        "activate-offer",
        "deactivate-offer",
        "delete-offer",
        "pay-owner-debt"
      ]);
      const isMutationAction = mutationActions.has(action);

      if (isMutationAction && actionButton.dataset.busy === "true") {
        return;
      }

      if (isMutationAction) {
        actionButton.dataset.busy = "true";
        actionButton.disabled = true;
      }

      try {
        switch (action) {
          case "approve-extension":
            await decideOwnerExtension(actionButton.dataset.extensionId, reservationId, true);
            break;
          case "reject-extension":
            await decideOwnerExtension(actionButton.dataset.extensionId, reservationId, false);
            break;
          case "approve-reservation":
            await approveReservation(reservationId);
            break;
          case "reject-reservation":
            await rejectReservation(reservationId);
            break;
          case "cancel-reservation":
            await cancelApprovedReservation(reservationId);
            break;
          case "mark-picked-up":
            await markReservationPickedUp(reservationId);
            break;
          case "mark-returned":
            await markReservationReturned(reservationId);
            break;
          case "report-return-missing":
            await reportReservationNotReturned(reservationId);
            break;
          case "toggle-request-detail":
            toggleRequestDetail(reservationId, actionButton);
            break;
          case "publish-offer":
            await publishOffer(offerId);
            break;
          case "activate-offer":
            await changeOfferVisibility(offerId, "active");
            break;
          case "deactivate-offer":
            await changeOfferVisibility(offerId, "hidden");
            break;
          case "open-offer-requests":
            toggleOfferRequests(offerId);
            break;
          case "delete-offer":
            await deleteOffer(offerId);
            break;
          case "pay-owner-debt":
            await payOwnerCancellationDebt(debtId);
            break;
          default:
            break;
        }
      } finally {
        if (isMutationAction && actionButton.isConnected) {
          delete actionButton.dataset.busy;
          actionButton.disabled = false;
        }
      }
    }

    async function initializeOwnerOffersPage() {
      const verifiedUser = await window.rentuloAuthGuard.requireUser();

      if (!verifiedUser) {
        return;
      }

      ownerCurrentUser = verifiedUser;

      renderLoadingState();

      const loaded = await loadOwnerData(ownerCurrentUser);


      if (loaded) {
        renderOwnerDebtSection();
        renderOffers();
      } else {
        renderLoadErrorState();
      }

      showAccountMessageFromStorage();
      showOwnerDebtCheckoutReturnMessage();
    }

    document.addEventListener("click", handleOffersActionClick);

    document.addEventListener("DOMContentLoaded", function () {
      initializeOfferDeleteModal();
      initializeOwnerReservationCancelModal();
      initializeReturnIssueModal();
      initializeOwnerOffersPage();
    });

    document.addEventListener("rentuloLanguageChanged", function () {
      refreshOfferDeleteModalText();
      refreshOwnerReservationCancelModalText();
      refreshReturnIssueModalText();

      if (ownerOffersLoadState === "loading") {
        renderLoadingState();
      } else if (ownerOffersLoadState === "error") {
        renderLoadErrorState();
      } else if (ownerOffersLoadState === "ready") {
        rerenderOffersForLanguageChange();
      }

      renderOwnerDebtSection();
      renderAccountMessage();
    });
