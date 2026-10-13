// Live Odoo reads for signed-in people (they don't need Odoo accounts): the invoice /
// sales order picker, one invoice or order, customer search, and tracker auto-fill.
import { z } from 'zod';
import { json, signedIn } from '../server/http.js';
import { getSource, listSources, searchPartners, trackerFields } from '../server/odoo.js';

const Kind = z.enum(['invoice', 'order']);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), kind: Kind, search: z.string().max(100).optional().nullable(), limit: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal('get'), kind: Kind, id: z.number().int().positive() }),
  z.object({ action: z.literal('partners'), search: z.string().min(1).max(100) }),
  z.object({ action: z.literal('tracker-fields'), id: z.number().int().positive() }),
]);

export function POST(req: Request) {
  return signedIn(req, async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Bad request' }, 400);
    const b = parsed.data;
    switch (b.action) {
      case 'list': return json({ items: await listSources(b.kind, b.search ?? null, b.limit ?? 50) });
      case 'partners': return json({ partners: await searchPartners(b.search) });
      case 'get': {
        const doc = await getSource(b.kind, b.id);
        return doc ? json(doc) : json({ error: 'Not found in Odoo.' }, 404);
      }
      case 'tracker-fields': {
        const doc = await getSource('invoice', b.id);
        return doc ? json(trackerFields(doc)) : json({ error: 'Invoice not found in Odoo.' }, 404);
      }
    }
  });
}
