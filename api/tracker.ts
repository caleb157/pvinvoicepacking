// Shipping bill tracker and inward remittances: list, add, edit, delete rows; and how much of
// each remittance is used against each invoice.
import { z } from 'zod';
import * as db from '../server/db.js';
import { json, signedIn } from '../server/http.js';

const Table = z.enum(['shipping_bills', 'inward_remittances']);
const Row = z.record(z.union([z.string().max(2000), z.number(), z.null()]));
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), table: Table }),
  z.object({ action: z.literal('insert'), table: Table, row: Row }),
  z.object({ action: z.literal('update'), table: Table, id: z.string().uuid(), row: Row }),
  z.object({ action: z.literal('delete'), table: Table, id: z.string().uuid() }),
  z.object({ action: z.literal('allocations') }),
  z.object({
    action: z.literal('set-allocations'), invoice_no: z.string().trim().min(1).max(100),
    items: z.array(z.object({ remittance_id: z.string().uuid(), amount: z.number().positive() })).max(50),
  }),
]);

export function POST(req: Request) {
  return signedIn(req, async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Bad request' }, 400);
    const b = parsed.data;
    switch (b.action) {
      case 'list': return json({ rows: await db.listRows(b.table) });
      case 'insert': return json({ row: await db.insertRow(b.table, b.row, s.name) });
      case 'update': {
        const row = await db.updateRow(b.table, b.id, b.row, s.name);
        return row ? json({ row }) : json({ error: 'That row no longer exists.' }, 404);
      }
      case 'delete':
        await db.deleteRow(b.table, b.id);
        return json({ ok: true });
      case 'allocations': return json({ allocations: await db.listAllocations() });
      case 'set-allocations':
        try { await db.setAllocations(b.invoice_no, b.items, s.name); }
        catch (e: any) { if (!e?.code) return json({ error: e.message }, 409); throw e; }
        return json({ allocations: await db.listAllocations() });
    }
  });
}
