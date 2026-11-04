let editOfferPhotoDataUrl = "";
let editOfferPhotoProcessing = false;
let editOfferPhotoSelectionToken = 0;
let editOfferPhotoState = "none";
let editOfferSelectedPhotoFileName = "";
let editCurrentOffer = null;
let editHasBlockingReservation = false;
let editSaveInProgress = false;
let editOwnerProfile = {
  street: "",
  city: "",
  postalCode: "",
  countryCode: ""
};

const EDIT_OFFER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const EDIT_OFFER_PHOTO_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

const MINIMUM_OFFER_PRICE_CZK = 100;


function editT(key, fallback) {
  if (typeof window.rentuloTranslate === "function") {
    const translated = window.rentuloTranslate(key);
    return translated === key ? fallback : translated;
  }

  return fallback;
}

document.addEventListener("DOMContentLoaded", async function () {
  const supabaseUser = await window.rentuloAuthGuard.requireUser();

  if (!supabaseUser) {
    return;
  }

  initializeEditOfferPage(supabaseUser);
});

function editShowMessage(message, type = "error", translationKey = "") {
  let messageBox = document.querySelector(".site-message");

  if (!messageBox) {
    messageBox = document.createElement("div");
    messageBox.className = "site-message";
    document.body.appendChild(messageBox);
  }

  messageBox.textContent = message;
  messageBox.className = "site-message " + type;
  messageBox.dataset.dynamicI18nKey = translationKey;
  messageBox.dataset.dynamicI18nFallback = message;

  setTimeout(function () {
    messageBox.className = "site-message";
  }, 3500);
}

function editShowTranslatedMessage(key, fallback, type = "error") {
  editShowMessage(editT(key, fallback), type, key);
}

function editMarkError(input) {
  if (input) {
    input.classList.add("input-error");
  }
}

function editClearErrors() {
  const fields = document.querySelectorAll("input, textarea, select");

  fields.forEach(function (field) {
    field.classList.remove("input-error");
  });
}

function editIsEmpty(value) {
  return String(value === undefined || value === null ? "" : value).trim() === "";
}

function editMoneyToNumber(value) {
  const cleanedValue = String(value === undefined || value === null ? "" : value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const numberValue = Number(cleanedValue);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return 0;
  }

  return Math.round(numberValue);
}

function editValueOrEmpty(value) {
  return value === undefined || value === null ? "" : value;
}


function getEditToolId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function getEditOfferPhoto(offer) {
  if (!offer) {
    return "";
  }

  return offer.photo_url || offer.photoUrl || offer.image || offer.photo || "";
}

function renderEditPhotoPreview(photoValue) {
  const preview = document.querySelector("#editPhotoPreview");

  if (!preview) {
    return;
  }

  if (!photoValue) {
    preview.textContent = editT("editOffer.noPhoto", "Bez fotky");
    return;
  }

  preview.innerHTML = `<img src="${escapeHtml(photoValue)}" alt="${escapeHtml(editT("editOffer.photoTitle", "Fotka věci"))}">`;
}

function updateEditPhotoControlState(state, fileNameValue) {
  const button = document.querySelector(".photo-file-button");
  const fileName = document.getElementById("editPhotoFileName");

  const states = {
    current: {
      buttonKey: "editOffer.changePhoto",
      buttonFallback: "Změnit fotku",
      fileKey: "editOffer.currentPhotoFile",
      fileFallback: "Aktuální fotka je uložená"
    },
    new: {
      buttonKey: "editOffer.chooseAnotherPhoto",
      buttonFallback: "Vybrat jinou fotku"
    },
    none: {
      buttonKey: "editOffer.choosePhoto",
      buttonFallback: "Vybrat fotku",
      fileKey: "editOffer.noFileChosen",
      fileFallback: "Nebyl vybrán žádný soubor"
    }
  };

  const nextState = states[state] || states.none;

  if (button) {
    button.setAttribute("data-i18n", nextState.buttonKey);
    button.textContent = editT(nextState.buttonKey, nextState.buttonFallback);
  }

  if (!fileName) {
    return;
  }

  if (state === "new" && fileNameValue) {
    fileName.removeAttribute("data-i18n");
    fileName.textContent = fileNameValue;
    return;
  }

  fileName.setAttribute("data-i18n", nextState.fileKey);
  fileName.textContent = editT(nextState.fileKey, nextState.fileFallback);
}

function updateEditPhotoStatus(message, type, translationKey) {
  const status = document.querySelector("#editPhotoStatus");

  if (!status) {
    return;
  }

  if (translationKey) {
    status.setAttribute("data-i18n", translationKey);
  } else {
    status.removeAttribute("data-i18n");
  }

  status.textContent = message;
  status.className = "photo-upload-status " + (type || "");
  status.hidden = !message;
}

