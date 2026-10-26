-- BOD03A / SINGLE READ-ONLY TEST verification. Never run on PROD.
SELECT
  (SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret, '/')='https://vspposovhdgvbeukoivh.supabase.co'
  )) AS spravny_test,
  session_user AS db_session_user,
  current_user AS db_current_user,
  auth.uid() IS NULL AS bez_klient_identity,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN (
     'platform_incidents','platform_incident_events','platform_user_blocks',
     'platform_offer_moderation','platform_admin_actions'
   ) AND c.relrowsecurity = true) AS pocet_chranenych_tabuliek,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O'
     AND t.tgname LIKE 'trg_platform_%') AS pocet_aktivnych_triggerov,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN (
     'platform_admin_create_incident','platform_admin_update_incident',
     'platform_admin_block_user','platform_admin_unblock_user',
     'platform_admin_hide_offer','platform_admin_release_offer'
   )) AS pocet_admin_funkcii,
  has_table_privilege('anon','public.platform_incidents','SELECT') AS anon_vidi_incidenty,
  has_table_privilege('authenticated','public.platform_user_blocks','SELECT') AS klient_vidi_blokacie,
  has_table_privilege('service_role','public.platform_admin_actions','INSERT') AS servis_zapisuje_audit,
  has_function_privilege('authenticated',
    'public.platform_admin_block_user(uuid,text)','EXECUTE') AS klient_moze_blokovat;
-- Expect: true, postgres, postgres, true, 5, 12+, 6,
-- and all final four grant booleans = false.
