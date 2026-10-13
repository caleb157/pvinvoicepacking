import { Session, sessionOf } from './session.js';
import { stillActive } from './users.js';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isMissingTable = (e: any) => e?.code === '42P01' || /relation .* does not exist/i.test(String(e?.message));
export const MISSING_TABLES_MSG = 'The app database is not set up yet. Run sql/setup.sql in the Neon SQL editor, then reload.';

/** Runs a handler for a signed-in person (admins only when `admin`); anyone else gets 401/403. */
export async function signedIn(req: Request, fn: (s: Session) => Promise<Response>, opts: { admin?: boolean } = {}): Promise<Response> {
  let s: Session | null;
  try { s = sessionOf(req); } catch (e) { return json({ error: errMsg(e) }, 500); }
  if (!s) return json({ error: 'Please sign in.' }, 401);
  if (opts.admin && !s.admin) return json({ error: 'Only an admin can do this.' }, 403);
  try {
    if (!(await stillActive(s.uid))) return json({ error: 'Please sign in.' }, 401);
    return await fn(s);
  } catch (e) {
    if (isMissingTable(e)) return json({ error: MISSING_TABLES_MSG, missingTables: true }, 503);
    return json({ error: errMsg(e) }, 500);
  }
}