function resizeEditImageToDataUrl(file, callback) {
  const reader = new FileReader();

  reader.onload = function (event) {
    const image = new Image();

    image.onload = function () {
      const maxSize = 900;
      let width = image.width;
      let height = image.height;

      if (width > height && width > maxSize) {
        height = Math.round(height * maxSize / width);
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round(width * maxSize / height);
        height = maxSize;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);

      callback(canvas.toDataURL("image/jpeg", 0.78));
    };

    image.onerror = function () {
      callback("");
    };

    image.src = event.target.result;
  };

  reader.onerror = function () {
    callback("");
  };

  reader.readAsDataURL(file);
}

function setEditRemovePhotoButtonVisible(button, isVisible) {
  if (!button) {
    return;
  }

  button.hidden = !isVisible;
}

function setupEditOfferPhotoUpload() {
  const photoInput = document.querySelector("#edit-photo");
  const removePhotoButton = document.querySelector("#removeEditPhotoButton");

  setEditRemovePhotoButtonVisible(removePhotoButton, Boolean(editOfferPhotoDataUrl));

  if (photoInput) {
    updateEditPhotoControlState(editOfferPhotoState, editOfferSelectedPhotoFileName);

    photoInput.addEventListener("change", function () {
      const file = photoInput.files && photoInput.files[0];
      const selectionToken = ++editOfferPhotoSelectionToken;
      const previousPhotoState = editOfferPhotoState;
      const previousPhotoFileName = editOfferSelectedPhotoFileName;

      if (!file) {
        editOfferPhotoProcessing = false;
        updateEditPhotoControlState(previousPhotoState, previousPhotoFileName);
        updateEditPhotoStatus(editT("editOffer.photoNotSelected", "Fotka nebyla vybraná."), "", "editOffer.photoNotSelected");
        setEditRemovePhotoButtonVisible(removePhotoButton, Boolean(editOfferPhotoDataUrl));
        return;
      }

      if (!EDIT_OFFER_PHOTO_ALLOWED_TYPES.includes(file.type)) {
        editOfferPhotoProcessing = false;
        photoInput.value = "";
        updateEditPhotoControlState(previousPhotoState, previousPhotoFileName);
        updateEditPhotoStatus(editT("editOffer.invalidPhoto", "Vyberte prosím obrázek ve formátu JPG, PNG nebo WEBP."), "error", "editOffer.invalidPhoto");
        setEditRemovePhotoButtonVisible(removePhotoButton, Boolean(editOfferPhotoDataUrl));
        return;
      }

      if (file.size > EDIT_OFFER_PHOTO_MAX_BYTES) {
        editOfferPhotoProcessing = false;
        photoInput.value = "";
        updateEditPhotoControlState(previousPhotoState, previousPhotoFileName);
        updateEditPhotoStatus(editT("editOffer.photoTooLarge", "Fotka je příliš velká. Maximální velikost je 5 MB."), "error", "editOffer.photoTooLarge");
        setEditRemovePhotoButtonVisible(removePhotoButton, Boolean(editOfferPhotoDataUrl));
        return;
      }

      editOfferPhotoProcessing = true;
      updateEditPhotoControlState("new", file.name);
      updateEditPhotoStatus(editT("editOffer.processingPhoto", "Zpracovávám fotku..."), "", "editOffer.processingPhoto");

      resizeEditImageToDataUrl(file, function (dataUrl) {
        if (selectionToken !== editOfferPhotoSelectionToken) {
          return;
        }

        editOfferPhotoProcessing = false;

        if (!dataUrl) {
          photoInput.value = "";
          updateEditPhotoControlState(previousPhotoState, previousPhotoFileName);
          updateEditPhotoStatus(editT("editOffer.photoLoadFailed", "Fotku se nepodařilo načíst. Zkuste jiný obrázek."), "error", "editOffer.photoLoadFailed");
          setEditRemovePhotoButtonVisible(removePhotoButton, Boolean(editOfferPhotoDataUrl));
          return;
        }

        editOfferPhotoDataUrl = dataUrl;
        editOfferPhotoState = "new";
        editOfferSelectedPhotoFileName = file.name;
        renderEditPhotoPreview(editOfferPhotoDataUrl);
        updateEditPhotoControlState(editOfferPhotoState, editOfferSelectedPhotoFileName);
        updateEditPhotoStatus(editT("editOffer.photoReady", "Nová fotka je připravená k uložení."), "success", "editOffer.photoReady");
        setEditRemovePhotoButtonVisible(removePhotoButton, true);
      });
    });
  }

  if (removePhotoButton) {
    removePhotoButton.addEventListener("click", function () {
      editOfferPhotoSelectionToken += 1;
      editOfferPhotoProcessing = false;
      editOfferPhotoDataUrl = "";
      editOfferPhotoState = "none";
      editOfferSelectedPhotoFileName = "";

      if (photoInput) {
        photoInput.value = "";
        updateEditPhotoControlState(editOfferPhotoState, editOfferSelectedPhotoFileName);
      }

      renderEditPhotoPreview("");
      updateEditPhotoStatus(editT("editOffer.photoWillBeRemoved", "Fotka bude po uložení odstraněná."), "", "editOffer.photoWillBeRemoved");
      setEditRemovePhotoButtonVisible(removePhotoButton, false);
    });
  }
}

