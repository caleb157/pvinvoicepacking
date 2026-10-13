// The app's own small database (Neon Postgres, added from Vercel → Storage):
// customs exchange rates, packing details remembered per SKU, and a copy of every
// generated document set. Tables come from sql/setup.sql, run once by hand.
import { neon } from '@neondatabase/serverless';

export const MISSING_TABLES_MSG =
  'The app database is not set up yet. Run sql/setup.sql in the Neon SQL editor, then reload.';

function sql() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('No database connected. In Vercel, open Storage and connect a Neon Postgres database to this project.');
  return neon(url);
}

export const isMissingTable = (e: any) => e?.code === '42P01' || /relation .* does not exist/i.test(String(e?.message));

export async function latestRate(currency = 'USD') {
  const rows = await sql()`select id, currency, rate::float8 as rate, notification_no, effective_from::text as effective_from, created_at
    from customs_exchange_rates where currency = ${currency}
    order by effective_from desc, created_at desc limit 1`;
  return rows[0] ?? null;
}

export async function saveRate(r: { currency: string; rate: number; notification_no: string; effective_from: string; source_url: string }, by: string) {
  await sql()`insert into customs_exchange_rates (currency, rate, notification_no, effective_from, source_url, created_by)
    values (${r.currency}, ${r.rate}, ${r.notification_no || null}, ${r.effective_from}, ${r.source_url}, ${by})`;
}

export async function packingProfiles(skus: string[]) {
  if (!skus.length) return [];
  return sql()`select sku, units_per_package::float8 as units_per_package, package_dims_in, package_kind,
      net_weight_kg::float8 as net_weight_kg, gross_weight_kg::float8 as gross_weight_kg
    from export_packing_profiles where sku = any(${skus})`;
}

export interface PackingRow {
  sku: string; units_per_package: number | null; package_dims_in: string | null; package_kind: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
}

export async function savePackingProfiles(rows: PackingRow[], by: string) {
  const q = sql();
  for (const r of rows) {
    await q`insert into export_packing_profiles (sku, units_per_package, package_dims_in, package_kind, net_weight_kg, gross_weight_kg, updated_by, updated_at)
      values (${r.sku}, ${r.units_per_package}, ${r.package_dims_in}, ${r.package_kind}, ${r.net_weight_kg}, ${r.gross_weight_kg}, ${by}, now())
      on conflict (sku) do update set units_per_package = excluded.units_per_package, package_dims_in = excluded.package_dims_in,
        package_kind = excluded.package_kind, net_weight_kg = excluded.net_weight_kg, gross_weight_kg = excluded.gross_weight_kg,
        updated_by = excluded.updated_by, updated_at = now()`;
  }
}

export async function listDocs(limit = 20) {
  return sql()`select id, invoice_no, odoo_invoice_id, exchange_rate::float8 as exchange_rate, total_usd::float8 as total_usd, created_by, created_at
    from export_documents order by created_at desc limit ${limit}`;
}

export async function getDoc(id: string) {
  const rows = await sql()`select payload, odoo_invoice_id from export_documents where id = ${id}`;
  return rows[0] ?? null;
}

export async function saveDoc(d: { invoice_no: string; odoo_invoice_id: number | null; exchange_rate: number; notification_no: string | null; total_usd: number; payload: unknown }, by: string) {
  await sql()`insert into export_documents (invoice_no, odoo_invoice_id, exchange_rate, notification_no, total_usd, payload, created_by)
    values (${d.invoice_no}, ${d.odoo_invoice_id}, ${d.exchange_rate}, ${d.notification_no}, ${d.total_usd}, ${JSON.stringify(d.payload)}::jsonb, ${by})`;
}
