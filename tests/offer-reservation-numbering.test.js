"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20261009130000_add_offer_and_reservation_numbers.sql"),
  "utf8"
);

function functionSql(name) {
  const start = `create function public.${name}()`;
  const startIndex = sql.indexOf(start);
  assert.notEqual(startIndex, -1, name + " must be defined");
  const endIndex = sql.indexOf("$function$;", startIndex);
  assert.notEqual(endIndex, -1, name + " must be closed");
  return sql.slice(startIndex, endIndex + "$function$;".length);
}

test("numbering migration backfills both existing tables in one atomic operation", () => {
  assert.match(sql, /^--[\s\S]*?\nbegin;/i);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /alter table public\.offers\s+add column offer_number text/i);
  assert.match(sql, /alter table public\.reservations\s+add column reservation_number text/i);

  for (const table of ["offers", "reservations"]) {
    assert.match(sql, new RegExp(`row_number\\(\\) over \\(order by created_at, id\\)[\\s\\S]*?from public\\.${table}`, "i"));
  }
  assert.match(sql, /update public\.offers as o\s+set offer_number = 'N-'/i);
  assert.match(sql, /update public\.reservations as r\s+set reservation_number = 'R-'/i);
  assert.match(sql, /setval\(\s*'public\.rentulo_offer_number_seq'::regclass,\s*greatest\(\(select count\(\*\) from public\.offers\), 1\),\s*exists \(select 1 from public\.offers\)/i);
  assert.match(sql, /setval\(\s*'public\.rentulo_reservation_number_seq'::regclass,\s*greatest\(\(select count\(\*\) from public\.reservations\), 1\),\s*exists \(select 1 from public\.reservations\)/i);
});

test("numbering references are unique, mandatory, and use independent never-cycling sequences", () => {
  assert.match(sql, /create sequence public\.rentulo_offer_number_seq\s+as bigint start with 1 increment by 1 no cycle;/i);
  assert.match(sql, /create sequence public\.rentulo_reservation_number_seq\s+as bigint start with 1 increment by 1 no cycle;/i);
  assert.match(sql, /alter table public\.offers\s+alter column offer_number set not null,\s+add constraint offers_offer_number_key unique \(offer_number\),\s+add constraint offers_offer_number_format check \(offer_number ~ '\^N-\[0-9\]\{6,\}\$'\)/i);
  assert.match(sql, /alter table public\.reservations\s+alter column reservation_number set not null,\s+add constraint reservations_reservation_number_key unique \(reservation_number\),\s+add constraint reservations_reservation_number_format check \(reservation_number ~ '\^R-\[0-9\]\{6,\}\$'\)/i);
  assert.match(sql, /greatest\(6, length\(v_next::text\)\)/i, "numbers above 999999 must not be truncated");
});

test("both references are assigned server-side and cannot be replaced on update", () => {
  for (const [kind, prefix, column, sequence] of [
    ["offer", "N-", "offer_number", "rentulo_offer_number_seq"],
    ["reservation", "R-", "reservation_number", "rentulo_reservation_number_seq"]
  ]) {
    const fn = functionSql(`assign_and_protect_${kind}_number`);
    assert.match(fn, /security definer\s+set search_path to ''/i);
    assert.match(fn, /if tg_op = 'INSERT' then/i);
    assert.match(fn, new RegExp(`nextval\\('public\\.${sequence}'::regclass\\)`, "i"));
    assert.match(fn, new RegExp(`new\\.${column} := '${prefix}' \\|\\| lpad\\(`, "i"));
    assert.match(fn, new RegExp(`elsif new\\.${column} is distinct from old\\.${column} then`, "i"));
    assert.match(fn, /raise exception .* using errcode = '23514'/i);
    assert.match(sql, new RegExp(`before insert or update on public\\.${kind === "offer" ? "offers" : "reservations"}\\s+for each row execute function public\\.assign_and_protect_${kind}_number\\(\\)`, "i"));
    assert.match(sql, new RegExp(`revoke all on sequence public\\.${sequence}\\s+from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.assign_and_protect_${kind}_number\\(\\)\\s+from public, anon, authenticated`, "i"));
  }
});

test("public offer reader and private reservation RPC expose reference numbers safely", () => {
  assert.match(sql, /create or replace view public\.public_offers\s+with \(security_invoker = false, security_barrier = true\)/i);
  assert.match(sql, /offer_number\s+from public\.offers\s+where status = 'active'::public\.offer_status/i);
  assert.match(sql, /revoke all on table public\.public_offers from public, anon, authenticated;\s+grant select on table public\.public_offers to anon, authenticated;/i);
  const publicOfferView = sql.split("create or replace view public.public_offers")[1].split("revoke all on table public.public_offers")[0];
  assert.doesNotMatch(publicOfferView, /pickup_street|pickup_phone|renter_email|renter_phone/i);

  assert.match(sql, /drop function public\.get_my_reservations\(\);\s+create function public\.get_my_reservations\(\)/i);
  const reader = functionSql("get_my_reservations");
  assert.match(reader, /photo_url text,\s+reservation_number text,\s+offer_number text\s*\)/i);
  assert.match(reader, /coalesce\(o\.photo_url, ''\) as photo_url,\s+r\.reservation_number,\s+o\.offer_number/i);
  assert.match(reader, /left join public\.offers o\s+on o\.id = r\.offer_id/i);
  assert.match(reader, /where auth\.uid\(\) is not null\s+and \(\s+r\.owner_id = auth\.uid\(\)\s+or r\.renter_id = auth\.uid\(\)/i);
  assert.match(sql, /revoke all on function public\.get_my_reservations\(\) from anon;/i);
  assert.match(sql, /grant execute on function public\.get_my_reservations\(\) to authenticated;/i);
  assert.doesNotMatch(sql, /grant execute on function public\.get_my_reservations\(\) to anon;/i);
});