function getEditPageElement() {
  return document.querySelector(".edit-page");
}

function showEditOfferNotFound() {
  const editPage = getEditPageElement();

  if (!editPage) {
    return;
  }

  editPage.innerHTML = `
    <section class="login-required-box">
      <p class="eyebrow" data-i18n="editOffer.notFoundEyebrow">${editT("editOffer.notFoundEyebrow", "Nabídka nenalezena")}</p>
      <h1 data-i18n="editOffer.notFoundTitle">${editT("editOffer.notFoundTitle", "Tuto nabídku se nepodařilo najít.")}</h1>
      <p data-i18n="editOffer.notFoundDescription">${editT("editOffer.notFoundDescription", "Nabídka mohla být smazána nebo odkaz není správný.")}</p>
      <div class="login-required-actions">
        <a href="moje-nabidky.html" data-i18n="editOffer.backToListings">${editT("editOffer.backToListings", "Zpět na moje nabídky")}</a>
      </div>
    </section>
  `;
}

function showEditOfferForbidden() {
  const editPage = getEditPageElement();

  if (!editPage) {
    return;
  }

  editPage.innerHTML = `
    <section class="login-required-box">
      <p class="eyebrow" data-i18n="editOffer.forbiddenEyebrow">${editT("editOffer.forbiddenEyebrow", "Nemáte oprávnění")}</p>
      <h1 data-i18n="editOffer.forbiddenTitle">${editT("editOffer.forbiddenTitle", "Tuto nabídku nemůžete upravovat.")}</h1>
      <p data-i18n="editOffer.forbiddenDescription">${editT("editOffer.forbiddenDescription", "Upravovat můžete pouze nabídky, které jste sami vytvořili.")}</p>
      <div class="login-required-actions">
        <a href="moje-nabidky.html" data-i18n="editOffer.backToListings">${editT("editOffer.backToListings", "Zpět na moje nabídky")}</a>
      </div>
    </section>
  `;
}

async function loadOfferFromSupabase(offerId) {
  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    throw new Error(editT("editOffer.supabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku."));
  }

  const { data, error } = await supabaseClient
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function loadEditOwnerProfile(userId) {
  const supabaseClient = getSupabaseClient();

  if (!supabaseClient || !userId) {
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("street, city, postal_code, country_code")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    if (error) {
      console.warn("Profilovou adresu se nepodařilo načíst.", error);
    }

    return;
  }

  editOwnerProfile = {
    street: profile.street || "",
    city: profile.city || "",
    postalCode: profile.postal_code || "",
    countryCode: profile.country_code || ""
  };
}

async function offerHasOpenReservationInSupabase(offerId) {
  const supabaseClient = getSupabaseClient();

  if (!supabaseClient || !offerId) {
    return false;
  }

  const { data, error } = await supabaseClient
  .rpc("get_blocking_reservations", {
    p_offer_id: offerId
  });

const blockingReservations = Array.isArray(data)
  ? data.slice(0, 1)
  : [];

  if (error) {
    console.warn(editT("editOffer.reservationCheckFailed", "Nepodařilo se ověřit aktivní rezervace nabídky."), error);
    return false;
  }

 return blockingReservations.length > 0;
}

function editLockPriceFields(hasBlockingReservation) {
  const priceInput = document.querySelector("#edit-price");

  if (!priceInput) {
    return;
  }

  if (!hasBlockingReservation) {
    priceInput.readOnly = false;
    priceInput.classList.remove("locked-input");
    return;
  }

  priceInput.readOnly = true;
  priceInput.classList.add("locked-input");

  const existingNotice = document.querySelector(".edit-price-lock-notice");

  if (existingNotice) {
    return;
  }

  const notice = document.createElement("p");
  notice.className = "edit-price-lock-notice";
  notice.dataset.i18n = "editOffer.priceLocked";
  notice.textContent =
    editT("editOffer.priceLocked", "Cena je zamčená, protože nabídka má aktivní rezervaci.");

  priceInput.insertAdjacentElement("afterend", notice);
}

