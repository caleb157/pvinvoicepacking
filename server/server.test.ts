import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { igstOf, packagingOf } from './odoo';
import { makeToken, readToken } from './session';

const KEY = 'test-secret-0123456789';

describe('sign-in cookie', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const t = makeToken({ uid: 7, name: 'Caleb', login: 'c@x.com' }, 0, KEY);
    expect(readToken(t, 1000, KEY)).toMatchObject({ uid: 7, name: 'Caleb' });
    expect(readToken(t.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), 1000, KEY)).toBeNull();
    expect(readToken(t, 1000, 'another-secret-0123456789')).toBeNull();
    expect(readToken(t, 31 * 24 * 3600 * 1000, KEY)).toBeNull();
    expect(readToken('junk', 0, KEY)).toBeNull();
  });
});

describe('odoo mapping', () => {
  it('picks the IGST tax, else the largest percent tax', () => {
    expect(igstOf([{ name: 'GST 18%', amount: 18 }, { name: 'IGST 12%', amount: 12 }])).toBe(12);
    expect(igstOf([{ name: 'A', amount: 5, amount_type: 'percent' }, { name: 'B', amount: 18, amount_type: 'percent' }])).toBe(18);
    expect(igstOf([])).toBeNull();
  });

  it('reads the biggest packaging and converts its size to inches', () => {
    const types = new Map([[3, { packaging_length: 508, width: 254, height: 254, base_weight: 1500, length_uom_name: 'mm', weight_uom_name: 'g' }]]);
    const p = packagingOf([{ qty: 1, name: 'Unit' }, { qty: 4, name: 'Carton', package_type_id: [3, 'Big'] }], types);
    expect(p?.units).toBe(4);
    expect(p?.dims_in?.map(n => Math.round(n * 100) / 100)).toEqual([20, 10, 10]);
    expect(p?.empty_kg).toBeCloseTo(1.5);
    expect(packagingOf([], types)).toBeNull();
  });
});

describe('api with a fake Odoo', () => {
  const calls: any[] = [];
  beforeEach(() => {
    process.env.SESSION_SECRET = KEY;
    process.env.ODOO_URL = 'https://odoo.test';
    process.env.ODOO_USERNAME = 'api@x.com';
    process.env.ODOO_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const { params } = JSON.parse(init.body);
      calls.push(params);
      let result: any = null;
      if (params.service === 'common') result = params.args[1] === 'bad@x.com' ? false : (params.args[1] === 'api@x.com' ? 1 : 42);
      else {
        const [, , , model, method] = params.args;
        if (method === 'fields_get') result = Object.fromEntries(['name', 'login', 'share', 'invoice_date', 'partner_id', 'amount_total', 'currency_id', 'invoice_origin', 'ref'].map(f => [f, {}]));
        else if (model === 'res.users') result = [{ id: 42, name: 'Caleb', login: 'caleb@x.com', share: false }];
        else if (model === 'account.move') result = [{ id: 9, name: 'INV/1', invoice_date: '2026-10-01', partner_id: [5, 'Buyer'], amount_total: 100, currency_id: [1, 'USD'], invoice_origin: 'S001', ref: false }];
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const post = (url: string, body: unknown, cookie?: string) =>
    new Request(`https://app.test${url}`, { method: 'POST', body: JSON.stringify(body), headers: cookie ? { cookie } : {} });

  it('signs in with an Odoo login, then lists invoices; refuses without a cookie', async () => {
    const auth = await import('../api/auth');
    const odoo = await import('../api/odoo');

    expect((await odoo.POST(post('/api/odoo', { action: 'list' }))).status).toBe(401);
    expect((await auth.POST(post('/api/auth', { action: 'login', login: 'bad@x.com', password: 'x' }))).status).toBe(401);

    const res = await auth.POST(post('/api/auth', { action: 'login', login: 'caleb@x.com', password: 'pw' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^ip_session=/);

    const list = await odoo.POST(post('/api/odoo', { action: 'list', search: 'INV' }, cookie));
    expect(list.status).toBe(200);
    expect((await list.json()).invoices).toEqual([
      { id: 9, name: 'INV/1', date: '2026-10-01', customer: 'Buyer', amount_total: 100, currency: 'USD', origin: 'S001', ref: '' },
    ]);
    // The person's own password is only used to check the login; Odoo reads use the app's API key.
    const reads = calls.filter(c => c.service === 'object');
    expect(reads.every(c => c.args[2] === 'k')).toBe(true);
  });
});
