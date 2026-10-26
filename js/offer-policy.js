(function (root) {
  "use strict";

  // Screening is intentionally conservative: it catches clearly labelled vehicles,
  // but brand-only titles and photographs still require reports and human moderation.
  // Keep the SQL trigger in 20261018110000_bod02_v1_transport_rule_TEST.sql aligned.
  const bannedCategories = new Set(["auto a doprava", "auto & transport", "vehicles", "transport", "dopravni prostredky", "dopravne prostriedky"]);
  const transportTitle = /(^|[^a-z0-9])(auto|automobil|automobily|osobni auto|osobni automobil|motorove vozidlo|motorka|motocykl|motocykel|moped|skutr|scooter|elektroskutr|elektroskuter|jizdni kolo|bicykl|bicykel|bicycle|elektrokolo|e-bike|kolobezka|elektrokolobezka|e-scooter|motorcycle|motorbike|motorboat|caravan|karavan|obytny vuz|obytny automobil|privesny vozik|prives|lod|clun|kajak|kanoe|boat|bicycle|motorhome|car|bike|kayak|canoe|trailer|fahrrad|motorrad|roller|boot|kanu|wohnmobil|anhanger|samochod|rower|hulajnoga|lodz|skuter|motorower|przyczepa|paddleboard)(?=$|[^a-z0-9])/i;

  function normalize(value) {
    return String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim();
  }

  function isTransportOffer(name, category) {
    return bannedCategories.has(normalize(category)) || transportTitle.test(normalize(name));
  }

  root.rentuloOfferPolicy = Object.freeze({ isTransportOffer: isTransportOffer });
})(typeof window === "undefined" ? globalThis : window);
