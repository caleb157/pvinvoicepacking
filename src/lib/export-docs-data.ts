// Client side of the app's API: sign-in, live Odoo reads (/api/odoo), the app's own data
// (/api/data, /api/tracker, /api/users), and building the document set from an Odoo
// invoice or sales order.
import {
  ExportDocData, ExportLine, ExportParty, PackingDefaults, PackRow, TaxMode, packRowFromLine, panFromGstin, partnerLines,
} from './export-docs';

export class ApiError extends Error {
  constructor(message: string, public status: number, public missingTables = false) { super(message); }
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    if (res.status === 401) window.dispatchEvent(new Event('ip:signed-out'));
    throw new ApiError(String(data?.error || `Request failed (${res.status})`), res.status, !!data?.missingTables);
  }
  return data as T;
}

// ---------- sign-in and people ----------

export interface AppUser { name: string; email: string; admin: boolean }
export const whoAmI = () => call<{ user: AppUser | null }>('/api/auth').then(r => r.user);
export const login = (email: string, password: string) =>
  call<{ user: AppUser }>('/api/auth', { action: 'login', email, password }).then(r => r.user);
export const logout = () => call('/api/auth', { action: 'logout' });

export interface UserRow { id: string; email: string; name: string; is_admin: boolean; disabled: boolean; created_at: string }
export const listUsers = () => call<{ users: UserRow[] }>('/api/users', { action: 'list' }).then(r => r.users);
export const saveUser = (u: { id?: string | null; email: string; name: string; is_admin: boolean; disabled: boolean; password?: string | null }) =>
  call<{ users: UserRow[] }>('/api/users', { action: 'save', ...u }).then(r => r.users);
export const deleteUser = (id: string) => call<{ users: UserRow[] }>('/api/users', { action: 'delete', id }).then(r => r.users);

// ---------- Odoo ----------

export type SourceKind = 'invoice' | 'order';
export interface SourceSummary {
  kind: SourceKind; id: number; name: string; date: string | null; customer: string; amount_total: number;
  currency: string; origin: string; ref: string; state: string;
}
export interface OdooPartner {
  name: string; contact: string; street: string; street2: string; city: string; state: string; zip: string;
  country: string; vat: string; phone: string; email: string;
}
export interface PartnerHit extends OdooPartner { id: number; label: string; type: string }
export interface SourceLine {
  product_id: number | null; internal_sku: string; customer_skus: string[]; product_name: string; description: string;
  quantity: number; uom: string; price_unit: number; subtotal: number; hsn_code: string | null; gst_rate: number | null;
  weight_kg: number | null; charge: 'freight' | 'insurance' | null;
}
export interface SourceDoc {
  kind: SourceKind; id: number; name: string; date: string | null; currency: string;
  sale_order: string | null; client_order_ref: string; invoice_ref: string;
  incoterm: string; payment_terms: string; amount_untaxed: number; amount_tax: number; amount_total: number;
  buyer: OdooPartner | null; consignee: OdooPartner | null; company: OdooPartner | null;
  buyer_partner_id: number | null; consignee_partner_id: number | null;
  lines: SourceLine[];
}
export interface TrackerFields {
  invoice_no: string; invoice_date: string | null; odoo_invoice_id: number; currency: string;
  consignee: string; buyer: string; fob_value: number; freight_value: number; insurance_value: number;
}

export const listSources = (kind: SourceKind, search: string) =>
  call<{ items: SourceSummary[] }>('/api/odoo', { action: 'list', kind, search: search || null, limit: 50 }).then(r => r.items);
export const getSource = (kind: SourceKind, id: number) => call<SourceDoc>('/api/odoo', { action: 'get', kind, id });
export const searchPartners = (search: string) =>
  call<{ partners: PartnerHit[] }>('/api/odoo', { action: 'partners', search }).then(r => r.partners);
export const trackerFields = (id: number) => call<TrackerFields>('/api/odoo', { action: 'tracker-fields', id });

// ---------- documents data ----------

export interface CustomsRate {
  id: string; currency: string; rate: number; notification_no: string | null; effective_from: string; created_at: string;
}
export interface ShipmentSummary {
  id: string; source_kind: SourceKind; source_name: string; odoo_id: number | null; invoice_no: string | null; updated_by: string | null; updated_at: string;
}
export interface AppSettings {
  lutArn: string; lutFrom: string; lutTo: string; adCode: string; signatoryName: string; signatoryTitle: string;
  signatureImage?: string; stampImage?: string; // PNG/JPEG data URLs printed on the letters
}
export interface PackingProfile {
  sku: string; units_per_package: number | null; package_dims_in: string | null; package_kind: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
}

export const loadInit = () =>
  call<{ rate: CustomsRate | null; shipments: ShipmentSummary[]; settings: AppSettings }>('/api/data', { action: 'init' });

