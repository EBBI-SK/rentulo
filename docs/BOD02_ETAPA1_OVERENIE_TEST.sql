-- BOD02 ETAPA1: read-only verification, Supabase TEST SQL Editor ONLY.
-- Does not expose email, UUID of users or reservation details.
SELECT EXISTS (
  SELECT 1 FROM vault.decrypted_secrets
  WHERE name = 'rentulo_project_url'
    AND btrim(decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
) AS je_test;

SELECT c.relname AS internal_table,
       c.relrowsecurity AS rls_on,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_read,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS user_can_read,
       has_table_privilege('service_role', c.oid, 'SELECT') AS backend_can_read,
       has_table_privilege('service_role', c.oid, 'INSERT') AS backend_can_insert
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'gdpr_terms_acceptances', 'gdpr_subject_requests',
    'dsa_content_notices', 'gdpr_security_incidents', 'gdpr_legal_holds'
  )
ORDER BY c.relname;

SELECT t.tgname AS trigger_name, t.tgenabled = 'O' AS active
FROM pg_trigger t
WHERE (t.tgrelid = 'auth.users'::regclass AND t.tgname = 'trg_gdpr_capture_signup_terms')
   OR (t.tgrelid = 'public.gdpr_terms_acceptances'::regclass
       AND t.tgname = 'trg_gdpr_prevent_terms_audit_mutation')
   OR (t.tgrelid = 'public.gdpr_legal_holds'::regclass
       AND t.tgname = 'trg_gdpr_serialize_legal_hold_writes')
ORDER BY t.tgname;

SELECT is_enabled AS gdpr_mazanie_povolene
FROM public.gdpr_reservation_contact_cleanup_gate
WHERE singleton = true;

SELECT count(*) AS pocet_novych_test_audit_zaznamov
FROM public.gdpr_terms_acceptances
WHERE source = 'auth_signup'
  AND terms_version = '1.0-test-2026-10-20';
