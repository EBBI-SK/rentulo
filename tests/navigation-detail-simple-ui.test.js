"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "js/navigation.js"), "utf8");
const detail = fs.readFileSync(path.join(root, "js/detail-page.js"), "utf8");

function extractFunction(source, startMarker, endMarker, context) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}

function renderHeader(page, loggedIn) {
  const element = { innerHTML: "", classList: { toggle() {} } };
  let desktopPin = false;
  let mobilePin = false;
  const context = {
    document: {
      getElementById(id) { return id === "mainNav" ? element : null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    window: { rentuloAccountNotificationCount: 1 },
    renderSharedBranding() {}, navEnsureLanguageStyles() {},
    navBindGlobalDropdownDismissal() {}, navInjectStyles() {},
    navGetCurrentUser() { return loggedIn ? { id: "owner-1" } : null; },
    navTranslate(key, fallback) { return fallback; },
    navMobileProfileSummary() { return "<div>Mobile account menu</div>"; },
    navPinLink() { desktopPin = true; return '<button data-home-pin-open="true">Zadat PIN</button>'; },
    navProfileControl() { return "<button>Account</button>"; },
    navMobileAccountMenu() { return "<div>Account links</div>"; },
    navLanguageControl() { return "<button>Language</button>"; },
    navMobileLogoutControl() { return "<button>Logout</button>"; },
    navSetupSharedMobileNavigation() {},
    navEnsureMobilePinShortcut() { mobilePin = true; }
  };
  const render = extractFunction(
    navigation,
    "function renderSharedNavigation(activePage)",
    "function navGetSameOriginReferrerUrl()",
    context
  );
  render(page);
  return { html: element.innerHTML, desktopPin, mobilePin };
}

test("all pages share the simplified header; the existing PIN and account controls remain", () => {
  for (const page of ["uvod", "nabidnout", "vysledky", "detail", "moje-nabidky", "edit-nabidka"]) {
    for (const loggedIn of [true, false]) {
      const result = renderHeader(page, loggedIn);
      assert.match(result.html, /href="jak-to-funguje\.html"/, page);
      assert.doesNotMatch(result.html, /href="vysledky\.html"|href="nabidnout\.html"/, page);
      assert.match(result.html, />Language<\/button>/, page);
      assert.equal(result.mobilePin, true, page);
      if (loggedIn) {
        assert.equal(result.desktopPin, page === "uvod", page);
        if (page === "uvod") assert.match(result.html, /data-home-pin-open="true"/);
        else assert.doesNotMatch(result.html, /data-home-pin-open="true"/);
        assert.match(result.html, />Account<\/button>/);
      } else {
        assert.equal(result.desktopPin, false, page);
        assert.match(result.html, /href="prihlaseni\.html"/);
        assert.match(result.html, /href="registrace\.html"/);
      }
    }
  }
});

test("browse listings is first in both desktop and mobile account menus", () => {
  const context = {
    window: {},
    navGetCurrentUser() { return { id: "owner-1" }; },
    navEnsureProfileSummary() { return { name: "Owner", email: "owner@example.com" }; },
    navEscapeHtml(value) { return String(value); },
    navGetProfileInitials() { return "OW"; },
    navFormatProfileRating() { return "No rating"; },
    navGetAccountNotificationCounts() { return { reservations: 0, offers: 0 }; },
    navMenuNotificationBadge() { return ""; },
    navProfileText(key) { return key; },
    navTranslate(key, fallback) { return key === "nav.browse" ? "Prohlédnout nabídky" : fallback; }
  };
  const desktopMenu = extractFunction(
    navigation, "function navProfileControl(notificationCount)",
    "function navPinIcon()", context
  )(0);
  const mobileMenu = extractFunction(
    navigation, "function navMobileAccountMenu()",
    "function navMobileLogoutControl()", context
  )();

  for (const menu of [desktopMenu, mobileMenu]) {
    assert.match(menu, /href="vysledky\.html"[^>]*>Prohlédnout nabídky<\/a>/);
    assert.equal((menu.match(/href="vysledky\.html"/g) || []).length, 1);
    assert.ok(menu.indexOf('href="vysledky.html"') < menu.indexOf('href="moje-rezervace.html"'));
    assert.ok(menu.indexOf('href="vysledky.html"') < menu.indexOf('href="moje-nabidky.html"'));
  }
});

async function renderOfferFor(user) {
  const element = { innerHTML: "" };
  let bookingFormSetups = 0;
  const context = {
    currentOffer: null,
    document: { getElementById(id) { return id === "detailContent" ? element : null; } },
    window: {},
    navGetVerifiedUser: async () => user,
    getOfferName(offer) { return offer.name; },
    getOfferCategory(offer) { return offer.category; },
    detailCategoryLabel(category) { return category; },
    getOfferCity(offer) { return offer.city; },
    getOfferPrice(offer) { return offer.pricePerDay; },
    getOfferLoginReturnTo() { return "detail.html?id=offer-1"; },
    updateOfferBrowserMetadata() {},
    isOfferActive() { return true; },
    offerHasGpsLocation() { return false; },
    getDetailDescriptionTitle() { return "Popis"; },
    getPickupGpsText() { return "GPS hidden"; },
    renderDetailImage() { return "<div>Photo</div>"; },
    escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;"); },
    formatDetailNumber(value) { return String(value); },
    detailTranslate(key) {
      return {
        "detail.currencyPerDay": "Kc / den",
        "detail.ownerOfferActiveTitle": "Nabidka je aktivni",
        "detail.ownerOfferActiveText": "Nabidka je viditelna ve vysledcich",
        "detail.ownItemTitle": "Tato vec patri vam",
        "detail.ownItemText": "Vlastni vec si nemuzete rezervovat",
        "detail.available": "Dostupne",
        "detail.availabilityPanelActive": "Dostupna pro rezervaci",
        "detail.reportOffer": "Nahlasit nabidku",
        "account.myListingsTitle": "Moje nabidky"
      }[key] || key;
    },
    renderBookingSidebar() { return "<aside>Reservation form</aside>"; },
    renderUnavailableSidebar() { return "<aside>Unavailable</aside>"; },
    loadOwnerRating() {},
    setupBookingForm() { bookingFormSetups += 1; }
  };
  context.renderSidebarMessage = extractFunction(
    detail,
    "function renderSidebarMessage(type, title, text, buttonHref, buttonText, price)",
    "function renderUnavailableSidebar(price, messageTitle, messageText)",
    context
  );
  const render = extractFunction(
    detail,
    "async function renderDetail(offer)",
    "async function loadOwnerRating(ownerId)",
    context
  );
  await render({
    id: "offer-1", ownerId: "owner-1", name: "Vrtacka", category: "Stavba",
    city: "Praha", description: "Test", pricePerDay: 150,
    offerNumber: "N-000005"
  });
  return { html: element.innerHTML, bookingFormSetups };
}

test("owner sees only price and own-offer button, without redundant copy or self-report link", async () => {
  const result = await renderOfferFor({ id: "owner-1" });
  assert.match(result.html, /Nabidka je aktivni/);
  assert.match(result.html, /href="moje-nabidky\.html"/);
  assert.match(result.html, /<div class="price">150<\/div>/);
  assert.doesNotMatch(result.html, /Nabidka je viditelna ve vysledcich/);
  assert.doesNotMatch(result.html, /Tato vec patri vam|Vlastni vec si nemuzete rezervovat/);
  assert.doesNotMatch(result.html, /detail\.privateListingNote|Soukroma nabidka|mailto:rentulo@rentulo\.com/);
  assert.equal(result.bookingFormSetups, 0);
});

test("other renters and anonymous visitors can still report the offer; booking stays available", async () => {
  const renter = await renderOfferFor({ id: "renter-2" });
  assert.match(renter.html, /mailto:rentulo@rentulo\.com\?subject=/);
  assert.match(renter.html, /Nahlasit nabidku/);
  assert.match(renter.html, /Reservation form/);
  assert.equal(renter.bookingFormSetups, 1);

  const anonymous = await renderOfferFor(null);
  assert.match(anonymous.html, /mailto:rentulo@rentulo\.com\?subject=/);
  assert.doesNotMatch(anonymous.html, /href="moje-nabidky\.html"/);
  assert.equal(anonymous.bookingFormSetups, 0);
});