export const saveCustomsRate = (r: { currency: string; rate: number; notification_no: string; effective_from: string; source_url: string }) =>
  call('/api/data', { action: 'save-rate', ...r });

export const saveSettings = (settings: Partial<AppSettings>) =>
  call<{ settings: AppSettings }>('/api/data', { action: 'save-settings', settings }).then(r => r.settings);

export const getShipment = (kind: SourceKind, name: string) =>
  call<{ shipment: { payload: ExportDocData; odoo_id: number | null; updated_by: string | null; updated_at: string } | null }>(
    '/api/data', { action: 'get-shipment', kind, name }).then(r => r.shipment);

/** Remembered packing details for these internal SKUs (empty when the tables aren't set up yet). */
export async function rememberedPacking(skus: string[]): Promise<Record<string, PackingDefaults>> {
  const out: Record<string, PackingDefaults> = {};
  const list = [...new Set(skus.filter(Boolean))];
  if (!list.length) return out;
  try {
    const { profiles } = await call<{ profiles: PackingProfile[] }>('/api/data', { action: 'packing', skus: list });
    for (const p of profiles) {
      out[p.sku] = {
        unitsPerPackage: Number(p.units_per_package || 0), packageDims: p.package_dims_in || '', packageKind: p.package_kind || 'Carton',
        netWeightKg: Number(p.net_weight_kg || 0), grossWeightKg: Number(p.gross_weight_kg || 0),
      };
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.missingTables)) throw e;
  }
  return out;
}

const packingProfileRows = (rows: PackRow[]): PackingProfile[] => {
  const seen = new Set<string>();
  return rows.filter(r => r.internalSku && (r.unitsPerPackage || r.packageDims) && !seen.has(r.internalSku) && seen.add(r.internalSku))
    .map(r => ({
      sku: r.internalSku, units_per_package: r.unitsPerPackage || null, package_dims_in: r.packageDims || null,
      package_kind: r.packageKind || null, net_weight_kg: r.netWeightKg || null, gross_weight_kg: r.grossWeightKg || null,
    }));
};

/** Saves the document set for this invoice / order and remembers packing details per SKU. */
export const saveShipment = (src: { kind: SourceKind; name: string; odooId: number | null }, doc: ExportDocData) =>
  call<{ shipments: ShipmentSummary[] }>('/api/data', {
    action: 'save-shipment', kind: src.kind, name: src.name, odoo_id: src.odooId,
    invoice_no: doc.isDraft ? null : doc.invoiceNo, payload: doc, packing: packingProfileRows(doc.packing),
  }).then(r => r.shipments);

// ---------- tracker tables ----------

export type TrackerTable = 'shipping_bills' | 'inward_remittances';
export type TrackerRow = Record<string, string | number | null> & { id: string };

export const listRows = (table: TrackerTable) => call<{ rows: TrackerRow[] }>('/api/tracker', { action: 'list', table }).then(r => r.rows);
export const insertRow = (table: TrackerTable, row: Record<string, unknown>) =>
  call<{ row: TrackerRow }>('/api/tracker', { action: 'insert', table, row }).then(r => r.row);
export const updateRow = (table: TrackerTable, id: string, row: Record<string, unknown>) =>
  call<{ row: TrackerRow }>('/api/tracker', { action: 'update', table, id, row }).then(r => r.row);
export const deleteRow = (table: TrackerTable, id: string) => call('/api/tracker', { action: 'delete', table, id });

export interface Allocation { remittance_id: string; invoice_no: string; amount: number }
export const listAllocations = () => call<{ allocations: Allocation[] }>('/api/tracker', { action: 'allocations' }).then(r => r.allocations);
export const setAllocations = (invoiceNo: string, items: { remittance_id: string; amount: number }[]) =>
  call<{ allocations: Allocation[] }>('/api/tracker', { action: 'set-allocations', invoice_no: invoiceNo, items }).then(r => r.allocations);

// ---------- building the document from Odoo ----------

export function shipperFromCompany(c: OdooPartner | null, contact: string) {
  return {
    name: c?.name || '', lines: partnerLines(c), contact,
    email: c?.email || '', phone: c?.phone || '', gstNumber: c?.vat || '',
  };
}

export function toParty(p: OdooPartner | null): ExportParty {
  return {
    name: p?.name || '', lines: partnerLines(p), contact: p?.contact && p.contact !== p.name ? p.contact : (p?.contact || ''),
    email: p?.email || '', phone: p?.phone || '',
  };
}

/** Shipping fields carried from the last document (they rarely change). */
export type ShippingDefaults = Pick<ExportDocData,
  'preCarriageBy' | 'portOfDischarge' | 'countryOfOrigin' | 'placeOfReceipt' | 'portOfLoading' | 'termsOfDelivery'>;

