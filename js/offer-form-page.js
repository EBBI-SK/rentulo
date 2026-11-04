let offerSaveInProgress = false;
    let offerSaveStatus = "";
    let offerPhotoDataUrl = "";
    let offerPhotoProcessing = false;
    let offerPhotoSelectionToken = 0;
    let offerOwnerProfile = {
      phone: "",
      street: "",
      city: "",
      postalCode: "",
      countryCode: ""
    };

    const OFFER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
    const OFFER_PHOTO_ALLOWED_TYPES = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];
    const MINIMUM_OFFER_PRICE_CZK = 100;


    function offerTranslate(key, fallback) {
      if (typeof window.rentuloTranslate === "function") {
        const translated = window.rentuloTranslate(key);
        return translated === key ? fallback : translated;
      }

      return fallback;
    }

    function getInputValue(id) {
      const input = document.getElementById(id);
      return input ? input.value.trim() : "";
    }

    async function fillProfileAddressAsDefault(authenticatedUser) {
      const supabaseClient = getSupabaseClient();

      if (!authenticatedUser || !authenticatedUser.id || !supabaseClient) {
        return;
      }

      const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("phone, street, city, postal_code, country_code")
        .eq("id", authenticatedUser.id)
        .maybeSingle();

      if (error || !profile) {
        // Without a confirmed Czech profile address, require a separate CZ pickup place.
        renderProfilePickupAddress();
        return;
      }

      const userCity = profile.city || "";
      const userPostalCode = profile.postal_code || "";

      offerOwnerProfile = {
        phone: profile.phone || "",
        street: profile.street || "",
        city: userCity,
        postalCode: userPostalCode,
        countryCode: profile.country_code || ""
      };

      // Start from the profile address only if it is complete and Czech.
      const custom = document.getElementById("pickupUseCustom");
      if (custom) custom.checked = false;
      renderProfilePickupAddress();
    }

    function renderProfilePickupAddress() {
      const summary = document.getElementById("profilePickupSummary");
      const address = document.getElementById("profilePickupAddress");
      const pickupUseCustom = document.getElementById("pickupUseCustom");
      const customToggle = document.getElementById("pickupCustomToggle");
      const customFields = document.getElementById("pickupCustomFields");
      const notice = document.getElementById("pickupProfileAddressNotice");

      const hasCompleteCzechProfileAddress = Boolean(
        offerOwnerProfile.street &&
        offerOwnerProfile.city &&
        offerOwnerProfile.postalCode &&
        offerOwnerProfile.countryCode === "CZ" &&
        formatRentuloCzechPostalCode(offerOwnerProfile.postalCode)
      );

      // No valid Czech profile pickup: use separate fields without showing a misleading toggle.
      if (pickupUseCustom && !hasCompleteCzechProfileAddress) {
        pickupUseCustom.checked = true;
      }
      if (customToggle) customToggle.hidden = !hasCompleteCzechProfileAddress;
      if (customFields) {
        customFields.classList.toggle("is-visible", Boolean(pickupUseCustom && pickupUseCustom.checked));
      }
      if (notice) {
        // A single clear instruction is enough when the user is entering a pickup address.
        notice.hidden = !(pickupUseCustom && pickupUseCustom.checked);
      }

      if (!summary || !address) return;
      if (!hasCompleteCzechProfileAddress) {
        summary.hidden = true;
        address.textContent = "";
        return;
      }
      address.textContent = [
        offerOwnerProfile.street,
        offerOwnerProfile.city,
        offerOwnerProfile.postalCode
      ].join(", ");
      summary.hidden = Boolean(pickupUseCustom && pickupUseCustom.checked);
    }

    function parseMoneyValue(value) {
      const rawValue = String(value === undefined || value === null ? "" : value).trim();

      if (!rawValue) {
        return 0;
      }

      const cleanedValue = rawValue
        .toLowerCase()
        .replace("kč", "")
        .replace("kc", "")
        .replace(/\s/g, "")
        .replace(",", ".")
        .trim();

      if (!cleanedValue || !/^\d+(?:\.\d+)?$/.test(cleanedValue)) {
        return NaN;
      }

      const number = Number(cleanedValue);

      if (!Number.isFinite(number)) {
        return NaN;
      }

      return Math.round(number);
    }

    function clearOfferFormErrors() {
      const fields = document.querySelectorAll("#offerForm input, #offerForm select, #offerForm textarea");
      const fieldMessages = document.querySelectorAll("#offerForm .field-error-message");

      fields.forEach(function (field) {
        field.classList.remove("input-error");
      });

      fieldMessages.forEach(function (message) {
        message.hidden = true;
      });
    }

    function markOfferFormError(id) {
      const field = document.getElementById(id);

      if (field) {
        field.classList.add("input-error");
      }
    }

    function refreshDynamicTranslatedText(element) {
      if (!element || !element.dataset.dynamicI18nKey) {
        return;
      }

      element.textContent = offerTranslate(
        element.dataset.dynamicI18nKey,
        element.dataset.dynamicI18nFallback || ""
      );
    }

    function showOfferFormMessage(message, type, key) {
      const messageBox = document.getElementById("offerFormMessage");

      if (!messageBox) {
        return;
      }

      messageBox.textContent = message;
      messageBox.className = "form-message active " + type;
      messageBox.dataset.dynamicI18nKey = key || "";
      messageBox.dataset.dynamicI18nFallback = message || "";

      messageBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }

    function showOfferTranslatedFormMessage(key, fallback, type) {
      showOfferFormMessage(
        offerTranslate(key, fallback),
        type,
        key
      );
    }

    function hideOfferFormMessage() {
      const messageBox = document.getElementById("offerFormMessage");

      if (!messageBox) {
        return;
      }

      messageBox.textContent = "";
      messageBox.className = "form-message";
      delete messageBox.dataset.dynamicI18nKey;
      delete messageBox.dataset.dynamicI18nFallback;
    }

    function updatePhotoStatus(message, type, key) {
      const status = document.getElementById("toolPhotoStatus");

      if (!status) {
        return;
      }

      status.textContent = message;
      status.className = "photo-upload-status " + (type || "");
      status.dataset.dynamicI18nKey = key || "";
      status.dataset.dynamicI18nFallback = message || "";
    }

    function updatePhotoStatusByKey(key, fallback, type) {
      updatePhotoStatus(
        offerTranslate(key, fallback),
        type,
        key
      );
    }

    function renderPhotoPreview(dataUrl) {
      const preview = document.getElementById("toolPhotoPreview");

      if (!preview) {
        return;
      }

      if (!dataUrl) {
        preview.textContent = offerTranslate("offer.noPhoto", "Bez fotky");
        return;
      }

preview.innerHTML = `<img src="${dataUrl}" alt="${offerTranslate("offer.photoAlt", "Fotka nabízené věci")}">`;
    }

    function resizeImageToDataUrl(file, callback) {
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

    function setRemovePhotoButtonVisible(button, isVisible) {
      const photoPicker = document.querySelector(".photo-file-picker");

      if (photoPicker) {
        photoPicker.hidden = isVisible;
        photoPicker.style.display = isVisible ? "none" : "";
      }

      if (button) {
        button.hidden = !isVisible;
      }
    }

    function setupOfferPhotoUpload() {
      const photoInput = document.getElementById("toolPhoto");
      const removePhotoButton = document.getElementById("removeToolPhotoButton");

      if (!photoInput) {
        return;
      }

      setRemovePhotoButtonVisible(removePhotoButton, Boolean(offerPhotoDataUrl));

      photoInput.addEventListener("change", function () {
        const file = photoInput.files && photoInput.files[0];
        const selectionToken = ++offerPhotoSelectionToken;

        if (!file) {
          offerPhotoDataUrl = "";
          offerPhotoProcessing = false;
          renderPhotoPreview("");
          updatePhotoStatusByKey("offer.photoRecommendation", "Doporučujeme kvalitní a dobře osvětlenou fotku.", "");
          setRemovePhotoButtonVisible(removePhotoButton, false);
          return;
        }

        if (!OFFER_PHOTO_ALLOWED_TYPES.includes(file.type)) {
          offerPhotoDataUrl = "";
          offerPhotoProcessing = false;
          photoInput.value = "";
          renderPhotoPreview("");
          updatePhotoStatusByKey("offer.photoInvalidType", "Vyberte prosím obrázek ve formátu JPG, PNG nebo WEBP.", "error");
          setRemovePhotoButtonVisible(removePhotoButton, false);
          return;
        }

        if (file.size > OFFER_PHOTO_MAX_BYTES) {
          offerPhotoDataUrl = "";
          offerPhotoProcessing = false;
          photoInput.value = "";
          renderPhotoPreview("");
          updatePhotoStatusByKey("offer.photoTooLarge", "Fotka je příliš velká. Maximální velikost je 5 MB.", "error");
          setRemovePhotoButtonVisible(removePhotoButton, false);
          return;
        }
        offerPhotoProcessing = true;
        updatePhotoStatusByKey("offer.photoProcessing", "Zpracovávám fotku...", "");

        resizeImageToDataUrl(file, function (dataUrl) {
          if (selectionToken !== offerPhotoSelectionToken) {
            return;
          }

          offerPhotoProcessing = false;

          if (!dataUrl) {
            offerPhotoDataUrl = "";
            photoInput.value = "";
            renderPhotoPreview("");
            updatePhotoStatusByKey("offer.photoLoadFailed", "Fotku se nepodařilo načíst. Zkuste jiný obrázek.", "error");
            setRemovePhotoButtonVisible(removePhotoButton, false);
            return;
          }

          offerPhotoDataUrl = dataUrl;
          renderPhotoPreview(offerPhotoDataUrl);
          updatePhotoStatus("", "", "");
          setRemovePhotoButtonVisible(removePhotoButton, true);
        });
      });

      if (removePhotoButton) {
        removePhotoButton.addEventListener("click", function () {
          offerPhotoSelectionToken += 1;
          offerPhotoDataUrl = "";
          offerPhotoProcessing = false;
          photoInput.value = "";
          renderPhotoPreview("");
          updatePhotoStatusByKey("offer.photoRecommendation", "Doporučujeme kvalitní a dobře osvětlenou fotku.", "");
          setRemovePhotoButtonVisible(removePhotoButton, false);
        });
      }
    }

    function getPickupAddress() {
      const pickupUseCustom = document.getElementById("pickupUseCustom");
      const useCustomPickup = pickupUseCustom ? pickupUseCustom.checked : false;

      if (useCustomPickup) {
        return {
          mode: "custom",
          countryCode: "CZ",
          street: getInputValue("pickupStreet"),
          city: getInputValue("pickupCity"),
          postalCode: formatRentuloCzechPostalCode(getInputValue("pickupPostalCode")) || getInputValue("pickupPostalCode"),
          note: getInputValue("pickupNote"),
          phone: offerOwnerProfile.phone
        };
      }

      return {
        mode: "profile",
        countryCode: offerOwnerProfile.countryCode,
        street: offerOwnerProfile.street,
        city: offerOwnerProfile.city,
        postalCode: formatRentuloCzechPostalCode(offerOwnerProfile.postalCode) || offerOwnerProfile.postalCode,
        note: "",
        phone: offerOwnerProfile.phone
      };
    }

    function validateOfferForm() {
      clearOfferFormErrors();
      hideOfferFormMessage();

      const requiredFields = [
        "toolName",
        "toolCategory",
        "toolPrice",
        "toolDescription"
      ];

      let hasError = false;
      let hasMissingRequired = false;
      let hasInvalidPrice = false;
      let hasInvalidMinimumDays = false;
      let hasInvalidPostalCode = false;

      requiredFields.forEach(function (fieldId) {
        if (!getInputValue(fieldId)) {
          markOfferFormError(fieldId);
          hasError = true;
          hasMissingRequired = true;
        }
      });

      const rawPrice = getInputValue("toolPrice");
      const parsedPrice = parseMoneyValue(rawPrice);

      if (rawPrice && (Number.isNaN(parsedPrice) || parsedPrice < MINIMUM_OFFER_PRICE_CZK)) {
        const priceError = document.getElementById("toolPriceError");
        markOfferFormError("toolPrice");
        hasError = true;
        hasInvalidPrice = true;

        if (priceError) {
          priceError.hidden = false;
        }
      }

      const minimumDaysRaw = getInputValue("toolMinRentalDays");
      const minimumDays = Number(minimumDaysRaw);
      if (!/^[1-9]\d*$/.test(minimumDaysRaw) || !Number.isSafeInteger(minimumDays) || minimumDays > 365) {
        markOfferFormError("toolMinRentalDays");
        hasError = true;
        hasInvalidMinimumDays = true;
      }

      const pickupUseCustom = document.getElementById("pickupUseCustom");
      const useCustomPickup = pickupUseCustom ? pickupUseCustom.checked : false;

      if (useCustomPickup) {
        ["pickupStreet", "pickupCity", "pickupPostalCode"].forEach(function (fieldId) {
          if (!getInputValue(fieldId)) {
            markOfferFormError(fieldId);
            hasError = true;
            hasMissingRequired = true;
          }
        });
        if (getInputValue("pickupPostalCode") && !formatRentuloCzechPostalCode(getInputValue("pickupPostalCode"))) {
          markOfferFormError("pickupPostalCode");
          hasError = true;
          hasInvalidPostalCode = true;
        }
      } else {
        const profilePickup = getPickupAddress();

        if (profilePickup.countryCode !== "CZ") {
          showOfferTranslatedFormMessage("offer.profilePickupOutsideCz", "Profilová adresa není ověřená jako česká. Zvolte jiné místo vyzvednutí v ČR nebo doplňte zemi bydliště v Nastavení.", "error");
          return false;
        }
        if (!profilePickup.street || !profilePickup.city || !profilePickup.postalCode) {
          showOfferTranslatedFormMessage(
            "offer.profilePickupMissing",
            "Ve vašem profilu chybí úplná adresa pro vyzvednutí. Doplňte ji v Nastavení nebo zvolte jiné místo vyzvednutí.",
            "error"
          );
          return false;
        }
        if (!formatRentuloCzechPostalCode(profilePickup.postalCode)) {
          showOfferTranslatedFormMessage("address.invalidPostalCode", "Zadejte české PSČ ve formátu 110 00 (5 číslic).", "error");
          return false;
        }
      }

      const transportAttestation = document.getElementById("offerTransportConfirmation");
      if (!window.rentuloOfferPolicy || typeof window.rentuloOfferPolicy.isTransportOffer !== "function") {
        showOfferTranslatedFormMessage("offer.transportNotAllowed", "Kontrola pravidel nabídky není dostupná.", "error");
        return false;
      }
      if (window.rentuloOfferPolicy.isTransportOffer(getInputValue("toolName"), getInputValue("toolCategory"))) {
        markOfferFormError("toolName");
        showOfferTranslatedFormMessage("offer.transportNotAllowed", "Dopravní prostředky nelze na Rentulu nabízet.", "error");
        return false;
      }
      if (!transportAttestation || !transportAttestation.checked) {
        if (transportAttestation) markOfferFormError("offerTransportConfirmation");
        showOfferTranslatedFormMessage("offer.transportMustConfirm", "Potvrďte prosím pravidla Rentula.", "error");
        return false;
      }

      if (hasError) {
        if (hasInvalidPostalCode) {
          showOfferTranslatedFormMessage("address.invalidPostalCode", "Zadejte české PSČ ve formátu 110 00 (5 číslic).", "error");
        } else if (hasInvalidMinimumDays) {
          showOfferTranslatedFormMessage("offer.minRentalDaysInvalid", "Minimální délka musí být celé číslo od 1 do 365 dní.", "error");
        } else if (hasInvalidPrice) {
          showOfferTranslatedFormMessage("offer.validationCorrectFields", "Opravte prosím označená pole.", "error");
        } else if (hasMissingRequired) {
          showOfferTranslatedFormMessage("offer.validationRequired", "Vyplňte prosím všechna povinná pole.", "error");
        }

        return false;
      }

      return true;
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

    async function removeOfferPhotoFromStorage(supabaseClient, photoPath) {
      if (!photoPath) {
        return;
      }

      const { error } = await supabaseClient.storage
        .from("offer-photos")
        .remove([photoPath]);

      if (error) {
        console.error("Nepoužitou fotku se nepodařilo odstranit ze Storage.", error);
      }
    }

    async function uploadOfferPhoto(supabaseClient, userId) {
      if (!offerPhotoDataUrl) {
        return { url: "", path: "" };
      }

      const photoBlob = dataUrlToBlob(offerPhotoDataUrl);
      const fileName = userId + "/" + Date.now() + "-offer.jpg";

      updatePhotoStatusByKey("offer.photoUploading", "Nahrávám fotku...", "");

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

      updatePhotoStatusByKey("offer.photoUploaded", "Fotka byla nahraná.", "success");

      return {
        url: data && data.publicUrl ? data.publicUrl : "",
        path: fileName
      };
    }

    async function geocodePickupAddress(supabaseClient, pickupAddress, mustVerify = true) {
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
        console.warn("Pickup verification unavailable; draft will have no coordinates.");
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
        const invalid = new Error("Pickup verification returned invalid coordinates");
        invalid.code = "PICKUP_GEOCODING_UNAVAILABLE";
        throw invalid;
      }

      return {
        latitude: latitude,
        longitude: longitude
      };
    }

    function createSupabaseOfferObject(status, supabaseUser, photoUrl, pickupAddress, pickupCoordinates) {
      return {
        owner_id: supabaseUser.id,
        name: getInputValue("toolName"),
        category: getInputValue("toolCategory"),
        description: getInputValue("toolDescription"),
        city: pickupAddress.city,
        postal_code: pickupAddress.postalCode,
        price_per_day: parseMoneyValue(getInputValue("toolPrice")),
        min_rental_days: Number(getInputValue("toolMinRentalDays")),

        status: status,
        photo_url: photoUrl || null,

        pickup_mode: pickupAddress.mode,
        pickup_country_code: pickupAddress.countryCode,
        currency_code: "CZK",
        pickup_street: pickupAddress.street,
        pickup_city: pickupAddress.city,
        pickup_postal_code: pickupAddress.postalCode,
        pickup_note: pickupAddress.note,
        pickup_phone: pickupAddress.phone,
        pickup_latitude: pickupCoordinates ? pickupCoordinates.latitude : null,
        pickup_longitude: pickupCoordinates ? pickupCoordinates.longitude : null
      };
    }

    function setOfferSavingState(isSaving, status) {
      const publishOfferButton = document.getElementById("publishOfferButton");
      const saveDraftButton = document.getElementById("saveDraftButton");

      offerSaveStatus = isSaving ? status : "";

      if (publishOfferButton) {
        publishOfferButton.disabled = isSaving;
        publishOfferButton.textContent = isSaving && status !== "draft"
          ? offerTranslate("offer.savingOffer", "Ukládám nabídku...")
          : offerTranslate("offer.publish", "Zveřejnit nabídku");
      }

      if (saveDraftButton) {
        saveDraftButton.disabled = isSaving;
        saveDraftButton.textContent = isSaving && status === "draft"
          ? offerTranslate("offer.savingDraft", "Ukládám koncept...")
          : offerTranslate("offer.saveDraft", "Uložit jako koncept");
      }
    }

    async function saveOffer(status) {
      if (offerSaveInProgress) {
        return;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        showOfferTranslatedFormMessage("offer.errorSupabaseMissing", "Služba je dočasně nedostupná. Obnovte stránku a zkuste to znovu.", "error");
        return;
      }

      if (!validateOfferForm()) {
        return;
      }

      if (offerPhotoProcessing) {
        showOfferTranslatedFormMessage("offer.photoProcessingWait", "Počkejte prosím, až se dokončí zpracování fotky.", "error");
        return;
      }

      if (status !== "draft" && !offerPhotoDataUrl) {
        const message = "Pro zveřejnění nabídky vyberte alespoň jednu fotografii věci. Koncept lze uložit bez fotky.";
        updatePhotoStatusByKey("offer.photoRequired", message, "error");
        showOfferTranslatedFormMessage("offer.photoRequired", message, "error");
        return;
      }

      offerSaveInProgress = true;
      setOfferSavingState(true, status);

      let uploadedPhotoPath = "";

      try {
        const supabaseUser = await getCurrentSupabaseUser();

        if (!supabaseUser) {
          showOfferTranslatedFormMessage("offer.errorNotAuthenticated", "Vaše přihlášení vypršelo. Přihlaste se prosím znovu.", "error");
          offerSaveInProgress = false;
          setOfferSavingState(false, status);
          return;
        }

        const pickupAddress = getPickupAddress();
        const pickupCoordinates = await geocodePickupAddress(supabaseClient, pickupAddress, status !== "draft");
        const uploadedPhoto = await uploadOfferPhoto(supabaseClient, supabaseUser.id);
        uploadedPhotoPath = uploadedPhoto.path;
        const supabaseOffer = createSupabaseOfferObject(
          status,
          supabaseUser,
          uploadedPhoto.url,
          pickupAddress,
          pickupCoordinates
        );

        const { error } = await supabaseClient
          .from("offers")
          .insert(supabaseOffer)
          .select()
          .single();

        if (error) {
          throw error;
        }

        try {
          sessionStorage.setItem("rentuloOfferSaved", status);
        } catch (_error) {
          // Continue after a successful save even when session storage is unavailable.
        }

        window.location.href = "moje-nabidky.html";
      } catch (error) {
        if (uploadedPhotoPath) {
          await removeOfferPhotoFromStorage(supabaseClient, uploadedPhotoPath);

          if (offerPhotoDataUrl) {
            updatePhotoStatus("", "", "");
          }
        }

        console.error("Nabídku se nepodařilo uložit.", error);
        offerSaveInProgress = false;
        setOfferSavingState(false, status);

        const message = error && error.message
          ? String(error.message).toLowerCase()
          : "";

        if (error && error.code === "PICKUP_COUNTRY_UNSUPPORTED") {
          showOfferTranslatedFormMessage("offer.pickupOutsideCz", "Místo vyzvednutí musí být v České republice. Zadejte českou adresu.", "error");
          return;
        }

        if (error && error.code === "PICKUP_GEOCODING_NOT_FOUND") {
          showOfferTranslatedFormMessage(
            "offer.geocodeNotFound",
            "Místo vyzvednutí se nepodařilo najít na mapě. Zkontrolujte ulici, město a PSČ.",
            "error"
          );
          return;
        }

        if (error && error.code === "PICKUP_GEOCODING_UNAVAILABLE") {
          showOfferTranslatedFormMessage(
            "offer.geocodeUnavailable",
            "Polohu místa vyzvednutí se teď nepodařilo ověřit. Zkuste to prosím znovu.",
            "error"
          );
          return;
        }

        if (message.includes("rentulo_v1_transport_not_allowed")) {
          showOfferTranslatedFormMessage("offer.transportNotAllowed", "Dopravní prostředky nelze na Rentulu nabízet.", "error");
          return;
        }

        if (message.includes("row-level security")) {
          showOfferTranslatedFormMessage("offer.errorRls", "Nabídku se nepodařilo uložit. Odhlaste se, znovu se přihlaste a opakujte akci.", "error");
          return;
        }

        if (message.includes("column") || message.includes("schema cache")) {
          showOfferTranslatedFormMessage("offer.errorSchema", "Nabídku se nyní nepodařilo uložit. Zkuste to prosím později.", "error");
          return;
        }

        showOfferTranslatedFormMessage("offer.errorSave", "Nabídku se nepodařilo uložit. Zkuste odebrat fotku a uložit znovu.", "error");
      }
    }

    function setupPickupCustomFields() {
      const pickupUseCustom = document.getElementById("pickupUseCustom");
      const pickupCustomFields = document.getElementById("pickupCustomFields");

      if (!pickupUseCustom || !pickupCustomFields) {
        return;
      }

      pickupUseCustom.addEventListener("change", function () {

        if (pickupUseCustom.checked) {
          pickupCustomFields.classList.add("is-visible");
        } else {
          pickupCustomFields.classList.remove("is-visible");
        }

        renderProfilePickupAddress();
      });

      renderProfilePickupAddress();
    }

    function setupOfferForm() {
      const offerForm = document.getElementById("offerForm");
      const saveDraftButton = document.getElementById("saveDraftButton");
      setupRentuloCzechPostalCodeBlur(document.getElementById("pickupPostalCode"));

      if (offerForm) {
        offerForm.addEventListener("submit", function (event) {
          event.preventDefault();
          saveOffer("active");
        });
      }

      if (saveDraftButton) {
        saveDraftButton.addEventListener("click", function () {
          saveOffer("draft");
        });
      }
    }

    function refreshOfferDynamicTranslations() {
      renderProfilePickupAddress();
      renderPhotoPreview(offerPhotoDataUrl);
      refreshDynamicTranslatedText(document.getElementById("toolPhotoStatus"));
      refreshDynamicTranslatedText(document.getElementById("offerFormMessage"));
      setOfferSavingState(offerSaveInProgress, offerSaveStatus);
    }

    document.addEventListener("DOMContentLoaded", async function () {
      const authenticatedUser = await window.rentuloAuthGuard.requireUser();

      if (!authenticatedUser) {
        return;
      }

      await fillProfileAddressAsDefault(authenticatedUser);
      setupOfferPhotoUpload();
      setupPickupCustomFields();
      setupOfferForm();
    });

    document.addEventListener("rentuloLanguageChanged", function () {
      refreshOfferDynamicTranslations();
    });
