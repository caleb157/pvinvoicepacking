// Data for the app: the Odoo invoice (read live through /api/odoo), the customs
// exchange rate, packing details remembered per SKU and saved document sets
// (the app's own database through /api/data), and building the document.
import {
  ExportDocData, ExportLine, ExportParty, PackingDefaults, packingFromOdoo, panFromGstin, partnerLines,
} from './export-docs';

export class ApiError extends Error {
  constructor(message: string, public status: number, public missingTables = false) { super(message); }
}

async function call<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    if (res.status === 401) window.dispatchEvent(new Event('ip:signed-out'));
    throw new ApiError(String(data?.error || `Request failed (${res.status})`), res.status, !!data?.missingTables);
  }
  return data as T;
}

// ---------- sign-in ----------

export interface AppUser { name: string; login: string }
export const whoAmI = () => call<{ user: AppUser | null }>('/api/auth').then(r => r.user);
export const login = (login: string, password: string) =>
  call<{ user: AppUser }>('/api/auth', { body: { action: 'login', login, password } }).then(r => r.user);
export const logout = () => call('/api/auth', { body: { action: 'logout' } });

// ---------- Odoo ----------

export interface OdooInvoiceSummary {
  id: number; name: string; date: string | null; customer: string; amount_total: number; currency: string; origin: string; ref: string;
}
export interface OdooPartner {
  name: string; contact: string; street: string; street2: string; city: string; state: string; zip: string;
  country: string; vat: string; phone: string; email: string;
}
export interface OdooPackaging { units: number; dims_in: number[] | null; empty_kg: number; name: string }
export interface OdooInvoice {
  invoice: {
    id: number; name: string; date: string | null; currency: string; origin: string; ref: string;
    buyer_order_no: string; buyer_order_date: string | null; sale_order: string | null; incoterm: string; payment_terms: string;
    amount_untaxed: number; amount_tax: number; amount_total: number;
    buyer: OdooPartner | null; consignee: OdooPartner | null; company: OdooPartner | null;
  };
  lines: {
    product_id: number | null; sku: string; product_name: string; description: string; quantity: number; uom: string;
    price_unit: number; subtotal: number; hsn_code: string | null; igst_rate: number | null;
    odoo_weight_kg: number | null; odoo_volume_m3: number | null; packaging: OdooPackaging | null;
  }[];
}

export const listOdooInvoices = (search: string) =>
  call<{ invoices: OdooInvoiceSummary[] }>('/api/odoo', { body: { action: 'list', search: search || null, limit: 50 } }).then(r => r.invoices);

export const getOdooInvoice = (id: number) => call<OdooInvoice>('/api/odoo', { body: { action: 'get', invoice_id: id } });

// ---------- the app's own data ----------

export interface CustomsRate {
  id: string; currency: string; rate: number; notification_no: string | null; effective_from: string; created_at: string;
}
export interface SavedExportDoc {
  id: string; invoice_no: string; odoo_invoice_id: number | null; exchange_rate: number | null; total_usd: number | null;
  created_by: string | null; created_at: string;
}
export interface PackingProfile {
  sku: string; units_per_package: number | null; package_dims_in: string | null; package_kind: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
}

export const loadInit = () => call<{ rate: CustomsRate | null; history: SavedExportDoc[] }>('/api/data', { body: { action: 'init' } });

export const saveCustomsRate = (r: { currency: string; rate: number; notification_no: string; effective_from: string; source_url: string }) =>
  call('/api/data', { body: { action: 'save-rate', ...r } });

export const getSavedDoc = (id: string) =>
  call<{ payload: ExportDocData; odoo_invoice_id: number | null }>('/api/data', { body: { action: 'get-doc', id } });

/** Packing pre-fill per SKU: what was used last time, else the Odoo product's packaging. */
export async function packingDefaults(inv: OdooInvoice): Promise<Record<string, PackingDefaults>> {
  const out: Record<string, PackingDefaults> = {};
  const skus = [...new Set(inv.lines.map(l => l.sku).filter(Boolean))];
  if (skus.length) {
    try {
      const { profiles } = await call<{ profiles: PackingProfile[] }>('/api/data', { body: { action: 'packing', skus } });
      for (const p of profiles) {
        out[p.sku] = {
          unitsPerPackage: Number(p.units_per_package || 0), packageDims: p.package_dims_in || '', packageKind: p.package_kind || 'Carton',
          netWeightKg: Number(p.net_weight_kg || 0), grossWeightKg: Number(p.gross_weight_kg || 0),
        };
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.missingTables)) throw e;
    }
  }
  for (const l of inv.lines) {
    if (!l.sku || out[l.sku]) continue;
    const d = packingFromOdoo(l.odoo_weight_kg, l.packaging);
    if (d) out[l.sku] = d;
  }
  return out;
}

