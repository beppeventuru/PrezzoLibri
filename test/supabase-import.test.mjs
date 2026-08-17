import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("l'importazione Supabase verifica il proprietario ed esegue deduplica e inserimento in transazione", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260817170000_import_marketplace_comparables.sql", import.meta.url), "utf8");
  assert.match(sql, /user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /delete from public\.comparables/i);
  assert.match(sql, /insert into public\.comparables/i);
  assert.match(sql, /jsonb_agg\(to_jsonb\(c\)/i);
});

test("copertina e confronti vengono importati nella stessa chiamata RPC", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260817171500_import_marketplace_cover.sql", import.meta.url), "utf8");
  assert.match(sql, /update public\.books set cover_url/i);
  assert.match(sql, /import_marketplace_comparables\(p_book_id,p_rows\)/i);
  assert.match(sql, /jsonb_build_object\('book'/i);
});
