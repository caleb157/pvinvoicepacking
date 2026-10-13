// Reads an Indian Customs (ICEGATE) shipping bill PDF without any AI. The PDF has a fixed
// layout: a value sits on the row under its label, in the same column. Rows come from
// pdfRows (src/lib/remittance-pdf.ts). Anything not found stays blank for manual entry.
import { isoDate } from './remittance-pdf';

export interface ParsedShippingBill {
  sb_number: string; sb_date: string; port_code: string; invoice_no: string; invoice_date: string;
  taxable_value_inr: number | null; currency: string; consignee: string; buyer: string;
  fob_value: number | null; freight_value: number | null; insurance_value: number | null;
  ad_code: string; packages: number | null; gross_weight_kg: number | null; exchange_rate: number | null;
}

const num = (s: string | undefined) => {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Index of the first row with a cell matching `label`. */
const rowOf = (rows: string[][], label: RegExp, from = 0) => {
  for (let i = from; i < rows.length; i++) if (rows[i].some(c => label.test(c))) return i;
  return -1;
};

/** The first row below `r` that has at least `min` cells and passes `ok`. */
function valuesBelow(rows: string[][], r: number, ok: (cells: string[]) => boolean, look = 4): string[] | null {
  for (let i = r + 1; i < Math.min(rows.length, r + 1 + look); i++) if (ok(rows[i])) return rows[i];
  return null;
}

/** Name in the second column under a "NAME & ADDRESS" header pair. */
function secondColumnName(rows: string[][], label: RegExp): string {
  const r = rowOf(rows, label);
  if (r < 0) return '';
  const col = rows[r].findIndex(c => label.test(c));
  const below = rows[r + 1];
  if (!below) return '';
  return (below[col] ?? below[below.length - 1] ?? '').trim();
}

export function parseShippingBill(rows: string[][]): ParsedShippingBill {
  const out: ParsedShippingBill = {
    sb_number: '', sb_date: '', port_code: '', invoice_no: '', invoice_date: '', taxable_value_inr: null, currency: '',
    consignee: '', buyer: '', fob_value: null, freight_value: null, insurance_value: null, ad_code: '', packages: null,
    gross_weight_kg: null, exchange_rate: null,
  };

  // Header block: "Port Code | SB No | SB Date" then the values.
  const h = rowOf(rows, /^Port Code$/i);
  if (h >= 0) {
    const v = valuesBelow(rows, h, c => c.length >= 3 && /^\d{5,}$/.test(c[1]), 2);
    if (v) { out.port_code = v[0]; out.sb_number = v[1]; out.sb_date = isoDate(v[2]); }
  }

  const pkg = rows.find(r => r.includes('PKG'));
  if (pkg) {
    out.packages = num(pkg[pkg.indexOf('PKG') + 1]);
    const g = pkg.findIndex(c => /G\.?WT/i.test(c));
    if (g >= 0) out.gross_weight_kg = num(pkg[g + 1]);
  }

  const ad = rows.find(r => r.some(c => /AD CODE:?$/i.test(c)));
  if (ad) out.ad_code = (ad[ad.findIndex(c => /AD CODE:?$/i.test(c)) + 1] ?? '').trim();

  // Part I values: FOB value in INR, and the IGST value (taxable value) row.
  const ig = rowOf(rows, /IGST VALUE/i);
  if (ig >= 0) {
    const v = valuesBelow(rows, ig, c => c.length >= 3 && c.every(x => num(x) != null));
    if (v) out.taxable_value_inr = num(v[v.length - 3]);
  }
  if (out.taxable_value_inr == null) {
    const f = rowOf(rows, /^1\.FOB VALUE$/i);
    const v = f >= 0 ? valuesBelow(rows, f, c => c.length >= 2 && num(c[0]) != null) : null;
    if (v) out.taxable_value_inr = num(v[0]);
  }

  // Part II: invoice number & date, then the transaction values in the invoice currency.
  const inv = rowOf(rows, /INVOICE No\. & Dt/i);
  if (inv >= 0) {
    const v = valuesBelow(rows, inv, c => c.some(x => /^\S+\s+\d{1,2}\/\d{1,2}\/\d{4}$/.test(x)), 3);
    const cell = v?.find(x => /^\S+\s+\d{1,2}\/\d{1,2}\/\d{4}$/.test(x));
    if (cell) { const [no, dt] = cell.split(/\s+/); out.invoice_no = no; out.invoice_date = isoDate(dt); }
  }
  if (!out.invoice_no) {
    const f = rowOf(rows, /INV NO\./i);
    const v = f >= 0 ? valuesBelow(rows, f, c => c.length >= 3 && num(c[0]) != null && num(c[2]) != null, 2) : null;
    if (v) out.invoice_no = v[1];
  }
  const tx = rowOf(rows, /^1\.INVOICE VALUE$/i);
  if (tx >= 0) {
    const v = valuesBelow(rows, tx, c => c.length >= 4 && num(c[0]) != null);
    if (v) {
      out.fob_value = num(v[1]); out.freight_value = num(v[2]); out.insurance_value = num(v[3]);
      const fx = v.find(x => /^1\s+[A-Z]{3}\s+INR\s+[\d.]+$/.test(x));
      if (fx) { const p = fx.split(/\s+/); out.currency = p[1]; out.exchange_rate = num(p[3]); }
    }
  }
  if (!out.currency) {
    const f = rowOf(rows, /CURRENC/i);
    const v = f >= 0 ? valuesBelow(rows, f, c => /^[A-Z]{3}$/.test(c[c.length - 1] ?? ''), 2) : null;
    if (v) out.currency = v[v.length - 1];
  }

  out.consignee = secondColumnName(rows, /CONSIGNEE NAME & ADDRESS/i);
  out.buyer = secondColumnName(rows, /BUYER'?S NAME & ADDRESS/i);
  return out;
}

/** Tracker fields from a parsed bill (the extra details go into the comment). */
export function trackerFromBill(p: ParsedShippingBill) {
  const extra = [p.packages != null && `${p.packages} packages`, p.gross_weight_kg != null && `${p.gross_weight_kg} kg gross`,
    p.exchange_rate != null && `rate ${p.exchange_rate}`].filter(Boolean).join(', ');
  return {
    row: {
      sb_number: p.sb_number, sb_date: p.sb_date, port_code: p.port_code, invoice_no: p.invoice_no, invoice_date: p.invoice_date,
      taxable_value_inr: p.taxable_value_inr, currency: p.currency, consignee: p.consignee, buyer: p.buyer,
      fob_value: p.fob_value, freight_value: p.freight_value, insurance_value: p.insurance_value,
    } as Record<string, string | number | null>,
    note: extra,
  };
}

/** Only the fields that are still empty on an existing row, so typed values are never overwritten. */
export function fillEmpty(existing: Record<string, unknown>, incoming: Record<string, string | number | null>) {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || v === '') continue;
    const cur = existing[k];
    if (cur == null || cur === '') out[k] = v;
  }
  return out;
}
