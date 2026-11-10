-- RENTULO / SEO 19B/2 / PROD / MANUAL APPROVAL ONLY, 2026-11-10.
-- Automatic subcategories from existing category+title+description. No new UI.
-- IMPORTANT: apply in PROD Supabase SQL Editor *before* deploying the PROD SEO web code.
-- Use only in the verified PROD SQL Editor, after a read-only preflight and explicit approval.
BEGIN;
-- Fail rather than holding business tables for a long period. Entire change is atomic.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
DECLARE v_columns text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) THEN
    RAISE EXCEPTION 'SEO 19B2 is PROD-only; wrong project - PROD only' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.offers') IS NULL
     OR to_regclass('public.public_offers') IS NULL
     OR to_regprocedure('public.platform_admin_assert(text)') IS NULL THEN
    RAISE EXCEPTION 'SEO 19B2: required PROD schemas and administration procedures missing';
  END IF;
  -- Explicitly refuse a partially applied or repeated production migration.
  IF to_regclass('public.seo19b2_subcategory_overrides') IS NOT NULL
     OR to_regclass('public.seo19b2_override_events') IS NOT NULL
     OR to_regprocedure('public.seo19b2_classify(text,text,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'offers'
                  AND column_name = 'subcategory_slug') THEN
    RAISE EXCEPTION 'SEO 19B2 PROD: objects already exist; review the schema before applying';
  END IF;
  -- Do not silently replace a differently secured production public view.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid = 'public.public_offers'::regclass
      AND 'security_invoker=false' = ANY(coalesce(c.reloptions, ARRAY[]::text[]))
      AND 'security_barrier=true' = ANY(coalesce(c.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'SEO 19B2 PROD: public_offers security options differ; stop and review';
  END IF;
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
    INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'public_offers';
  IF v_columns IS DISTINCT FROM ARRAY[
    'id','owner_id','name','category','description','city','postal_code',
    'price_per_day','status','photo_url','pickup_mode','created_at',
    'updated_at','offer_number','min_rental_days'
  ]::text[] THEN
    RAISE EXCEPTION 'SEO 19B2: public_offers columns changed; review before migration';
  END IF;
END;
$guard$;

-- Deterministic locale-independent tokens, with diacritics removed for
-- CZ/SK/EN/DE/PL. Whole-word/whole-phrase comparisons prevent false stems.
CREATE FUNCTION public.seo19b2_normalize(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $sql$
  SELECT ' ' || btrim(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áàâäąăãåčćçďéèëěęêíìïîĺľłńňóòôöőřŕšśşßťúùûüůýÿžźż', 'aaaaaaaacccdeeeeeeiiiilllnnooooorrsssstuuuuuyyzzz'),
    '[^a-z0-9]+', ' ', 'g'
  )) || ' ';
$sql$;

-- No configuration table, external AI, browser scripts or data-dependent SQL.
-- 25 automatic slugs; "jine" is deliberately admin-only.
-- TITLE decides when unique. Description only resolves title ties, or must
-- contain >= 2 strong phrases for one subcategory if title has no signal.
CREATE FUNCTION public.seo19b2_classify(p_category text, p_name text, p_description text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $sql$
WITH input AS (
  SELECT public.seo19b2_normalize(p_name) AS title,
         public.seo19b2_normalize(p_description) AS description
), rules(category, slug, phrase, strong) AS (
  VALUES
    ('Domácnost', 'uklid', 'vysavac', false),
    ('Domácnost', 'uklid', 'vysavace', false),
    ('Domácnost', 'uklid', 'tepovac', false),
    ('Domácnost', 'uklid', 'parni cistic', true),
    ('Domácnost', 'uklid', 'cistic kobercu', true),
    ('Domácnost', 'uklid', 'prumyslovy vysavac', true),
    ('Domácnost', 'uklid', 'vacuum cleaner', true),
    ('Domácnost', 'uklid', 'carpet cleaner', true),
    ('Domácnost', 'uklid', 'steam cleaner', true),
    ('Domácnost', 'uklid', 'staubsauger', false),
    ('Domácnost', 'uklid', 'dampfreiniger', false),
    ('Domácnost', 'uklid', 'teppichreiniger', false),
    ('Domácnost', 'uklid', 'odkurzacz', false),
    ('Domácnost', 'uklid', 'odkurzacz pioracy', true),
    ('Domácnost', 'uklid', 'czyscik parowy', true),
    ('Domácnost', 'uklid', 'tepovac kobercov', true),
    ('Domácnost', 'kuchynske-pristroje', 'mixer', false),
    ('Domácnost', 'kuchynske-pristroje', 'kuchynsky robot', true),
    ('Domácnost', 'kuchynske-pristroje', 'kavovar', false),
    ('Domácnost', 'kuchynske-pristroje', 'friteza', false),
    ('Domácnost', 'kuchynske-pristroje', 'fritovaci hrnec', true),
    ('Domácnost', 'kuchynske-pristroje', 'blender', false),
    ('Domácnost', 'kuchynske-pristroje', 'coffee maker', true),
    ('Domácnost', 'kuchynske-pristroje', 'coffee machine', true),
    ('Domácnost', 'kuchynske-pristroje', 'food processor', true),
    ('Domácnost', 'kuchynske-pristroje', 'kitchen mixer', true),
    ('Domácnost', 'kuchynske-pristroje', 'kaffeemaschine', false),
    ('Domácnost', 'kuchynske-pristroje', 'kuchenmaschine', false),
    ('Domácnost', 'kuchynske-pristroje', 'fritteuse', false),
    ('Domácnost', 'kuchynske-pristroje', 'robot kuchenny', true),
    ('Domácnost', 'kuchynske-pristroje', 'ekspres do kawy', true),
    ('Domácnost', 'kuchynske-pristroje', 'frytkownica', false),
    ('Domácnost', 'domaci-spotrebice', 'odvlhcovac', false),
    ('Domácnost', 'domaci-spotrebice', 'klimatizace', false),
    ('Domácnost', 'domaci-spotrebice', 'klimatizacia', false),
    ('Domácnost', 'domaci-spotrebice', 'ventilator', false),
    ('Domácnost', 'domaci-spotrebice', 'mobilni klimatizace', true),
    ('Domácnost', 'domaci-spotrebice', 'air conditioner', true),
    ('Domácnost', 'domaci-spotrebice', 'dehumidifier', false),
    ('Domácnost', 'domaci-spotrebice', 'fan heater', true),
    ('Domácnost', 'domaci-spotrebice', 'luftentfeuchter', false),
    ('Domácnost', 'domaci-spotrebice', 'klimagerat', false),
    ('Domácnost', 'domaci-spotrebice', 'klimaanlage', false),
    ('Domácnost', 'domaci-spotrebice', 'osuszacz powietrza', true),
    ('Domácnost', 'domaci-spotrebice', 'klimatyzator', false),
    ('Domácnost', 'domaci-spotrebice', 'wentylator', false),
    ('Domácnost', 'vybaveni-domacnosti', 'zehlici prkno', true),
    ('Domácnost', 'vybaveni-domacnosti', 'sici stroj', true),
    ('Domácnost', 'vybaveni-domacnosti', 'susak pradla', true),
    ('Domácnost', 'vybaveni-domacnosti', 'ironing board', true),
    ('Domácnost', 'vybaveni-domacnosti', 'sewing machine', true),
    ('Domácnost', 'vybaveni-domacnosti', 'clothes dryer rack', true),
    ('Domácnost', 'vybaveni-domacnosti', 'bugelbrett', false),
    ('Domácnost', 'vybaveni-domacnosti', 'nahmaschine', false),
    ('Domácnost', 'vybaveni-domacnosti', 'waschestander', false),
    ('Domácnost', 'vybaveni-domacnosti', 'deska do prasowania', true),
    ('Domácnost', 'vybaveni-domacnosti', 'maszyna do szycia', true),
    ('Domácnost', 'vybaveni-domacnosti', 'suszarka na pranie', true),
    ('Zahrada', 'sekacky', 'sekacka', false),
    ('Zahrada', 'sekacky', 'sekacky', false),
    ('Zahrada', 'sekacky', 'vertikutator', false),
    ('Zahrada', 'sekacky', 'kosacka', false),
    ('Zahrada', 'sekacky', 'lawn mower', true),
    ('Zahrada', 'sekacky', 'scarifier', false),
    ('Zahrada', 'sekacky', 'rasenmaher', false),
    ('Zahrada', 'sekacky', 'vertikutierer', false),
    ('Zahrada', 'sekacky', 'kosiarka', false),
    ('Zahrada', 'sekacky', 'wertykulator', false),
    ('Zahrada', 'krovinorezy-pily', 'krovinorez', false),
    ('Zahrada', 'krovinorezy-pily', 'motorova pila', true),
    ('Zahrada', 'krovinorezy-pily', 'retezova pila', true),
    ('Zahrada', 'krovinorezy-pily', 'benzinova pila', true),
    ('Zahrada', 'krovinorezy-pily', 'chainsaw', false),
    ('Zahrada', 'krovinorezy-pily', 'brushcutter', false),
    ('Zahrada', 'krovinorezy-pily', 'brush cutter', true),
    ('Zahrada', 'krovinorezy-pily', 'motorsage', false),
    ('Zahrada', 'krovinorezy-pily', 'freischneider', false),
    ('Zahrada', 'krovinorezy-pily', 'kosa spalinowa', true),
    ('Zahrada', 'krovinorezy-pily', 'pila lancuchowa', true),
    ('Zahrada', 'krovinorezy-pily', 'pila spalinowa', true),
    ('Zahrada', 'krovinorezy-pily', 'krovinorez benzinovy', true),
    ('Zahrada', 'kultivatory', 'kultivator', false),
    ('Zahrada', 'kultivatory', 'rotavator', false),
    ('Zahrada', 'kultivatory', 'zemni vrtak', true),
    ('Zahrada', 'kultivatory', 'motorovy kultivator', true),
    ('Zahrada', 'kultivatory', 'soil tiller', true),
    ('Zahrada', 'kultivatory', 'cultivator', false),
    ('Zahrada', 'kultivatory', 'earth auger', true),
    ('Zahrada', 'kultivatory', 'erdbohrer', false),
    ('Zahrada', 'kultivatory', 'motorhacke', false),
    ('Zahrada', 'kultivatory', 'glebogryzarka', false),
    ('Zahrada', 'kultivatory', 'swider ziemny', true),
    ('Zahrada', 'cerpadla', 'cerpadlo', false),
    ('Zahrada', 'cerpadla', 'zavlazovac', false),
    ('Zahrada', 'cerpadla', 'postrikovac', false),
    ('Zahrada', 'cerpadla', 'zahradni cerpadlo', true),
    ('Zahrada', 'cerpadla', 'water pump', true),
    ('Zahrada', 'cerpadla', 'garden sprinkler', true),
    ('Zahrada', 'cerpadla', 'sprinkler', false),
    ('Zahrada', 'cerpadla', 'wasserpumpe', false),
    ('Zahrada', 'cerpadla', 'rasensprenger', false),
    ('Zahrada', 'cerpadla', 'pompa wodna', true),
    ('Zahrada', 'cerpadla', 'zraszacz', false),
    ('Stavba', 'vrtacky', 'vrtacka', false),
    ('Stavba', 'vrtacky', 'vrtacky', false),
    ('Stavba', 'vrtacky', 'vrtaci kladivo', true),
    ('Stavba', 'vrtacky', 'aku sroubovak', true),
    ('Stavba', 'vrtacky', 'sroubovak', false),
    ('Stavba', 'vrtacky', 'vrtacka s priklepem', true),
    ('Stavba', 'vrtacky', 'power drill', true),
    ('Stavba', 'vrtacky', 'cordless drill', true),
    ('Stavba', 'vrtacky', 'hammer drill', true),
    ('Stavba', 'vrtacky', 'electric screwdriver', true),
    ('Stavba', 'vrtacky', 'bohrmaschine', false),
    ('Stavba', 'vrtacky', 'akkuschrauber', false),
    ('Stavba', 'vrtacky', 'schlagbohrer', false),
    ('Stavba', 'vrtacky', 'wiertarka', false),
    ('Stavba', 'vrtacky', 'wkretarka', false),
    ('Stavba', 'vrtacky', 'mlotowiertarka', false),
    ('Stavba', 'pily-brusky', 'kotoucova pila', true),
    ('Stavba', 'pily-brusky', 'primocara pila', true),
    ('Stavba', 'pily-brusky', 'uhlova bruska', true),
    ('Stavba', 'pily-brusky', 'bruska', false),
    ('Stavba', 'pily-brusky', 'flexa', false),
    ('Stavba', 'pily-brusky', 'circular saw', true),
    ('Stavba', 'pily-brusky', 'angle grinder', true),
    ('Stavba', 'pily-brusky', 'jigsaw', false),
    ('Stavba', 'pily-brusky', 'orbital sander', true),
    ('Stavba', 'pily-brusky', 'kreissage', false),
    ('Stavba', 'pily-brusky', 'winkelschleifer', false),
    ('Stavba', 'pily-brusky', 'stichsage', false),
    ('Stavba', 'pily-brusky', 'szlifierka', false),
    ('Stavba', 'pily-brusky', 'pila tarczowa', true),
    ('Stavba', 'pily-brusky', 'wyrzynarka', false),
    ('Stavba', 'merici-technika', 'krizovy laser', true),
    ('Stavba', 'merici-technika', 'nivelacni pristroj', true),
    ('Stavba', 'merici-technika', 'laserovy dalkomer', true),
    ('Stavba', 'merici-technika', 'laserove meradlo', true),
    ('Stavba', 'merici-technika', 'merici pristroj', true),
    ('Stavba', 'merici-technika', 'laser level', true),
    ('Stavba', 'merici-technika', 'laser distance meter', true),
    ('Stavba', 'merici-technika', 'laser measurer', true),
    ('Stavba', 'merici-technika', 'kreuzlinienlaser', false),
    ('Stavba', 'merici-technika', 'laserentfernungsmesser', false),
    ('Stavba', 'merici-technika', 'nivelliergerat', false),
    ('Stavba', 'merici-technika', 'poziomica laserowa', true),
    ('Stavba', 'merici-technika', 'dalmierz laserowy', true),
    ('Stavba', 'zebriky-leseni', 'zebrik', false),
    ('Stavba', 'zebriky-leseni', 'stafle', false),
    ('Stavba', 'zebriky-leseni', 'leseni', false),
    ('Stavba', 'zebriky-leseni', 'rebrik', false),
    ('Stavba', 'zebriky-leseni', 'ladder', false),
    ('Stavba', 'zebriky-leseni', 'scaffolding', false),
    ('Stavba', 'zebriky-leseni', 'step ladder', true),
    ('Stavba', 'zebriky-leseni', 'leiter', false),
    ('Stavba', 'zebriky-leseni', 'gerust', false),
    ('Stavba', 'zebriky-leseni', 'stehleiter', false),
    ('Stavba', 'zebriky-leseni', 'drabina', false),
    ('Stavba', 'zebriky-leseni', 'rusztowanie', false),
    ('Stavba', 'betonovani-bourani', 'michacka', false),
    ('Stavba', 'betonovani-bourani', 'bouraci kladivo', true),
    ('Stavba', 'betonovani-bourani', 'vibracni deska', true),
    ('Stavba', 'betonovani-bourani', 'betonarka', false),
    ('Stavba', 'betonovani-bourani', 'concrete mixer', true),
    ('Stavba', 'betonovani-bourani', 'demolition hammer', true),
    ('Stavba', 'betonovani-bourani', 'plate compactor', true),
    ('Stavba', 'betonovani-bourani', 'betonmischer', false),
    ('Stavba', 'betonovani-bourani', 'abbruchhammer', false),
    ('Stavba', 'betonovani-bourani', 'ruttelplatte', false),
    ('Stavba', 'betonovani-bourani', 'betoniarka', false),
    ('Stavba', 'betonovani-bourani', 'mlot wyburzeniowy', true),
    ('Stavba', 'betonovani-bourani', 'zageszczarka', false),
    ('Hobby', 'foto-video', 'fotoaparat', false),
    ('Hobby', 'foto-video', 'fotak', false),
    ('Hobby', 'foto-video', 'kamera', false),
    ('Hobby', 'foto-video', 'objektiv', false),
    ('Hobby', 'foto-video', 'foto stativ', true),
    ('Hobby', 'foto-video', 'fotograficky stativ', true),
    ('Hobby', 'foto-video', 'digital camera', true),
    ('Hobby', 'foto-video', 'camera lens', true),
    ('Hobby', 'foto-video', 'dslr camera', true),
    ('Hobby', 'foto-video', 'camcorder', false),
    ('Hobby', 'foto-video', 'fotoapparat', false),
    ('Hobby', 'foto-video', 'fotokamera', false),
    ('Hobby', 'foto-video', 'kamera objektiv', true),
    ('Hobby', 'foto-video', 'aparat fotograficzny', true),
    ('Hobby', 'foto-video', 'obiektyw', false),
    ('Hobby', 'foto-video', 'statyw fotograficzny', true),
    ('Hobby', 'hudebni-nastroje', 'kytara', false),
    ('Hobby', 'hudebni-nastroje', 'klavesy', false),
    ('Hobby', 'hudebni-nastroje', 'bici souprava', true),
    ('Hobby', 'hudebni-nastroje', 'housle', false),
    ('Hobby', 'hudebni-nastroje', 'hudebni klavesy', true),
    ('Hobby', 'hudebni-nastroje', 'guitar', false),
    ('Hobby', 'hudebni-nastroje', 'drum kit', true),
    ('Hobby', 'hudebni-nastroje', 'violin', false),
    ('Hobby', 'hudebni-nastroje', 'keyboard piano', true),
    ('Hobby', 'hudebni-nastroje', 'gitarre', false),
    ('Hobby', 'hudebni-nastroje', 'schlagzeug', false),
    ('Hobby', 'hudebni-nastroje', 'geige', false),
    ('Hobby', 'hudebni-nastroje', 'gitara', false),
    ('Hobby', 'hudebni-nastroje', 'perkusja', false),
    ('Hobby', 'hudebni-nastroje', 'skrzypce', false),
    ('Hobby', 'sport-fitness', 'cinky', false),
    ('Hobby', 'sport-fitness', 'bezecky pas', true),
    ('Hobby', 'sport-fitness', 'lyze', false),
    ('Hobby', 'sport-fitness', 'snowboard', false),
    ('Hobby', 'sport-fitness', 'posilovaci lavice', true),
    ('Hobby', 'sport-fitness', 'dumbbells', false),
    ('Hobby', 'sport-fitness', 'treadmill', false),
    ('Hobby', 'sport-fitness', 'skis', false),
    ('Hobby', 'sport-fitness', 'weight bench', true),
    ('Hobby', 'sport-fitness', 'hanteln', false),
    ('Hobby', 'sport-fitness', 'laufband', false),
    ('Hobby', 'sport-fitness', 'fitnessbank', false),
    ('Hobby', 'sport-fitness', 'narty', false),
    ('Hobby', 'sport-fitness', 'bieznia', false),
    ('Hobby', 'sport-fitness', 'hantle', false),
    ('Hobby', 'sport-fitness', 'silownia', false),
    ('Hobby', 'kempovani', 'turisticky stan', true),
    ('Hobby', 'kempovani', 'kempingovy stan', true),
    ('Hobby', 'kempovani', 'spacak', false),
    ('Hobby', 'kempovani', 'karimatka', false),
    ('Hobby', 'kempovani', 'camping tent', true),
    ('Hobby', 'kempovani', 'sleeping bag', true),
    ('Hobby', 'kempovani', 'camping mat', true),
    ('Hobby', 'kempovani', 'campingzelt', false),
    ('Hobby', 'kempovani', 'schlafsack', false),
    ('Hobby', 'kempovani', 'isomatte', false),
    ('Hobby', 'kempovani', 'namiot turystyczny', true),
    ('Hobby', 'kempovani', 'spiwor', false),
    ('Hobby', 'kempovani', 'karimata', false),
    ('Párty', 'ozvuceni', 'reproduktor', false),
    ('Párty', 'ozvuceni', 'mikrofon', false),
    ('Párty', 'ozvuceni', 'mixazni pult', true),
    ('Párty', 'ozvuceni', 'ozvucovaci system', true),
    ('Párty', 'ozvuceni', 'sound system', true),
    ('Párty', 'ozvuceni', 'pa speaker', true),
    ('Párty', 'ozvuceni', 'microphone', false),
    ('Párty', 'ozvuceni', 'audio mixer', true),
    ('Párty', 'ozvuceni', 'lautsprecher', false),
    ('Párty', 'ozvuceni', 'mischpult', false),
    ('Párty', 'ozvuceni', 'glosnik', false),
    ('Párty', 'ozvuceni', 'mikser audio', true),
    ('Párty', 'ozvuceni', 'kolumna glosnikowa', true),
    ('Párty', 'osvetleni-efekty', 'disco svetla', true),
    ('Párty', 'osvetleni-efekty', 'laserovy efekt', true),
    ('Párty', 'osvetleni-efekty', 'vyrobnik mlhy', true),
    ('Párty', 'osvetleni-efekty', 'svetelna show', true),
    ('Párty', 'osvetleni-efekty', 'party lights', true),
    ('Párty', 'osvetleni-efekty', 'fog machine', true),
    ('Párty', 'osvetleni-efekty', 'stage lights', true),
    ('Párty', 'osvetleni-efekty', 'nebelmaschine', false),
    ('Párty', 'osvetleni-efekty', 'partybeleuchtung', false),
    ('Párty', 'osvetleni-efekty', 'lichteffekte', false),
    ('Párty', 'osvetleni-efekty', 'wytwornica dymu', true),
    ('Párty', 'osvetleni-efekty', 'swiatla dyskotekowe', true),
    ('Párty', 'osvetleni-efekty', 'efekty swietlne', true),
    ('Párty', 'stany-pristresky', 'party stan', true),
    ('Párty', 'stany-pristresky', 'nuzkovy stan', true),
    ('Párty', 'stany-pristresky', 'party pristresek', true),
    ('Párty', 'stany-pristresky', 'altan', false),
    ('Párty', 'stany-pristresky', 'party tent', true),
    ('Párty', 'stany-pristresky', 'event tent', true),
    ('Párty', 'stany-pristresky', 'event marquee', true),
    ('Párty', 'stany-pristresky', 'pavillon', false),
    ('Párty', 'stany-pristresky', 'partyzelt', false),
    ('Párty', 'stany-pristresky', 'faltenzelt', false),
    ('Párty', 'stany-pristresky', 'namiot imprezowy', true),
    ('Párty', 'stany-pristresky', 'pawilon ogrodowy', true),
    ('Párty', 'stoly-zidle', 'pivni set', true),
    ('Párty', 'stoly-zidle', 'skladaci stul', true),
    ('Párty', 'stoly-zidle', 'banketova zidle', true),
    ('Párty', 'stoly-zidle', 'party zidle', true),
    ('Párty', 'stoly-zidle', 'folding table', true),
    ('Párty', 'stoly-zidle', 'banquet chair', true),
    ('Párty', 'stoly-zidle', 'beer table set', true),
    ('Párty', 'stoly-zidle', 'bierzeltgarnitur', false),
    ('Párty', 'stoly-zidle', 'klapptisch', false),
    ('Párty', 'stoly-zidle', 'bankettstuhl', false),
    ('Párty', 'stoly-zidle', 'stol skladany', true),
    ('Párty', 'stoly-zidle', 'krzeslo bankietowe', true),
    ('Párty', 'gastro-vycep', 'vycepni zarizeni', true),
    ('Párty', 'gastro-vycep', 'pipa', false),
    ('Párty', 'gastro-vycep', 'popcornovac', false),
    ('Párty', 'gastro-vycep', 'vycep piva', true),
    ('Párty', 'gastro-vycep', 'beer tap', true),
    ('Párty', 'gastro-vycep', 'keg tap', true),
    ('Párty', 'gastro-vycep', 'popcorn machine', true),
    ('Párty', 'gastro-vycep', 'zapfanlage', false),
    ('Párty', 'gastro-vycep', 'popcornmaschine', false),
    ('Párty', 'gastro-vycep', 'bierzapfanlage', false),
    ('Párty', 'gastro-vycep', 'nalewak do piwa', true),
    ('Párty', 'gastro-vycep', 'maszyna do popcornu', true),
    ('Ostatní', 'kancelar-prezentace', 'projektor', false),
    ('Ostatní', 'kancelar-prezentace', 'projekcni platno', true),
    ('Ostatní', 'kancelar-prezentace', 'flipchart', false),
    ('Ostatní', 'kancelar-prezentace', 'dataprojektor', false),
    ('Ostatní', 'kancelar-prezentace', 'presentation projector', true),
    ('Ostatní', 'kancelar-prezentace', 'projection screen', true),
    ('Ostatní', 'kancelar-prezentace', 'beamer', false),
    ('Ostatní', 'kancelar-prezentace', 'projektionsleinwand', false),
    ('Ostatní', 'kancelar-prezentace', 'flipchart tafel', true),
    ('Ostatní', 'kancelar-prezentace', 'rzutnik', false),
    ('Ostatní', 'kancelar-prezentace', 'ekran projekcyjny', true),
    ('Ostatní', 'detske-vybaveni', 'kocarek', false),
    ('Ostatní', 'detske-vybaveni', 'detska postylka', true),
    ('Ostatní', 'detske-vybaveni', 'nositko', false),
    ('Ostatní', 'detske-vybaveni', 'detska zidlicka', true),
    ('Ostatní', 'detske-vybaveni', 'stroller', false),
    ('Ostatní', 'detske-vybaveni', 'baby cot', true),
    ('Ostatní', 'detske-vybaveni', 'baby carrier', true),
    ('Ostatní', 'detske-vybaveni', 'kinderwagen', false),
    ('Ostatní', 'detske-vybaveni', 'babybett', false),
    ('Ostatní', 'detske-vybaveni', 'tragehilfe', false),
    ('Ostatní', 'detske-vybaveni', 'wozek dzieciecy', true),
    ('Ostatní', 'detske-vybaveni', 'lozeczko dzieciece', true),
    ('Ostatní', 'detske-vybaveni', 'nosidelko', false),
    ('Ostatní', 'sezonni-vybaveni', 'vanocni vyzdoba', true),
    ('Ostatní', 'sezonni-vybaveni', 'snehova freza', true),
    ('Ostatní', 'sezonni-vybaveni', 'vanocni dekorace', true),
    ('Ostatní', 'sezonni-vybaveni', 'christmas decorations', true),
    ('Ostatní', 'sezonni-vybaveni', 'snow blower', true),
    ('Ostatní', 'sezonni-vybaveni', 'weihnachtsdekoration', false),
    ('Ostatní', 'sezonni-vybaveni', 'schneefrase', false),
    ('Ostatní', 'sezonni-vybaveni', 'dekoracje swiateczne', true),
    ('Ostatní', 'sezonni-vybaveni', 'odsniezarka', false),
    ('Ostatní', 'sezonni-vybaveni', 'vianocna vyzdoba', true)
), scores AS (
  SELECT rules.slug,
    count(*) FILTER (WHERE strpos(input.title, ' ' || rules.phrase || ' ') > 0) AS title_hits,
    count(*) FILTER (WHERE rules.strong AND strpos(input.description, ' ' || rules.phrase || ' ') > 0) AS description_hits
  FROM rules CROSS JOIN input
  WHERE rules.category = p_category
  GROUP BY rules.slug
), title_winners AS (
  SELECT slug FROM scores WHERE title_hits > 0
), title_vote AS (
  SELECT count(*) AS n, min(slug) AS winner FROM title_winners
), tie_vote AS (
  SELECT count(*) AS n, min(s.slug) AS winner
  FROM scores s JOIN title_winners w ON w.slug = s.slug
  WHERE s.description_hits > 0
), description_vote AS (
  SELECT count(*) AS n, min(slug) AS winner
  FROM scores WHERE description_hits >= 2
)
SELECT CASE
  WHEN title_vote.n = 1 THEN title_vote.winner
  WHEN title_vote.n > 1 AND tie_vote.n = 1 THEN tie_vote.winner
  WHEN title_vote.n = 0 AND description_vote.n = 1 THEN description_vote.winner
  ELSE NULL
END
FROM title_vote CROSS JOIN tie_vote CROSS JOIN description_vote;
$sql$;

-- Allowed manual overrides, including manual-only Ostatni/jine.
CREATE FUNCTION public.seo19b2_valid(p_category text, p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $sql$
  SELECT (p_category, p_slug) IN (
    VALUES
    ('Domácnost', 'uklid'),
    ('Domácnost', 'kuchynske-pristroje'),
    ('Domácnost', 'domaci-spotrebice'),
    ('Domácnost', 'vybaveni-domacnosti'),
    ('Zahrada', 'sekacky'),
    ('Zahrada', 'krovinorezy-pily'),
    ('Zahrada', 'kultivatory'),
    ('Zahrada', 'cerpadla'),
    ('Stavba', 'vrtacky'),
    ('Stavba', 'pily-brusky'),
    ('Stavba', 'merici-technika'),
    ('Stavba', 'zebriky-leseni'),
    ('Stavba', 'betonovani-bourani'),
    ('Hobby', 'foto-video'),
    ('Hobby', 'hudebni-nastroje'),
    ('Hobby', 'sport-fitness'),
    ('Hobby', 'kempovani'),
    ('Párty', 'ozvuceni'),
    ('Párty', 'osvetleni-efekty'),
    ('Párty', 'stany-pristresky'),
    ('Párty', 'stoly-zidle'),
    ('Párty', 'gastro-vycep'),
    ('Ostatní', 'kancelar-prezentace'),
    ('Ostatní', 'detske-vybaveni'),
    ('Ostatní', 'sezonni-vybaveni'),
    ('Ostatní', 'jine')
  );
$sql$;

-- Adding a STORED generated column computes legacy records inside the DDL;
-- unlike UPDATE public.offers, it does not fire business/moderation UPDATE
-- triggers, modify offer timestamps, or touch reservations and payments.
ALTER TABLE public.offers
  ADD COLUMN subcategory_slug text
  GENERATED ALWAYS AS (public.seo19b2_classify(category, name, description)) STORED;

-- Optional manual override, restricted to SQL Editor owner. Normal users
-- cannot edit the generated column or create/alter an override.
CREATE TABLE public.seo19b2_subcategory_overrides (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
  category text NOT NULL,
  slug text NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT seo19b2_valid_manual_slug CHECK (public.seo19b2_valid(category, slug))
);
CREATE TABLE public.seo19b2_override_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id uuid NOT NULL,
  category text NOT NULL,
  previous_slug text,
  new_slug text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  db_session_user text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.seo19b2_subcategory_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo19b2_override_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seo19b2_subcategory_overrides,
  public.seo19b2_override_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.seo19b2_override_events_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.seo19b2_prevent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $plpgsql$
BEGIN
  RAISE EXCEPTION 'SEO 19B2: override audit is append-only' USING ERRCODE = '42501';
END;
$plpgsql$;
CREATE TRIGGER seo19b2_audit_append_only
  BEFORE UPDATE OR DELETE ON public.seo19b2_override_events
  FOR EACH ROW EXECUTE FUNCTION public.seo19b2_prevent_audit_mutation();

-- Designated PROD Supabase Owner / SQL Editor only. A NULL slug clears the
-- override and falls back to the computed classification. No client RPC.
CREATE FUNCTION public.seo19b2_admin_override(
  p_offer_id uuid, p_slug text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $plpgsql$
DECLARE v_category text; v_previous text;
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  SELECT o.category INTO v_category FROM public.offers o
  WHERE o.id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEO 19B2: unknown offer ID' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NOT NULL AND NOT public.seo19b2_valid(v_category, p_slug) THEN
    RAISE EXCEPTION 'SEO 19B2: slug incompatible with offer category'
      USING ERRCODE = '22023';
  END IF;
  SELECT x.slug INTO v_previous
  FROM public.seo19b2_subcategory_overrides x WHERE x.offer_id = p_offer_id;
  IF p_slug IS NULL THEN
    DELETE FROM public.seo19b2_subcategory_overrides WHERE offer_id = p_offer_id;
  ELSE
    INSERT INTO public.seo19b2_subcategory_overrides (offer_id, category, slug, reason, changed_at)
    VALUES (p_offer_id, v_category, p_slug, btrim(p_reason), clock_timestamp())
    ON CONFLICT (offer_id) DO UPDATE
      SET category = EXCLUDED.category, slug = EXCLUDED.slug,
          reason = EXCLUDED.reason, changed_at = EXCLUDED.changed_at;
  END IF;
  INSERT INTO public.seo19b2_override_events
    (offer_id, category, previous_slug, new_slug, reason, db_session_user)
  VALUES (p_offer_id, v_category, v_previous, p_slug, btrim(p_reason), session_user);
END;
$plpgsql$;

-- Preserve existing 15 public columns, append one safe scalar only. Keep
-- security_definer (security_invoker = false) and security_barrier from V1.
CREATE OR REPLACE VIEW public.public_offers
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id, o.owner_id, o.name, o.category, o.description, o.city,
  o.postal_code, o.price_per_day, o.status, o.photo_url,
  o.pickup_mode, o.created_at, o.updated_at, o.offer_number,
  o.min_rental_days,
  COALESCE(CASE WHEN ov.category = o.category THEN ov.slug END, o.subcategory_slug)
    AS subcategory_slug
FROM public.offers o
LEFT JOIN public.seo19b2_subcategory_overrides ov ON ov.offer_id = o.id
WHERE o.status = 'active'::public.offer_status;

REVOKE ALL ON TABLE public.public_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_offers TO anon, authenticated;

REVOKE ALL ON FUNCTION public.seo19b2_admin_override(uuid,text,text),
  public.seo19b2_prevent_audit_mutation(), public.seo19b2_valid(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
-- Ordinary user INSERT/UPDATE of offers needs EXECUTE for the STORED
-- generated expression. These helpers are immutable and read no secrets.
REVOKE ALL ON FUNCTION public.seo19b2_normalize(text),
  public.seo19b2_classify(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seo19b2_normalize(text),
  public.seo19b2_classify(text,text,text) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.offers.subcategory_slug IS
  'SEO 19B2 PROD: deterministic, stored automatic classification; cannot be client-written.';
COMMENT ON FUNCTION public.seo19b2_admin_override(uuid,text,text) IS
  'PROD only: designated Owner SQL Editor correction with an administrative reason and private audit.';
COMMIT;
