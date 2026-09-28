"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESERVATIONS_SHARED_PATH = path.join(PROJECT_ROOT, "js", "reservations.js");
const RENTER_PAGE_PATH = path.join(PROJECT_ROOT, "js", "reservations-page.js");
const OWNER_PAGE_PATH = path.join(PROJECT_ROOT, "js", "offers-page.js");
const I18N_PATH = path.join(PROJECT_ROOT, "js", "i18n.js");
const RENTER_HTML_PATH = path.join(PROJECT_ROOT, "moje-rezervace.html");
const OWNER_HTML_PATH = path.join(PROJECT_ROOT, "moje-nabidky.html");
const OWNER_FLOW_CSS_PATH = path.join(PROJECT_ROOT, "css", "my-offers-flow.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("paid reservations are cancellable for both parties before the shared six-hour cutoff", () => {
  const shared = read(RESERVATIONS_SHARED_PATH);

  assert.match(
    shared,
    /function canRenterCancelReservation[\s\S]*RESERVATION_STATUS_PENDING[\s\S]*RESERVATION_STATUS_APPROVED[\s\S]*RESERVATION_STATUS_PAID/
  );
  assert.match(
    shared,
    /function canOwnerCancelReservation[\s\S]*RESERVATION_STATUS_APPROVED[\s\S]*RESERVATION_STATUS_PAID/
  );
  assert.match(shared, /return now\.getTime\(\) < cutoff\.getTime\(\)/);
});

test("shared paid cancellation client calls preview or confirm on the trusted Edge Function", () => {
  const shared = read(RESERVATIONS_SHARED_PATH);

  assert.match(shared, /function requestPaidReservationCancellation/);
  assert.match(shared, /"cancel-paid-reservation"/);
  assert.match(shared, /reservation_id:\s*reservationId/);
  assert.match(shared, /action:\s*action/);
  assert.match(shared, /action !== "preview" && action !== "confirm"/);
  assert.match(shared, /formatPaidCancellationMinorMoney/);
});

test("renter paid cancellation previews exact Stripe cost before confirmation", () => {
  const source = read(RENTER_PAGE_PATH);
  const previewIndex = source.indexOf('"preview"');
  const modalIndex = source.indexOf("openReservationCancelModal(\n          reservation,\n          previewResult.data");
  const confirmIndex = source.indexOf('"confirm"', previewIndex + 1);

  assert.ok(previewIndex >= 0, "renter preview call must exist");
  assert.ok(modalIndex > previewIndex, "preview must load before the confirmation modal");
  assert.ok(confirmIndex > modalIndex, "confirm must run only after the modal is accepted");
  assert.match(source, /payment_amount_minor/);
  assert.match(source, /external_cost_amount_minor/);
  assert.match(source, /refund_amount_minor/);
  assert.match(source, /reservations\.cancelPaid\.renterDescription/);
  assert.match(source, /reservations\.cancelPaid\.confirm/);
});

