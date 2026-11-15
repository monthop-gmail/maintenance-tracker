/**
 * Maintenance Tracker — ดูแลอุปกรณ์ตามรอบ (เวลา/เลขไมล์) ประวัติซ่อม ประกัน และเตือนก่อนถึงกำหนด
 * Cloudflare Worker + D1
 *
 *   POST /api/login {password} · POST /api/logout · GET /api/me
 *   อุปกรณ์ งานดูแล บันทึก → src/assets.ts
 *   การแจ้งเตือน     → src/notify.ts
 */
import { Env, HttpError, json } from './util';
import { handleLogin, isAuthed, passwordReady, cookieHeader } from './auth';
import { handleAssets, runDaily } from './assets';
import { handlePush } from './notify';

export type { Env };

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // กัน CSRF: คำขอที่แก้ข้อมูลต้องมาจาก origin เดียวกัน
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ error: 'bad_origin' }, 403);
  }

  if (path === '/api/login' && method === 'POST') return handleLogin(req, env, url);
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookieHeader(url, '', 0) });

  if (!(await isAuthed(req, env))) {
    return json({ error: passwordReady(env) ? 'unauthorized' : 'password_not_configured' }, 401);
  }

  const now = Date.now();
  if (path === '/api/me' && method === 'GET') return json({ ok: true, now });

  const r = (await handleAssets(req, env, url, now)) ?? (await handlePush(req, env, url, now));
  if (r) return r;

  // ทดลองส่งสรุปรายวันทันที (ใช้ตรวจสอบหลังตั้งค่า)
  if (path === '/api/push/daily-now' && method === 'POST') return json({ ok: true, ...(await runDaily(env, now, true)) });

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code }, err.status);
      console.error('api_error', err);
      return json({ error: 'server_error' }, 500);
    }
  },

  // Cron ทุกชั่วโมง: ส่งสรุปงานดูแลที่ใกล้ถึง/เลยกำหนด และประกันใกล้หมด ตามเวลาที่ตั้งไว้
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDaily(env, controller.scheduledTime).then(
        (r) => r.items && console.log('daily_reminder', JSON.stringify(r)),
        (err) => console.error('daily_reminder_error', err)
      )
    );
  },
} satisfies ExportedHandler<Env>;
