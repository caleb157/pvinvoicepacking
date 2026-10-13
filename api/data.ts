// The app's own data: customs rate, packing details per SKU, saved document sets.
import { z } from 'zod';
import * as db from '../server/db.js';
import { errMsg, json, signedIn } from '../server/http.js';

const Packing = z.object({
  sku: z.string().min(1).max(100), units_per_package: z.number().nullable(), package_dims_in: z.string().max(100).nullable(),
  package_kind: z.string().max(50).nullable(), net_weight_kg: z.number().nullable(), gross_weight_kg: z.number().nullable(),
});

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('init') }),
  z.object({ action: z.literal('packing'), skus: z.array(z.string().max(100)).max(500) }),
  z.object({ action: z.literal('get-doc'), id: z.string().uuid() }),
  z.object({
    action: z.literal('save-rate'), currency: z.string().max(5), rate: z.number().positive(),
    notification_no: z.string().max(50), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source_url: z.string().max(300),
  }),
  z.object({
    action: z.literal('save-doc'), invoice_no: z.string().min(1).max(100), odoo_invoice_id: z.number().int().nullable(),
    exchange_rate: z.number(), notification_no: z.string().max(50).nullable(), total_usd: z.number(),
    payload: z.record(z.unknown()), packing: z.array(Packing).max(500),
  }),
]);

export function POST(req: Request) {
  return signedIn(req, async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Bad request' }, 400);
    const b = parsed.data;
    try {
      switch (b.action) {
        case 'init': return json({ rate: await db.latestRate('USD'), history: await db.listDocs(20) });
        case 'packing': return json({ profiles: await db.packingProfiles([...new Set(b.skus.filter(Boolean))]) });
        case 'get-doc': {
          const row = await db.getDoc(b.id);
          return row ? json(row) : json({ error: 'Saved set not found.' }, 404);
        }
        case 'save-rate': {
          await db.saveRate(b, s.name);
          return json({ ok: true });
        }
        case 'save-doc': {
          const { packing, action: _a, ...doc } = b;
          await db.saveDoc(doc, s.name);
          await db.savePackingProfiles(packing, s.name);
          return json({ history: await db.listDocs(20) });
        }
      }
    } catch (e) {
      if (db.isMissingTable(e)) return json({ error: db.MISSING_TABLES_MSG, missingTables: true }, 503);
      return json({ error: errMsg(e) }, 500);
    }
  });
}
