// Sign in with your own Odoo login. GET: who is signed in. POST: sign in / sign out.
import { z } from 'zod';
import { errMsg, json } from '../server/http.js';
import { signIn } from '../server/odoo.js';
import { clearCookie, makeToken, sessionOf, setCookie } from '../server/session.js';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), login: z.string().trim().min(1).max(200), password: z.string().min(1).max(500) }),
  z.object({ action: z.literal('logout') }),
]);

export async function GET(req: Request) {
  try {
    const s = sessionOf(req);
    return json({ user: s ? { name: s.name, login: s.login } : null });
  } catch (e) { return json({ error: errMsg(e) }, 500); }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Bad request' }, 400);
  if (parsed.data.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  try {
    const u = await signIn(parsed.data.login, parsed.data.password);
    if (!u) return json({ error: 'That Odoo login and password did not work.' }, 401);
    return json({ user: { name: u.name, login: u.login } }, 200, { 'Set-Cookie': setCookie(makeToken(u)) });
  } catch (e) {
    const m = errMsg(e);
    return json({ error: /access denied|login|password/i.test(m) ? 'That Odoo login and password did not work.' : m }, /SESSION_SECRET|ODOO_/.test(m) ? 500 : 401);
  }
}