const packingRows = (lines: ExportLine[]): PackingProfile[] =>
  lines.filter(l => l.sku && (l.unitsPerPackage || l.packageDims)).map(l => ({
    sku: l.sku, units_per_package: l.unitsPerPackage || null, package_dims_in: l.packageDims || null,
    package_kind: l.packageKind || null, net_weight_kg: l.netWeightKg || null, gross_weight_kg: l.grossWeightKg || null,
  }));

/** Saves a copy of the set and remembers its packing details per SKU; returns the refreshed history. */
export const saveDoc = (doc: ExportDocData, meta: { odooInvoiceId: number | null; totalUsd: number }) =>
  call<{ history: SavedExportDoc[] }>('/api/data', {
    body: {
      action: 'save-doc', invoice_no: doc.invoiceNo, odoo_invoice_id: meta.odooInvoiceId, exchange_rate: doc.exchangeRate,
      notification_no: doc.notificationNo || null, total_usd: meta.totalUsd, payload: doc, packing: packingRows(doc.lines),
    },
  }).then(r => r.history);

// ---------- building the document from Odoo ----------

/** The shipper is the Odoo company that issued the invoice; its VAT is the GSTIN. */
export function shipperFromCompany(c: OdooPartner | null, contact: string) {
  return {
    name: c?.name || '', lines: partnerLines(c), contact,
    email: c?.email || '', phone: c?.phone || '', gstNumber: c?.vat || '',
  };
}

function toParty(p: OdooPartner | null): ExportParty {
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

export function docFromOdoo(
  inv: OdooInvoice,
  opts: {
    contact: string; packing: Record<string, PackingDefaults>; shipping: ShippingDefaults;
    rate: number; notificationNo: string; signatoryName: string;
  },
): ExportDocData {
  const i = inv.invoice;
  const shipper = shipperFromCompany(i.company, opts.contact);
  const consignee = toParty(i.consignee ?? i.buyer);
  const buyer = toParty(i.buyer);
  const sameParty = !i.buyer || !i.consignee || (buyer.name === consignee.name && buyer.lines.join('|') === consignee.lines.join('|'));
  const destCountry = i.consignee?.country || i.buyer?.country || '';
  const finalDest = i.consignee ? [i.consignee.city, i.consignee.state, i.consignee.country].filter(Boolean).join(', ') : '';
  // Odoo's incoterm reads "[FOB] FREE ON BOARD"; the documents use the code + place of loading.
  const incoterm = (/^\[(\w+)\]/.exec(i.incoterm || '')?.[1] ?? i.incoterm ?? '').trim();
  const fromOdoo = [incoterm && opts.shipping.placeOfReceipt ? `${incoterm} ${opts.shipping.placeOfReceipt}` : incoterm, i.payment_terms]
    .filter(Boolean).join(', ');
  const terms = fromOdoo || opts.shipping.termsOfDelivery;
  return {
    invoiceNo: i.name, invoiceDate: i.date || '', exporterRef: panFromGstin(shipper.gstNumber),
    buyerOrderNo: i.buyer_order_no || '', buyerOrderDate: '', billOfLading: '', otherReferences: '',
    shipper, consignee, buyer: sameParty ? null : buyer,
    preCarriageBy: opts.shipping.preCarriageBy, vesselFlightNo: '', portOfDischarge: opts.shipping.portOfDischarge,
    countryOfOrigin: opts.shipping.countryOfOrigin, countryOfFinalDestination: destCountry === 'United States' ? 'United States of America' : destCountry,
    placeOfReceipt: opts.shipping.placeOfReceipt, portOfLoading: opts.shipping.portOfLoading, finalDestination: finalDest,
    termsOfDelivery: terms, handlingInformation: '',
    exchangeRate: opts.rate, notificationNo: opts.notificationNo, shippingInr: 0, shippingIgstInr: 0,
    signatoryCompany: shipper.name, signatoryName: opts.signatoryName,
    lines: inv.lines.map(l => {
      const p = opts.packing[l.sku];
      return {
        sku: l.sku, description: (l.description || l.product_name).replace(/^\[[^\]]*\]\s*/, ''), hsnCode: l.hsn_code || '', quantity: l.quantity,
        uom: !l.uom || /^units?$/i.test(l.uom) ? 'Units' : l.uom, fobPriceUsd: l.price_unit, igstRatePct: l.igst_rate ?? 0,
        unitsPerPackage: p?.unitsPerPackage ?? 0, packageDims: p?.packageDims ?? '', packageKind: p?.packageKind ?? 'Carton',
        netWeightKg: p?.netWeightKg ?? 0, grossWeightKg: p?.grossWeightKg ?? 0,
      };
    }),
  };
}
