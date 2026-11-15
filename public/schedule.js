/**
 * คำนวณรอบดูแลอุปกรณ์ — ใช้ร่วมกันทั้งหน้าเว็บและ Worker (cron เตือน)
 *
 * หลักการ: รอบถัดไปนับจาก "ครั้งล่าสุดที่ทำจริง" (ทำช้า รอบถัดไปก็เลื่อนตาม)
 *   - ตามเวลา: ทุก n วัน/สัปดาห์/เดือน/ปี
 *   - ตามเลขไมล์/ชั่วโมงใช้งาน: ทุก n กม. (ถ้ามีทั้งสองแบบ ใช้อันที่ถึงก่อน)
 *   - ครั้งเดียว: ตามวันที่กำหนด (ทำแล้วถือว่าเสร็จ)
 * วันที่เป็นสตริง 'YYYY-MM-DD' ตามเวลาท้องถิ่น
 */

const pad = (n) => String(n).padStart(2, '0');

export function parseDate(/** @type {string} */ s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
export function fmtDate(/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
const daysInMonth = (/** @type {number} */ y, /** @type {number} */ m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** บวกเดือน ยึดวันที่เดิม (ถ้าเดือนนั้นไม่มีวันที่นั้น ใช้วันสุดท้ายของเดือน) */
export function addMonths(/** @type {string} */ date, /** @type {number} */ n) {
  const { y, m, d } = parseDate(date);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmtDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export function addDays(/** @type {string} */ date, /** @type {number} */ n) {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** จำนวนวันจาก a ไป b (b − a) */
export function diffDays(/** @type {string} */ a, /** @type {string} */ b) {
  const A = parseDate(a);
  const B = parseDate(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

/** บวกช่วงเวลาตามหน่วย */
export function addInterval(/** @type {string} */ date, /** @type {number} */ every, /** @type {string} */ unit) {
  const n = Math.max(1, Number(every) || 1);
  if (unit === 'day') return addDays(date, n);
  if (unit === 'week') return addDays(date, 7 * n);
  if (unit === 'month') return addMonths(date, n);
  if (unit === 'year') return addMonths(date, 12 * n);
  return null;
}

const hasTime = (/** @type {any} */ t) => ['day', 'week', 'month', 'year'].includes(t.unit) && Number(t.every) > 0;
const hasMeter = (/** @type {any} */ t) => t.every_meter != null && Number(t.every_meter) > 0;

/** ระยะเตือนล่วงหน้าตามเลขไมล์ (ค่าเริ่มต้น 10% ของรอบ) */
export const remindMeterOf = (/** @type {any} */ t) =>
  t.remind_meter != null ? Number(t.remind_meter) : hasMeter(t) ? Math.ceil(Number(t.every_meter) * 0.1) : 0;

/** เลขไมล์/ชั่วโมงล่าสุดของอุปกรณ์ */
export function meterNow(/** @type {any} */ asset, /** @type {any[]} */ logs) {
  let v = asset.meter_start != null ? Number(asset.meter_start) : null;
  for (const l of logs) {
    if (l.asset_id !== asset.id || l.deleted || l.meter == null) continue;
    if (v == null || Number(l.meter) > v) v = Number(l.meter);
  }
  return v;
}

/**
 * อัตราการใช้งานต่อวัน (เช่น กม./วัน) จากบันทึกเลขไมล์ในช่วง 1 ปีล่าสุด
 * ต้องมีอย่างน้อย 2 จุดห่างกัน ≥ 14 วัน ไม่งั้นคืน null
 */
export function usageRate(/** @type {any} */ asset, /** @type {any[]} */ logs, /** @type {string} */ today) {
  const from = addDays(today, -365);
  const pts = [];
  if (asset.meter_start != null && asset.meter_start_date) pts.push({ date: asset.meter_start_date, meter: Number(asset.meter_start) });
  for (const l of logs) if (l.asset_id === asset.id && !l.deleted && l.meter != null) pts.push({ date: l.done_date, meter: Number(l.meter) });
  const win = pts.filter((p) => p.date >= from && p.date <= today).sort((a, b) => a.date.localeCompare(b.date) || a.meter - b.meter);
  if (win.length < 2) return null;
  const first = win[0];
  const last = win[win.length - 1];
  const days = diffDays(first.date, last.date);
  if (days < 14 || last.meter <= first.meter) return null;
  return (last.meter - first.meter) / days;
}

/** ครั้งล่าสุดที่ทำงานนี้ (ล่าสุดตามวันที่ แล้วตามเลขไมล์) */
export function lastDone(/** @type {any} */ task, /** @type {any[]} */ logs) {
  let best = null;
  for (const l of logs) {
    if (l.task_id !== task.id || l.kind !== 'done' || l.deleted) continue;
    if (!best || l.done_date > best.done_date || (l.done_date === best.done_date && (l.meter ?? -1) > (best.meter ?? -1))) best = l;
  }
  return best;
}

/**
 * สถานะของงานดูแล
 * @returns {{state: 'done'|'overdue'|'soon'|'ok', due_date: string|null, due_meter: number|null, days_left: number|null,
 *            meter_left: number|null, est_days: number|null, sort: number, last: any}}
 */
export function taskStatus(/** @type {any} */ task, /** @type {any} */ asset, /** @type {any[]} */ logs, /** @type {string} */ today) {
  const last = lastDone(task, logs);
  if (task.unit === 'once') {
    if (last) return { state: 'done', due_date: null, due_meter: null, days_left: null, meter_left: null, est_days: null, sort: 1e9, last };
  }
  let due_date = null;
  if (task.unit === 'once') due_date = task.first_due || null;
  else if (hasTime(task)) due_date = last ? addInterval(last.done_date, task.every, task.unit) : task.first_due || null;

  let due_meter = null;
  if (hasMeter(task)) {
    if (last && last.meter != null) due_meter = Number(last.meter) + Number(task.every_meter);
    else if (task.first_due_meter != null) due_meter = Number(task.first_due_meter);
  }

  const cur = meterNow(asset, logs);
  const days_left = due_date ? diffDays(today, due_date) : null;
  const meter_left = due_meter != null && cur != null ? due_meter - cur : null;
  const rate = meter_left != null ? usageRate(asset, logs, today) : null;
  const est_days = meter_left != null && rate ? Math.max(0, Math.round(meter_left / rate)) : null;

  const remindDays = Number(task.remind_days ?? 7);
  let state = 'ok';
  if ((days_left != null && days_left < 0) || (meter_left != null && meter_left <= 0)) state = 'overdue';
  else if (
    (days_left != null && days_left <= remindDays) ||
    (meter_left != null && meter_left <= remindMeterOf(task)) ||
    (est_days != null && est_days <= remindDays)
  )
    state = 'soon';

  const cands = [days_left, est_days].filter((v) => v != null);
  let sort = cands.length ? Math.min(...cands) : 1e8;
  if (meter_left != null && meter_left <= 0) sort = Math.min(sort, -1);
  return { state, due_date, due_meter, days_left, meter_left, est_days, sort, last };
}

/** จำนวนวันก่อนหมดประกัน (null ถ้าไม่ได้ระบุ) */
export const warrantyLeft = (/** @type {any} */ asset, /** @type {string} */ today) => (asset.warranty_until ? diffDays(today, asset.warranty_until) : null);

const UNIT_TH = /** @type {Record<string,string>} */ ({ day: 'วัน', week: 'สัปดาห์', month: 'เดือน', year: 'ปี' });

/** ข้อความรอบ เช่น "ทุก 6 เดือน หรือ 10,000 กม." */
export function intervalText(/** @type {any} */ task, /** @type {string} */ meterUnit, /** @type {(d: string) => string} */ fmtFull) {
  if (task.unit === 'once') return `ครั้งเดียว${task.first_due ? ` ${fmtFull(task.first_due)}` : ''}`;
  const parts = [];
  if (hasTime(task)) {
    const n = Number(task.every);
    parts.push(n === 1 && task.unit !== 'day' ? `ทุก${UNIT_TH[task.unit]}` : `ทุก ${n} ${UNIT_TH[task.unit]}`);
  }
  if (hasMeter(task)) parts.push(`${parts.length ? '' : 'ทุก '}${Number(task.every_meter).toLocaleString('th-TH')} ${meterUnit || 'หน่วย'}`);
  return parts.join(' หรือ ') || 'ไม่ได้ตั้งรอบ';
}
