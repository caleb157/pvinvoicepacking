// Live Odoo reads for signed-in people: the invoice picker and one invoice.
import { z } from 'zod';
import { json, signedIn } from '../server/http.js';
import { getInvoice, listInvoices } from '../server/odoo.js';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), search: z.string().max(100).optional().nullable(), limit: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal('get'), invoice_id: z.number().int().positive() }),
]);

export function POST(req: Request) {
  return signedIn(req, async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Bad request' }, 400);
    const b = parsed.data;
    if (b.action === 'list') return json({ invoices: await listInvoices(b.search ?? null, b.limit ?? 50) });
    const inv = await getInvoice(b.invoice_id);
    return inv ? json(inv) : json({ error: 'Invoice not found in Odoo.' }, 404);
  });
}
