// Commercial Invoice & Packing List: the numbers behind both documents.
// Mirrors the formulas in the INV262700015 spreadsheets exactly:
//   FOB value USD  = qty × FOB price
//   FOB value INR  = FOB value USD × customs exchange rate
//   FOB IGST INR   = FOB value INR × IGST rate
//   Invoice value  = FOB value (IGST is paid and refunded, not added to the invoice)
//   Packages       = qty ÷ units per package; weights and CBM are per package × packages.
// The invoice currency is whatever the Odoo document uses (fields keep the "Usd" name).
// Invoice lines and packing rows are separate: the packing list can split a line over
// several carton sizes, and its case numbers always run 1..N across the rows.
// Everything here is pure so the page, the Excel, the PDFs and the labels can never disagree.

export const ICEGATE_RATES_URL = 'https://foservices.icegate.gov.in/#/services/notifyPublishScreen';
export const CUBIC_INCH_TO_M3 = 0.0000163871;

export interface ExportParty {
  name: string;
  lines: string[];       // address lines, last one the country
  contact: string;
  email: string;
  phone: string;
}

export interface ExportShipper extends ExportParty {
  gstNumber: string;
}

export interface ExportLine {
  sku: string;            // product code shown: the customer SKU (Odoo variant tag), else ours
  internalSku: string;    // our Odoo internal reference
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  fobPriceUsd: number;
  igstRatePct: number;    // 18 = 18%; 0 on an LUT invoice
}

/** One packing list row. A line can be split over several rows (e.g. 100 in boxes of 20 + 10 in one box). */
export interface PackRow {
  sku: string;              // product code shown (same rule as the invoice)
  internalSku: string;
  customerSku: string;      // for the carton label; blank when the product has no variant tag
  description: string;
  labelDescription: string; // short name for labels and the Non-DG letter
  quantity: number;
  unitsPerPackage: number;
  packageDims: string;      // "20 x 20 x 20" inches
  packageKind: string;
  netWeightKg: number;      // per package
  grossWeightKg: number;    // per package
  unitGrossKg: number;      // Odoo product weight (average gross per piece); 0 when Odoo has none
  grossManual: boolean;     // gross typed by hand, so it no longer follows units × Odoo weight
}

export type TaxMode = 'igst' | 'lut';

export interface ExportDocData {
  invoiceNo: string;
  invoiceDate: string;           // YYYY-MM-DD
  exporterRef: string;           // PAN / IEC
  buyerOrderNo: string;
  buyerOrderDate: string;
  billOfLading: string;
  otherReferences: string;
  shipper: ExportShipper;
  consignee: ExportParty;
  buyer: ExportParty | null;     // null = same as consignee
  preCarriageBy: string;
  vesselFlightNo: string;
  portOfDischarge: string;
  countryOfOrigin: string;
  countryOfFinalDestination: string;
  placeOfReceipt: string;
  portOfLoading: string;
  finalDestination: string;
  termsOfDelivery: string;       // "FOB Jodhpur, 50% Advance and 50% on BOL"
  handlingInformation: string;
  currency: string;              // invoice currency from Odoo, e.g. USD
  taxMode: TaxMode;              // IGST paid, or export under LUT without IGST
  lutArn: string;
  isDraft: boolean;              // built from a sales order (no invoice yet)
  exchangeRate: number;          // INR per unit of currency (customs rate)
  notificationNo: string;
  shippingInr: number;
  shippingIgstInr: number;
  signatoryCompany: string;
  signatoryName: string;
  lines: ExportLine[];
  packing: PackRow[];
  incoterm?: string;             // "FOB" (from Odoo), for the Export Value Declaration
  paymentTerms?: string;         // Odoo payment terms, for the Export Value Declaration
  woodSpecies?: string[];        // for the Wooden Declaration, e.g. ['Mango', 'Acacia']
  hdfc?: HdfcInputs;             // typed parts of the HDFC export regularization letter
}

