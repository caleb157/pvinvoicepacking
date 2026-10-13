// App sign-in: people added by an admin (app_users, scrypt password hashes), plus the
// bootstrap admin from ADMIN_EMAIL / ADMIN_PASSWORD so the first sign-in needs no database row.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { sql } from './db.js';
import type { SessionUser } from './session.js';

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const normEmail = (e: string) => e.trim().toLowerCase();

export async function signIn(email: string, password: string): Promise<SessionUser | null> {
  const e = normEmail(email);
  const adminEmail = normEmail(process.env.ADMIN_EMAIL ?? '');
  const adminPw = process.env.ADMIN_PASSWORD ?? '';
  if (adminEmail && adminPw.length >= 8 && e === adminEmail && same(password, adminPw)) {
    return { uid: 'env-admin', email: e, name: 'Admin', admin: true };
  }
  const rows = (await sql()`select id, email, name, password_hash, is_admin from app_users where email = ${e} and not disabled`) as any[];
  const u = rows[0];
  if (!u || !checkPassword(password, u.password_hash)) return null;
  return { uid: u.id, email: u.email, name: u.name || u.email, admin: !!u.is_admin };
}

/** A signed-in person is still allowed (not removed or disabled since the cookie was issued). */
export async function stillActive(uid: string): Promise<boolean> {
  if (uid === 'env-admin') return true;
  const rows = (await sql()`select 1 from app_users where id = ${uid} and not disabled`) as any[];
  return rows.length > 0;
}

export async function listUsers() {
  return sql()`select id, email, name, is_admin, disabled, created_at from app_users order by created_at`;
}

export async function saveUser(u: { id?: string | null; email: string; name: string; is_admin: boolean; disabled: boolean; password?: string | null }) {
  const email = normEmail(u.email);
  if (u.id) {
    await sql()`update app_users set email = ${email}, name = ${u.name}, is_admin = ${u.is_admin}, disabled = ${u.disabled} where id = ${u.id}`;
    if (u.password) await sql()`update app_users set password_hash = ${hashPassword(u.password)} where id = ${u.id}`;
    return;
  }
  if (!u.password) throw new Error('A new person needs a password.');
  await sql()`insert into app_users (email, name, password_hash, is_admin, disabled)
    values (${email}, ${u.name}, ${hashPassword(u.password)}, ${u.is_admin}, ${u.disabled})`;
}

export async function deleteUser(id: string) {
  await sql()`delete from app_users where id = ${id}`;
}