function normalizeEditOfferCategory(category) {
  const value = String(category || "").trim();
  const legacyMap = {
    "Dům a zahrada": "Domácnost",
    "Dílna a nářadí": "Stavba",
    "Stavební technika": "Stavba",
    "Sport a volný čas": "Hobby",
    "Elektronika": "Hobby",
    "Děti a rodina": "Hobby",
    "Cestování a kempování": "Hobby",
    "Párty a akce": "Párty",
    "Auto a doprava": "Ostatní"
  };

  return legacyMap[value] || value;
}

function renderEditProfilePickupAddress() {
  const summary = document.querySelector("#editProfilePickupSummary");
  const address = document.querySelector("#editProfilePickupAddress");
  const pickupUseCustom = document.querySelector("#editPickupUseCustom");

  if (!summary || !address) {
    return;
  }

  const hasCompleteProfileAddress = Boolean(
    editOwnerProfile.street &&
    editOwnerProfile.city &&
    editOwnerProfile.postalCode &&
    editOwnerProfile.countryCode === "CZ"
  );

  if (!hasCompleteProfileAddress) {
    summary.hidden = true;
    address.textContent = "";
    return;
  }

  address.textContent = [
    editOwnerProfile.street,
    editOwnerProfile.city,
    editOwnerProfile.postalCode
  ].join(", ");
  summary.hidden = Boolean(pickupUseCustom && pickupUseCustom.checked);
}

function setupEditPickupFields() {
  const pickupUseCustom = document.querySelector("#editPickupUseCustom");
  const pickupCustomFields = document.querySelector("#editPickupCustomFields");
  setupRentuloCzechPostalCodeBlur(document.getElementById("edit-postal-code"));

  if (!pickupUseCustom || !pickupCustomFields) {
    return;
  }

  pickupUseCustom.addEventListener("change", function () {
    pickupCustomFields.classList.toggle("is-visible", pickupUseCustom.checked);

    renderEditProfilePickupAddress();
  });

  pickupCustomFields.classList.toggle("is-visible", pickupUseCustom.checked);
  renderEditProfilePickupAddress();
}

function getEditedPickupAddress() {
  const pickupUseCustom = document.querySelector("#editPickupUseCustom");
  const useCustomPickup = Boolean(pickupUseCustom && pickupUseCustom.checked);

  if (useCustomPickup) {
    const pickupStreetInput = document.querySelector("#edit-pickup-street");
    const cityInput = document.querySelector("#edit-city");
    const postalInput = document.querySelector("#edit-postal-code");
    const pickupNoteInput = document.querySelector("#edit-pickup-note");

    return {
      mode: "custom",
      countryCode: "CZ",
      street: pickupStreetInput ? pickupStreetInput.value.trim() : "",
      city: cityInput ? cityInput.value.trim() : "",
      postalCode: postalInput ? (formatRentuloCzechPostalCode(postalInput.value) || postalInput.value.trim()) : "",
      note: pickupNoteInput ? pickupNoteInput.value.trim() : ""
    };
  }

  return {
    mode: "profile",
    countryCode: editOwnerProfile.countryCode,
    street: editOwnerProfile.street,
    city: editOwnerProfile.city,
    postalCode: formatRentuloCzechPostalCode(editOwnerProfile.postalCode) || editOwnerProfile.postalCode,
    note: ""
  };
}

