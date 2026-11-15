/**
 * อุปกรณ์ (assets) งานดูแลตามรอบ (tasks) และบันทึก (logs)
 *
 *   GET    /api/data                 → {assets, tasks, logs, categories}
 *   POST   /api/sync                 {ops:[{type:'put',log} | {type:'del',id,updated_at}]}
 *   POST   /api/logs                 {asset, task?, kind?, date?, meter?, cost?, provider?, note?}  → บันทึกผ่าน Shortcuts/สคริปต์
 *   PUT    /api/assets/:id           {asset}
 *   DELETE /api/assets/:id           (ลบงานของอุปกรณ์นี้ด้วย และซ่อนบันทึก)
 *   PUT    /api/tasks/:id            {task}
 *   DELETE /api/tasks/:id            (บันทึกเดิมยังอยู่)
 *   GET/PUT /api/categories, POST /api/categories/reset
 */
import { Env, json, readJson, ID_RE, MIN_TS, getSetting, putSetting, clip } from './util';
import { localParts, getTz, sendToAll } from './notify';
import { taskStatus, warrantyLeft, addDays } from '../public/schedule.js';

export type Category = { key: string; label: string; emoji: string; hidden?: boolean };
export type Asset = {
  id: string;
  name: string;
  category: string;
  location: string;
  brand: string;
  model: string;
  serial: string;
  purchase_date: string | null;
  price: number | null;
  warranty_until: string | null;
  warranty_remind_days: number;
  contact: string;
  notes: string;
  meter_unit: string;
  meter_start: number | null;
  meter_start_date: string | null;
  active: boolean;
  created_at?: number;
  updated_at: number;
};
export type Task = {
  id: string;
  asset_id: string;
  name: string;
  unit: string;
  every: number | null;
  every_meter: number | null;
  first_due: string | null;
  first_due_meter: number | null;
  remind_days: number;
  remind_meter: number | null;
  est_cost: number | null;
  notes: string;
  active: boolean;
  updated_at: number;
};
export type Log = {
  id: string;
  asset_id: string;
  task_id: string | null;
  kind: 'done' | 'repair' | 'reading' | 'note';
  done_date: string;
  title: string;
  meter: number | null;
  cost: number | null;
  provider: string;
  note: string;
  updated_at: number;
};

export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'car', label: 'รถยนต์', emoji: '🚗' },
  { key: 'motorcycle', label: 'มอเตอร์ไซค์', emoji: '🛵' },
  { key: 'aircon', label: 'แอร์', emoji: '❄️' },
  { key: 'appliance', label: 'เครื่องใช้ไฟฟ้า', emoji: '🧺' },
  { key: 'water', label: 'น้ำ/ปั๊ม/กรองน้ำ', emoji: '💧' },
  { key: 'electronics', label: 'คอมพิวเตอร์/ไอที', emoji: '💻' },
  { key: 'safety', label: 'ความปลอดภัย', emoji: '🧯' },
  { key: 'home', label: 'บ้าน/โครงสร้าง', emoji: '🏠' },
  { key: 'garden', label: 'สวน/เครื่องมือ', emoji: '🌳' },
  { key: 'other', label: 'อื่น ๆ', emoji: '📦' },
];

const CAT_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const DATE_RE = /^(20\d\d|21\d\d|19\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UNITS = new Set(['day', 'week', 'month', 'year', 'once', '']);
const KINDS = new Set(['done', 'repair', 'reading', 'note']);
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v);
const optDate = (v: unknown): string | null | 'bad' => (v == null || v === '' ? null : isDate(v) ? v : 'bad');
const num = (v: unknown, max = 1e10): number | null | 'bad' => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : 'bad';
};

// ---------- หมวด ----------
function validateCategories(input: any): Category[] | string {
  if (!Array.isArray(input) || input.length < 1 || input.length > 40) return 'bad_categories';
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const c of input) {
    const key = String(c?.key ?? '');
    if (!CAT_KEY_RE.test(key) || seen.has(key)) return 'bad_category_key';
    seen.add(key);
    const label = clip(c.label, 30);
    if (!label) return 'bad_category_label';
    out.push({ key, label, emoji: clip(c.emoji, 16), hidden: !!c.hidden });
  }
  return out;
}
async function getCategories(env: Env): Promise<Category[]> {
  const v = validateCategories(await getSetting<unknown>(env, 'categories', null));
  return typeof v === 'string' ? DEFAULT_CATEGORIES : v;
}

