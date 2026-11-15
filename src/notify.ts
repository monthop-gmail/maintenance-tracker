/** การแจ้งเตือน (Web Push) + เครื่องมือเรื่องโซนเวลา */
import { Env, json, readJson, getSetting, putSetting, clip } from './util';
import { generateVapidKeys, sendPush, VapidKeys, PushSub } from './push';

export const DEFAULT_TZ = 'Asia/Bangkok';

const dtfCache = new Map<string, Intl.DateTimeFormat>();
/** วันที่ (YYYY-MM-DD) และนาทีของวัน ตามโซนเวลา */
export function localParts(ts: number, tz: string): { date: string; minutes: number } {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dtfCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(ts)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const getTz = async (env: Env) => {
  const tz = await getSetting<string>(env, 'tz', DEFAULT_TZ);
  return validTz(tz) ? tz : DEFAULT_TZ;
};

async function getVapid(env: Env): Promise<VapidKeys> {
  const existing = await getSetting<VapidKeys | null>(env, 'vapid', null);
  if (existing?.publicKey && existing.privateJwk) return existing;
  const keys = await generateVapidKeys();
  await putSetting(env, 'vapid', keys);
  return keys;
}

function validEndpoint(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 1000) return false;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'); // ใช้ทดสอบ
  } catch {
    return false;
  }
}

export async function sendToAll(env: Env, payload: unknown): Promise<{ total: number; sent: number; failed: number }> {
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth, fails FROM push_subs').all<PushSub & { fails: number }>();
  if (!results.length) return { total: 0, sent: 0, failed: 0 };
  const keys = await getVapid(env);
  const subject = await getSetting<string>(env, 'app_origin', 'mailto:maintenance-tracker@users.noreply.github.com');
  let sent = 0;
  let failed = 0;
  const now = Date.now();
  await Promise.all(
    results.map(async (s) => {
      const status = await sendPush(s, payload, keys, subject);
      if (status >= 200 && status < 300) {
        sent++;
        await env.DB.prepare('UPDATE push_subs SET last_ok = ?2, fails = 0 WHERE endpoint = ?1').bind(s.endpoint, now).run();
      } else {
        failed++;
        if (status === 404 || status === 410 || s.fails >= 20) {
          await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
        } else {
          await env.DB.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(s.endpoint).run();
        }
        console.warn('push_failed', status, new URL(s.endpoint).host);
      }
    })
  );
  return { total: results.length, sent, failed };
}

/** เส้นทาง /api/push/* และ /api/notify-settings */
export async function handlePush(req: Request, env: Env, url: URL, now: number): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/push/key' && method === 'GET') {
    const keys = await getVapid(env);
    const { results } = await env.DB.prepare('SELECT endpoint FROM push_subs').all<{ endpoint: string }>();
    return json({ publicKey: keys.publicKey, endpoints: results.map((r) => r.endpoint) });
  }

  if (path === '/api/push/subscribe' && method === 'POST') {
    const body = await readJson(req);
    const sub = body?.subscription;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!validEndpoint(sub?.endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) {
      return json({ error: 'bad_subscription' }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, ua, created_at, fails) VALUES (?1, ?2, ?3, ?4, ?5, 0)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0`
    )
      .bind(sub.endpoint, p256dh, auth, clip(req.headers.get('user-agent'), 200), now)
      .run();
    if (validTz(body?.tz)) await putSetting(env, 'tz', body.tz);
    if (url.protocol === 'https:') await putSetting(env, 'app_origin', url.origin);
    return json({ ok: true });
  }

  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body?.endpoint === 'string') await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(body.endpoint).run();
    return json({ ok: true });
  }

  if (path === '/api/push/test' && method === 'POST') {
    const r = await sendToAll(env, {
      tag: 'test',
      title: 'ทดสอบการแจ้งเตือน',
      body: 'ถ้าเห็นข้อความนี้ แปลว่าการเตือนงานดูแลอุปกรณ์ใช้งานได้แล้ว',
      url: '/#/settings',
    });
    return json({ ok: true, ...r });
  }

  if (path === '/api/notify-settings' && method === 'GET') {
    return json({ hour: await getSetting<number>(env, 'remind_hour', 8), tz: await getTz(env) });
  }
  if (path === '/api/notify-settings' && method === 'PUT') {
    const body = await readJson(req);
    const hour = Number(body?.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return json({ error: 'bad_hour' }, 400);
    await putSetting(env, 'remind_hour', hour);
    if (validTz(body?.tz)) await putSetting(env, 'tz', body.tz);
    return json({ ok: true, hour });
  }

  return null;
}