export interface HdfcInputs {
  letterDate: string;            // YYYY-MM-DD
  purposeCode: string;           // e.g. "P0103 - Advance receipts against export contracts"
  exportType: 'REGULAR' | 'WAREHOUSE' | 'PROJECT EXPORT';
  lcNo: string; lcDate: string; lcAmount: string; issuingBank: string; tenor: string;
  documentsAgainst: string;
  remark: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceLineCalc {
  fobValueUsd: number;
  fobValueInr: number;
  fobIgstInr: number;
  invoiceValueInr: number;
  invoiceValueUsd: number;
}

/** IGST rate used on the documents: the line's rate, or 0 on an LUT invoice. */
export const igstPct = (line: ExportLine, taxMode: TaxMode = 'igst') => (taxMode === 'lut' ? 0 : line.igstRatePct || 0);

export function invoiceLine(line: ExportLine, rate: number, taxMode: TaxMode = 'igst'): InvoiceLineCalc {
  const fobValueUsd = line.quantity * line.fobPriceUsd;
  const fobValueInr = fobValueUsd * rate;
  const fobIgstInr = fobValueInr * (igstPct(line, taxMode) / 100);
  return { fobValueUsd, fobValueInr, fobIgstInr, invoiceValueInr: fobValueInr, invoiceValueUsd: fobValueUsd };
}

export interface InvoiceTotals {
  quantity: number;
  fobValueUsd: number;
  fobValueInr: number;
  fobIgstInr: number;
  invoiceValueInr: number;
  invoiceValueUsd: number;
  shippingInr: number;
  shippingIgstInr: number;
  totalIgstInr: number;
}

export function invoiceTotals(doc: Pick<ExportDocData, 'lines' | 'exchangeRate' | 'shippingInr' | 'shippingIgstInr'> & { taxMode?: TaxMode }): InvoiceTotals {
  const t = { quantity: 0, fobValueUsd: 0, fobValueInr: 0, fobIgstInr: 0, invoiceValueInr: 0, invoiceValueUsd: 0 };
  for (const l of doc.lines) {
    const c = invoiceLine(l, doc.exchangeRate, doc.taxMode);
    t.quantity += l.quantity;
    t.fobValueUsd += c.fobValueUsd;
    t.fobValueInr += c.fobValueInr;
    t.fobIgstInr += c.fobIgstInr;
    t.invoiceValueInr += c.invoiceValueInr;
    t.invoiceValueUsd += c.invoiceValueUsd;
  }
  return {
    ...t,
    shippingInr: doc.shippingInr || 0,
    shippingIgstInr: doc.taxMode === 'lut' ? 0 : doc.shippingIgstInr || 0,
    totalIgstInr: t.fobIgstInr + (doc.taxMode === 'lut' ? 0 : doc.shippingIgstInr || 0),
  };
}

/** Package volume in m³ from "W x D x H" inches; null when it can't be read. */
export function packageCbm(dims: string): number | null {
  const parts = String(dims || '').toLowerCase().split('x').map(s => Number(s.trim()));
  if (parts.length !== 3 || parts.some(n => !isFinite(n) || n <= 0)) return null;
  return parts[0] * parts[1] * parts[2] * CUBIC_INCH_TO_M3;
}

export const formatDims = (w: number, d: number, h: number) =>
  [w, d, h].map(n => String(round2(n))).join(' x ');

export interface PackingLineCalc {
  packages: number;
  cartonRange: string;    // "1 to 20" or "66"
  cbmPerPackage: number | null;
}

type Packable = Pick<PackRow, 'quantity' | 'unitsPerPackage' | 'packageDims' | 'netWeightKg' | 'grossWeightKg'>;

/** Package count per row (whole packages) and the running case & carton numbers. */
export function packingLines(lines: Packable[]): PackingLineCalc[] {
  let next = 1;
  return lines.map(l => {
    const per = l.unitsPerPackage > 0 ? l.unitsPerPackage : 0;
    const packages = per > 0 && l.quantity > 0 ? Math.ceil(l.quantity / per - 1e-9) : 0;
    const from = next;
    const to = next + packages - 1;
    next += packages;
    const cartonRange = packages <= 0 ? '' : packages === 1 ? String(from) : `${from} to ${to}`;
    return { packages, cartonRange, cbmPerPackage: packageCbm(l.packageDims) };
  });
}

export interface PackingTotals {
  quantity: number;
  packages: number;
  netWeightKg: number;
  grossWeightKg: number;
  cbm: number;
}

export function packingTotals(lines: Packable[]): PackingTotals {
  const calc = packingLines(lines);
  const t = { quantity: 0, packages: 0, netWeightKg: 0, grossWeightKg: 0, cbm: 0 };
  lines.forEach((l, i) => {
    const n = calc[i].packages;
    t.quantity += l.quantity;
    t.packages += n;
    t.netWeightKg += n * (l.netWeightKg || 0);
    t.grossWeightKg += n * (l.grossWeightKg || 0);
    t.cbm += n * (calc[i].cbmPerPackage || 0);
  });
  return t;
}

// ---------- amount in words ----------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? ` ${ONES[r % 10]}` : ''));
  else if (r) parts.push(ONES[r]);
  return parts.join(' ');
}

