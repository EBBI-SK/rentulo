(function () {
  function getSupabaseClient() {
    if (window.rentuloSupabase) {
      return window.rentuloSupabase;
    }

    if (typeof rentuloSupabase !== "undefined") {
      return rentuloSupabase;
    }

    return null;
  }

  function translate(key, fallback) {
    if (typeof window.rentuloTranslate === "function") {
      return window.rentuloTranslate(key);
    }

    return fallback;
  }

  function renderMessage(element, text, type) {
    if (!element) {
      return;
    }

    element.textContent = text || "";
    element.className = "message";

    if (text && type) {
      element.classList.add(type);
    }
  }

  function setMessage(element, text, type) {
    if (!element) {
      return;
    }

    delete element.dataset.messageKey;
    delete element.dataset.messageFallback;
    delete element.dataset.messageValues;
    renderMessage(element, text, type);
  }

  function formatTranslatedMessage(key, fallback, values) {
    let text = translate(key, fallback);

    Object.keys(values || {}).forEach(function (name) {
      text = text.split("{" + name + "}").join(String(values[name]));
    });

    return text;
  }

  function setTranslatedMessage(element, key, fallback, type, values) {
    if (!element) {
      return;
    }

    element.dataset.messageKey = key;
    element.dataset.messageFallback = fallback || "";
    element.dataset.messageValues = JSON.stringify(values || {});
    renderMessage(
      element,
      formatTranslatedMessage(key, fallback, values),
      type
    );
  }

  function refreshTranslatedMessages() {
    document
      .querySelectorAll(".message[data-message-key]")
      .forEach(function (element) {
        let values = {};

        try {
          values = JSON.parse(element.dataset.messageValues || "{}");
        } catch (_error) {
          values = {};
        }

        renderMessage(
          element,
          formatTranslatedMessage(
            element.dataset.messageKey,
            element.dataset.messageFallback || "",
            values
          ),
          element.classList.contains("error") ? "error" : "success"
        );
      });
  }

  function setLoadState(mode) {
    const state = document.getElementById("settingsLoadState");
    const text = document.getElementById("settingsLoadText");
    const retryButton = document.getElementById("settingsRetryButton");
    const content = document.getElementById("settingsContent");
    const isLoading = mode === "loading";
    const isError = mode === "error";

    if (state) {
      state.hidden = !isLoading && !isError;
      state.classList.toggle("is-error", isError);
      state.dataset.state = mode;
    }

    if (text) {
      const key = isError ? "settings.loadError" : "settings.loading";
      const fallback = isError
        ? "Nastavení se nepodařilo načíst."
        : "Načítám nastavení…";
      text.dataset.i18n = key;
      text.textContent = translate(key, fallback);
    }

    if (retryButton) {
      retryButton.hidden = !isError;
    }

    if (content) {
      content.hidden = isLoading || isError;
    }
  }

  function setButtonLoading(button, isLoading) {
    if (!button) {
      return;
    }

    button.disabled = Boolean(isLoading);
    button.classList.toggle("is-loading", Boolean(isLoading));
    button.setAttribute("aria-busy", isLoading ? "true" : "false");
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  let savedProfileValues = null;
  let savedSmsEnabled = false;

  function profileValuesEqual(left, right) {
    if (!left || !right) {
      return false;
    }

    return (
      left.fullName === right.fullName &&
      left.email === right.email &&
      left.phone === right.phone &&
      left.street === right.street &&
      left.city === right.city &&
      left.postalCode === right.postalCode
    );
  }

  function applyLanguage(language) {
    if (typeof window.setRentuloLanguage === "function") {
      window.setRentuloLanguage(language);
      return;
    }

    try {
      localStorage.setItem("rentuloLanguage", language);
    } catch (error) {
      // Continue when browser storage is unavailable.
    }

    if (typeof renderSharedNavigation === "function") {
      renderSharedNavigation("nastaveni");
    }
  }

  function setProfileFields(profile, user) {
    const values = {
      profileFullName: profile && profile.full_name ? profile.full_name : "",
      profileEmail:
        user && user.email
          ? user.email
          : profile && profile.email
            ? profile.email
            : "",
      profilePhone: profile && profile.phone ? profile.phone : "",
      profileStreet: profile && profile.street ? profile.street : "",
      profileCity: profile && profile.city ? profile.city : "",
      profilePostalCode: profile && profile.postal_code ? profile.postal_code : ""
    };

    Object.keys(values).forEach(function (id) {
      const input = document.getElementById(id);

      if (input) {
        input.value = values[id];
      }
    });

    savedProfileValues = {
      fullName: normalizeText(values.profileFullName),
      email: normalizeEmail(values.profileEmail),
      phone: normalizeText(values.profilePhone),
      street: normalizeText(values.profileStreet),
      city: normalizeText(values.profileCity),
      postalCode: normalizeText(values.profilePostalCode)
    };
  }

  async function loadPageData(client, user) {
    const profileMessage = document.getElementById("profileMessage");

    setLoadState("loading");
    setMessage(profileMessage, "", "");

    let data;
    let error;

    try {
      const response = await client
        .from("profiles")
        .select(
          "full_name, email, phone, street, city, postal_code, preferred_language, sms_notifications"
        )
        .eq("id", user.id)
        .maybeSingle();

      data = response.data;
      error = response.error;
    } catch (requestError) {
      error = requestError;
    }

    if (error || !data) {
      // After a Storage failure the backend has already deactivated the profile,
      // and profile RLS hides it. Keep the existing cancellation UI available so
      // the user can retry the same protected operation after reloading the page.
      try {
        const { data: statusData, error: statusError } = await client.rpc(
          "get_my_account_deactivation_status_v2"
        );
        const status = !statusError ? firstResultRow(statusData) : null;
        if (status && status.account_status === "deactivated") {
          const content = document.getElementById("settingsContent");
          if (content) {
            content.querySelectorAll(".settings-card").forEach(function (section) {
              if (section.id !== "accountCancellationSection") {
                section.hidden = true;
                section.style.display = "none";
              }
            });
          }
          setLoadState("ready");
          await checkAccountCancellation(client);
          return true;
        }
      } catch (retryError) {
        console.warn("Unable to load account-deactivation retry state", retryError);
      }
      console.error(error);
      setLoadState("error");
      return false;
    }

    let profile = data || null;
    const authEmail = normalizeEmail(user && user.email);
    const profileEmail = normalizeEmail(profile && profile.email);

    if (authEmail && authEmail !== profileEmail) {
      try {
        const { error: emailSyncError } = await client
          .from("profiles")
          .update({
            email: authEmail,
            updated_at: new Date().toISOString()
          })
          .eq("id", user.id);

        if (emailSyncError) {
          console.error("Potvrzený e-mail se nepodařilo synchronizovat.", emailSyncError);
        } else {
          profile = { ...(profile || {}), email: authEmail };
        }
      } catch (emailSyncError) {
        console.error("Potvrzený e-mail se nepodařilo synchronizovat.", emailSyncError);
      }
    }

    setProfileFields(profile, user);
    savedSmsEnabled = profile?.sms_notifications === true;
    const smsCheck = document.getElementById("settingsSmsEnabled");
    if (smsCheck) smsCheck.checked = savedSmsEnabled;

    const pendingEmail = normalizeEmail(user && user.new_email);
    if (pendingEmail && pendingEmail !== authEmail) {
      setTranslatedMessage(
        profileMessage,
        "settings.emailConfirmationPending",
        "Změna e-mailu na {email} čeká na potvrzení odkazů v původní i nové e-mailové schránce. Do té doby zůstává aktivní původní adresa.",
        "success",
        { email: pendingEmail }
      );
    }

    const language = profile && profile.preferred_language
      ? profile.preferred_language
      : "cs";

    applyLanguage(language);
    setLoadState("ready");
    return true;
  }

  async function saveProfile(client, user) {
    const fullNameInput = document.getElementById("profileFullName");
    const emailInput = document.getElementById("profileEmail");
    const phoneInput = document.getElementById("profilePhone");
    const streetInput = document.getElementById("profileStreet");
    const cityInput = document.getElementById("profileCity");
    const postalCodeInput = document.getElementById("profilePostalCode");
    const button = document.getElementById("saveProfileButton");
    const message = document.getElementById("profileMessage");

    const fullName = normalizeText(fullNameInput && fullNameInput.value);
    const email = normalizeEmail(emailInput && emailInput.value);
    const phone = normalizeText(phoneInput && phoneInput.value);
    const street = normalizeText(streetInput && streetInput.value);
    const city = normalizeText(cityInput && cityInput.value);
    const postalCodeRaw = normalizeText(postalCodeInput && postalCodeInput.value);
    const postalCode = formatRentuloCzechPostalCode(postalCodeRaw);
    const profileValues = {
      fullName: fullName,
      email: email,
      phone: phone,
      street: street,
      city: city,
      postalCode: postalCode || postalCodeRaw
    };
    const phoneChanged = savedProfileValues && savedProfileValues.phone !== phone;

    if (button && button.disabled) {
      return user;
    }

    setMessage(message, "", "");

    if (!fullName || !email || !phone || !street || !city || !postalCodeRaw) {
      setTranslatedMessage(
        message,
        "settings.profileRequired",
        "Vyplňte všechna osobní data.",
        "error"
      );
      return user;
    }

    if (!postalCode) {
      setTranslatedMessage(message, "address.invalidPostalCode", "Zadejte české PSČ ve formátu 110 00 (5 číslic).", "error");
      if (postalCodeInput) postalCodeInput.focus();
      return user;
    }

    if (postalCodeInput) postalCodeInput.value = postalCode;

    if (!isValidEmail(email)) {
      setTranslatedMessage(
        message,
        "settings.invalidEmail",
        "Zadejte platnou e-mailovou adresu.",
        "error"
      );
      return user;
    }

    if (profileValuesEqual(savedProfileValues, profileValues)) {
      setTranslatedMessage(
        message,
        "settings.profileSaved",
        "Osobní údaje byly uloženy.",
        "success"
      );
      return user;
    }

    setButtonLoading(button, true);

    try {
      const currentEmail = normalizeEmail(user.email);
      const currentPendingEmail = normalizeEmail(user.new_email);
      let emailConfirmationRequired = false;
      let authUser = user;

      if (email !== currentEmail && email !== currentPendingEmail) {
        const { data: authData, error: authError } = await client.auth.updateUser({
          email: email,
          data: {
            full_name: fullName,
            phone: phone,
            street: street,
            city: city,
            postal_code: postalCode
          }
        });

        if (authError) {
          throw authError;
        }

        const returnedUser = authData && authData.user ? authData.user : null;
        authUser = returnedUser || user;
        const returnedEmail = normalizeEmail(returnedUser && returnedUser.email);
        const pendingEmail = normalizeEmail(returnedUser && returnedUser.new_email);

        emailConfirmationRequired = Boolean(
          pendingEmail && pendingEmail === email && returnedEmail !== email
        );

        if (!emailConfirmationRequired && returnedEmail !== email) {
          emailConfirmationRequired = true;
        }
      } else {
        emailConfirmationRequired = Boolean(
          currentPendingEmail && email === currentPendingEmail
        );

        const { data: authData, error: metadataError } = await client.auth.updateUser({
          data: {
            full_name: fullName,
            phone: phone,
            street: street,
            city: city,
            postal_code: postalCode
          }
        });

        if (metadataError) {
          throw metadataError;
        }

        authUser = authData && authData.user ? authData.user : user;
      }

      const profileUpdate = {
        full_name: fullName,
        phone: phone,
        street: street,
        city: city,
        postal_code: postalCode,
        updated_at: new Date().toISOString()
      };

      if (!emailConfirmationRequired) {
        profileUpdate.email = email;
      }

      const { error: profileError } = await client
        .from("profiles")
        .update(profileUpdate)
        .eq("id", user.id);

      if (profileError) {
        throw profileError;
      }

      const effectiveEmail = emailConfirmationRequired ? currentEmail : email;
      const updatedUser = {
          ...authUser,
          email: effectiveEmail,
          user_metadata: {
            ...(authUser.user_metadata || {}),
            full_name: fullName,
            phone: phone,
            street: street,
            city: city,
            postal_code: postalCode
          }
        };

      savedProfileValues = { ...profileValues };
      // The DB trigger atomically removes SMS opt-in when the stored phone changes.
      // Reflect that in the form only after the profile write succeeds.
      if (phoneChanged) {
        savedSmsEnabled = false;
        const smsCheck = document.getElementById("settingsSmsEnabled");
        if (smsCheck) smsCheck.checked = false;
      }

      const savedKey = phoneChanged
        ? emailConfirmationRequired
          ? "settings.profileSavedEmailConfirmationSmsReset"
          : "settings.profileSavedSmsReset"
        : emailConfirmationRequired
          ? "settings.profileSavedEmailConfirmation"
          : "settings.profileSaved";
      const savedFallback = phoneChanged
        ? emailConfirmationRequired
          ? "Osobní údaje byly uloženy. Pro změnu e-mailu potvrďte oba odkazy. SMS upozornění byla kvůli změně telefonu vypnuta."
          : "Osobní údaje byly uloženy. Kvůli změně telefonu byla SMS upozornění vypnuta. Můžete je znovu zapnout v nastavení SMS."
        : emailConfirmationRequired
          ? "Osobní údaje byly uloženy. Pro změnu e-mailu potvrďte odkazy ve zprávách zaslaných na původní i novou adresu."
          : "Osobní údaje byly uloženy.";
      setTranslatedMessage(message, savedKey, savedFallback, "success");
      return updatedUser;
    } catch (error) {
      console.error(error);
      setTranslatedMessage(
        message,
        "settings.profileSaveError",
        "Osobní údaje se nepodařilo uložit. Zkuste to prosím znovu.",
        "error"
      );
      return user;
    } finally {
      setButtonLoading(button, false);
    }
  }

  function phoneEligibleForSms(value) {
    const phone = normalizeText(value).replace(/[\s()\-]/g, "");
    return /^\d{9}$/.test(phone) || /^\+[1-9]\d{7,14}$/.test(phone) || /^00[1-9]\d{7,14}$/.test(phone);
  }

  async function saveSmsPreference(client, user) {
    const checkbox = document.getElementById("settingsSmsEnabled");
    const phoneInput = document.getElementById("profilePhone");
    const button = document.getElementById("settingsSaveSmsButton");
    const message = document.getElementById("settingsSmsMessage");
    if (!checkbox || (button && button.disabled)) return;
    const smsEnabled = checkbox.checked;
    const phone = normalizeText(phoneInput && phoneInput.value);
    if (smsEnabled && !phoneEligibleForSms(phone)) {
      checkbox.checked = savedSmsEnabled;
      setTranslatedMessage(message, "settings.smsInvalidPhone",
        "Pro SMS uložte platné telefonní číslo v osobních údajích.", "error");
      return;
    }
    if (smsEnabled && (!savedProfileValues || savedProfileValues.phone !== phone)) {
      checkbox.checked = savedSmsEnabled;
      setTranslatedMessage(message, "settings.smsUnsavedPhone",
        "Nejprve uložte změněné telefonní číslo v osobních údajích.", "error");
      return;
    }

    setButtonLoading(button, true);
    setMessage(message, "", "");
    try {
      // Conditional UPDATE protects against a stale profile or concurrent phone edit.
      // Deactivating SMS is always allowed, even with unsaved form changes.
      let query = client.from("profiles")
        .update({ sms_notifications: smsEnabled, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (smsEnabled) query = query.eq("phone", phone);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) {
        // A stale phone can mean another session already changed it and reset
        // SMS opt-in. Do not keep showing an outdated enabled checkbox.
        if (smsEnabled) savedSmsEnabled = false;
        checkbox.checked = savedSmsEnabled;
        setTranslatedMessage(message,
          smsEnabled ? "settings.smsUnsavedPhone" : "settings.smsSaveError",
          smsEnabled
            ? "Telefonní číslo v profilu se změnilo. Obnovte nastavení a uložte číslo před zapnutím SMS."
            : "SMS nastavení se nepodařilo uložit.", "error");
        return;
      }
      savedSmsEnabled = smsEnabled;
      setTranslatedMessage(message, "settings.smsSaved", "SMS nastavení bylo uloženo.", "success");
    } catch (error) {
      console.error(error);
      checkbox.checked = savedSmsEnabled;
      setTranslatedMessage(message, "settings.smsSaveError",
        "SMS nastavení se nepodařilo uložit.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function changePassword(client) {
    const currentPassword = document.getElementById("currentPassword");
    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const button = document.getElementById("changePasswordButton");
    const message = document.getElementById("passwordMessage");

    const current = currentPassword ? currentPassword.value : "";
    const password = newPassword ? newPassword.value : "";
    const confirmation = confirmPassword ? confirmPassword.value : "";

    if (button && button.disabled) {
      return;
    }

    setMessage(message, "", "");

    if (!current) {
      setTranslatedMessage(
        message,
        "settings.currentPasswordRequired",
        "Zadejte současné heslo.",
        "error"
      );
      if (currentPassword) {
        currentPassword.focus();
      }
      return;
    }

    if (!meetsRentuloPasswordRequirements(password)) {
      setTranslatedMessage(
        message,
        "settings.passwordRequirements",
        "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol.",
        "error"
      );
      if (newPassword) {
        newPassword.focus();
      }
      return;
    }

    if (password !== confirmation) {
      setTranslatedMessage(
        message,
        "settings.passwordMismatch",
        "Zadaná hesla se neshodují.",
        "error"
      );
      return;
    }

    setButtonLoading(button, true);

    try {
      const { error } = await client.auth.updateUser({
        password: password,
        current_password: current,
      });

      if (error) {
        throw error;
      }

      if (currentPassword) {
        currentPassword.value = "";
      }

      if (newPassword) {
        newPassword.value = "";
      }

      if (confirmPassword) {
        confirmPassword.value = "";
      }

      if (currentPassword) {
        currentPassword.type = "password";
      }
      if (newPassword) {
        newPassword.type = "password";
      }
      if (confirmPassword) {
        confirmPassword.type = "password";
      }

      setTranslatedMessage(
        message,
        "settings.passwordChanged",
        "Heslo bylo úspěšně změněno.",
        "success"
      );
    } catch (error) {
      if (isRentuloWeakPasswordError(error)) {
        setTranslatedMessage(
          message,
          "settings.passwordRequirements",
          "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol.",
          "error"
        );
      } else if (isCurrentPasswordError(error)) {
        setTranslatedMessage(
          message,
          "settings.currentPasswordIncorrect",
          "Současné heslo není správné.",
          "error"
        );
        if (currentPassword) {
          currentPassword.focus();
        }
      } else if (isSamePasswordError(error)) {
        setTranslatedMessage(
          message,
          "settings.passwordSameAsCurrent",
          "Nové heslo musí být jiné než současné heslo.",
          "error"
        );
        if (newPassword) {
          newPassword.focus();
        }
      } else {
        console.error(error);
        setTranslatedMessage(
          message,
          "settings.passwordChangeError",
          "Heslo se nepodařilo změnit. Zkuste to prosím znovu.",
          "error"
        );
      }
    } finally {
      setButtonLoading(button, false);
    }
  }

  function isCurrentPasswordError(error) {
    const code = String(error && error.code ? error.code : "").toLowerCase();
    const message = String(error && error.message ? error.message : "").toLowerCase();
    return (
      code === "current_password_required" ||
      code === "current_password_mismatch" ||
      message.includes("current password")
    );
  }

  function isSamePasswordError(error) {
    const code = String(error && error.code ? error.code : "").toLowerCase();
    const message = String(error && error.message ? error.message : "").toLowerCase();
    return code === "same_password" || message.includes("different from the old password");
  }

  function firstResultRow(value) {
    if (Array.isArray(value)) {
      return value[0] || null;
    }

    if (value && typeof value === "object") {
      return value;
    }

    return null;
  }

  function showReservationCancellationBlock(message, status) {
    if (!status || typeof status.blocking_reservations_count !== "number" ||
        status.blocking_reservations_count <= 0) {
      setTranslatedMessage(
        message,
        "settings.cancelAccountCheckError",
        "Možnost zrušení účtu se nepodařilo zkontrolovat. Zkuste to prosím znovu.",
        "error"
      );
      return;
    }

    setTranslatedMessage(
      message,
      "settings.cancelAccountBlocked",
      "Účet zatím nelze zrušit. Máte {count} rozpracovaných rezervací ({owner} jako majitel, {renter} jako zájemce). Nejdříve je dokončete nebo zrušte.",
      "error",
      {
        count: status.blocking_reservations_count,
        owner: status.blocking_as_owner_count || 0,
        renter: status.blocking_as_renter_count || 0
      }
    );
  }

  function showFinancialCancellationBlock(message, status) {
    const fields = [
      "open_owner_debts_count",
      "unfinished_refunds_count",
      "unresolved_owner_transfers_count"
    ];

    if (!status || !fields.every(function (key) {
      return typeof status[key] === "number" && status[key] >= 0;
    }) || fields.every(function (key) { return status[key] === 0; })) {
      setTranslatedMessage(
        message,
        "settings.cancelAccountFinancialBlockedGeneric",
        "Účet zatím nelze zrušit kvůli nedokončeným finančním operacím. Zkuste kontrolu opakovat později nebo kontaktujte podporu.",
        "error"
      );
      return;
    }

    setTranslatedMessage(
      message,
      "settings.cancelAccountFinancialBlocked",
      "Účet zatím nelze zrušit. Neuhrazené storno poplatky: {debts}, nedokončené vratky: {refunds}, nevyřešené výplaty: {transfers}. Dluhy uhraďte v Moje nabídky; u ostatních operací vyčkejte na dokončení nebo kontaktujte podporu.",
      "error",
      {
        debts: status.open_owner_debts_count,
        refunds: status.unfinished_refunds_count,
        transfers: status.unresolved_owner_transfers_count
      }
    );
  }

  function resetAccountCancellationAfterBlock() {
    setAccountCancellationConfirmationVisible(false);
    const checkButton = document.getElementById("checkAccountCancellationButton");
    if (checkButton) {
      checkButton.hidden = false;
    }
  }

  function setAccountCancellationConfirmationVisible(visible) {
    const confirmation = document.getElementById("accountCancellationConfirmation");
    const password = document.getElementById("cancelAccountPassword");
    const acknowledge = document.getElementById("cancelAccountAcknowledge");
    const cancelButton = document.getElementById("cancelAccountButton");

    if (confirmation) {
      confirmation.hidden = !visible;
    }

    if (!visible) {
      if (password) {
        password.value = "";
      }
      if (acknowledge) {
        acknowledge.checked = false;
      }
      if (cancelButton) {
        cancelButton.disabled = true;
      }
    }
  }

  function updateAccountCancellationButtonState() {
    const password = document.getElementById("cancelAccountPassword");
    const acknowledge = document.getElementById("cancelAccountAcknowledge");
    const button = document.getElementById("cancelAccountButton");

    if (!button || button.classList.contains("is-loading")) {
      return;
    }

    button.disabled = !(
      password && password.value && acknowledge && acknowledge.checked
    );
  }

  async function checkAccountCancellation(client) {
    const button = document.getElementById("checkAccountCancellationButton");
    const message = document.getElementById("accountCancellationMessage");

    if (button && button.disabled) {
      return;
    }

    setMessage(message, "", "");
    resetAccountCancellationAfterBlock();
    setButtonLoading(button, true);

    try {
      const { data, error } = await client.rpc("get_my_account_deactivation_status_v2");

      if (error) {
        throw error;
      }

      const status = firstResultRow(data);

      if (!status) {
        throw new Error("Account deactivation status is missing.");
      }

      if (status.account_status === "deactivated") {
        setTranslatedMessage(
          message,
          "settings.cancelAccountAlreadyDeactivated",
          "Účetní data už byla deaktivována. Potvrďte akci znovu, abychom dokončili odebrání možnosti přihlášení.",
          "success"
        );
        if (button) {
          button.hidden = true;
        }
        setAccountCancellationConfirmationVisible(true);
        updateAccountCancellationButtonState();
        return;
      }

      if (!status.can_deactivate) {
        if (status.blocking_reservations_count > 0) {
          showReservationCancellationBlock(message, status);
        } else if (
          status.open_owner_debts_count > 0 ||
          status.unfinished_refunds_count > 0 ||
          status.unresolved_owner_transfers_count > 0
        ) {
          showFinancialCancellationBlock(message, status);
        } else {
          setTranslatedMessage(
            message,
            "settings.cancelAccountCheckError",
            "Možnost zrušení účtu se nepodařilo zkontrolovat. Zkuste to prosím znovu.",
            "error"
          );
        }
        return;
      }

      setTranslatedMessage(
        message,
        "settings.cancelAccountReady",
        "Účet lze zrušit. Aktivní nabídky, které se při zrušení skryjí: {offers}.",
        "success",
        { offers: status.offers_to_close_count || 0 }
      );
      if (button) {
        button.hidden = true;
      }
      setAccountCancellationConfirmationVisible(true);
      updateAccountCancellationButtonState();
    } catch (error) {
      console.error(error);
      setTranslatedMessage(
        message,
        "settings.cancelAccountCheckError",
        "Možnost zrušení účtu se nepodařilo zkontrolovat. Zkuste to prosím znovu.",
        "error"
      );
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function readFunctionErrorPayload(error) {
    const context = error && error.context ? error.context : null;

    if (!context || typeof context.json !== "function") {
      return null;
    }

    try {
      return await context.json();
    } catch (_error) {
      return null;
    }
  }

  async function cancelAccount(client, currentUser) {
    const password = document.getElementById("cancelAccountPassword");
    const acknowledge = document.getElementById("cancelAccountAcknowledge");
    const button = document.getElementById("cancelAccountButton");
    const message = document.getElementById("accountCancellationMessage");
    const currentPassword = password ? password.value : "";

    if (button && button.disabled) {
      return;
    }

    if (!currentPassword || !acknowledge || !acknowledge.checked) {
      setTranslatedMessage(
        message,
        "settings.cancelAccountConfirmationError",
        "Zadejte současné heslo a potvrďte, že rozumíte následkům zrušení účtu.",
        "error"
      );
      updateAccountCancellationButtonState();
      return;
    }

    if (!currentUser || !currentUser.email) {
      setTranslatedMessage(
        message,
        "settings.cancelAccountInvokeError",
        "Účet se nepodařilo zrušit. Zkuste to prosím znovu.",
        "error"
      );
      return;
    }

    setMessage(message, "", "");
    setButtonLoading(button, true);
    let completed = false;

    try {
      const { error: passwordError } = await client.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPassword,
      });

      if (passwordError) {
        const passwordErrorCode = String(passwordError.code || "").toLowerCase();
        const passwordErrorMessage = String(passwordError.message || "").toLowerCase();

        if (
          passwordErrorCode === "invalid_credentials" ||
          passwordErrorMessage.includes("invalid login credentials")
        ) {
          setTranslatedMessage(
            message,
            "settings.currentPasswordIncorrect",
            "Současné heslo není správné.",
            "error"
          );
          if (password) {
            password.focus();
          }
          return;
        }

        throw passwordError;
      }

      const { data, error } = await client.functions.invoke("account-deactivation", {
        body: {},
      });

      if (error) {
        const details = await readFunctionErrorPayload(error);
        const code = details && details.code ? details.code : "";

        if (code === "ACCOUNT_HAS_ACTIVE_RESERVATIONS") {
          resetAccountCancellationAfterBlock();
          showReservationCancellationBlock(message, details);
          return;
        }

        if (code === "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS") {
          resetAccountCancellationAfterBlock();
          showFinancialCancellationBlock(message, details);
          return;
        }

        if (code === "AUTH_SOFT_DELETE_FAILED") {
          setTranslatedMessage(
            message,
            "settings.cancelAccountPartialError",
            "Údaje účtu byly deaktivovány, ale odebrání možnosti přihlášení se nepodařilo dokončit. Zkuste zrušení účtu znovu.",
            "error"
          );
          return;
        }

        throw error;
      }

      if (!data || data.ok !== true) {
        throw new Error("Account deactivation did not return a successful result.");
      }

      completed = true;
      setTranslatedMessage(
        message,
        "settings.cancelAccountSuccess",
        "Účet byl zrušen. Nyní vás odhlásíme.",
        "success"
      );

      if (password) {
        password.value = "";
      }
      if (acknowledge) {
        acknowledge.checked = false;
      }

      try {
        await client.auth.signOut({ scope: "local" });
      } catch (signOutError) {
        console.warn("Local sign-out after account cancellation failed", signOutError);
      }

      window.setTimeout(function () {
        window.location.replace("index.html");
      }, 900);
    } catch (error) {
      console.error(error);
      const messageText = String(error && error.message ? error.message : "").toLowerCase();

      if (messageText.includes("jwt") || messageText.includes("unauthorized")) {
        setTranslatedMessage(
          message,
          "settings.cancelAccountSessionExpired",
          "Přihlášení vypršelo. Přihlaste se znovu a zrušení účtu zopakujte.",
          "error"
        );
      } else {
        setTranslatedMessage(
          message,
          "settings.cancelAccountInvokeError",
          "Účet se nepodařilo zrušit. Zkuste to prosím znovu.",
          "error"
        );
      }
    } finally {
      if (!completed && button && document.body.contains(button)) {
        setButtonLoading(button, false);
        updateAccountCancellationButtonState();
      }
    }
  }

  async function initializeSettingsPage() {
    if (!window.rentuloAuthGuard) {
      window.location.replace("prihlaseni.html?returnTo=nastaveni.html");
      return;
    }

    const user = await window.rentuloAuthGuard.requireUser();

    if (!user) {
      return;
    }

    const client = getSupabaseClient();

    if (!client) {
      setLoadState("error");

      const unavailableRetryButton = document.getElementById("settingsRetryButton");
      if (unavailableRetryButton) {
        unavailableRetryButton.addEventListener("click", function () {
          window.location.reload();
        });
      }

      return;
    }

    const profileForm = document.getElementById("profileForm");
    const passwordForm = document.getElementById("passwordForm");
    const saveSmsButton = document.getElementById("settingsSaveSmsButton");
    const retryButton = document.getElementById("settingsRetryButton");
    const checkAccountCancellationButton = document.getElementById("checkAccountCancellationButton");
    const cancelAccountButton = document.getElementById("cancelAccountButton");
    const cancelAccountPassword = document.getElementById("cancelAccountPassword");
    const cancelAccountAcknowledge = document.getElementById("cancelAccountAcknowledge");
    let currentUser = user;

    if (profileForm) {
      setupRentuloCzechPostalCodeBlur(document.getElementById("profilePostalCode"));
      profileForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        currentUser = await saveProfile(client, currentUser);
      });
    }

    if (saveSmsButton) {
      saveSmsButton.addEventListener("click", function () {
        saveSmsPreference(client, currentUser);
      });
    }

    if (passwordForm) {
      passwordForm.addEventListener("submit", function (event) {
        event.preventDefault();
        changePassword(client);
      });
    }

    if (retryButton) {
      retryButton.addEventListener("click", async function () {
        setButtonLoading(retryButton, true);

        try {
          await loadPageData(client, currentUser);
        } finally {
          setButtonLoading(retryButton, false);
        }
      });
    }

    if (checkAccountCancellationButton) {
      checkAccountCancellationButton.addEventListener("click", function () {
        checkAccountCancellation(client);
      });
    }

    if (cancelAccountPassword) {
      cancelAccountPassword.addEventListener(
        "input",
        updateAccountCancellationButtonState
      );
    }

    if (cancelAccountAcknowledge) {
      cancelAccountAcknowledge.addEventListener(
        "change",
        updateAccountCancellationButtonState
      );
    }

    if (cancelAccountButton) {
      cancelAccountButton.addEventListener("click", function () {
        cancelAccount(client, currentUser);
      });
    }

    await loadPageData(client, currentUser);
  }

  document.addEventListener("rentuloLanguageChanged", function () {
    refreshTranslatedMessages();

    const loadState = document.getElementById("settingsLoadState");
    if (loadState && loadState.dataset.state) {
      setLoadState(loadState.dataset.state);
    }
  });

  document.addEventListener("DOMContentLoaded", initializeSettingsPage);
})();
