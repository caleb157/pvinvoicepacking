// What goes on the carton labels and the letters (Non-DG, Export Value Declaration, Wooden
// Declaration). Everything comes from the saved document set so the letters always match the
// invoice and packing list. Pure, so it is tested without drawing anything.
import { ExportDocData, cartonLabels, packingTotals } from './export-docs';

export const WOOD_SPECIES = ['Mango', 'Acacia', 'Teak', 'Oak'] as const;

/** Letterhead text (from the May 2024 Parable letterhead). */
export const LETTERHEAD = {
  company: 'PARABLE VENTURES PRIVATE LIMITED',
  lines: ['CIN: U74110DL2021PTC376324', 'GSTIN: 08AAFCH6385K1Z1'],
  small: [
    'REGISTERED ADDRESS: 2-A/3 S/F FRONT PORTION STIRRING MINDS KUNDAN MANSION ASAF ALI RD, TURKMAN GT., NEW DELHI, INDIA, 110002',
    'FACTORY ADDRESS: 33 UDYOG NAGAR, BASNI PHASE II, GALI NO. 10, BASNI PHASE 2, JODHPUR, INDIA 342005',
    'E-MAIL: caleb@parable-ventures.com',
    'CONTACT NO.: +91 78273 81480',
  ],
  footer: [
    'Parable Ventures Private Limited',
    'REGISTERED ADDRESS: 2-A/3 S/F FRONT PORTION STIRRING MINDS KUNDAN MANSION ASAF ALI RD, TURKMAN GT., NEW DELHI, INDIA, 110002',
  ],
};

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** Distinct label names in packing-list order. */
export const productNames = (doc: Pick<ExportDocData, 'packing'>) =>
  joinAnd([...new Set(doc.packing.map(p => (p.labelDescription || p.description).trim()).filter(Boolean))]);

/** "13 Oct 2026" style date for letters ('' stays ''). */
export function letterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

const kg = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} KG`;

/** Why the labels and letters can't be made yet ('' when they can). */
export function notReady(doc: ExportDocData): string {
  if (doc.isDraft) return 'Labels and letters need a posted invoice. Open the invoice instead of the sales order.';
  if (!doc.invoiceNo || !doc.invoiceDate) return 'The invoice number and date are missing.';
  if (!doc.packing.length) return 'The packing list is empty.';
  if (doc.packing.some(p => !(p.unitsPerPackage > 0))) return 'Every packing row needs units per package.';
  if (doc.packing.some(p => !(p.netWeightKg > 0) || !(p.grossWeightKg > 0))) return 'Every packing row needs net and gross weight (0 kg is not accepted).';
  return '';
}

export interface LabelData {
  customerSku: string; customerPo: string; invoiceNo: string; description: string; qty: number;
  netKg: number; grossKg: number; size: string; origin: string; carton: number; total: number;
}

/** One A5 label per carton, numbered across the shipment. */
export function labelData(doc: ExportDocData): LabelData[] {
  return cartonLabels(doc.packing).map(c => ({
    customerSku: c.row.customerSku, customerPo: doc.buyerOrderNo, invoiceNo: doc.invoiceNo,
    description: c.row.labelDescription || c.row.description, qty: c.unitsInCarton,
    netKg: c.row.netWeightKg, grossKg: c.row.grossWeightKg,
    size: c.row.packageDims ? `${c.row.packageDims} in` : '', origin: doc.countryOfOrigin || 'India',
    carton: c.carton, total: c.total,
  }));
}

export function nonDgRows(doc: ExportDocData, signatory: { name: string; title: string }): [string, string][] {
  const t = packingTotals(doc.packing);
  const s = doc.shipper;
  return [
    ['NO. OF PACKAGES', String(t.packages)],
    ['PRODUCT NAME', productNames(doc)],
    ['GROSS WEIGHT', kg(t.grossWeightKg)],
    ['NET WEIGHT', kg(t.netWeightKg)],
    ['DESTINATION', doc.countryOfFinalDestination],
    ['CONSIGNEE ADDRESS', [doc.consignee.name, ...doc.consignee.lines].filter(Boolean).join(', ')],
    ['AWB NO.', ''],
    ['NOTIFY ADDRESS', [s.name, ...s.lines].filter(Boolean).join(', ')],
    ['NAME', signatory.name],
    ['DESIGNATION', signatory.title],
  ];
}

/** Related party: the buyer (bill-to) is Desert Kingdom Traders. */
export const isRelatedBuyer = (doc: Pick<ExportDocData, 'buyer' | 'consignee'>) =>
  /desert\s*kingdom/i.test((doc.buyer ?? doc.consignee).name);

/** Odoo incoterm and payment terms; older saved sets only have the combined "FOB Jodhpur, 50% advance". */
export function evdTerms(doc: ExportDocData): { payment: string; delivery: string } {
  if (doc.incoterm || doc.paymentTerms) return { payment: doc.paymentTerms || '', delivery: doc.incoterm || '' };
  const [delivery, ...rest] = doc.termsOfDelivery.split(',');
  return { payment: rest.join(',').trim(), delivery: (delivery || '').trim() };
}

export function woodText(doc: ExportDocData): string {
  const species = joinAnd(doc.woodSpecies ?? []).toUpperCase();
  const country = doc.countryOfFinalDestination || 'the destination country';
  return `We hereby declare that we are sending wooden items to consignee in the ${country} under our Invoice no. ${doc.invoiceNo} `
    + `dated ${letterDate(doc.invoiceDate)} and confirming that we have used ${species || '[WOOD SPECIES]'} WOOD in this shipment, `
    + 'which is not a prohibited item.';
}
