-- KROK 79: PostgreSQL enum additions commit before the value is used.
-- Refuse every project except the explicitly approved Rentulo TEST database.
do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets v
    where v.name = 'rentulo_project_url'
      and btrim(v.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'KROK 79 is authorized only for the Rentulo TEST Supabase project';
  end if;
end;
$test_project$;

alter type public.reservation_status add value if not exists 'no_show';