function fillEditForm(offer) {
  const nameInput = document.querySelector("#edit-name");
  const categorySelect = document.querySelector("#edit-category");
  const pickupUseCustom = document.querySelector("#editPickupUseCustom");
  const pickupCustomFields = document.querySelector("#editPickupCustomFields");
  const pickupStreetInput = document.querySelector("#edit-pickup-street");
  const cityInput = document.querySelector("#edit-city");
  const postalInput = document.querySelector("#edit-postal-code");
  const pickupNoteInput = document.querySelector("#edit-pickup-note");
  const priceInput = document.querySelector("#edit-price");
  const minDaysInput = document.querySelector("#edit-min-rental-days");
  const descriptionInput = document.querySelector("#edit-description");

  if (
    !nameInput ||
    !categorySelect ||
    !pickupUseCustom ||
    !pickupCustomFields ||
    !pickupStreetInput ||
    !cityInput ||
    !postalInput ||
    !pickupNoteInput ||
    !priceInput ||
    !minDaysInput ||
    !descriptionInput
  ) {
    editShowTranslatedMessage("editOffer.formLoadFailed", "Formulář pro úpravu nabídky se nepodařilo načíst.");
    return;
  }

  nameInput.value = offer.name || "";
  categorySelect.value = normalizeEditOfferCategory(offer.category);

  const usesCustomPickup = offer.pickup_mode === "custom";
  pickupStreetInput.value = usesCustomPickup ? (offer.pickup_street || "") : "";
  cityInput.value = usesCustomPickup ? (offer.pickup_city || offer.city || "") : "";
  postalInput.value = usesCustomPickup ? (offer.pickup_postal_code || offer.postal_code || "") : "";
  pickupNoteInput.value = usesCustomPickup ? (offer.pickup_note || "") : "";
  priceInput.value = editValueOrEmpty(offer.price_per_day);
  minDaysInput.value = String(offer.min_rental_days || 1);
  descriptionInput.value = offer.description || "";

  pickupUseCustom.checked = usesCustomPickup;
  pickupCustomFields.classList.toggle("is-visible", pickupUseCustom.checked);
  renderEditProfilePickupAddress();

  editOfferPhotoDataUrl = getEditOfferPhoto(offer);
  editOfferPhotoState = editOfferPhotoDataUrl ? "current" : "none";
  editOfferSelectedPhotoFileName = "";
  renderEditPhotoPreview(editOfferPhotoDataUrl);

  if (editOfferPhotoDataUrl) {
    updateEditPhotoStatus("", "");
  } else {
    updateEditPhotoStatus(editT("editOffer.noCurrentPhoto", "Tato nabídka zatím nemá fotku."), "", "editOffer.noCurrentPhoto");
  }

  document.title = editT("editOffer.title", "Upravit nabídku") + " - " + (offer.name || editT("editOffer.offerFallback", "Nabídka"));
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const metadata = parts[0];
  const base64 = parts[1];

  const mimeMatch = metadata.match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: mimeType
  });
}

function getOwnedOfferPhotoPath(photoUrl, userId) {
  if (!photoUrl || !userId) {
    return "";
  }

  try {
    const parsedUrl = new URL(photoUrl, window.location.origin);
    const marker = "/storage/v1/object/public/offer-photos/";
    const markerIndex = parsedUrl.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return "";
    }

    const photoPath = decodeURIComponent(parsedUrl.pathname.slice(markerIndex + marker.length));
    return photoPath.startsWith(userId + "/") ? photoPath : "";
  } catch (error) {
    return "";
  }
}

async function removeEditedOfferPhotoFromStorage(supabaseClient, photoPath) {
  if (!photoPath) {
    return;
  }

  const { error } = await supabaseClient.storage
    .from("offer-photos")
    .remove([photoPath]);

  if (error) {
    console.error("Starou fotku se nepodařilo odstranit ze Storage.", error);
  }
}

async function uploadEditedOfferPhoto(supabaseClient, userId) {
  if (!editOfferPhotoDataUrl) {
    return { url: null, path: "", isNew: false };
  }

  if (!editOfferPhotoDataUrl.startsWith("data:")) {
    return { url: editOfferPhotoDataUrl, path: "", isNew: false };
  }

  const photoBlob = dataUrlToBlob(editOfferPhotoDataUrl);
  const fileName = userId + "/" + Date.now() + "-offer.jpg";

  updateEditPhotoStatus(editT("editOffer.uploadingPhoto", "Nahrávám fotku do Supabase..."), "", "editOffer.uploadingPhoto");

  const { error } = await supabaseClient.storage
    .from("offer-photos")
    .upload(fileName, photoBlob, {
      contentType: "image/jpeg",
      upsert: false
    });

  if (error) {
    throw error;
  }

  const { data } = supabaseClient.storage
    .from("offer-photos")
    .getPublicUrl(fileName);

  updateEditPhotoStatus(editT("editOffer.photoUploaded", "Fotka byla nahraná."), "success", "editOffer.photoUploaded");

  return {
    url: data && data.publicUrl ? data.publicUrl : null,
    path: fileName,
    isNew: true
  };
}

function setEditSavingState(isSaving) {
  const saveButton = document.querySelector("#save-edit-button");

  if (!saveButton) {
    return;
  }

  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving
    ? editT("editOffer.saving", "Ukládám změny...")
    : editT("editOffer.save", "Uložit změny");
}