export function numberToWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const scales = ['', 'Thousand', 'Million', 'Billion'];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(under1000(chunk) + (scales[i] ? ` ${scales[i]}` : ''));
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(' ');
}

const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  USD: ['Dollar', 'Dollars', 'Cent', 'Cents'], CAD: ['Canadian Dollar', 'Canadian Dollars', 'Cent', 'Cents'],
  AUD: ['Australian Dollar', 'Australian Dollars', 'Cent', 'Cents'], EUR: ['Euro', 'Euros', 'Cent', 'Cents'],
  GBP: ['Pound', 'Pounds', 'Penny', 'Pence'], INR: ['Rupee', 'Rupees', 'Paisa', 'Paise'],
};

/** "Three Thousand Eight Hundred Ninety Nine Dollars and Ninety One Cents" (or Euros, Pounds, ...) */
export function amountInWords(amount: number, currency = 'USD'): string {
  const [one, many, subOne, subMany] = CURRENCY_WORDS[currency.toUpperCase()] ?? [currency, currency, 'Cent', 'Cents'];
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const c = cents % 100;
  const d = `${numberToWords(whole)} ${whole === 1 ? one : many}`;
  return c ? `${d} and ${numberToWords(c)} ${c === 1 ? subOne : subMany}` : d;
}
export const usdInWords = (amount: number) => amountInWords(amount, 'USD');

// ---------- helpers for pre-filling ----------

/** PAN (characters 3–12 of a GSTIN), which is also the exporter's IEC. */
export function panFromGstin(gstin: string | null | undefined): string {
  const g = String(gstin || '').trim().toUpperCase();
  return /^\d{2}[A-Z0-9]{10}/.test(g) ? g.slice(2, 12) : '';
}

/** Odoo partner → the address block lines used on both documents. */
export function partnerLines(p: { street?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string } | null | undefined): string[] {
  if (!p) return [];
  const cityLine = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [p.street, p.street2, cityLine, p.country].map(s => (s || '').trim()).filter(Boolean);
}

export interface PackingDefaults {
  unitsPerPackage: number;
  packageDims: string;
  packageKind: string;
  netWeightKg: number;
  grossWeightKg: number;
}

/** Short item name for carton labels and the Non-DG letter: the part before the first "/",
 *  plus anything in brackets elsewhere ("Ashtray with Cork / 5 x 5 x 5 inch / with cork (Mango)"
 *  → "Ashtray with Cork (Mango)"). "(Box of 20)" style notes are left out. */