test("owner paid cancellation previews the full renter refund and seven-day owner cost", () => {
  const source = read(OWNER_PAGE_PATH);

  assert.match(source, /normalizedStatus === RESERVATION_STATUS_PAID/);
  assert.match(source, /requestPaidReservationCancellation[\s\S]*"preview"/);
  assert.match(source, /openOwnerReservationCancelModal\([\s\S]*previewResult\.data/);
  assert.match(source, /requestPaidReservationCancellation[\s\S]*"confirm"/);
  assert.match(source, /reservations\.cancelPaid\.ownerDescription/);
  assert.match(source, /reservations\.cancelPaid\.ownerDescriptionNoCost/);
  assert.match(source, /7 dní od storna/);
  assert.match(source, /actions\.push\(renderOwnerReservationCancellationAction\(reservation\)\)/);
});

test("paid cancellation UI does not use the ordinary browser status RPC for the paid branch", () => {
  const renter = read(RENTER_PAGE_PATH);
  const owner = read(OWNER_PAGE_PATH);

  const renterPaidStart = renter.indexOf("if (normalizedStatus === RESERVATION_STATUS_PAID)");
  const renterOrdinaryRpc = renter.indexOf('.rpc("change_my_reservation_status"', renterPaidStart);
  const renterReturn = renter.indexOf("return;", renter.indexOf("renterSuccess", renterPaidStart));
  assert.ok(renterPaidStart >= 0 && renterReturn > renterPaidStart);
  assert.ok(renterOrdinaryRpc === -1 || renterOrdinaryRpc > renterReturn);

  const ownerPaidStart = owner.indexOf("if (normalizedStatus === RESERVATION_STATUS_PAID)");
  const ownerOrdinaryUpdate = owner.indexOf("updateReservationStatus(\n        reservationId,\n        RESERVATION_STATUS_CANCELLED", ownerPaidStart);
  const ownerReturn = owner.indexOf("return;", owner.indexOf("reloadAndReopen(reservationId, \"history\")", ownerPaidStart));
  assert.ok(ownerPaidStart >= 0 && ownerReturn > ownerPaidStart);
  assert.ok(ownerOrdinaryUpdate === -1 || ownerOrdinaryUpdate > ownerReturn);
});


test("renter cancellation is visible directly in the reservation row like owner cancellation", () => {
  const page = read(RENTER_PAGE_PATH);
  const shared = read(RESERVATIONS_SHARED_PATH);

  assert.match(page, /function renderRenterReservationCancellationAction/);
  assert.match(page, /const cancellationAction = renderRenterReservationCancellationAction\(reservation\)/);
  assert.match(
    page,
    /class="simple-reservation-actions"[\s\S]*\$\{paymentAction\}[\s\S]*\$\{cancellationAction\}[\s\S]*\$\{detailAction\}/
  );
  assert.doesNotMatch(
    page,
    /renderContactBox\(reservation, status\)[\s\S]{0,120}renderReservationDetailActions/
  );
  assert.match(page, /data-reservations-action="cancel"/);
  assert.match(page, /data-cancel-cutoff=/);
  assert.match(page, /reservation-cancel-cutoff-note/);
  assert.match(shared, /\.reservation-detail-actions, \.simple-reservation-actions/);
  assert.match(shared, /\.reservation-cancel-action\.reservation-cancel-locked/);
});

test("renter cutoff explanation stays grouped directly below the disabled cancel action", () => {
  const page = read(RENTER_PAGE_PATH);
  const shared = read(RESERVATIONS_SHARED_PATH);
  const renterHtml = read(RENTER_HTML_PATH);

  assert.match(
    page,
    /reservation-cancel-action-stack reservation-cancel-action-stack-locked[\s\S]*reservation-cancel-locked[\s\S]*reservation-cancel-cutoff-note/
  );
  assert.match(
    page,
    /class="reservation-cancel-action-stack"[\s\S]*data-reservations-action="cancel"/
  );
  assert.match(shared, /button\.closest\("\.reservation-cancel-action-stack"\)/);
  assert.match(shared, /actionStack\.classList\.add\("reservation-cancel-action-stack-locked"\)/);
  assert.match(
    renterHtml,
    /\.simple-reservation-actions \.reservation-cancel-action-stack \{[\s\S]*flex-direction: column;[\s\S]*align-items: flex-end;/
  );
  assert.match(
    renterHtml,
    /\.reservation-cancel-action-stack \.reservation-cancel-cutoff-note \{[\s\S]*max-width: 180px;[\s\S]*text-align: right;/
  );
});

test("locked renter cancellation keeps both detail actions together beside the cutoff block", () => {
  const page = read(RENTER_PAGE_PATH);
  const renterHtml = read(RENTER_HTML_PATH);

  assert.match(
    page,
    /class="reservation-detail-action-group"[\s\S]*\$\{detailAction\}[\s\S]*\$\{offerDetailAction\}/
  );
  assert.match(
    renterHtml,
    /\.simple-reservation-actions \.reservation-cancel-action-stack-locked \{[\s\S]*width: 180px;[\s\S]*max-width: 180px;/
  );
  assert.match(
    renterHtml,
    /\.simple-reservation-actions \.reservation-detail-action-group \{[\s\S]*display: flex;[\s\S]*flex: 0 0 auto;[\s\S]*gap: 10px;/
  );
  assert.match(
    renterHtml,
    /@media \(max-width: 560px\)[\s\S]*\.simple-reservation-actions \.reservation-detail-action-group \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-template-columns: 1fr 1fr;/
  );
});

test("renter and owner cancellation actions use the same compact visual semantics", () => {
  const renterHtml = read(RENTER_HTML_PATH);
  const ownerHtml = read(OWNER_HTML_PATH);
  const ownerFlowCss = read(OWNER_FLOW_CSS_PATH);

  assert.match(
    renterHtml,
    /\.simple-reservation-actions \.reservation-primary-action \{[\s\S]*min-height: 34px !important;[\s\S]*padding: 8px 11px !important;[\s\S]*border-radius: 9px !important;[\s\S]*font-weight: 900 !important;/
  );
  assert.match(
    ownerFlowCss,
    /\.owner-reservation-actions \.small-button,[\s\S]*min-height: 34px !important;[\s\S]*padding: 8px 11px !important;/
  );

  for (const source of [renterHtml, ownerHtml]) {
    assert.match(source, /background: #fff8f6 !important;/);
    assert.match(source, /color: #a43b2f !important;/);
    assert.match(source, /border: 1px solid #efc1b7 !important;/);
    assert.match(source, /background: #fff0ec !important;/);
  }

  assert.match(renterHtml, /\.simple-reservation-actions \.reservation-cancel-action/);
  assert.match(ownerHtml, /\.request-row \.row-actions \.small-button\.reservation-cancel-action/);
});

test("paid cancellation warning and result copy exists in all five supported languages", () => {
  const i18n = read(I18N_PATH);

  assert.equal((i18n.match(/"reservations\.cancelPaid\.title"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.renterDescription"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.ownerDescription"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.confirm"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.previewError"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.confirmError"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.renterSuccess"/g) || []).length, 5);
  assert.equal((i18n.match(/"reservations\.cancelPaid\.ownerSuccess"/g) || []).length, 5);
});