async function geocodeEditedPickupAddress(supabaseClient, pickupAddress, mustVerify = true) {
  const { data, error } = await supabaseClient.functions.invoke("geocode-pickup", {
    body: {
      street: pickupAddress.street,
      city: pickupAddress.city,
      postalCode: pickupAddress.postalCode,
      countryCode: pickupAddress.countryCode
    }
  });

  if (error) {
    if (mustVerify) {
      const unavailable = new Error("Pickup verification unavailable");
      unavailable.code = "PICKUP_GEOCODING_UNAVAILABLE";
      throw unavailable;
    }
    return null;
  }

  if (!data || data.ok !== true) {
    if (data && data.reason === "unsupported_country") {
      const countryError = new Error("Pickup address is outside the Czech Republic");
      countryError.code = "PICKUP_COUNTRY_UNSUPPORTED";
      throw countryError;
    }
    if (data && data.reason === "not_found") {
      const geocodeError = new Error("Pickup address was not found");
      geocodeError.code = "PICKUP_GEOCODING_NOT_FOUND";
      throw geocodeError;
    }

    if (mustVerify) {
      const unavailable = new Error("Pickup verification unavailable");
      unavailable.code = "PICKUP_GEOCODING_UNAVAILABLE";
      throw unavailable;
    }
    return null;
  }

  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const unavailable = new Error("Invalid pickup coordinates");
    unavailable.code = "PICKUP_GEOCODING_UNAVAILABLE";
    throw unavailable;
  }

  return { latitude, longitude };
}

async function initializeEditOfferPage(supabaseUser) {
  const offerId = getEditToolId();

  if (!offerId) {
    showEditOfferNotFound();
    return;
  }

  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    editShowTranslatedMessage("editOffer.supabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku.");
    return;
  }

  try {
    const offer = await loadOfferFromSupabase(offerId);

    if (!offer) {
      showEditOfferNotFound();
      return;
    }

    if (String(offer.owner_id) !== String(supabaseUser.id)) {
      showEditOfferForbidden();
      return;
    }

    editCurrentOffer = offer;
    await loadEditOwnerProfile(supabaseUser.id);
    editHasBlockingReservation = await offerHasOpenReservationInSupabase(offer.id);

    fillEditForm(offer);
    editLockPriceFields(editHasBlockingReservation);
    setupEditOfferPhotoUpload();
    setupEditPickupFields();
    setupEditOfferSave();
  } catch (error) {
    console.error(error);
    showEditOfferNotFound();
  }
}

