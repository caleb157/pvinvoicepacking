// Commercial Invoice & Packing List: the numbers behind both documents.
// Mirrors the formulas in the INV262700015 spreadsheets exactly:
//   FOB value USD  = qty × FOB price
//   FOB value INR  = FOB value USD × customs exchange rate
//   FOB IGST INR   = FOB value INR × IGST rate
//   Invoice value  = FOB value (IGST is paid and refunded, not added to the invoice)
//   Packages       = qty ÷ units per package; weights and CBM are per package × packages.
// Everything here is pure so the page, the Excel and the PDF can never disagree.

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
  sku: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  fobPriceUsd: number;
  igstRatePct: number;    // 18 = 18%
  unitsPerPackage: number;
  packageDims: string;    // "20 x 20 x 20" inches
  packageKind: string;    // "Carton"
  netWeightKg: number;    // per package
  grossWeightKg: number;  // per package
}

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
  exchangeRate: number;          // INR per USD
  notificationNo: string;
  shippingInr: number;
  shippingIgstInr: number;
  signatoryCompany: string;
  signatoryName: string;
  lines: ExportLine[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceLineCalc {
  fobValueUsd: number;
  fobValueInr: number;
  fobIgstInr: number;
  invoiceValueInr: number;
  invoiceValueUsd: number;
}

export function invoiceLine(line: ExportLine, rate: number): InvoiceLineCalc {
  const fobValueUsd = line.quantity * line.fobPriceUsd;
  const fobValueInr = fobValueUsd * rate;
  const fobIgstInr = fobValueInr * (line.igstRatePct / 100);
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

export function invoiceTotals(doc: Pick<ExportDocData, 'lines' | 'exchangeRate' | 'shippingInr' | 'shippingIgstInr'>): InvoiceTotals {
  const t = { quantity: 0, fobValueUsd: 0, fobValueInr: 0, fobIgstInr: 0, invoiceValueInr: 0, invoiceValueUsd: 0 };
  for (const l of doc.lines) {
    const c = invoiceLine(l, doc.exchangeRate);
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
    shippingIgstInr: doc.shippingIgstInr || 0,
    totalIgstInr: t.fobIgstInr + (doc.shippingIgstInr || 0),
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

/** Package count per line (whole packages) and the running case & carton numbers. */
export function packingLines(lines: ExportLine[]): PackingLineCalc[] {
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

export function packingTotals(lines: ExportLine[]): PackingTotals {
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

/** "Three Thousand Eight Hundred Ninety Nine Dollars and Ninety One Cents" */
export function usdInWords(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const dollars = Math.floor(cents / 100);
  const c = cents % 100;
  const d = `${numberToWords(dollars)} ${dollars === 1 ? 'Dollar' : 'Dollars'}`;
  return c ? `${d} and ${numberToWords(c)} ${c === 1 ? 'Cent' : 'Cents'}` : d;
}

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

/** Packing pre-fill from the Odoo product's packaging (the one with the most units):
 *  its package type's size in inches, net = Odoo product weight × units, gross adds
 *  the package type's empty weight. Null when the product has no packaging in Odoo. */
export function packingFromOdoo(
  productWeightKg: number | null | undefined,
  packaging: { units: number; dims_in: number[] | null; empty_kg: number } | null | undefined,
): PackingDefaults | null {
  if (!packaging || !(packaging.units > 0)) return null;
  const net = round2(Number(productWeightKg || 0) * packaging.units);
  const d = packaging.dims_in;
  return {
    unitsPerPackage: packaging.units,
    packageDims: d && d.length === 3 ? formatDims(d[0], d[1], d[2]) : '',
    packageKind: 'Carton',
    netWeightKg: net,
    grossWeightKg: net ? round2(net + Number(packaging.empty_kg || 0)) : 0,
  };
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
