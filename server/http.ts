import { Session, sessionOf } from './session.js';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a handler for a signed-in person; anyone else gets 401. */
export async function signedIn(req: Request, fn: (s: Session) => Promise<Response>): Promise<Response> {
  let s: Session | null;
  try { s = sessionOf(req); } catch (e) { return json({ error: errMsg(e) }, 500); }
  if (!s) return json({ error: 'Please sign in.' }, 401);
  try { return await fn(s); } catch (e) { return json({ error: errMsg(e) }, 500); }
}
