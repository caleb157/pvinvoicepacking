// Sign-in cookie: a small signed token (HMAC-SHA256 with SESSION_SECRET) holding the
// app user's id, email, name and admin flag.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'ip_session';
const MAX_AGE_S = 30 * 24 * 3600;

export interface SessionUser { uid: string; email: string; name: string; admin: boolean }
export interface Session extends SessionUser { exp: number }

function secret() {
  const s = process.env.SESSION_SECRET ?? '';
  if (s.length < 16) throw new Error('SESSION_SECRET is not set (or too short) in the Vercel environment variables.');
  return s;
}
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string, key: string) => createHmac('sha256', key).update(body).digest('base64url');

export function makeToken(user: SessionUser, now = Date.now(), key = secret()): string {
  const body = b64(JSON.stringify({ ...user, exp: Math.floor(now / 1000) + MAX_AGE_S }));
  return `${body}.${sign(body, key)}`;
}

export function readToken(token: string | null | undefined, now = Date.now(), key = secret()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
    return s.exp * 1000 > now ? s : null;
  } catch { return null; }
}

export function cookieValue(req: Request, name = COOKIE): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const sessionOf = (req: Request) => readToken(cookieValue(req));

export const setCookie = (token: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
