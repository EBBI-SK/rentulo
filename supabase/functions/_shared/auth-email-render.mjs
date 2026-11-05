// Rentulo Auth email templates — exact, reviewed copies of supabase/auth-email-templates/*.
// The Node tests compare this snapshot to its source, so template changes cannot drift silently.
// Do not log tokens or confirmation URLs. All generated links use the Supabase Auth verify endpoint.
export const AUTH_SOURCE_TEMPLATES = {
  "signup": {
    "body": "<div style=\"margin:0;padding:32px 16px;background:#f5f8f6;font-family:Arial,Helvetica,sans-serif;color:#102019;\">\n  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e9e5;border-radius:18px;overflow:hidden;\">\n    <div style=\"padding:28px 32px;background:#e9f4ee;\">\n      <div style=\"font-size:30px;font-weight:700;color:#0e5037;\">Rentulo</div>\n    </div>\n    <div style=\"padding:32px;\">\n{{if eq .Data.preferred_language \"cs\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potvrďte svůj e-mail</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">K dokončení registrace na Rentulu potvrďte svou e-mailovou adresu kliknutím na tlačítko níže.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potvrdit e-mail</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Pokud jste si účet na Rentulu nezakládali, tento e-mail můžete ignorovat.</p>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potvrďte svoj e-mail</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Na dokončenie registrácie v Rentule potvrďte svoju e-mailovú adresu kliknutím na tlačidlo nižšie.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potvrdiť e-mail</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Ak ste si účet na Rentule nevytvorili, tento e-mail môžete ignorovať.</p>\n{{else if eq .Data.preferred_language \"en\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Confirm your email address</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">To finish signing up for Rentulo, confirm your email address by clicking the button below.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Confirm email address</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">If you did not sign up for Rentulo, you can safely ignore this email.</p>\n{{else if eq .Data.preferred_language \"de\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Bestätigen Sie Ihre E-Mail-Adresse</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Um Ihre Registrierung bei Rentulo abzuschließen, bestätigen Sie Ihre E-Mail-Adresse über die Schaltfläche unten.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">E-Mail-Adresse bestätigen</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Falls Sie kein Rentulo-Konto erstellt haben, können Sie diese E-Mail ignorieren.</p>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potwierdź swój adres e-mail</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Aby dokończyć rejestrację w Rentulo, potwierdź swój adres e-mail, klikając poniższy przycisk.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potwierdź adres e-mail</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Jeśli nie zakładałeś konta w Rentulo, możesz zignorować tę wiadomość.</p>\n{{else}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Confirm your email address</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">To finish signing up for Rentulo, confirm your email address by clicking the button below.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Confirm email address</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">If you did not sign up for Rentulo, you can safely ignore this email.</p>\n{{end}}\n    </div>\n    <div style=\"padding:20px 32px;border-top:1px solid #e5e9e5;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64706b;\">\n      <div style=\"font-weight:700;color:#37564b;\">&copy; 2026 Rentulo</div>\n{{if eq .Data.preferred_language \"cs\"}}\n      <div>Potřebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <div>Potrebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"en\"}}\n      <div>Need help? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Contact us.</a></div>\n{{else if eq .Data.preferred_language \"de\"}}\n      <div>Brauchen Sie Hilfe? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktieren Sie uns.</a></div>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <div>Potrzebujesz pomocy? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Skontaktuj się z nami.</a></div>\n{{else}}\n      <div>Need help? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Contact us.</a></div>\n{{end}}\n    </div>\n  </div>\n</div>\n",
    "subject": "{{$l:=.Data.preferred_language}}{{if eq $l \"cs\"}}Potvrďte svůj e-mail{{else if eq $l \"sk\"}}Potvrďte svoj e-mail{{else if eq $l \"de\"}}E-Mail bestätigen{{else if eq $l \"pl\"}}Potwierdź e-mail{{else}}Confirm email{{end}} – Rentulo"
  },
  "recovery": {
    "body": "<div style=\"margin:0;padding:32px 16px;background:#f5f8f6;font-family:Arial,Helvetica,sans-serif;color:#102019;\">\n  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e9e5;border-radius:18px;overflow:hidden;\">\n    <div style=\"padding:28px 32px;background:#e9f4ee;\">\n      <div style=\"font-size:30px;font-weight:700;color:#0e5037;\">Rentulo</div>\n    </div>\n    <div style=\"padding:32px;\">\n{{if eq .Data.preferred_language \"cs\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Obnova hesla</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Obdrželi jsme žádost o nastavení nového hesla k vašemu účtu Rentulo.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Klikněte na tlačítko níže a nastavte si nové heslo.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Nastavit nové heslo</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Pokud jste o obnovu hesla nežádali, tento e-mail můžete ignorovat. Vaše heslo zůstane beze změny.</p>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Obnova hesla</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Dostali sme žiadosť o nastavenie nového hesla k vášmu účtu Rentulo.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Kliknite na tlačidlo nižšie a nastavte si nové heslo.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Nastaviť nové heslo</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Ak ste o obnovu hesla nežiadali, tento e-mail môžete ignorovať. Vaše heslo zostane nezmenené.</p>\n{{else if eq .Data.preferred_language \"en\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Reset your password</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">We received a request to set a new password for your Rentulo account.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Click the button below to set your new password.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Set a new password</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>\n{{else if eq .Data.preferred_language \"de\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Passwort zurücksetzen</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Wir haben eine Anfrage erhalten, ein neues Passwort für Ihr Rentulo-Konto festzulegen.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Klicken Sie auf die Schaltfläche unten, um Ihr neues Passwort festzulegen.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Neues Passwort festlegen</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Falls Sie das Zurücksetzen Ihres Passworts nicht angefordert haben, können Sie diese E-Mail ignorieren. Ihr Passwort bleibt unverändert.</p>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Resetowanie hasła</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Otrzymaliśmy prośbę o ustawienie nowego hasła do Twojego konta Rentulo.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Kliknij poniższy przycisk, aby ustawić nowe hasło.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Ustaw nowe hasło</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Jeśli nie prosiłeś o zresetowanie hasła, możesz zignorować tę wiadomość. Twoje hasło pozostanie bez zmian.</p>\n{{else}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Obnova hesla</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Obdrželi jsme žádost o nastavení nového hesla k vašemu účtu Rentulo.</p>\n      <p style=\"margin:0 0 28px;font-size:16px;line-height:1.6;color:#64706b;\">Klikněte na tlačítko níže a nastavte si nové heslo.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Nastavit nové heslo</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Pokud jste o obnovu hesla nežádali, tento e-mail můžete ignorovat. Vaše heslo zůstane beze změny.</p>\n{{end}}\n    </div>\n    <div style=\"padding:20px 32px;border-top:1px solid #e5e9e5;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64706b;\">\n      <div style=\"font-weight:700;color:#37564b;\">&copy; 2026 Rentulo</div>\n{{if eq .Data.preferred_language \"cs\"}}\n      <div>Potřebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <div>Potrebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"en\"}}\n      <div>Need help? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Contact us.</a></div>\n{{else if eq .Data.preferred_language \"de\"}}\n      <div>Brauchen Sie Hilfe? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktieren Sie uns.</a></div>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <div>Potrzebujesz pomocy? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Skontaktuj się z nami.</a></div>\n{{else}}\n      <div>Potřebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{end}}\n    </div>\n  </div>\n</div>\n",
    "subject": "{{$l:=.Data.preferred_language}}{{if eq $l \"cs\"}}Obnova hesla{{else if eq $l \"sk\"}}Obnova hesla{{else if eq $l \"de\"}}Passwort zurücksetzen{{else if eq $l \"pl\"}}Resetowanie hasła{{else}}Reset your password{{end}} – Rentulo"
  },
  "email_change": {
    "body": "<div style=\"margin:0;padding:32px 16px;background:#f5f8f6;font-family:Arial,Helvetica,sans-serif;color:#102019;\">\n  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e9e5;border-radius:18px;overflow:hidden;\">\n    <div style=\"padding:28px 32px;background:#e9f4ee;\">\n      <div style=\"font-size:30px;font-weight:700;color:#0e5037;\">Rentulo</div>\n    </div>\n    <div style=\"padding:32px;\">\n{{if eq .Data.preferred_language \"cs\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potvrďte změnu e-mailové adresy</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Obdrželi jsme žádost o změnu e-mailové adresy vašeho účtu Rentulo na:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Kliknutím na tlačítko níže potvrďte změnu e-mailové adresy.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">Z bezpečnostních důvodů posíláme potvrzení na původní i novou e-mailovou adresu. Změna se dokončí až po potvrzení obou zpráv.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potvrdit novou e-mailovou adresu</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Pokud jste o tuto změnu nežádali, tento e-mail ignorujte. Vaše současná e-mailová adresa zůstane platná, dokud nebude změna potvrzena.</p>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potvrďte zmenu e-mailovej adresy</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Dostali sme žiadosť o zmenu e-mailovej adresy vášho účtu Rentulo na:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Kliknutím na tlačidlo nižšie potvrďte zmenu e-mailovej adresy.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">Z bezpečnostných dôvodov posielame potvrdenie na pôvodnú aj novú e-mailovú adresu. Zmena sa dokončí až po potvrdení oboch správ.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potvrdiť novú e-mailovú adresu</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Ak ste o túto zmenu nežiadali, e-mail ignorujte. Vaša súčasná e-mailová adresa zostane platná, kým sa zmena nepotvrdí.</p>\n{{else if eq .Data.preferred_language \"en\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Confirm your new email address</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">We received a request to change the email address of your Rentulo account to:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Click the button below to confirm your new email address.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">For security, we send a confirmation to both your current and new email addresses. The change is completed only after you confirm both messages.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Confirm new email address</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">If you did not request this change, you can safely ignore this email. Your current email address will remain in place until the change is confirmed.</p>\n{{else if eq .Data.preferred_language \"de\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Bestätigen Sie Ihre neue E-Mail-Adresse</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Wir haben eine Anfrage erhalten, die E-Mail-Adresse Ihres Rentulo-Kontos auf folgende Adresse zu ändern:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Klicken Sie auf die Schaltfläche unten, um Ihre neue E-Mail-Adresse zu bestätigen.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">Aus Sicherheitsgründen senden wir eine Bestätigung an die bisherige und die neue E-Mail-Adresse. Die Änderung wird erst nach Bestätigung beider Nachrichten abgeschlossen.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Neue E-Mail-Adresse bestätigen</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Falls Sie diese Änderung nicht angefordert haben, können Sie diese E-Mail ignorieren. Ihre bisherige E-Mail-Adresse bleibt gültig, bis die Änderung bestätigt wurde.</p>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Potwierdź nowy adres e-mail</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">Otrzymaliśmy prośbę o zmianę adresu e-mail Twojego konta Rentulo na:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Kliknij poniższy przycisk, aby potwierdzić nowy adres e-mail.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">Ze względów bezpieczeństwa wysyłamy potwierdzenie na stary i nowy adres e-mail. Zmiana zostanie zakończona dopiero po potwierdzeniu obu wiadomości.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Potwierdź nowy adres e-mail</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">Jeśli nie prosiłeś o tę zmianę, możesz zignorować tę wiadomość. Twój obecny adres e-mail pozostanie aktywny do czasu potwierdzenia zmiany.</p>\n{{else}}\n      <h1 style=\"margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037;\">Confirm your new email address</h1>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b;\">We received a request to change the email address of your Rentulo account to:</p>\n      <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;color:#103f32;\"><strong>{{ .NewEmail }}</strong></p>\n      <p style=\"margin:0 0 12px;font-size:16px;line-height:1.6;color:#64706b;\">Click the button below to confirm your new email address.</p>\n      <p style=\"margin:0 0 28px;font-size:14px;line-height:1.6;color:#64706b;\">For security, we send a confirmation to both your current and new email addresses. The change is completed only after you confirm both messages.</p>\n      <a href=\"{{ .ConfirmationURL }}\" style=\"display:inline-block;padding:14px 24px;background:#00835a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;\">Confirm new email address</a>\n      <p style=\"margin:28px 0 0;font-size:14px;line-height:1.6;color:#64706b;\">If you did not request this change, you can safely ignore this email. Your current email address will remain in place until the change is confirmed.</p>\n{{end}}\n    </div>\n    <div style=\"padding:20px 32px;border-top:1px solid #e5e9e5;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64706b;\">\n      <div style=\"font-weight:700;color:#37564b;\">&copy; 2026 Rentulo</div>\n{{if eq .Data.preferred_language \"cs\"}}\n      <div>Potřebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"sk\"}}\n      <div>Potrebujete pomoc? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktujte nás.</a></div>\n{{else if eq .Data.preferred_language \"en\"}}\n      <div>Need help? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Contact us.</a></div>\n{{else if eq .Data.preferred_language \"de\"}}\n      <div>Brauchen Sie Hilfe? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Kontaktieren Sie uns.</a></div>\n{{else if eq .Data.preferred_language \"pl\"}}\n      <div>Potrzebujesz pomocy? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Skontaktuj się z nami.</a></div>\n{{else}}\n      <div>Need help? <a href=\"mailto:rentulo@rentulo.com\" style=\"color:#0b6b50;text-decoration:underline;font-weight:600\">Contact us.</a></div>\n{{end}}\n    </div>\n  </div>\n</div>\n",
    "subject": "{{$l:=.Data.preferred_language}}{{if eq $l \"cs\"}}Potvrďte nový e-mail{{else if eq $l \"sk\"}}Potvrďte nový e-mail{{else if eq $l \"de\"}}Neue E-Mail bestätigen{{else if eq $l \"pl\"}}Potwierdź nowy e-mail{{else}}Confirm new email{{end}} – Rentulo"
  }
};

const LANGUAGES = new Set(["cs", "sk", "en", "de", "pl"]);
const AUTH_TYPES_WITH_LINK = new Set(["signup", "recovery", "invite", "magiclink", "email_change"]);
const NOTICES = {
  password_changed_notification: ["Heslo bylo změněno", "Heslo vášho účtu bolo zmenené", "Your password was changed", "Ihr Passwort wurde geändert", "Hasło zostało zmienione"],
  email_changed_notification: ["E-mailová adresa byla změněna", "E-mailová adresa bola zmenená", "Your email address was changed", "Ihre E-Mail-Adresse wurde geändert", "Adres e-mail został zmieniony"],
  phone_changed_notification: ["Telefonní číslo bylo změněno", "Telefónne číslo bolo zmenené", "Your phone number was changed", "Ihre Telefonnummer wurde geändert", "Numer telefonu został zmieniony"],
  identity_linked_notification: ["Způsob přihlášení byl přidán", "Spôsob prihlásenia bol pridaný", "A sign-in method was linked", "Eine Anmeldemethode wurde hinzugefügt", "Dodano metodę logowania"],
  identity_unlinked_notification: ["Způsob přihlášení byl odebrán", "Spôsob prihlásenia bol odstránený", "A sign-in method was removed", "Eine Anmeldemethode wurde entfernt", "Usunięto metodę logowania"],
  mfa_factor_enrolled_notification: ["Ověřovací metoda byla přidána", "Overovacia metóda bola pridaná", "A verification method was added", "Eine Verifizierungsmethode wurde hinzugefügt", "Dodano metodę weryfikacji"],
  mfa_factor_unenrolled_notification: ["Ověřovací metoda byla odebrána", "Overovacia metóda bola odstránená", "A verification method was removed", "Eine Verifizierungsmethode wurde entfernt", "Usunięto metodę weryfikacji"],
};
const IDS = ["cs", "sk", "en", "de", "pl"];
const GENERIC = {
  invite: ["Pozvánka do Rentulo", "Pozvánka do Rentula", "Your invitation to Rentulo", "Ihre Einladung zu Rentulo", "Zaproszenie do Rentulo"],
  magiclink: ["Přihlášení do Rentulo", "Prihlásenie do Rentula", "Sign in to Rentulo", "Bei Rentulo anmelden", "Logowanie do Rentulo"],
  reauthentication: ["Ověřte svou totožnost", "Overte svoju totožnosť", "Verify your identity", "Bestätigen Sie Ihre Identität", "Potwierdź swoją tożsamość"],
};
const GENERIC_CTA = {
  invite: ["Přijmout pozvánku →", "Prijať pozvánku →", "Accept invitation →", "Einladung annehmen →", "Przyjmij zaproszenie →"],
  magiclink: ["Otevřít přihlášení →", "Otvoriť prihlásenie →", "Open sign-in →", "Anmeldung öffnen →", "Otwórz logowanie →"],
};

const safeText = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const languageOf = (user, type) => {
  const value = user?.user_metadata?.preferred_language;
  if (LANGUAGES.has(value)) return value;
  // Match the historical approved Supabase templates' unspecified-language defaults.
  return type === "recovery" ? "cs" : "en";
};
const pick = (values, language) => values[IDS.indexOf(language) === -1 ? 2 : IDS.indexOf(language)];

// The source templates use only Go's if/else-if/else/end on the language.
// Render these explicitly rather than evaluating arbitrary template expressions.
export function renderGoLanguage(source, language) {
  const text = source.replace(/{{\s*\$l\s*:=\s*\.Data\.preferred_language\s*}}/g, "");
  const tags = /{{\s*(if eq (?:\.Data\.preferred_language|\$l) "[a-z]{2}"|else if eq (?:\.Data\.preferred_language|\$l) "[a-z]{2}"|else|end)\s*}}/g;
  const stack = [];
  let active = true, output = "", start = 0, match;
  while ((match = tags.exec(text)) !== null) {
    if (active) output += text.slice(start, match.index);
    const op = match[1];
    if (op.startsWith("if eq ")) {
      const selected = op.match(/"([a-z]{2})"$/)[1] === language;
      stack.push({ parent: active, matched: selected });
      active = active && selected;
    } else if (op.startsWith("else if eq ")) {
      const frame = stack.at(-1);
      if (!frame) throw new Error("Unexpected else if in Auth email template");
      const selected = !frame.matched && op.match(/"([a-z]{2})"$/)[1] === language;
      frame.matched ||= selected;
      active = frame.parent && selected;
    } else if (op === "else") {
      const frame = stack.at(-1);
      if (!frame) throw new Error("Unexpected else in Auth email template");
      active = frame.parent && !frame.matched;
    } else {
      const frame = stack.pop();
      if (!frame) throw new Error("Unexpected end in Auth email template");
      active = frame.parent;
    }
    start = tags.lastIndex;
  }
  if (stack.length) throw new Error("Unclosed conditional in Auth email template");
  if (active) output += text.slice(start);
  return output.trim();
}

function withLink(source, language, url, newEmail) {
  const html = renderGoLanguage(source, language)
    .replace(/{{\s*\.ConfirmationURL\s*}}/g, safeText(url))
    .replace(/{{\s*\.NewEmail\s*}}/g, safeText(newEmail));
  if (html.includes("{{")) throw new Error("Unresolved Auth email template variable");
  return html;
}
const asCard = (title, content, footer, button = "", href = "") => {
  const buttonHtml = button && href ? `<p style="margin:18px 0 16px"><a href="${safeText(href)}" style="display:inline-block;padding:14px 24px;background:#00835a;color:#fff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px">${safeText(button)}</a></p>` : "";
  return `<div style="margin:0;padding:32px 16px;background:#f5f8f6;font-family:Arial,Helvetica,sans-serif;color:#102019"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e9e5;border-radius:18px;overflow:hidden"><div style="padding:28px 32px;background:#e9f4ee"><div style="font-size:30px;font-weight:700;color:#0e5037">Rentulo</div></div><div style="padding:32px"><h1 style="margin:0 0 16px;font-size:26px;line-height:1.3;color:#0e5037">${safeText(title)}</h1>${content}${buttonHtml}</div><div style="padding:20px 32px;border-top:1px solid #e5e9e5;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64706b"><div style="font-weight:700;color:#37564b">&copy; 2026 Rentulo</div><div>${safeText(footer[0])} <a href="mailto:rentulo@rentulo.com" style="color:#0b6b50;text-decoration:underline;font-weight:600">${safeText(footer[1])}</a></div></div></div></div>`;
};
const footerFor = language => pick([
  ["Potřebujete pomoc?", "Kontaktujte nás."],
  ["Potrebujete pomoc?", "Kontaktujte nás."],
  ["Need help?", "Contact us."],
  ["Brauchen Sie Hilfe?", "Kontaktieren Sie uns."],
  ["Potrzebujesz pomocy?", "Skontaktuj się z nami."]
], language);
const safeParagraph = text => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#64706b">${safeText(text)}</p>`;

function verifyLink(emailData, tokenHash, type, supabaseUrl) {
  if (typeof tokenHash !== "string" || !/^[a-f0-9]{16,256}$/i.test(tokenHash)) {
    throw new Error("Auth token hash is missing or malformed");
  }
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co") || parsed.username || parsed.password) {
    throw new Error("Untrusted Supabase Auth URL");
  }
  const url = new URL("/auth/v1/verify", parsed);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  const redirect = emailData.redirect_to || emailData.site_url;
  if (redirect) {
    const parsedRedirect = new URL(redirect);
    const allowedHost = parsedRedirect.hostname === "rentulo.eu" || parsedRedirect.hostname.endsWith(".rentulo.eu") || parsedRedirect.hostname === "rentulo.com" || parsedRedirect.hostname.endsWith(".rentulo.com");
    if (!allowedHost || parsedRedirect.protocol !== "https:" || parsedRedirect.username || parsedRedirect.password) {
      throw new Error("Untrusted Auth redirect URL");
    }
    url.searchParams.set("redirect_to", parsedRedirect.toString());
  }
  return url.toString();
}

// Validates and prepares all required sends BEFORE any external API call.
// The dedicated Edge Function is the only network sender; this module is pure and Node-testable.
export function buildAuthEmailMessages(event, { supabaseUrl }) {
  const user = event?.user, data = event?.email_data;
  const kind = data?.email_action_type;
  if (!user || typeof user.email !== "string" || !/^[^<>"\s@]+@[^<>"\s@]+\.[^<>"\s@]+$/.test(user.email) || !data || typeof kind !== "string") {
    throw new Error("Malformed Supabase Auth email event");
  }
  const type = kind === "magic_link" ? "magiclink" : kind;
  const language = languageOf(user, type);
  const toMessage = (to, subject, html, suffix = "main") => ({ to, subject, html, suffix });
  if (["signup", "recovery"].includes(type)) {
    const url = verifyLink(data, data.token_hash, type, supabaseUrl);
    const tmpl = AUTH_SOURCE_TEMPLATES[type];
    const subject = renderGoLanguage(tmpl.subject, language);
    return [toMessage(user.email, subject, withLink(tmpl.body, language, url))];
  }
  if (type === "email_change") {
    const newEmail = user.new_email;
    if (typeof newEmail !== "string" || !/^[^<>"\s@]+@[^<>"\s@]+\.[^<>"\s@]+$/.test(newEmail)) {
      throw new Error("Auth new email is missing");
    }
    const tmpl = AUTH_SOURCE_TEMPLATES.email_change;
    const subject = renderGoLanguage(tmpl.subject, language);
    const dualConfirm = Boolean(data.token_hash_new && data.token_hash);
    if (dualConfirm) {
      const oldUrl = verifyLink(data, data.token_hash_new, "email_change", supabaseUrl);
      const newUrl = verifyLink(data, data.token_hash, "email_change", supabaseUrl);
      return [
        toMessage(user.email, subject, withLink(tmpl.body, language, oldUrl, newEmail), "old"),
        toMessage(newEmail, subject, withLink(tmpl.body, language, newUrl, newEmail), "new"),
      ];
    }
    const url = verifyLink(data, data.token_hash, "email_change", supabaseUrl);
    const title = pick(["Potvrďte nový e-mail", "Potvrďte nový e-mail", "Confirm new email", "Neue E-Mail bestätigen", "Potwierdź nowy e-mail"], language);
    const intro = pick(["Potvrďte změnu své e-mailové adresy.", "Potvrďte zmenu svojej e-mailovej adresy.", "Confirm the change to your email address.", "Bestätigen Sie die Änderung Ihrer E-Mail-Adresse.", "Potwierdź zmianę adresu e-mail."], language);
    const action = pick(["Potvrdit nový e-mail →", "Potvrdiť nový e-mail →", "Confirm new email →", "Neue E-Mail bestätigen →", "Potwierdź nowy e-mail →"], language);
    return [toMessage(newEmail, subject, asCard(title, safeParagraph(intro) + safeParagraph(newEmail), footerFor(language), action, url), "new")];
  }
  if (type === "magiclink" || type === "invite") {
    const url = verifyLink(data, data.token_hash, type, supabaseUrl);
    const title = pick(GENERIC[type], language);
    return [toMessage(user.email, `${title} – Rentulo`, asCard(title, "", footerFor(language), pick(GENERIC_CTA[type], language), url))];
  }
  if (type === "reauthentication") {
    if (typeof data.token !== "string" || !/^[0-9]{4,10}$/.test(data.token)) {
      throw new Error("Auth reauthentication code is missing");
    }
    const title = pick(GENERIC.reauthentication, language);
    const codeHtml = `<p style="font-size:26px;letter-spacing:5px;font-weight:700;color:#103f32">${safeText(data.token)}</p>`;
    return [toMessage(user.email, `${title} – Rentulo`, asCard(title, codeHtml, footerFor(language)))];
  }
  if (Object.hasOwn(NOTICES, type)) {
    const title = pick(NOTICES[type], language);
    const intro = pick([
      "Pokud jste tuto změnu neprovedli, kontaktujte prosím podporu na rentulo@rentulo.com.",
      "Ak ste túto zmenu neurobili, kontaktujte podporu na rentulo@rentulo.com.",
      "If you did not make this change, contact rentulo@rentulo.com.",
      "Wenn Sie diese Änderung nicht vorgenommen haben, kontaktieren Sie rentulo@rentulo.com.",
      "Jeśli to nie Ty dokonałeś tej zmiany, skontaktuj się z rentulo@rentulo.com."
    ], language);
    return [toMessage(user.email, `${title} – Rentulo`, asCard(title, safeParagraph(intro), footerFor(language)))];
  }
  throw new Error("Unsupported Supabase Auth email action type");
}
