// Odoo access for the app's server functions. Everything is read live over Odoo's
// JSON-RPC with one API key kept in Vercel environment variables; nothing is copied.
// People using the app don't need Odoo accounts.
//   listSources:    posted customer invoices or confirmed sales orders (for the picker)
//   getSource:      one invoice or sales order with lines, addresses, references,
//                   HSN, GST rate (from the line's taxes), customer SKU (variant tags)
//                   and the product's weight (Odoo keeps the average gross weight)
//   searchPartners: customers and their delivery addresses (consignee / buyer pickers)

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
/** Base address only: adds https:// when missing and drops a pasted /odoo or /web path. */
export function odooBase(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return u.replace(/\/+$/, ''); }
}
const ODOO_URL = () => odooBase(env('ODOO_URL'));
const ODOO_DB = () => env('ODOO_DB', 'parableventures');

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  if (!ODOO_URL()) throw new Error('ODOO_URL is not set in the Vercel environment variables.');
  let res: Response;
  try {
    res = await fetch(`${ODOO_URL()}/jsonrpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
    });
  } catch (e: any) {
    const why = e?.cause?.code || e?.cause?.message || e?.message || 'network error';
    throw new Error(`Could not reach Odoo at ${ODOO_URL()} (${why}). Check ODOO_URL in Vercel, e.g. https://yourcompany.odoo.com`);
  }
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

// ---------- invoices ----------

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

// ---------- picker ----------

export type SourceKind = 'invoice' | 'order';

export interface SourceSummary {
  kind: SourceKind; id: number; name: string; date: string | null; customer: string; amount_total: number;
  currency: string; origin: string; ref: string; state: string;
}

export async function listSources(kind: SourceKind, search: string | null, limit = 50): Promise<SourceSummary[]> {
  const q = search?.trim();
  if (kind === 'invoice') {
    const domain: unknown[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
    if (q) domain.push('|', '|', '|', ['name', 'ilike', q], ['partner_id.name', 'ilike', q], ['invoice_origin', 'ilike', q], ['ref', 'ilike', q]);
    const rows = await sr('account.move', domain,
      ['name', 'invoice_date', 'partner_id', 'amount_total', 'currency_id', 'invoice_origin', 'ref', 'state'],
      { order: 'invoice_date desc, id desc', limit });
    return rows.map(r => ({
      kind, id: r.id, name: str(r.name), date: str(r.invoice_date) || null, customer: str(nm(r.partner_id)),
      amount_total: num(r.amount_total), currency: str(nm(r.currency_id)), origin: str(r.invoice_origin), ref: str(r.ref), state: str(r.state),
    }));
  }
  const domain: unknown[] = [['state', 'in', ['sale', 'done']]];
  if (q) domain.push('|', '|', ['name', 'ilike', q], ['partner_id.name', 'ilike', q], ['client_order_ref', 'ilike', q]);
  const rows = await sr('sale.order', domain,
    ['name', 'date_order', 'partner_id', 'amount_total', 'currency_id', 'client_order_ref', 'state', 'invoice_status'],
    { order: 'date_order desc, id desc', limit });
  return rows.map(r => ({
    kind, id: r.id, name: str(r.name), date: r.date_order ? String(r.date_order).slice(0, 10) : null, customer: str(nm(r.partner_id)),
    amount_total: num(r.amount_total), currency: str(nm(r.currency_id)), origin: '', ref: str(r.client_order_ref), state: str(r.invoice_status) || str(r.state),
  }));
}

// ---------- one invoice or sales order ----------

/** Lines for freight or insurance charges (kept out of the goods lines). */
export function chargeKind(text: string): 'freight' | 'insurance' | null {
  if (/insurance/i.test(text)) return 'insurance';
  if (/freight|shipping charge|delivery charge/i.test(text)) return 'freight';
  return null;
}

export interface SourceLine {
  product_id: number | null; internal_sku: string; customer_skus: string[]; product_name: string; description: string;
  quantity: number; uom: string; price_unit: number; subtotal: number; hsn_code: string | null; gst_rate: number | null;
  weight_kg: number | null; charge: 'freight' | 'insurance' | null;
}

export interface SourceDoc {
  kind: SourceKind; id: number; name: string; date: string | null; currency: string;
  sale_order: string | null; client_order_ref: string; invoice_ref: string;
  incoterm: string; payment_terms: string; amount_untaxed: number; amount_tax: number; amount_total: number;
  buyer: ReturnType<typeof partnerOut>; consignee: ReturnType<typeof partnerOut>; company: ReturnType<typeof partnerOut>;
  buyer_partner_id: number | null; consignee_partner_id: number | null;
  lines: SourceLine[];
}

const lineTaxField = async (model: string) => {
  const f = await fieldsOf(model);
  return f.has('tax_ids') ? 'tax_ids' : 'tax_id';
};

export async function getSource(kind: SourceKind, sourceId: number): Promise<SourceDoc | null> {
  let head: any, rawLines: any[], taxField: string;
  if (kind === 'invoice') {
    [head] = await sr('account.move', [['id', '=', sourceId]],
      ['name', 'invoice_date', 'partner_id', 'partner_shipping_id', 'currency_id', 'invoice_origin', 'ref',
        'amount_untaxed', 'amount_tax', 'amount_total', 'invoice_incoterm_id', 'invoice_payment_term_id', 'company_id', 'state']);
    if (!head) return null;
    taxField = await lineTaxField('account.move.line');
    rawLines = (await sr('account.move.line', [['move_id', '=', head.id], ['display_type', 'in', ['product', false]]],
      ['product_id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'product_uom_id', 'sequence', taxField],
      { order: 'sequence, id' })).filter(l => id(l.product_id) || num(l.quantity));
  } else {
    [head] = await sr('sale.order', [['id', '=', sourceId]],
      ['name', 'date_order', 'partner_id', 'partner_invoice_id', 'partner_shipping_id', 'currency_id', 'client_order_ref',
        'amount_untaxed', 'amount_tax', 'amount_total', 'incoterm', 'payment_term_id', 'company_id', 'state']);
    if (!head) return null;
    taxField = await lineTaxField('sale.order.line');
    rawLines = (await sr('sale.order.line', [['order_id', '=', head.id], ['display_type', '=', false]],
      ['product_id', 'name', 'product_uom_qty', 'price_unit', 'price_subtotal', 'product_uom', 'product_uom_id', 'sequence', taxField],
      { order: 'sequence, id' })).filter(l => id(l.product_id));
  }

  const prodIds = [...new Set(rawLines.map(l => id(l.product_id)).filter(Boolean))];
  const prods = prodIds.length
    ? await sr('product.product', [['id', 'in', prodIds]],
      ['default_code', 'name', 'l10n_in_hsn_code', 'hs_code', 'taxes_id', 'weight', 'additional_product_tag_ids'], { context: { active_test: false } })
    : [];
  const prodById = new Map(prods.map(p => [p.id, p]));

  const tagIds = [...new Set(prods.flatMap(p => (Array.isArray(p.additional_product_tag_ids) ? p.additional_product_tag_ids : [])))];
  const tags = tagIds.length ? await sr('product.tag', [['id', 'in', tagIds]], ['name']) : [];
  const tagById = new Map(tags.map(t => [t.id, str(t.name)]));

  const taxIds = [...new Set([
    ...rawLines.flatMap(l => (Array.isArray(l[taxField]) ? l[taxField] : [])),
    ...prods.flatMap(p => (Array.isArray(p.taxes_id) ? p.taxes_id : [])),
  ])];
  const taxes = taxIds.length
    ? await sr('account.tax', [['id', 'in', taxIds]], ['name', 'amount', 'amount_type', 'tax_group_id'], { context: { active_test: false } })
    : [];
  const taxById = new Map(taxes.map(t => [t.id, t]));
  const taxesOf = (ids: unknown) => (Array.isArray(ids) ? ids : []).map((t: number) => taxById.get(t)).filter(Boolean);

  // Invoice: the sales order is in invoice_origin. Order: it is the order itself.
  let so: any = null;
  if (kind === 'invoice') {
    const origin = str(head.invoice_origin).split(',')[0].trim();
    if (origin) [so] = await sr('sale.order', [['name', '=', origin]], ['name', 'client_order_ref']);
  } else so = head;

  const buyerId = id(kind === 'invoice' ? head.partner_id : (head.partner_invoice_id || head.partner_id));
  const consigneeId = id(head.partner_shipping_id) || buyerId;
  const partnerIds = [...new Set([buyerId, consigneeId].filter(Boolean))];
  const partners = partnerIds.length ? await sr('res.partner', [['id', 'in', partnerIds]], PARTNER_FIELDS) : [];
  const partnerById = new Map(partners.map(p => [p.id, p]));

  let company: any = null;
  if (id(head.company_id)) {
    [company] = await sr('res.company', [['id', '=', id(head.company_id)]],
      ['name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'vat', 'phone', 'email']);
  }

  return {
    kind, id: head.id,
    name: kind === 'invoice' ? str(head.name) : str(head.name),
    date: kind === 'invoice' ? (str(head.invoice_date) || null) : (head.date_order ? String(head.date_order).slice(0, 10) : null),
    currency: str(nm(head.currency_id)),
    sale_order: str(so?.name) || null,
    client_order_ref: str(so?.client_order_ref),
    invoice_ref: kind === 'invoice' ? str(head.ref) : '',
    incoterm: str(nm(kind === 'invoice' ? head.invoice_incoterm_id : head.incoterm)),
    payment_terms: str(nm(kind === 'invoice' ? head.invoice_payment_term_id : head.payment_term_id)),
    amount_untaxed: num(head.amount_untaxed), amount_tax: num(head.amount_tax), amount_total: num(head.amount_total),
    buyer: partnerOut(partnerById.get(buyerId)),
    consignee: partnerOut(partnerById.get(consigneeId)),
    company: company ? partnerOut(company) : null,
    buyer_partner_id: buyerId, consignee_partner_id: consigneeId,
    lines: rawLines.map(l => {
      const p = prodById.get(id(l.product_id));
      const lineTaxes = taxesOf(l[taxField]);
      const name = str(p?.name) || str(nm(l.product_id));
      return {
        product_id: id(l.product_id), internal_sku: str(p?.default_code),
        customer_skus: (Array.isArray(p?.additional_product_tag_ids) ? p.additional_product_tag_ids : []).map((t: number) => tagById.get(t) || '').filter(Boolean),
        product_name: name, description: str(l.name),
        quantity: num(kind === 'invoice' ? l.quantity : l.product_uom_qty),
        uom: str(nm(kind === 'invoice' ? l.product_uom_id : (l.product_uom || l.product_uom_id))),
        price_unit: num(l.price_unit), subtotal: num(l.price_subtotal),
        hsn_code: str(p?.l10n_in_hsn_code) || str(p?.hs_code) || null,
        gst_rate: lineTaxes.length ? igstOf(lineTaxes) : igstOf(taxesOf(p?.taxes_id)),
        weight_kg: p?.weight ? num(p.weight) : null,
        charge: chargeKind(`${str(p?.default_code)} ${name}`),
      };
    }),
  };
}

/** Values the shipping bill tracker fills from a posted invoice. */
export function trackerFields(doc: SourceDoc) {
  const sum = (k: 'freight' | 'insurance' | null) => doc.lines.filter(l => l.charge === k).reduce((t, l) => t + l.subtotal, 0);
  const freight = sum('freight');
  const insurance = sum('insurance');
  return {
    invoice_no: doc.name, invoice_date: doc.date, odoo_invoice_id: doc.id, currency: doc.currency,
    consignee: doc.consignee?.name ?? '', buyer: doc.buyer?.name ?? '',
    fob_value: Math.round((doc.amount_untaxed - freight - insurance) * 100) / 100,
    freight_value: freight, insurance_value: insurance,
  };
}

// ---------- customers ----------

export async function searchPartners(q: string, limit = 20) {
  const rows = await sr('res.partner', ['|', ['name', 'ilike', q.trim()], ['parent_id.name', 'ilike', q.trim()], ['active', '=', true]],
    [...PARTNER_FIELDS, 'display_name', 'type', 'customer_rank', 'is_company'], { limit, order: 'customer_rank desc, name' });
  return rows.map(p => ({ id: p.id, label: str(p.display_name) || str(p.name), type: str(p.type), ...partnerOut(p)! }));
}