export const DEFAULT_SHIPPING: ShippingDefaults = {
  preCarriageBy: 'Truck', portOfDischarge: '', countryOfOrigin: 'India', placeOfReceipt: 'Jodhpur',
  portOfLoading: 'Jodhpur, India', termsOfDelivery: '',
};

/**
 * The customer SKU among a product's Odoo variant tags: a tag starting "SKU:" (the prefix is
 * dropped), else the product's only tag. With several tags and none marked "SKU:", there is no
 * customer SKU, so an unrelated tag never prints as one.
 */
export function customerSku(tags: string[]): string {
  const marked = tags.map(t => /^\s*SKU\s*[:\-]\s*(.+)$/i.exec(t)?.[1]?.trim()).find(Boolean);
  if (marked) return marked;
  return tags.length === 1 ? tags[0].trim() : '';
}

/** Product code on the documents: the customer SKU from the Odoo variant tags, else ours. */
export const productCode = (l: Pick<SourceLine, 'customer_skus' | 'internal_sku'>) => customerSku(l.customer_skus) || l.internal_sku;

export function docFromSource(
  src: SourceDoc,
  opts: {
    contact: string; remembered: Record<string, PackingDefaults>; shipping: ShippingDefaults; taxMode: TaxMode; lutArn: string;
    rate: number; notificationNo: string; signatoryName: string;
  },
): ExportDocData {
  const consignee = toParty(src.consignee ?? src.buyer);
  const buyer = toParty(src.buyer);
  const sameParty = !src.buyer || !src.consignee || (buyer.name === consignee.name && buyer.lines.join('|') === consignee.lines.join('|'));
  const destCountry = src.consignee?.country || src.buyer?.country || '';
  const finalDest = src.consignee ? [src.consignee.city, src.consignee.state, src.consignee.country].filter(Boolean).join(', ') : '';
  // Odoo's incoterm reads "[FOB] FREE ON BOARD"; the documents use the code + place of loading.
  const incoterm = (/^\[(\w+)\]/.exec(src.incoterm || '')?.[1] ?? src.incoterm ?? '').trim();
  const fromOdoo = [incoterm && opts.shipping.placeOfReceipt ? `${incoterm} ${opts.shipping.placeOfReceipt}` : incoterm, src.payment_terms]
    .filter(Boolean).join(', ');
  const shipper = shipperFromCompany(src.company, opts.contact);
  const isDraft = src.kind === 'order';
  const goods = src.lines.filter(l => !l.charge);
  const charges = src.lines.filter(l => l.charge).reduce((t, l) => t + l.subtotal, 0);
  const lines: ExportLine[] = goods.map(l => ({
    sku: productCode(l), internalSku: l.internal_sku,
    description: (l.description || l.product_name).replace(/^\[[^\]]*\]\s*/, ''), hsnCode: l.hsn_code || '', quantity: l.quantity,
    uom: !l.uom || /^units?$/i.test(l.uom) ? 'Units' : l.uom, fobPriceUsd: l.price_unit, igstRatePct: l.gst_rate ?? 0,
  }));
  const packing: PackRow[] = goods.map((l, i) => packRowFromLine(lines[i], {
    customerSku: customerSku(l.customer_skus), unitGrossKg: l.weight_kg || 0, remembered: opts.remembered[l.internal_sku] ?? null,
  }));
  return {
    invoiceNo: isDraft ? 'DRAFT' : src.name, invoiceDate: isDraft ? '' : (src.date || ''), exporterRef: panFromGstin(shipper.gstNumber),
    buyerOrderNo: src.client_order_ref || src.invoice_ref || src.sale_order || '', buyerOrderDate: '', billOfLading: '',
    otherReferences: src.sale_order && src.sale_order !== src.client_order_ref ? src.sale_order : '',
    shipper, consignee, buyer: sameParty ? null : buyer,
    preCarriageBy: opts.shipping.preCarriageBy, vesselFlightNo: '', portOfDischarge: opts.shipping.portOfDischarge,
    countryOfOrigin: opts.shipping.countryOfOrigin, countryOfFinalDestination: destCountry === 'United States' ? 'United States of America' : destCountry,
    placeOfReceipt: opts.shipping.placeOfReceipt, portOfLoading: opts.shipping.portOfLoading, finalDestination: finalDest,
    termsOfDelivery: fromOdoo || opts.shipping.termsOfDelivery, handlingInformation: '',
    currency: src.currency || 'USD', taxMode: opts.taxMode, lutArn: opts.lutArn, isDraft,
    exchangeRate: opts.rate, notificationNo: opts.notificationNo,
    shippingInr: Math.round(charges * opts.rate * 100) / 100, shippingIgstInr: 0,
    signatoryCompany: shipper.name, signatoryName: opts.signatoryName,
    lines, packing, incoterm, paymentTerms: src.payment_terms || '', woodSpecies: [],
  };
}
