// Shipping bill tracker and inward remittances: list, add, edit, delete rows.
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
    }
  });
}