// ---------- แปลงแถว ----------
const rowAsset = (r: any): Asset => ({ ...r, active: !!r.active });
const rowTask = (r: any): Task => ({ ...r, active: !!r.active });
const rowLog = (r: any): Log => {
  const { deleted, created_at, ...rest } = r;
  return rest;
};

// ---------- ตรวจข้อมูล ----------
function validateAsset(id: string, a: any, now: number): Asset | string {
  if (!a || typeof a !== 'object') return 'bad_asset';
  const name = clip(a.name, 120);
  if (!name) return 'name_required';
  const purchase = optDate(a.purchase_date);
  const warranty = optDate(a.warranty_until);
  const startDate = optDate(a.meter_start_date);
  if (purchase === 'bad' || warranty === 'bad' || startDate === 'bad') return 'bad_date';
  const price = num(a.price);
  const meterStart = num(a.meter_start, 1e9);
  if (price === 'bad' || meterStart === 'bad') return 'bad_number';
  const wr = Number(a.warranty_remind_days ?? 30);
  return {
    id,
    name,
    category: CAT_KEY_RE.test(String(a.category ?? '')) ? String(a.category) : 'other',
    location: clip(a.location, 80),
    brand: clip(a.brand, 80),
    model: clip(a.model, 80),
    serial: clip(a.serial, 80),
    purchase_date: purchase,
    price,
    warranty_until: warranty,
    warranty_remind_days: Number.isInteger(wr) && wr >= 0 && wr <= 365 ? wr : 30,
    contact: clip(a.contact, 300),
    notes: clip(a.notes, 2000),
    meter_unit: clip(a.meter_unit, 10),
    meter_start: meterStart,
    meter_start_date: meterStart != null ? startDate ?? new Date(now).toISOString().slice(0, 10) : null,
    active: a.active !== false,
    updated_at: now,
  };
}

function validateTask(id: string, t: any, now: number): Task | string {
  if (!t || typeof t !== 'object') return 'bad_task';
  if (typeof t.asset_id !== 'string' || !ID_RE.test(t.asset_id)) return 'bad_asset_id';
  const name = clip(t.name, 120);
  if (!name) return 'name_required';
  const unit = String(t.unit ?? '');
  if (!UNITS.has(unit)) return 'bad_unit';
  const every = t.every == null || t.every === '' ? null : Number(t.every);
  if (every !== null && (!Number.isInteger(every) || every < 1 || every > 1000)) return 'bad_every';
  const everyMeter = num(t.every_meter, 1e7);
  const firstDue = optDate(t.first_due);
  const firstDueMeter = num(t.first_due_meter, 1e9);
  const remindMeter = num(t.remind_meter, 1e7);
  const estCost = num(t.est_cost);
  if (everyMeter === 'bad' || firstDueMeter === 'bad' || remindMeter === 'bad' || estCost === 'bad') return 'bad_number';
  if (firstDue === 'bad') return 'bad_first_due';
  const timed = ['day', 'week', 'month', 'year'].includes(unit);
  if (timed && !every) return 'every_required';
  if (unit === 'once' && !firstDue) return 'first_due_required';
  if (!timed && unit !== 'once' && !everyMeter) return 'schedule_required';
  const remind = Number(t.remind_days ?? 7);
  return {
    id,
    asset_id: t.asset_id,
    name,
    unit,
    every: timed ? every : null,
    every_meter: unit === 'once' ? null : everyMeter,
    first_due: firstDue,
    first_due_meter: unit === 'once' ? null : firstDueMeter,
    remind_days: Number.isInteger(remind) && remind >= 0 && remind <= 365 ? remind : 7,
    remind_meter: remindMeter,
    est_cost: estCost,
    notes: clip(t.notes, 1000),
    active: t.active !== false,
    updated_at: now,
  };
}

