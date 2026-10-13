import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanRow } from './db';
import { chargeKind, igstOf, trackerFields } from './odoo';
import { makeToken, readToken } from './session';
import { checkPassword, hashPassword } from './users';

const KEY = 'test-secret-0123456789';

describe('sign-in cookie', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const t = makeToken({ uid: 'u1', name: 'Nadeem', email: 'n@x.com', admin: false }, 0, KEY);
    expect(readToken(t, 1000, KEY)).toMatchObject({ uid: 'u1', name: 'Nadeem', admin: false });
    expect(readToken(t.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), 1000, KEY)).toBeNull();
    expect(readToken(t, 1000, 'another-secret-0123456789')).toBeNull();
    expect(readToken(t, 31 * 24 * 3600 * 1000, KEY)).toBeNull();
    expect(readToken('junk', 0, KEY)).toBeNull();
  });
});

describe('passwords', () => {
  it('hashes with a salt and checks', () => {
    const h = hashPassword('correct horse');
    expect(h).not.toBe(hashPassword('correct horse'));
    expect(checkPassword('correct horse', h)).toBe(true);
    expect(checkPassword('wrong', h)).toBe(false);
    expect(checkPassword('x', 'garbage')).toBe(false);
  });
});

describe('odoo mapping', () => {
  it('picks the IGST tax, else the largest percent tax', () => {
    expect(igstOf([{ name: 'GST 18%', amount: 18 }, { name: 'IGST 12%', amount: 12 }])).toBe(12);
    expect(igstOf([{ name: 'A', amount: 5, amount_type: 'percent' }, { name: 'B', amount: 18, amount_type: 'percent' }])).toBe(18);
    expect(igstOf([])).toBeNull();
  });

  it('spots freight and insurance lines', () => {
    expect(chargeKind('FREIGHT Ocean freight')).toBe('freight');
    expect(chargeKind('Marine insurance')).toBe('insurance');
    expect(chargeKind('Mango Ashtray')).toBeNull();
  });

  it('fills the tracker with FOB net of freight and insurance', () => {
    const line = (subtotal: number, charge: any) => ({ subtotal, charge }) as any;
    const f = trackerFields({
      id: 9, name: 'INV/2026/0001', date: '2026-10-01', currency: 'USD', amount_untaxed: 1150,
      consignee: { name: 'Ship Co' }, buyer: { name: 'Bill Co' }, lines: [line(1000, null), line(120, 'freight'), line(30, 'insurance')],
    } as any);
    expect(f).toMatchObject({ invoice_no: 'INV/2026/0001', odoo_invoice_id: 9, consignee: 'Ship Co', buyer: 'Bill Co', fob_value: 1000, freight_value: 120, insurance_value: 30 });
  });
});

describe('tracker rows', () => {
  it('keeps known columns and cleans values', () => {
    expect(cleanRow('shipping_bills', { sb_number: '123', fob_value: '$1,234.50', sb_date: '2026-03-01', ebrc_date: '1/3/26', hacker: 'x', comments: '' }))
      .toEqual({ sb_number: '123', fob_value: 1234.5, sb_date: '2026-03-01', ebrc_date: null, comments: null });
  });
});

describe('api', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = KEY;
    process.env.ADMIN_EMAIL = 'Boss@X.com';
    process.env.ADMIN_PASSWORD = 'admin-password';
    process.env.ODOO_URL = 'https://odoo.test';
    process.env.ODOO_USERNAME = 'api@x.com';
    process.env.ODOO_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const { params } = JSON.parse(init.body);
      let result: any = null;
      if (params.service === 'common') result = 1;
      else {
        const [, , , model, method] = params.args;
        if (method === 'fields_get') result = Object.fromEntries(['name', 'invoice_date', 'partner_id', 'amount_total', 'currency_id', 'invoice_origin', 'ref', 'state'].map(f => [f, {}]));
        else if (model === 'account.move') result = [{ id: 9, name: 'INV/1', invoice_date: '2026-10-01', partner_id: [5, 'Buyer'], amount_total: 100, currency_id: [1, 'USD'], invoice_origin: 'S001', ref: false, state: 'posted' }];
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const post = (url: string, body: unknown, cookie?: string) =>
    new Request(`https://app.test${url}`, { method: 'POST', body: JSON.stringify(body), headers: cookie ? { cookie } : {} });

  it('signs the Vercel admin in without a database, then reads Odoo with the app key', async () => {
    const auth = await import('../api/auth');
    const odoo = await import('../api/odoo');
    const users = await import('../api/users');

    expect((await odoo.POST(post('/api/odoo', { action: 'list', kind: 'invoice' }))).status).toBe(401);

    const res = await auth.POST(post('/api/auth', { action: 'login', email: 'boss@x.com', password: 'admin-password' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^ip_session=/);

    const list = await odoo.POST(post('/api/odoo', { action: 'list', kind: 'invoice', search: 'INV' }, cookie));
    expect(list.status).toBe(200);
    expect((await list.json()).items[0]).toMatchObject({ id: 9, name: 'INV/1', customer: 'Buyer', currency: 'USD', ref: '' });

    // A non-admin cookie can't manage people.
    const plain = `ip_session=${makeToken({ uid: 'env-admin', name: 'x', email: 'x@x.com', admin: false })}`;
    expect((await users.POST(post('/api/users', { action: 'list' }, plain))).status).toBe(403);
  });
});
