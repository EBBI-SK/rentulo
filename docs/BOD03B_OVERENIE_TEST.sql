-- BOD 03B: JEDNA čítacia kontrola po nasadení, VÝHRADNE Supabase TEST.
-- Nič nevytvára, nemení, nespúšťa refund ani transfer.
SELECT
  (SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
   WHERE s.name='rentulo_project_url'
     AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')) AS spravny_test,
  session_user AS db_user,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
   ('reservation_dispute_settlements','reservation_dispute_settlement_events')
   AND c.relrowsecurity=true) AS chranene_tabulky,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O'
     AND t.tgname LIKE 'trg_bod03b_%') AS aktivne_triggery,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
   ('bod03b_admin_authorize_settlement','bod03b_admin_retry_refund',
    'bod03b_owner_transfer_allowed','bod03b_claim_due_refunds',
    'bod03b_record_refund_result','bod03b_record_refund_error',
    'bod03b_verify_refund_cron_secret')) AS funkcie,
  (SELECT count(*) FROM cron.job
   WHERE jobname='rentulo-process-dispute-refunds-every-5-minutes'
    AND active=true AND schedule='*/5 * * * *') AS aktivny_test_cron,
  has_table_privilege('authenticated','public.reservation_dispute_settlements','SELECT') AS klient_vidi_rozhodnutia,
  has_function_privilege('authenticated',
    'public.bod03b_admin_authorize_settlement(text,text,text,text,text)','EXECUTE')
    AS klient_moze_schvalit,
  has_function_privilege('service_role',
    'public.bod03b_admin_authorize_settlement(text,text,text,text,text)','EXECUTE')
    AS worker_moze_schvalit;
-- Očakávame: true, postgres, 2, >=4, 7, 1, false, false, false.