function setupEditOfferSave() {
  const saveButton = document.querySelector("#save-edit-button");

  if (!saveButton) {
    return;
  }

  saveButton.addEventListener("click", async function () {
    if (editSaveInProgress) {
      return;
    }

    editClearErrors();

    if (!editCurrentOffer) {
      editShowTranslatedMessage("editOffer.offerLoadFailed", "Nabídku se nepodařilo načíst.");
      return;
    }

    const supabaseClient = getSupabaseClient();
    const supabaseUser = await getCurrentSupabaseUser();

    if (!supabaseClient || !supabaseUser) {
      editShowTranslatedMessage("editOffer.sessionMissing", "Vaše přihlášení vypršelo. Přihlaste se prosím znovu.");
      return;
    }

    if (String(editCurrentOffer.owner_id) !== String(supabaseUser.id)) {
      editShowTranslatedMessage("editOffer.cannotEdit", "Tuto nabídku nemůžete upravovat.");
      return;
    }

    const nameInput = document.querySelector("#edit-name");
    const categorySelect = document.querySelector("#edit-category");
    const pickupUseCustom = document.querySelector("#editPickupUseCustom");
    const pickupStreetInput = document.querySelector("#edit-pickup-street");
    const cityInput = document.querySelector("#edit-city");
    const postalInput = document.querySelector("#edit-postal-code");
    const pickupNoteInput = document.querySelector("#edit-pickup-note");
    const priceInput = document.querySelector("#edit-price");
    const minDaysInput = document.querySelector("#edit-min-rental-days");
    const descriptionInput = document.querySelector("#edit-description");

    if (
      !nameInput ||
      !categorySelect ||
      !pickupUseCustom ||
      !pickupStreetInput ||
      !cityInput ||
      !postalInput ||
      !pickupNoteInput ||
      !priceInput ||
      !minDaysInput ||
      !descriptionInput
    ) {
      editShowTranslatedMessage("editOffer.formLoadFailed", "Formulář pro úpravu nabídky se nepodařilo načíst.");
      return;
    }

    let hasError = false;

    [nameInput, descriptionInput].forEach(function (field) {
      if (editIsEmpty(field.value)) {
        editMarkError(field);
        hasError = true;
      }
    });

    if (categorySelect.selectedIndex === 0 || editIsEmpty(categorySelect.value)) {
      editMarkError(categorySelect);
      hasError = true;
    }

    if (pickupUseCustom.checked) {
      [pickupStreetInput, cityInput, postalInput].forEach(function (field) {
        if (editIsEmpty(field.value)) {
          editMarkError(field);
          hasError = true;
        }
      });
    } else if (editOwnerProfile.countryCode !== "CZ") {
      editShowTranslatedMessage("offer.profilePickupOutsideCz", "Profilová adresa není ověřená jako česká. Zvolte jiné místo vyzvednutí v ČR nebo doplňte zemi bydliště v Nastavení.");
      return;
    } else if (!editOwnerProfile.street || !editOwnerProfile.city || !editOwnerProfile.postalCode) {
      editShowTranslatedMessage(
        "offer.profilePickupMissing",
        "Ve vašem profilu chybí úplná adresa pro vyzvednutí. Doplňte ji v Nastavení nebo zvolte jiné místo vyzvednutí."
      );
      return;
    }

    const enteredPostalCode = pickupUseCustom.checked ? postalInput.value : editOwnerProfile.postalCode;
    const normalizedPostalCode = formatRentuloCzechPostalCode(enteredPostalCode);
    if (enteredPostalCode.trim() && !normalizedPostalCode) {
      if (pickupUseCustom.checked) editMarkError(postalInput);
      editShowTranslatedMessage("address.invalidPostalCode", "Zadejte české PSČ ve formátu 110 00 (5 číslic).");
      return;
    }

    const minDaysRaw = minDaysInput.value.trim();
    const minDaysValue = Number(minDaysRaw);
    if (!/^[1-9]\d*$/.test(minDaysRaw) || !Number.isSafeInteger(minDaysValue) || minDaysValue > 365) {
      editMarkError(minDaysInput);
      editShowTranslatedMessage("offer.minRentalDaysInvalid", "Minimální délka musí být celé číslo od 1 do 365 dní.");
      return;
    }

    let priceValue = Number(editCurrentOffer.price_per_day || 0);

    if (!editHasBlockingReservation) {
      if (editIsEmpty(priceInput.value)) {
        editMarkError(priceInput);
        hasError = true;
      }

      priceValue = editMoneyToNumber(priceInput.value);

      if (priceValue < MINIMUM_OFFER_PRICE_CZK) {
        editMarkError(priceInput);
        hasError = true;
      }
    }

    const transportAttestation = document.getElementById("editTransportConfirmation");
    if (!window.rentuloOfferPolicy || typeof window.rentuloOfferPolicy.isTransportOffer !== "function") {
      editShowTranslatedMessage("offer.transportNotAllowed", "Kontrola pravidel nabídky není dostupná.");
      return;
    }
    if (window.rentuloOfferPolicy.isTransportOffer(nameInput.value, categorySelect.value)) {
      editMarkError(nameInput);
      editShowTranslatedMessage("offer.transportNotAllowed", "Dopravní prostředky nelze na Rentulu nabízet.");
      return;
    }
    if (!transportAttestation || !transportAttestation.checked) {
      editMarkError(transportAttestation);
      editShowTranslatedMessage("offer.transportMustConfirm", "Potvrďte prosím pravidla Rentula.");
      return;
    }

    if (hasError) {
      editShowTranslatedMessage("editOffer.validation", "Vyplňte prosím všechna povinná pole. Cena musí být alespoň 100 Kč za den.");
      return;
    }

    if (editOfferPhotoProcessing) {
      editShowTranslatedMessage(
        "offer.photoProcessingWait",
        "Počkejte prosím, až se dokončí zpracování fotky."
      );
      return;
    }

    if (editCurrentOffer.status === "active" && !String(editOfferPhotoDataUrl || "").trim()) {
      const message = "Zveřejněná nabídka musí mít alespoň jednu fotografii. Ponechte původní nebo nahrajte novou.";
      updateEditPhotoStatus(editT("editOffer.photoRequired", message), "error", "editOffer.photoRequired");
      editShowTranslatedMessage("editOffer.photoRequired", message);
      return;
    }

    editSaveInProgress = true;
    setEditSavingState(true);

    let newlyUploadedPhotoPath = "";

    try {
      const pickupAddress = getEditedPickupAddress();
      // Always re-check edited offers, including unchanged legacy addresses.
      const pickupCoordinates = await geocodeEditedPickupAddress(
        supabaseClient, pickupAddress, editCurrentOffer.status !== "draft"
      );
      const previousPhotoUrl = getEditOfferPhoto(editCurrentOffer);
      const uploadedPhoto = await uploadEditedOfferPhoto(supabaseClient, supabaseUser.id);
      newlyUploadedPhotoPath = uploadedPhoto.isNew ? uploadedPhoto.path : "";

      const updatePayload = {
        name: nameInput.value.trim(),
        category: categorySelect.value.trim(),
        city: pickupAddress.city,
        postal_code: pickupAddress.postalCode,
        description: descriptionInput.value.trim(),
        min_rental_days: minDaysValue,
        photo_url: uploadedPhoto.url,
        pickup_mode: pickupAddress.mode,
        pickup_country_code: pickupAddress.countryCode,
        currency_code: "CZK",
        pickup_street: pickupAddress.street,
        pickup_city: pickupAddress.city,
        pickup_postal_code: pickupAddress.postalCode,
        pickup_note: pickupAddress.note,
        pickup_latitude: pickupCoordinates ? pickupCoordinates.latitude : null,
        pickup_longitude: pickupCoordinates ? pickupCoordinates.longitude : null
      };

      if (!editHasBlockingReservation) {
        updatePayload.price_per_day = priceValue;
      }

      const { error } = await supabaseClient
        .from("offers")
        .update(updatePayload)
        .eq("id", editCurrentOffer.id)
        .eq("owner_id", supabaseUser.id);

      if (error) {
        throw error;
      }

      const photoChanged = previousPhotoUrl && previousPhotoUrl !== uploadedPhoto.url;
      const previousPhotoPath = photoChanged
        ? getOwnedOfferPhotoPath(previousPhotoUrl, supabaseUser.id)
        : "";

      if (previousPhotoPath) {
        await removeEditedOfferPhotoFromStorage(supabaseClient, previousPhotoPath);
      }

      if (editHasBlockingReservation) {
        editShowTranslatedMessage("editOffer.savedPriceLocked", "Změny byly uloženy. Cena zůstala stejná, protože nabídka má aktivní rezervaci.", "success");
      } else {
        editShowTranslatedMessage("editOffer.saved", "Změny byly uloženy.", "success");
      }

      setTimeout(function () {
        window.location.href = "moje-nabidky.html";
      }, 900);
    } catch (error) {
      if (newlyUploadedPhotoPath) {
        await removeEditedOfferPhotoFromStorage(supabaseClient, newlyUploadedPhotoPath);
      }

      if (error && String(error.message || "").toLowerCase().includes("rentulo_v1_transport_not_allowed")) {
        editSaveInProgress = false;
        setEditSavingState(false);
        editShowTranslatedMessage("offer.transportNotAllowed", "Dopravní prostředky nelze na Rentulu nabízet.");
        return;
      }

      console.error(error);
      editSaveInProgress = false;
      setEditSavingState(false);

      if (error && error.code === "PICKUP_COUNTRY_UNSUPPORTED") {
        editShowTranslatedMessage("offer.pickupOutsideCz", "Místo vyzvednutí musí být v České republice. Zadejte českou adresu.");
        return;
      }

      if (error && error.code === "PICKUP_GEOCODING_NOT_FOUND") {
        editShowTranslatedMessage(
          "offer.geocodeNotFound",
          "Místo vyzvednutí se nepodařilo najít na mapě. Zkontrolujte ulici, město a PSČ."
        );
        return;
      }

      if (error && error.code === "PICKUP_GEOCODING_UNAVAILABLE") {
        editShowTranslatedMessage(
          "offer.geocodeUnavailable",
          "Polohu místa vyzvednutí se teď nepodařilo ověřit. Zkuste to prosím znovu."
        );
        return;
      }

      editShowTranslatedMessage("editOffer.saveFailed", "Změny se nepodařilo uložit. Zkuste to prosím znovu.");
    }
  });
}

function refreshEditOfferDynamicTranslations() {
  if (editCurrentOffer) {
    const preview = document.querySelector("#editPhotoPreview");
    if (preview) {
      const image = preview.querySelector("img");
      if (image) {
        image.alt = editT("editOffer.photoTitle", "Fotka věci");
      } else {
        preview.textContent = editT("editOffer.noPhoto", "Bez fotky");
      }
    }

    updateEditPhotoControlState(editOfferPhotoState, editOfferSelectedPhotoFileName);
    document.title = editT("editOffer.title", "Upravit nabídku") + " - " +
      (editCurrentOffer.name || editT("editOffer.offerFallback", "Nabídka"));
    setEditSavingState(editSaveInProgress);
  }

  const messageBox = document.querySelector(".site-message");
  if (messageBox && messageBox.dataset.dynamicI18nKey) {
    messageBox.textContent = editT(
      messageBox.dataset.dynamicI18nKey,
      messageBox.dataset.dynamicI18nFallback || ""
    );
  }
}

document.addEventListener("rentuloLanguageChanged", refreshEditOfferDynamicTranslations);