export function labelDescription(description: string): string {
  const text = String(description || '').replace(/^\[[^\]]*\]\s*/, '').trim();
  const first = text.split('/')[0].trim();
  const extras = [...text.matchAll(/\(([^()]*)\)/g)]
    .map(m => m[0].trim())
    .filter(p => !/^\(\s*box of/i.test(p) && !first.includes(p));
  return [first, ...new Set(extras)].filter(Boolean).join(' ');
}

/** Gross weight of one package from the Odoo per-piece gross weight. */
export const grossFromUnits = (unitGrossKg: number, units: number) => round2((unitGrossKg || 0) * (units || 0));

/** A packing row for an invoice line, pre-filled from what was used last time for that SKU. */
export function packRowFromLine(
  line: ExportLine, opts: { customerSku: string; unitGrossKg: number; remembered?: PackingDefaults | null },
): PackRow {
  const r = opts.remembered;
  const units = r?.unitsPerPackage || 0;
  const gross = opts.unitGrossKg > 0 && units > 0 ? grossFromUnits(opts.unitGrossKg, units) : (r?.grossWeightKg || 0);
  return {
    sku: line.sku, internalSku: line.internalSku, customerSku: opts.customerSku,
    description: line.description, labelDescription: labelDescription(line.description),
    quantity: line.quantity, unitsPerPackage: units, packageDims: r?.packageDims || '', packageKind: r?.packageKind || 'Carton',
    netWeightKg: r?.netWeightKg || 0, grossWeightKg: gross, unitGrossKg: opts.unitGrossKg || 0,
    grossManual: !(opts.unitGrossKg > 0) && gross > 0,
  };
}

/** Packing quantities that don't add up to the invoice, per product. */
export function packingMismatches(lines: ExportLine[], packing: PackRow[]): { key: string; invoice: number; packed: number }[] {
  const key = (x: { internalSku: string; sku: string; description: string }) => x.internalSku || x.sku || x.description;
  const inv = new Map<string, number>();
  const packed = new Map<string, number>();
  for (const l of lines) inv.set(key(l), (inv.get(key(l)) ?? 0) + (l.quantity || 0));
  for (const p of packing) packed.set(key(p), (packed.get(key(p)) ?? 0) + (p.quantity || 0));
  const keys = new Set([...inv.keys(), ...packed.keys()]);
  return [...keys].map(k => ({ key: k, invoice: inv.get(k) ?? 0, packed: packed.get(k) ?? 0 }))
    .filter(m => Math.abs(m.invoice - m.packed) > 1e-9);
}

/** Rows where the quantity isn't a whole number of packages (the last carton is part-full). */
export const unevenRows = (packing: PackRow[]) =>
  packing.map((p, i) => ({ p, i })).filter(({ p }) => p.unitsPerPackage > 0 && p.quantity > 0 && Math.abs(p.quantity / p.unitsPerPackage - Math.round(p.quantity / p.unitsPerPackage)) > 1e-9);

/** One entry per carton, numbered across the whole shipment ("3 of 12"), for the A5 labels. */
export function cartonLabels(packing: PackRow[]) {
  const calc = packingLines(packing);
  const total = calc.reduce((t, c) => t + c.packages, 0);
  const out: { carton: number; total: number; row: PackRow; unitsInCarton: number }[] = [];
  let n = 0;
  packing.forEach((row, i) => {
    let left = row.quantity;
    for (let k = 0; k < calc[i].packages; k++) {
      const units = Math.min(row.unitsPerPackage, left);
      left -= units;
      out.push({ carton: ++n, total, row, unitsInCarton: units });
    }
  });
  return out;
}

/** Line under the INVOICE title: IGST paid, or export under LUT (with its ARN). */
export function invoiceBanner(doc: Pick<ExportDocData, 'taxMode' | 'lutArn'>): string {
  if (doc.taxMode === 'lut') {
    return `** SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX${doc.lutArn ? ` (LUT ARN ${doc.lutArn})` : ''} **`;
  }
  return '** SUPPLY MEANT FOR EXPORT UPON PAYMENT OF INTEGRATED TAX **';
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
