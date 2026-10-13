// Odoo access for the app's server functions. Everything is read live over Odoo's
// JSON-RPC with one API key kept in Vercel environment variables; nothing is copied.
//   listInvoices: recent posted customer invoices (for the picker)
//   getInvoice:   one invoice with lines, addresses, the sales order's customer
//                 reference, HSN code / IGST rate and packaging per Odoo product
//   signIn:       checks a person's own Odoo login (internal users only)

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const ODOO_URL = () => env('ODOO_URL').replace(/\/+$/, '');
const ODOO_DB = () => env('ODOO_DB', 'parableventures');

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  if (!ODOO_URL()) throw new Error('ODOO_URL is not set in the Vercel environment variables.');
  const res = await fetch(`${ODOO_URL()}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const data: any = await res.json();
  if (data.error) throw new Error(data.error?.data?.message || data.error?.message || 'Odoo error');
  return data.result;
}

let uid: number | null = null;
async function kw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<any> {
  if (!uid) {
    uid = await rpc('common', 'authenticate', [ODOO_DB(), env('ODOO_USERNAME'), env('ODOO_API_KEY'), {}]);
    if (!uid) throw new Error('Odoo login failed: check ODOO_USERNAME and ODOO_API_KEY in Vercel.');
  }
  return rpc('object', 'execute_kw', [ODOO_DB(), uid, env('ODOO_API_KEY'), model, method, args, kwargs]);
}

const fieldCache: Record<string, Set<string>> = {};
async function fieldsOf(model: string) {
  if (!fieldCache[model]) fieldCache[model] = new Set(Object.keys((await kw(model, 'fields_get', [], { attributes: ['type'] })) || {}));
  return fieldCache[model];
}
/** search_read that only asks for fields this Odoo version has. */
async function sr(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}): Promise<any[]> {
  const avail = await fieldsOf(model);
  return (await kw(model, 'search_read', [domain], { fields: fields.filter(f => avail.has(f)), ...extra })) as any[];
}

const id = (v: any) => (Array.isArray(v) ? v[0] : v || null);
const nm = (v: any) => (Array.isArray(v) ? v[1] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const str = (v: any) => (v == null || v === false ? '' : String(v));

// ---------- sign-in ----------

/** Checks a person's own Odoo login (password or API key). Only internal users get in. */
export async function signIn(login: string, password: string): Promise<{ uid: number; name: string; login: string } | null> {
  const userUid = await rpc('common', 'authenticate', [ODOO_DB(), login, password, {}]);
  if (!userUid) return null;
  const [u] = await sr('res.users', [['id', '=', userUid]], ['name', 'login', 'share']);
  if (!u || u.share) return null;
  return { uid: userUid, name: str(u.name), login: str(u.login) };
}

// ---------- invoices ----------

export interface OdooInvoiceSummary {
  id: number; name: string; date: string | null; customer: string; amount_total: number; currency: string; origin: string; ref: string;
}

export async function listInvoices(search: string | null, limit = 50): Promise<OdooInvoiceSummary[]> {
  const domain: unknown[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  const q = search?.trim();
  if (q) domain.push('|', '|', ['name', 'ilike', q], ['partner_id.name', 'ilike', q], ['invoice_origin', 'ilike', q]);
  const rows = await sr('account.move', domain,
    ['name', 'invoice_date', 'partner_id', 'amount_total', 'currency_id', 'invoice_origin', 'ref'],
    { order: 'invoice_date desc, id desc', limit });
  return rows.map(r => ({
    id: r.id, name: str(r.name), date: str(r.invoice_date) || null, customer: str(nm(r.partner_id)),
    amount_total: num(r.amount_total), currency: str(nm(r.currency_id)), origin: str(r.invoice_origin), ref: str(r.ref),
  }));
}

const PARTNER_FIELDS = ['name', 'commercial_company_name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'vat', 'phone', 'mobile', 'email'];
function partnerOut(p: any) {
  if (!p) return null;
  return {
    name: str(p.commercial_company_name) || str(p.name),
    contact: str(p.name),
    street: str(p.street), street2: str(p.street2), city: str(p.city),
    state: str(nm(p.state_id)), zip: str(p.zip), country: str(nm(p.country_id)),
    vat: str(p.vat), phone: str(p.phone) || str(p.mobile), email: str(p.email),
  };
}

/** IGST rate (%) from a product's customer taxes: the tax named IGST, else the
 *  largest percent tax (an export line itself is usually zero-rated under LUT). */
export function igstOf(taxes: any[]): number | null {
  if (!taxes.length) return null;
  const igst = taxes.find(t => /igst/i.test(str(t.name)) || /igst/i.test(str(nm(t.tax_group_id))));
  if (igst) return num(igst.amount);
  const pct = taxes.filter(t => str(t.amount_type) === 'percent' || t.amount_type == null);
  if (!pct.length) return null;
  return Math.max(...pct.map(t => num(t.amount)));
}

const TO_INCH: Record<string, number> = { in: 1, inch: 1, inches: 1, ft: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 };
const TO_KG: Record<string, number> = { kg: 1, kgs: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237 };

/** The shipping packaging of an Odoo product: the packaging with the most units,
 *  with its package type's size (converted to inches) and empty weight (kg). */
export function packagingOf(packs: any[], typeById: Map<number, any>) {
  const best = [...packs].filter(p => num(p.qty) > 0).sort((a, b) => num(b.qty) - num(a.qty))[0];
  if (!best) return null;
  const t = typeById.get(id(best.package_type_id));
  const f = TO_INCH[str(t?.length_uom_name).toLowerCase()] ?? 1;
  const dims = t && num(t.packaging_length) && num(t.width) && num(t.height)
    ? [num(t.packaging_length) * f, num(t.width) * f, num(t.height) * f] : null;
  const wf = TO_KG[str(t?.weight_uom_name).toLowerCase()] ?? 1;
  return { units: num(best.qty), dims_in: dims, empty_kg: t ? num(t.base_weight) * wf : 0, name: str(best.name) };
}

export async function getInvoice(invoiceId: number) {
  const [mv] = await sr('account.move', [['id', '=', invoiceId]],
    ['name', 'invoice_date', 'partner_id', 'partner_shipping_id', 'currency_id', 'invoice_origin', 'ref',
      'amount_untaxed', 'amount_tax', 'amount_total', 'invoice_incoterm_id', 'invoice_payment_term_id', 'company_id', 'move_type', 'state']);
  if (!mv) return null;

  const lines = (await sr('account.move.line', [['move_id', '=', mv.id], ['display_type', 'in', ['product', false]]],
    ['product_id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'product_uom_id', 'sequence', 'display_type'],
    { order: 'sequence, id' })).filter(l => id(l.product_id) || num(l.quantity));

  const prodIds = [...new Set(lines.map(l => id(l.product_id)).filter(Boolean))];
  const prods = prodIds.length
    ? await sr('product.product', [['id', 'in', prodIds]],
      ['default_code', 'name', 'l10n_in_hsn_code', 'hs_code', 'taxes_id', 'weight', 'volume'], { context: { active_test: false } })
    : [];
  const prodById = new Map(prods.map(p => [p.id, p]));

  const taxIds = [...new Set(prods.flatMap(p => (Array.isArray(p.taxes_id) ? p.taxes_id : [])))];
  const taxes = taxIds.length
    ? await sr('account.tax', [['id', 'in', taxIds]], ['name', 'amount', 'amount_type', 'tax_group_id'], { context: { active_test: false } })
    : [];
  const taxById = new Map(taxes.map(t => [t.id, t]));

  // Packaging (units per carton, carton size and empty weight) as the packing-list fallback.
  // Not every Odoo version has product.packaging / package types, so a failure just means none.
  const packsByProd = new Map<number, any[]>();
  const typeById = new Map<number, any>();
  if (prodIds.length) {
    try {
      const packs = await sr('product.packaging', [['product_id', 'in', prodIds]], ['product_id', 'name', 'qty', 'package_type_id', 'sequence']);
      for (const p of packs) packsByProd.set(id(p.product_id), [...(packsByProd.get(id(p.product_id)) ?? []), p]);
      const typeIds = [...new Set(packs.map(p => id(p.package_type_id)).filter(Boolean))];
      if (typeIds.length) {
        const types = await sr('stock.package.type', [['id', 'in', typeIds]],
          ['name', 'packaging_length', 'width', 'height', 'base_weight', 'length_uom_name', 'weight_uom_name']);
        for (const t of types) typeById.set(t.id, t);
      }
    } catch { /* no packaging in this Odoo */ }
  }

  const partnerIds = [...new Set([id(mv.partner_id), id(mv.partner_shipping_id)].filter(Boolean))];
  const partners = partnerIds.length ? await sr('res.partner', [['id', 'in', partnerIds]], PARTNER_FIELDS) : [];
  const partnerById = new Map(partners.map(p => [p.id, p]));

  // Buyer's order number: the sales order's customer reference, else the SO name.
  let so: any = null;
  const origin = str(mv.invoice_origin).split(',')[0].trim();
  if (origin) [so] = await sr('sale.order', [['name', '=', origin]], ['name', 'client_order_ref', 'date_order']);

  // The shipper is the Odoo company that issued the invoice (its VAT is the GSTIN).
  let company: any = null;
  if (id(mv.company_id)) {
    [company] = await sr('res.company', [['id', '=', id(mv.company_id)]],
      ['name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'vat', 'phone', 'email']);
  }

  return {
    invoice: {
      id: mv.id, name: str(mv.name), date: str(mv.invoice_date) || null, currency: str(nm(mv.currency_id)),
      origin: str(mv.invoice_origin), ref: str(mv.ref),
      buyer_order_no: str(so?.client_order_ref) || str(so?.name) || origin,
      buyer_order_date: so?.date_order ? String(so.date_order).slice(0, 10) : null,
      sale_order: str(so?.name) || null,
      incoterm: str(nm(mv.invoice_incoterm_id)), payment_terms: str(nm(mv.invoice_payment_term_id)),
      amount_untaxed: num(mv.amount_untaxed), amount_tax: num(mv.amount_tax), amount_total: num(mv.amount_total),
      buyer: partnerOut(partnerById.get(id(mv.partner_id))),
      consignee: partnerOut(partnerById.get(id(mv.partner_shipping_id)) ?? partnerById.get(id(mv.partner_id))),
      company: company ? partnerOut(company) : null,
    },
    lines: lines.map(l => {
      const p = prodById.get(id(l.product_id));
      const pTaxes = (Array.isArray(p?.taxes_id) ? p.taxes_id : []).map((t: number) => taxById.get(t)).filter(Boolean);
      return {
        product_id: id(l.product_id), sku: str(p?.default_code), product_name: str(p?.name) || str(nm(l.product_id)),
        description: str(l.name), quantity: num(l.quantity), uom: str(nm(l.product_uom_id)),
        price_unit: num(l.price_unit), subtotal: num(l.price_subtotal),
        hsn_code: str(p?.l10n_in_hsn_code) || str(p?.hs_code) || null,
        igst_rate: igstOf(pTaxes),
        odoo_weight_kg: p?.weight ? num(p.weight) : null, odoo_volume_m3: p?.volume ? num(p.volume) : null,
        packaging: packagingOf(packsByProd.get(id(l.product_id)) ?? [], typeById),
      };
    }),
  };
}
