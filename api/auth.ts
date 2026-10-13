// Sign in with an app account (added by an admin). GET: who is signed in. POST: sign in / out.
import { z } from 'zod';
import { errMsg, isMissingTable, json, MISSING_TABLES_MSG } from '../server/http.js';
import { clearCookie, makeToken, sessionOf, setCookie } from '../server/session.js';
import { signIn } from '../server/users.js';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), email: z.string().trim().min(1).max(200), password: z.string().min(1).max(500) }),
  z.object({ action: z.literal('logout') }),
]);

export async function GET(req: Request) {
  try {
    const s = sessionOf(req);
    return json({ user: s ? { name: s.name, email: s.email, admin: s.admin } : null });
  } catch (e) { return json({ error: errMsg(e) }, 500); }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Bad request' }, 400);
  if (parsed.data.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  try {
    const u = await signIn(parsed.data.email, parsed.data.password);
    if (!u) return json({ error: 'That email and password did not work.' }, 401);
    return json({ user: { name: u.name, email: u.email, admin: u.admin } }, 200, { 'Set-Cookie': setCookie(makeToken(u)) });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: `${MISSING_TABLES_MSG} Until then only the admin login from Vercel works.` }, 503);
    return json({ error: errMsg(e) }, 500);
  }
}