function validateLog(l: any, now: number): Log | string {
  if (!l || typeof l !== 'object') return 'bad_log';
  if (typeof l.id !== 'string' || !ID_RE.test(l.id)) return 'bad_id';
  if (typeof l.asset_id !== 'string' || !ID_RE.test(l.asset_id)) return 'bad_asset_id';
  const task_id = l.task_id == null ? null : String(l.task_id);
  if (task_id !== null && !ID_RE.test(task_id)) return 'bad_task_id';
  if (!KINDS.has(l.kind)) return 'bad_kind';
  if (!isDate(l.done_date)) return 'bad_date';
  const meter = num(l.meter, 1e9);
  const cost = num(l.cost);
  if (meter === 'bad' || cost === 'bad') return 'bad_number';
  let updated = Number(l.updated_at);
  if (!Number.isFinite(updated) || updated < MIN_TS || updated > now + 60000) updated = now;
  return {
    id: l.id,
    asset_id: l.asset_id,
    task_id,
    kind: l.kind,
    done_date: l.done_date,
    title: clip(l.title, 160),
    meter,
    cost,
    provider: clip(l.provider, 120),
    note: clip(l.note, 2000),
    updated_at: Math.round(updated),
  };
}

function upsertLog(env: Env, l: Log, now: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO logs (id, asset_id, task_id, kind, done_date, title, meter, cost, provider, note, deleted, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?12, ?11)
     ON CONFLICT(id) DO UPDATE SET asset_id = excluded.asset_id, task_id = excluded.task_id, kind = excluded.kind,
       done_date = excluded.done_date, title = excluded.title, meter = excluded.meter, cost = excluded.cost,
       provider = excluded.provider, note = excluded.note, deleted = 0, updated_at = excluded.updated_at
     WHERE excluded.updated_at >= logs.updated_at`
  ).bind(l.id, l.asset_id, l.task_id, l.kind, l.done_date, l.title, l.meter, l.cost, l.provider, l.note, l.updated_at, now);
}

const listAll = async (env: Env) => {
  const [a, t, l] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM assets ORDER BY active DESC, name'),
    env.DB.prepare('SELECT * FROM tasks ORDER BY name'),
    env.DB.prepare('SELECT * FROM logs WHERE deleted = 0 ORDER BY done_date DESC LIMIT 50000'),
  ]);
  return { assets: a.results.map(rowAsset), tasks: t.results.map(rowTask), logs: l.results.map(rowLog) };
};

// ---------- routes ----------
export async function handleAssets(req: Request, env: Env, url: URL, now: number): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/data' && method === 'GET') {
    const [all, categories] = await Promise.all([listAll(env), getCategories(env)]);
    return json({ ...all, categories });
  }

  if (path === '/api/sync' && method === 'POST') {
    const body = await readJson(req);
    const ops = body?.ops;
    if (!Array.isArray(ops) || ops.length > 500) return json({ error: 'bad_ops' }, 400);
    const stmts: D1PreparedStatement[] = [];
    const rejected: { index: number; error: string }[] = [];
    ops.forEach((op: any, index: number) => {
      if (op?.type === 'put') {
        const v = validateLog(op.log, now);
        if (typeof v === 'string') rejected.push({ index, error: v });
        else stmts.push(upsertLog(env, v, now));
      } else if (op?.type === 'del') {
        if (typeof op.id !== 'string' || !ID_RE.test(op.id)) return void rejected.push({ index, error: 'bad_id' });
        let u = Number(op.updated_at);
        if (!Number.isFinite(u) || u > now + 60000) u = now;
        stmts.push(env.DB.prepare('UPDATE logs SET deleted = 1, updated_at = ?2 WHERE id = ?1 AND updated_at <= ?2').bind(op.id, u));
      } else rejected.push({ index, error: 'bad_op' });
    });
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, applied: stmts.length, rejected });
  }

  if (path === '/api/logs' && method === 'POST') {
    // สำหรับ iOS Shortcuts / สคริปต์: อ้างอุปกรณ์และงานด้วยชื่อหรือ id
    const body = await readJson(req);
    const all = await listAll(env);
    const key = clip(body?.asset, 120);
    const asset = all.assets.find((a) => a.id === key || a.name === key);
    if (!asset) return json({ error: 'unknown_asset', assets: all.assets.map((a) => a.name) }, 400);
    const tkey = clip(body?.task, 120);
    const task = tkey ? all.tasks.find((t) => t.asset_id === asset.id && (t.id === tkey || t.name === tkey)) : undefined;
    if (tkey && !task) return json({ error: 'unknown_task', tasks: all.tasks.filter((t) => t.asset_id === asset.id).map((t) => t.name) }, 400);
    const tz = await getTz(env);
    const v = validateLog(
      {
        id: crypto.randomUUID(),
        asset_id: asset.id,
        task_id: task ? task.id : null,
        kind: body?.kind ?? (task ? 'done' : body?.meter != null && !body?.note ? 'reading' : 'repair'),
        done_date: body?.date ?? localParts(now, tz).date,
        title: body?.title ?? (task ? task.name : ''),
        meter: body?.meter,
        cost: body?.cost,
        provider: body?.provider,
        note: body?.note,
        updated_at: now,
      },
      now
    );
    if (typeof v === 'string') return json({ error: v }, 400);
    await upsertLog(env, v, now).run();
    return json({ ok: true, log: v }, 201);
  }

  let m = path.match(/^\/api\/assets\/([A-Za-z0-9_-]{8,64})$/);
  if (m && method === 'PUT') {
    const body = await readJson(req);
    const v = validateAsset(m[1], body?.asset, now);
    if (typeof v === 'string') return json({ error: v }, 400);
    await env.DB.prepare(
      `INSERT INTO assets (id, name, category, location, brand, model, serial, purchase_date, price, warranty_until, warranty_remind_days,
         contact, notes, meter_unit, meter_start, meter_start_date, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, location = excluded.location,
         brand = excluded.brand, model = excluded.model, serial = excluded.serial, purchase_date = excluded.purchase_date,
         price = excluded.price, warranty_until = excluded.warranty_until, warranty_remind_days = excluded.warranty_remind_days,
         contact = excluded.contact, notes = excluded.notes, meter_unit = excluded.meter_unit, meter_start = excluded.meter_start,
         meter_start_date = excluded.meter_start_date, active = excluded.active, updated_at = excluded.updated_at`
    )
      .bind(v.id, v.name, v.category, v.location, v.brand, v.model, v.serial, v.purchase_date, v.price, v.warranty_until, v.warranty_remind_days,
        v.contact, v.notes, v.meter_unit, v.meter_start, v.meter_start_date, v.active ? 1 : 0, now)
      .run();
    const saved = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(v.id).first();
    return json({ ok: true, asset: rowAsset(saved) });
  }
  if (m && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tasks WHERE asset_id = ?').bind(m[1]),
      env.DB.prepare('UPDATE logs SET deleted = 1, updated_at = ?2 WHERE asset_id = ?1').bind(m[1], now),
      env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(m[1]),
    ]);
    return json({ ok: true });
  }

  m = path.match(/^\/api\/tasks\/([A-Za-z0-9_-]{8,64})$/);
  if (m && method === 'PUT') {
    const body = await readJson(req);
    const v = validateTask(m[1], body?.task, now);
    if (typeof v === 'string') return json({ error: v }, 400);
    await env.DB.prepare(
      `INSERT INTO tasks (id, asset_id, name, unit, every, every_meter, first_due, first_due_meter, remind_days, remind_meter, est_cost, notes, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
       ON CONFLICT(id) DO UPDATE SET asset_id = excluded.asset_id, name = excluded.name, unit = excluded.unit, every = excluded.every,
         every_meter = excluded.every_meter, first_due = excluded.first_due, first_due_meter = excluded.first_due_meter,
         remind_days = excluded.remind_days, remind_meter = excluded.remind_meter, est_cost = excluded.est_cost,
         notes = excluded.notes, active = excluded.active, updated_at = excluded.updated_at`
    )
      .bind(v.id, v.asset_id, v.name, v.unit, v.every, v.every_meter, v.first_due, v.first_due_meter, v.remind_days, v.remind_meter, v.est_cost, v.notes, v.active ? 1 : 0, now)
      .run();
    const saved = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(v.id).first();
    return json({ ok: true, task: rowTask(saved) });
  }
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(m[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/categories' && method === 'GET') return json({ categories: await getCategories(env) });
  if (path === '/api/categories' && method === 'PUT') {
    const body = await readJson(req);
    const v = validateCategories(body?.categories);
    if (typeof v === 'string') return json({ error: v }, 400);
    await putSetting(env, 'categories', v);
    return json({ ok: true, categories: v });
  }
  if (path === '/api/categories/reset' && method === 'POST') {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'categories'").run();
    return json({ ok: true, categories: DEFAULT_CATEGORIES });
  }

  return null;
}

// ---------- สรุปรายวัน (cron รายชั่วโมง) ----------

const fmtN = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

export function itemsToRemind(assets: Asset[], tasks: Task[], logs: Log[], today: string) {
  const items: { sort: number; overdue: boolean; line: string }[] = [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const t of tasks) {
    const a = byId.get(t.asset_id);
    if (!t.active || !a || !a.active) continue;
    const s = taskStatus(t, a, logs, today);
    if (s.state !== 'overdue' && s.state !== 'soon') continue;
    const unit = a.meter_unit || 'หน่วย';
    const bits: string[] = [];
    if (s.days_left != null) bits.push(s.days_left < 0 ? `เลย ${-s.days_left} วัน` : s.days_left === 0 ? 'วันนี้' : `อีก ${s.days_left} วัน`);
    if (s.meter_left != null) bits.push(s.meter_left <= 0 ? `เกิน ${fmtN(-s.meter_left)} ${unit}` : `อีก ${fmtN(s.meter_left)} ${unit}`);
    items.push({ sort: s.sort, overdue: s.state === 'overdue', line: `• ${t.name} — ${a.name} (${bits.join(', ') || 'ครบกำหนด'})` });
  }
  for (const a of assets) {
    if (!a.active) continue;
    const w = warrantyLeft(a, today);
    if (w != null && w >= 0 && w <= a.warranty_remind_days) {
      items.push({ sort: w, overdue: false, line: `• ประกัน ${a.name} หมด${w === 0 ? 'วันนี้' : `ในอีก ${w} วัน`}` });
    }
  }
  return items.sort((x, y) => x.sort - y.sort);
}

export async function runDaily(env: Env, now = Date.now(), force = false): Promise<{ items: number; sent: number }> {
  const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first<{ n: number }>();
  if (!subs?.n) return { items: 0, sent: 0 };
  const [tz, hour] = await Promise.all([getTz(env), getSetting<number>(env, 'remind_hour', 8)]);
  const { date, minutes } = localParts(now, tz);
  const h = Math.floor(minutes / 60);
  if (!force && (h < hour || h > hour + 2)) return { items: 0, sent: 0 };

  const key = `daily:${date}`;
  if (!force) {
    const r = await env.DB.prepare('INSERT INTO reminders_sent (key, sent_at) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING').bind(key, now).run();
    if (!r.meta.changes) return { items: 0, sent: 0 };
  }

  const all = await listAll(env);
  const items = itemsToRemind(all.assets, all.tasks, all.logs, date);
  if (!items.length) return { items: 0, sent: 0 };
  const overdue = items.filter((i) => i.overdue).length;
  const lines = items.slice(0, 12).map((i) => i.line);
  if (items.length > 12) lines.push(`และอีก ${items.length - 12} รายการ`);
  const res = await sendToAll(env, {
    tag: `daily-${date}`,
    title: overdue ? `มีงานดูแลเลยกำหนด ${overdue} รายการ` : `งานดูแลอุปกรณ์ที่ใกล้ถึง ${items.length} รายการ`,
    body: lines.join('\n'),
    url: '/',
  });
  if (!force && res.total > 0 && res.sent === 0) {
    await env.DB.prepare('DELETE FROM reminders_sent WHERE key = ?').bind(key).run();
  }
  if (minutes < 60) await env.DB.prepare('DELETE FROM reminders_sent WHERE sent_at < ?').bind(now - 60 * 86400000).run();
  return { items: items.length, sent: res.sent };
}

export { addDays };
