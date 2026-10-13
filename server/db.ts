// The app's own database (Neon Postgres, added from Vercel → Storage): users, settings,
// customs rates, packing details per SKU, saved shipments, the shipping bill tracker and
// inward remittances. Tables come from sql/setup.sql, run by hand.
import { neon } from '@neondatabase/serverless';

let client: ReturnType<typeof neon> | null = null;
export function sql() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('No database connected. In Vercel, open Storage and connect a Neon Postgres database to this project.');
  return (client ??= neon(url));
}
const rowsOf = (r: unknown) => r as any[];

// ---------- settings ----------

export interface AppSettings {
  lutArn: string; lutFrom: string; lutTo: string; adCode: string; signatoryName: string; signatoryTitle: string;
}
export const DEFAULT_SETTINGS: AppSettings = {
  lutArn: '', lutFrom: '', lutTo: '', adCode: '', signatoryName: 'Parker Hoye', signatoryTitle: 'Director',
};

export async function getSettings(): Promise<AppSettings> {
  const rows = rowsOf(await sql()`select key, value from app_settings`);
  const out: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out;
}

export async function saveSettings(s: Partial<AppSettings>, by: string) {
  for (const [k, v] of Object.entries(s)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    await sql()`insert into app_settings (key, value, updated_by, updated_at) values (${k}, ${JSON.stringify(v)}::jsonb, ${by}, now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  }
}

// ---------- customs rate ----------

export async function latestRate(currency = 'USD') {
  const rows = rowsOf(await sql()`select id, currency, rate::float8 as rate, notification_no, effective_from::text as effective_from, created_at
    from customs_exchange_rates where currency = ${currency}
    order by effective_from desc, created_at desc limit 1`);
  return rows[0] ?? null;
}

export async function saveRate(r: { currency: string; rate: number; notification_no: string; effective_from: string; source_url: string }, by: string) {
  await sql()`insert into customs_exchange_rates (currency, rate, notification_no, effective_from, source_url, created_by)
    values (${r.currency}, ${r.rate}, ${r.notification_no || null}, ${r.effective_from}, ${r.source_url}, ${by})`;
}

// ---------- packing details per SKU ----------

export interface PackingRow {
  sku: string; units_per_package: number | null; package_dims_in: string | null; package_kind: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
}

export async function packingProfiles(skus: string[]) {
  if (!skus.length) return [];
  return rowsOf(await sql()`select sku, units_per_package::float8 as units_per_package, package_dims_in, package_kind,
      net_weight_kg::float8 as net_weight_kg, gross_weight_kg::float8 as gross_weight_kg
    from export_packing_profiles where sku = any(${skus})`);
}

export async function savePackingProfiles(rows: PackingRow[], by: string) {
  for (const r of rows) {
    await sql()`insert into export_packing_profiles (sku, units_per_package, package_dims_in, package_kind, net_weight_kg, gross_weight_kg, updated_by, updated_at)
      values (${r.sku}, ${r.units_per_package}, ${r.package_dims_in}, ${r.package_kind}, ${r.net_weight_kg}, ${r.gross_weight_kg}, ${by}, now())
      on conflict (sku) do update set units_per_package = excluded.units_per_package, package_dims_in = excluded.package_dims_in,
        package_kind = excluded.package_kind, net_weight_kg = excluded.net_weight_kg, gross_weight_kg = excluded.gross_weight_kg,
        updated_by = excluded.updated_by, updated_at = now()`;
  }
}

// ---------- shipments (saved document sets) ----------

export async function listShipments(limit = 30) {
  return rowsOf(await sql()`select id, source_kind, source_name, odoo_id, invoice_no, updated_by, updated_at
    from shipments order by updated_at desc limit ${limit}`);
}

export async function getShipment(kind: string, name: string) {
  const rows = rowsOf(await sql()`select id, source_kind, source_name, odoo_id, payload, updated_by, updated_at
    from shipments where source_kind = ${kind} and source_name = ${name}`);
  return rows[0] ?? null;
}

export async function saveShipment(s: { source_kind: string; source_name: string; odoo_id: number | null; invoice_no: string | null; payload: unknown }, by: string) {
  await sql()`insert into shipments (source_kind, source_name, odoo_id, invoice_no, payload, updated_by, updated_at)
    values (${s.source_kind}, ${s.source_name}, ${s.odoo_id}, ${s.invoice_no}, ${JSON.stringify(s.payload)}::jsonb, ${by}, now())
    on conflict (source_kind, source_name) do update set odoo_id = excluded.odoo_id, invoice_no = excluded.invoice_no,
      payload = excluded.payload, updated_by = excluded.updated_by, updated_at = now()`;
}

// ---------- tracker tables (shipping bills, inward remittances) ----------

type ColKind = 'text' | 'date' | 'num' | 'int';
export const TABLES: Record<'shipping_bills' | 'inward_remittances', Record<string, ColKind>> = {
  shipping_bills: {
    sb_number: 'text', sb_date: 'date', port_code: 'text', invoice_no: 'text', invoice_date: 'date', odoo_invoice_id: 'int',
    taxable_value_inr: 'num', currency: 'text', consignee: 'text', buyer: 'text', fob_value: 'num', freight_value: 'num',
    insurance_value: 'num', transport_doc_no: 'text', transport_doc_date: 'date', ebrc_date: 'date', bank_submitted_date: 'date',
    bank_status: 'text', status: 'text', comments: 'text',
  },
  inward_remittances: {
    remittance_no: 'text', value_date: 'date', currency: 'text', fcy_amount: 'num', exchange_rate: 'num', inr_amount: 'num',
    remitter: 'text', remitting_bank: 'text', purpose_code: 'text', comments: 'text',
  },
};
export type TrackerTable = keyof typeof TABLES;

/** Keeps only known columns and turns each into the right type ('' → null). */
export function cleanRow(table: TrackerTable, row: Record<string, unknown>) {
  const out: Record<string, string | number | null> = {};
  for (const [col, kind] of Object.entries(TABLES[table])) {
    if (!(col in row)) continue;
    const v = row[col];
    if (v == null || v === '') { out[col] = null; continue; }
    if (kind === 'num' || kind === 'int') {
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      out[col] = Number.isFinite(n) ? (kind === 'int' ? Math.round(n) : n) : null;
    } else if (kind === 'date') {
      out[col] = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    } else out[col] = String(v).slice(0, 2000);
  }
  return out;
}

function selectCols(table: TrackerTable) {
  return Object.entries(TABLES[table]).map(([c, k]) =>
    k === 'date' ? `${c}::text as ${c}` : k === 'num' ? `${c}::float8 as ${c}` : c).join(', ');
}

export async function listRows(table: TrackerTable) {
  const order = table === 'shipping_bills' ? 'sb_date desc nulls first, created_at desc' : 'value_date desc nulls first, created_at desc';
  return rowsOf(await sql().query(`select id, ${selectCols(table)}, updated_by, updated_at from ${table} order by ${order}`));
}

export async function insertRow(table: TrackerTable, row: Record<string, unknown>, by: string) {
  const r = cleanRow(table, row);
  const cols = Object.keys(r);
  const names = [...cols, 'created_by', 'updated_by'];
  const rows = rowsOf(await sql().query(
    `insert into ${table} (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})
     returning id, ${selectCols(table)}, updated_by, updated_at`, [...cols.map(c => r[c]), by, by]));
  return rows[0];
}

export async function updateRow(table: TrackerTable, id: string, row: Record<string, unknown>, by: string) {
  const r = cleanRow(table, row);
  const cols = Object.keys(r);
  const sets = [...cols.map((c, i) => `${c} = $${i + 1}`), `updated_by = $${cols.length + 1}`, 'updated_at = now()'];
  const rows = rowsOf(await sql().query(
    `update ${table} set ${sets.join(', ')} where id = $${cols.length + 2}
     returning id, ${selectCols(table)}, updated_by, updated_at`, [...cols.map(c => r[c]), by, id]));
  return rows[0] ?? null;
}

export async function deleteRow(table: TrackerTable, id: string) {
  await sql().query(`delete from ${table} where id = $1`, [id]);
}

// ---------- remittance allocations (amount of a remittance used against an invoice) ----------

export async function listAllocations() {
  return rowsOf(await sql()`select remittance_id, invoice_no, amount::float8 as amount from remittance_allocations order by invoice_no`);
}

/** Replaces this invoice's allocations; refuses to use more of a remittance than it has left. */
export async function setAllocations(invoiceNo: string, items: { remittance_id: string; amount: number }[], by: string) {
  const ids = [...new Set(items.map(i => i.remittance_id))];
  if (ids.length !== items.length) throw new Error('A remittance is listed twice.');
  if (ids.length) {
    const rows = rowsOf(await sql()`select r.id, r.remittance_no, coalesce(r.fcy_amount, 0)::float8 as total,
        coalesce((select sum(a.amount) from remittance_allocations a where a.remittance_id = r.id and a.invoice_no <> ${invoiceNo}), 0)::float8 as used
      from inward_remittances r where r.id = any(${ids})`);
    for (const i of items) {
      const r = rows.find(x => x.id === i.remittance_id);
      if (!r) throw new Error('A picked remittance no longer exists.');
      if (i.amount > r.total - r.used + 0.005) {
        throw new Error(`${r.remittance_no || 'A remittance'} only has ${Math.max(0, r.total - r.used).toFixed(2)} left (the rest is used on other invoices).`);
      }
    }
  }
  await sql()`delete from remittance_allocations where invoice_no = ${invoiceNo}`;
  for (const i of items) {
    await sql()`insert into remittance_allocations (remittance_id, invoice_no, amount, updated_by) values (${i.remittance_id}, ${invoiceNo}, ${i.amount}, ${by})`;
  }
}
