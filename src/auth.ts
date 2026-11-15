/** ล็อกอินด้วยรหัสผ่านเดียว (APP_PASSWORD) + cookie ที่เซ็นด้วย HMAC, หรือ Bearer API_TOKEN */
import { Env, json, readJson, b64url, enc } from './util';

const COOKIE = 'mt_session';
const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;
const MAX_LOGIN_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** เทียบสตริงแบบไม่รั่วเวลา (hash ก่อนเพื่อให้ยาวเท่ากัน) */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

// ไม่ยอมเปิดใช้ถ้ารหัสผ่านว่าง/สั้น/เป็นค่าตัวอย่าง (กันคน deploy แล้วลืมตั้ง)
const WEAK_PASSWORDS = new Set(['change-me', 'changeme', 'password', '12345678', 'test1234']);
export function passwordReady(env: Env): boolean {
  const p = env.APP_PASSWORD ?? '';
  return p.length >= 8 && !WEAK_PASSWORDS.has(p.toLowerCase());
}

// session ผูกกับรหัสผ่าน: เปลี่ยนรหัสผ่าน = ทุกเครื่องหลุดล็อกอิน
const sessionKey = (env: Env) => 'maintenance-tracker-session:v1:' + (env.APP_PASSWORD ?? '');

async function makeSession(env: Env): Promise<{ token: string; maxAge: number }> {
  const exp = Date.now() + SESSION_TTL_MS;
  return { token: `${exp}.${await hmac(sessionKey(env), String(exp))}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

async function checkSession(env: Env, token: string): Promise<boolean> {
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return safeEqual(sig, await hmac(sessionKey(env), expStr));
}

export function cookieHeader(url: URL, value: string, maxAge: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  if (!passwordReady(env)) return false;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return !!env.API_TOKEN && (await safeEqual(auth.slice(7).trim(), env.API_TOKEN));
  const token = getCookie(req, COOKIE);
  return token ? checkSession(env, token) : false;
}

export async function handleLogin(req: Request, env: Env, url: URL): Promise<Response> {
  if (!passwordReady(env)) return json({ error: 'password_not_configured' }, 503);
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE ip = ?')
    .bind(ip)
    .first<{ count: number; window_start: number }>();
  if (row && now - row.window_start < LOGIN_WINDOW_MS && row.count >= MAX_LOGIN_FAILS) {
    return json({ error: 'too_many_attempts' }, 429);
  }
  const body = await readJson(req);
  const ok = typeof body?.password === 'string' && (await safeEqual(body.password, env.APP_PASSWORD ?? ''));
  if (!ok) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         count = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END`
    )
      .bind(ip, now, LOGIN_WINDOW_MS)
      .run();
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: 'wrong_password' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const { token, maxAge } = await makeSession(env);
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader(url, token, maxAge) });
}
