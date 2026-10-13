// Admin: people who can sign in.
import { z } from 'zod';
import { json, signedIn } from '../server/http.js';
import { deleteUser, listUsers, saveUser } from '../server/users.js';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({
    action: z.literal('save'), id: z.string().uuid().nullable().optional(), email: z.string().email().max(200), name: z.string().max(100),
    is_admin: z.boolean(), disabled: z.boolean(), password: z.string().min(8).max(200).nullable().optional(),
  }),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }),
]);

export function POST(req: Request) {
  return signedIn(req, async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Check the email, and use a password of at least 8 characters.' }, 400);
    const b = parsed.data;
    if (b.action === 'save') {
      try { await saveUser(b); }
      catch (e: any) { if (e?.code === '23505') return json({ error: 'Someone with that email already exists.' }, 409); throw e; }
    }
    if (b.action === 'delete') await deleteUser(b.id);
    return json({ users: await listUsers() });
  }, { admin: true });
}
