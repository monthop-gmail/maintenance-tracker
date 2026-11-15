/* ดูแลอุปกรณ์ — frontend (ES module, ไม่ต้อง build)
 * - บันทึก (ทำแล้ว/ซ่อม/จดเลขไมล์) เก็บลงเครื่องก่อน แล้วส่งขึ้นเซิร์ฟเวอร์ผ่าน outbox → ใช้ได้แม้เน็ตหลุด
 * - การคำนวณรอบใช้ schedule.js ไฟล์เดียวกับฝั่ง Worker
 */
import { taskStatus, meterNow, usageRate, intervalText, warrantyLeft, addInterval, addDays, addMonths, diffDays, parseDate } from './schedule.js';

const app = document.getElementById('app');
const sheetEl = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// ---------- วันที่ / ตัวเลข ----------
const localDate = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => localDate();
const dateObj = (s) => {
  const { y, m, d } = parseDate(s);
  return new Date(y, m - 1, d);
};
const F_FULL = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const F_DM = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });
const F_WD = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const F_MON = new Intl.DateTimeFormat('th-TH', { month: 'short' });
const F_MONTH = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' });
const F_LONG = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtFull = (s) => F_FULL.format(dateObj(s));
const NUM = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const MONEY2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baht = (n) => (n == null ? '' : `฿${(Math.round(n * 100) % 100 ? MONEY2 : MONEY).format(n)}`);
const fmtN = (n) => NUM.format(n);
const monthOf = (s) => s.slice(0, 7);
const monthLabel = (ym) => F_MONTH.format(dateObj(`${ym}-01`));

const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  todo: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'),
  box: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
};

// ---------- ค่าคงที่ ----------
const FALLBACK_CATS = [{ key: 'other', label: 'อื่น ๆ', emoji: '📦' }];
const UNIT_TH = { day: 'วัน', week: 'สัปดาห์', month: 'เดือน', year: 'ปี' };
const FREQS = [
  ['month', 1, 'ทุกเดือน'],
  ['month', 3, 'ทุก 3 เดือน'],
  ['month', 6, 'ทุก 6 เดือน'],
  ['year', 1, 'ทุกปี'],
  ['once', null, 'ครั้งเดียว'],
];
const KIND = {
  done: { icon: '✅', label: 'ดูแลตามรอบ' },
  repair: { icon: '🔧', label: 'ซ่อม/เปลี่ยนอะไหล่' },
  reading: { icon: '📏', label: 'จดเลขไมล์' },
  note: { icon: '📝', label: 'บันทึกอื่น' },
};
// งานแนะนำตามประเภทอุปกรณ์: [ชื่อ, ทุกกี่, หน่วย, ทุกกี่ กม., เลือกไว้ก่อน]
const TEMPLATES = {
  car: {
    meter: 'กม.',
    tasks: [
      ['เปลี่ยนน้ำมันเครื่อง', 6, 'month', 10000, true],
      ['ตรวจลมยาง', 1, 'month', null, true],
      ['เปลี่ยนไส้กรองอากาศ/แอร์รถ', 1, 'year', 20000, false],
      ['สลับยาง', 1, 'year', 10000, false],
      ['เปลี่ยนน้ำมันเบรก', 2, 'year', 40000, false],
      ['เปลี่ยนแบตเตอรี่', 2, 'year', null, false],
      ['เปลี่ยนยาง', 4, 'year', 50000, false],
    ],
  },
  motorcycle: {
    meter: 'กม.',
    tasks: [
      ['เปลี่ยนน้ำมันเครื่อง', 3, 'month', 3000, true],
      ['เช็กโซ่/สายพาน', 6, 'month', 6000, false],
      ['เปลี่ยนยาง', 2, 'year', 15000, false],
    ],
  },
  aircon: { tasks: [['ล้างแอร์', 6, 'month', null, true], ['ล้างฟิลเตอร์', 1, 'month', null, false]] },
  appliance: {
    tasks: [
      ['ล้างถังเครื่องซักผ้า', 1, 'month', null, false],
      ['ทำความสะอาดแผงคอยล์ตู้เย็น', 6, 'month', null, false],
      ['ล้างเครื่องทำน้ำอุ่น/หัวฝักบัว', 6, 'month', null, false],
    ],
  },
  water: { tasks: [['เปลี่ยนไส้กรองน้ำ', 6, 'month', null, true], ['ตรวจปั๊มน้ำ', 6, 'month', null, false], ['ล้างแท็งก์น้ำ', 1, 'year', null, false]] },
  electronics: { tasks: [['สำรองข้อมูล', 1, 'month', null, true], ['ทำความสะอาด/เป่าฝุ่น', 1, 'year', null, false], ['อัปเดตระบบ', 3, 'month', null, false]] },
  safety: {
    tasks: [
      ['ตรวจเกจถังดับเพลิง', 1, 'month', null, true],
      ['เปลี่ยนถ่านเครื่องตรวจจับควัน', 1, 'year', null, false],
      ['อัดสาร/เปลี่ยนถังดับเพลิง', 5, 'year', null, false],
    ],
  },
  home: { tasks: [['ล้างรางน้ำฝน', 1, 'year', null, true], ['ฉีดกันปลวก', 1, 'year', null, false], ['ตรวจรอยรั่วหลังคา', 1, 'year', null, false]] },
  garden: { tasks: [['ลับใบมีด/ดูแลเครื่องตัดหญ้า', 1, 'year', null, true]] },
};

// ---------- state ----------
const cache = store.get('mt_cache', {});
const state = {
  authed: null,
  view: 'home',
  assetId: null,
  online: true,
  syncing: false,
  lastRefresh: 0,
  assets: cache.assets || [],
  tasks: cache.tasks || [],
  categories: cache.categories || FALLBACK_CATS,
  logs: new Map((cache.logs || []).map((l) => [l.id, l])),
  outbox: store.get('mt_outbox', []),
  seq: store.get('mt_seq', 0),
  touched: new Map(),
  hist: { month: monthOf(today()), q: '' },
};

const catOf = (key) => state.categories.find((c) => c.key === key) || { key, label: key || 'อื่น ๆ', emoji: '📦' };
const assetOf = (id) => state.assets.find((a) => a.id === id);
const taskOf = (id) => state.tasks.find((t) => t.id === id);
const logList = () => [...state.logs.values()];

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('network');
    err.network = true;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  return data;
}

function handleErr(e) {
  if (e.status === 401) {
    showLogin();
    return true;
  }
  if (e.network) {
    state.online = false;
    updateSync();
    return true;
  }
  return false;
}

// ---------- outbox / sync ----------
const opId = (o) => (o.type === 'put' ? o.log.id : o.id);
const persistOutbox = () => {
  store.set('mt_outbox', state.outbox);
  store.set('mt_seq', state.seq);
};
const pendingIds = () => new Set(state.outbox.filter((o) => o.type === 'put').map((o) => o.log.id));

function queue(op) {
  const id = opId(op);
  state.outbox = state.outbox.filter((o) => opId(o) !== id);
  op.seq = ++state.seq;
  state.outbox.push(op);
  persistOutbox();
  updateSync();
}

function applyOutbox(map) {
  for (const o of state.outbox) {
    if (o.type === 'put') map.set(o.log.id, o.log);
    else map.delete(o.id);
  }
}

async function flush() {
  if (state.syncing || !state.outbox.length || state.authed === false) return;
  state.syncing = true;
  updateSync();
  const batch = state.outbox.slice(0, 200);
  let again = false;
  try {
    const r = await api('/api/sync', { method: 'POST', body: { ops: batch.map(({ seq, ...o }) => o) } });
    const sent = new Set(batch.map((o) => o.seq));
    state.outbox = state.outbox.filter((o) => !sent.has(o.seq));
    persistOutbox();
    state.online = true;
    if (r.rejected && r.rejected.length) toast(`มี ${r.rejected.length} รายการที่ระบบไม่รับ (ข้อมูลไม่ถูกต้อง)`);
    again = state.outbox.length > 0;
  } catch (e) {
    if (e.status === 400) {
      const sent = new Set(batch.map((o) => o.seq));
      state.outbox = state.outbox.filter((o) => !sent.has(o.seq));
      persistOutbox();
      toast('ส่งข้อมูลบางส่วนไม่สำเร็จ');
    } else handleErr(e);
  } finally {
    state.syncing = false;
    updateSync();
    if (state.view === 'home') renderHome();
  }
  if (again) flush();
}

function saveCache() {
  store.set('mt_cache', { assets: state.assets, tasks: state.tasks, categories: state.categories, logs: logList().slice(0, 8000) });
}

function saveLog(l) {
  const log = {
    id: l.id,
    asset_id: l.asset_id,
    task_id: l.task_id ?? null,
    kind: l.kind,
    done_date: l.done_date,
    title: (l.title || '').trim(),
    meter: l.meter ?? null,
    cost: l.cost ?? null,
    provider: (l.provider || '').trim(),
    note: (l.note || '').trim(),
    updated_at: Date.now(),
  };
  state.logs.set(log.id, log);
  state.touched.set(log.id, { at: log.updated_at, log });
  queue({ type: 'put', log });
  saveCache();
  rerender();
  flush();
  return log;
}

function deleteLog(id, { silent } = {}) {
  const old = state.logs.get(id);
  if (!old) return;
  const at = Date.now();
  state.logs.delete(id);
  state.touched.set(id, { at, log: null });
  queue({ type: 'del', id, updated_at: at });
  saveCache();
  rerender();
  flush();
  if (!silent) toast('ลบแล้ว', { label: 'เลิกทำ', fn: () => saveLog(old) });
}

async function refresh() {
  const t0 = Date.now();
  state.lastRefresh = t0;
  try {
    const r = await api('/api/data');
    const map = new Map(r.logs.map((l) => [l.id, l]));
    applyOutbox(map);
    for (const [id, t] of state.touched) {
      if (t.at >= t0 - 2000) t.log ? map.set(id, t.log) : map.delete(id);
      else if (Date.now() - t.at > 5 * 60000) state.touched.delete(id);
    }
    state.assets = r.assets;
    state.tasks = r.tasks;
    state.categories = r.categories;
    state.logs = map;
    state.online = true;
    saveCache();
    rerender();
  } catch (e) {
    handleErr(e);
  }
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  if (action) {
    $('button', toastEl).onclick = () => {
      toastEl.hidden = true;
      action.fn();
    };
  }
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 2600);
}

function updateSync() {
  const n = state.outbox.length;
  let cls = '';
  let txt = '';
  if (!state.online) {
    cls = 'off';
    txt = n ? `ออฟไลน์ · รอส่ง ${n} รายการ (บันทึกไว้ในเครื่องแล้ว)` : 'ออฟไลน์ — ยังบันทึกได้ตามปกติ';
  } else if (n) {
    cls = 'wait';
    txt = state.syncing ? `กำลังส่ง ${n} รายการ…` : `รอส่ง ${n} รายการ`;
  }
  for (const el of $$('.sync')) {
    el.className = `sync ${cls}`;
    el.textContent = txt;
    el.hidden = !txt;
  }
  const p = $('#pending-count');
  if (p) p.textContent = String(n);
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function toCSV(list) {
  const rows = [['วันที่', 'อุปกรณ์', 'ประเภทบันทึก', 'รายการ', 'เลขไมล์', 'ค่าใช้จ่าย', 'ผู้ทำ/ร้าน', 'หมายเหตุ']];
  for (const l of [...list].sort((a, b) => a.done_date.localeCompare(b.done_date))) {
    const a = assetOf(l.asset_id);
    rows.push([l.done_date, a ? a.name : '', KIND[l.kind]?.label || l.kind, logTitle(l), l.meter ?? '', l.cost ?? '', l.provider, l.note]);
  }
  const cell = (v) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

const NAV = [
  ['home', '#/', 'ต้องทำ', 'todo'],
  ['assets', '#/assets', 'อุปกรณ์', 'box'],
  ['history', '#/history', 'ประวัติ', 'history'],
  ['settings', '#/settings', 'ตั้งค่า', 'settings'],
];
const nav = () => {
  const cur = state.view === 'asset' ? 'assets' : state.view;
  return `<nav class="tabbar no-print" aria-label="เมนูหลัก">${NAV.map(
    ([v, href, label, icon]) => `<a href="${href}" class="${cur === v ? 'on' : ''}"${cur === v ? ' aria-current="page"' : ''}>${ICON[icon]}<span>${label}</span></a>`
  ).join('')}</nav>`;
};

function rerender() {
  const y = window.scrollY;
  if (state.view === 'home') renderHome();
  else if (state.view === 'assets') renderAssets();
  else if (state.view === 'asset') renderAsset();
  else if (state.view === 'history') renderHistory();
  else return;
  window.scrollTo(0, y);
}

// ---------- ข้อมูลที่คำนวณ ----------
function statuses({ includeInactive = false } = {}) {
  const t = today();
  const logs = logList();
  const out = [];
  for (const task of state.tasks) {
    const a = assetOf(task.asset_id);
    if (!a) continue;
    if (!includeInactive && (!task.active || !a.active)) continue;
    out.push({ task, asset: a, s: taskStatus(task, a, logs, t) });
  }
  return out;
}

function dueText(s, asset) {
  const unit = asset.meter_unit || 'หน่วย';
  const bits = [];
  if (s.days_left != null) bits.push(s.days_left < 0 ? `เลยกำหนด ${-s.days_left} วัน` : s.days_left === 0 ? 'ครบกำหนดวันนี้' : s.days_left === 1 ? 'พรุ่งนี้' : `อีก ${s.days_left} วัน`);
  if (s.meter_left != null) bits.push(s.meter_left <= 0 ? `เกินระยะ ${fmtN(-s.meter_left)} ${unit}` : `อีก ${fmtN(s.meter_left)} ${unit}${s.est_days != null ? ` (≈ ${s.est_days} วัน)` : ''}`);
  if (!bits.length) return s.state === 'done' ? 'ทำแล้ว' : s.due_meter != null ? `ครบที่ ${fmtN(s.due_meter)} ${unit} (ยังไม่มีเลขไมล์ปัจจุบัน)` : 'ยังไม่ได้กำหนดครั้งแรก';
  return bits.join(' · ');
}

const logTitle = (l) => l.title || (l.task_id && taskOf(l.task_id) ? taskOf(l.task_id).name : KIND[l.kind]?.label || '');

function warrantyText(a) {
  const w = warrantyLeft(a, today());
  if (w == null) return '';
  if (w < 0) return `ประกันหมดแล้ว (${fmtFull(a.warranty_until)})`;
  if (w === 0) return 'ประกันหมดวันนี้';
  return `ประกันถึง ${fmtFull(a.warranty_until)} (อีก ${w} วัน)`;
}

// ---------- หน้า: ล็อกอิน ----------
function showLogin() {
  state.authed = false;
  if (sheetEl.open) sheetEl.close();
  renderLogin();
}

function renderLogin(msg = '') {
  app.innerHTML = `
    <main class="login">
      <div class="login-card">
        <img src="/icon.svg" alt="">
        <h1>ดูแลอุปกรณ์</h1>
        <p>ใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
        <form id="login-form">
          <input class="in" type="password" name="password" autocomplete="current-password" placeholder="รหัสผ่าน" required autofocus>
          <button class="btn primary" type="submit">เข้าสู่ระบบ</button>
          <p class="err" id="login-err">${esc(msg)}</p>
        </form>
      </div>
    </main>`;
}

async function doLogin(form) {
  const btn = $('button', form);
  const err = $('#login-err');
  btn.disabled = true;
  err.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: form.password.value } });
    state.authed = true;
    state.online = true;
    route();
    await refresh();
    flush();
    openDeepLink();
  } catch (e) {
    const m = {
      wrong_password: 'รหัสผ่านไม่ถูกต้อง',
      too_many_attempts: 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
      password_not_configured: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสผ่าน หรือรหัสผ่านสั้นเกินไป (APP_PASSWORD ต้องยาวอย่างน้อย 8 ตัว)',
    };
    err.textContent = e.network ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : m[e.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    btn.disabled = false;
    form.password.select();
  }
}

// ---------- แถวงาน / แถวบันทึก ----------
function taskRow({ task, asset, s }, { showAsset = true } = {}) {
  const c = catOf(asset.category);
  let badge;
  // ถ้าระยะไมล์จะถึงก่อนวันที่ ให้ป้ายแสดงเลขไมล์แทน
  const meterFirst =
    s.due_meter != null &&
    (!s.due_date || (s.meter_left != null && s.meter_left <= 0) || (s.est_days != null && s.est_days < (s.days_left ?? Infinity)));
  if (meterFirst) badge = `<b class="sm">${esc(fmtN(s.due_meter))}</b><span>${esc(asset.meter_unit || '')}</span>`;
  else if (s.due_date) {
    const d = dateObj(s.due_date);
    badge = `<b>${d.getDate()}</b><span>${esc(F_MON.format(d))}</span>`;
  } else if (s.due_meter != null) badge = `<b class="sm">${esc(fmtN(s.due_meter))}</b><span>${esc(asset.meter_unit || '')}</span>`;
  else badge = '<b>—</b>';
  return `<div class="due-row ${s.state}">
    <button type="button" class="due-main" data-action="${showAsset ? 'open-asset' : 'edit-task'}" data-id="${esc(showAsset ? asset.id : task.id)}">
      <span class="due-date">${badge}</span>
      <span class="due-body">
        <span class="due-name">${showAsset ? `${esc(c.emoji)} ` : ''}${esc(task.name)}</span>
        ${showAsset ? `<span class="due-sub">${esc(asset.name)}</span>` : `<span class="due-sub">${esc(intervalText(task, asset.meter_unit, fmtFull))}</span>`}
        <span class="due-meta">${esc(dueText(s, asset))}</span>
      </span>
    </button>
    ${s.state === 'done' ? '' : `<button type="button" class="btn sm ${s.state === 'ok' ? 'ghost' : 'primary'}" data-action="done" data-task="${esc(task.id)}">ทำแล้ว</button>`}
  </div>`;
}

function logRow(l, pending, { showAsset = true } = {}) {
  const a = assetOf(l.asset_id);
  const unit = a ? a.meter_unit : '';
  const sub = [
    fmtFull(l.done_date),
    showAsset && a ? a.name : '',
    l.meter != null ? `${fmtN(l.meter)} ${unit}` : '',
    l.provider,
  ]
    .filter(Boolean)
    .join(' · ');
  return `<button type="button" class="pay-row" data-action="edit-log" data-id="${esc(l.id)}">
    <span class="pay-emoji" aria-hidden="true">${KIND[l.kind]?.icon || '•'}</span>
    <span class="pay-body"><span class="pay-name">${esc(logTitle(l))}</span><span class="pay-meta">${esc(sub)}${l.note ? ` · ${esc(l.note)}` : ''}</span></span>
    <span class="pay-amt">${esc(baht(l.cost))}${pending ? ' <span title="รอส่งขึ้นเซิร์ฟเวอร์">⏳</span>' : ''}</span>
  </button>`;
}

// ---------- หน้า: ต้องทำ ----------
function renderHome() {
  const all = statuses();
  const sorter = (x, y) => x.s.sort - y.s.sort || x.task.name.localeCompare(y.task.name, 'th');
  const overdue = all.filter((x) => x.s.state === 'overdue').sort(sorter);
  const soon = all.filter((x) => x.s.state === 'soon').sort(sorter);
  const next = all.filter((x) => x.s.state === 'ok' && x.s.sort <= 60).sort(sorter);
  const t = today();
  const warranty = state.assets
    .filter((a) => a.active)
    .map((a) => ({ a, w: warrantyLeft(a, t) }))
    .filter((x) => x.w != null && x.w >= 0 && x.w <= Math.max(60, x.a.warranty_remind_days))
    .sort((x, y) => x.w - y.w);
  const pending = pendingIds();
  const recent = logList()
    .sort((a, b) => b.done_date.localeCompare(a.done_date) || b.updated_at - a.updated_at)
    .slice(0, 8);
  const yearCost = logList()
    .filter((l) => l.done_date.startsWith(t.slice(0, 4)))
    .reduce((s, l) => s + (l.cost || 0), 0);
  const section = (title, list, kind) =>
    list.length ? `<h2 class="sec ${kind}">${title} <span class="count">${list.length}</span></h2><div class="due-list">${list.map((x) => taskRow(x)).join('')}</div>` : '';
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="eyebrow">${esc(F_LONG.format(new Date()))}</div><h1>ดูแลอุปกรณ์</h1></div>
    </header>
    <div class="sync" hidden></div>
    <section class="month-card stat3" aria-label="สรุป">
      <div><span>เลยกำหนด</span><b class="${overdue.length ? 'bad' : ''}">${overdue.length}</b></div>
      <div><span>ใกล้ถึง</span><b>${soon.length}</b></div>
      <div><span>ค่าดูแลปีนี้</span><b class="money">${esc(baht(yearCost) || '฿0')}</b></div>
    </section>
    <div class="action-row">
      <button type="button" class="btn primary" data-action="new-log">+ บันทึกการดูแล/ซ่อม</button>
      <button type="button" class="btn" data-action="new-asset">+ เพิ่มอุปกรณ์</button>
    </div>
    ${
      !state.assets.length
        ? `<div class="hero">
            <p><b>เริ่มจากเพิ่มอุปกรณ์ที่ต้องดูแล</b> เช่น รถ แอร์ เครื่องกรองน้ำ ถังดับเพลิง — เลือกประเภทแล้วแอปจะแนะนำงานดูแลตามรอบให้</p>
            <p class="muted">รอบถัดไปนับจากครั้งล่าสุดที่ทำจริง กด "ทำแล้ว" เมื่อทำเสร็จ (บันทึกย้อนหลังได้)</p>
          </div>`
        : ''
    }
    ${section('เลยกำหนด', overdue, 'overdue')}
    ${section('ใกล้ถึง', soon, 'soon')}
    ${state.tasks.length && !overdue.length && !soon.length ? '<p class="all-clear">✓ ไม่มีงานค้างหรือใกล้ถึงกำหนด</p>' : ''}
    ${section('ถัดไป (ภายใน 60 วัน)', next, 'later')}
    ${
      warranty.length
        ? `<h2 class="sec soon">ประกันใกล้หมด <span class="count">${warranty.length}</span></h2>
           <div class="due-list">${warranty
             .map(
               ({ a, w }) => `<button type="button" class="due-row warranty" data-action="open-asset" data-id="${esc(a.id)}">
                 <span class="due-main"><span class="due-date"><b>${w}</b><span>วัน</span></span>
                 <span class="due-body"><span class="due-name">${esc(catOf(a.category).emoji)} ${esc(a.name)}</span><span class="due-meta">${esc(warrantyText(a))}</span></span></span>
               </button>`
             )
             .join('')}</div>`
        : ''
    }
    ${recent.length ? `<h2 class="sec">บันทึกล่าสุด</h2><div class="pay-list">${recent.map((l) => logRow(l, pending.has(l.id))).join('')}</div><a class="more-link" href="#/history">ดูประวัติทั้งหมด →</a>` : ''}
    ${nav()}`;
  updateSync();
}

// ---------- หน้า: อุปกรณ์ ----------
function assetCard(a, sts) {
  const c = catOf(a.category);
  const mine = sts.filter((x) => x.asset.id === a.id && x.task.active);
  const od = mine.filter((x) => x.s.state === 'overdue').length;
  const sn = mine.filter((x) => x.s.state === 'soon').length;
  const status = !a.active
    ? 'เลิกใช้แล้ว'
    : od
      ? `<span class="bad">เลยกำหนด ${od} งาน</span>`
      : sn
        ? `<span class="warn">ใกล้ถึง ${sn} งาน</span>`
        : mine.length
          ? `<span class="good">ปกติ · ${mine.length} งานดูแล</span>`
          : '<span class="muted">ยังไม่มีงานดูแล</span>';
  const cur = a.meter_unit ? meterNow(a, logList()) : null;
  const meta = [a.brand, a.model, a.location].filter(Boolean).join(' · ');
  return `<button type="button" class="bill-card${a.active ? '' : ' inactive'}" data-action="open-asset" data-id="${esc(a.id)}">
    <span class="bc-emoji" aria-hidden="true">${esc(c.emoji)}</span>
    <span class="bc-body">
      <span class="bc-top"><b>${esc(a.name)}</b>${cur != null ? `<span class="bc-amt">${esc(fmtN(cur))} ${esc(a.meter_unit)}</span>` : ''}</span>
      ${meta ? `<span class="bc-meta">${esc(meta)}</span>` : ''}
      <span class="bc-status">${status}</span>
      ${a.warranty_until ? `<span class="bc-meta">${esc(warrantyText(a))}</span>` : ''}
    </span>
  </button>`;
}

function renderAssets() {
  const sts = statuses({ includeInactive: true });
  const active = state.assets.filter((a) => a.active);
  const inactive = state.assets.filter((a) => !a.active);
  const byName = (x, y) => x.name.localeCompare(y.name, 'th');
  const groups = state.categories
    .map((c) => [c, active.filter((a) => a.category === c.key).sort(byName)])
    .filter(([, list]) => list.length);
  const known = new Set(state.categories.map((c) => c.key));
  const orphan = active.filter((a) => !known.has(a.category));
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><h1>อุปกรณ์</h1></div>
      <button type="button" class="btn primary sm" data-action="new-asset">+ เพิ่ม</button>
    </header>
    <div class="sync" hidden></div>
    ${active.length ? '' : '<p class="empty">ยังไม่มีอุปกรณ์ — กด "+ เพิ่ม" เพื่อเริ่ม</p>'}
    ${groups.map(([c, list]) => `<h2 class="sec">${esc(c.emoji)} ${esc(c.label)} <span class="count">${list.length}</span></h2><div class="bill-list">${list.map((a) => assetCard(a, sts)).join('')}</div>`).join('')}
    ${orphan.length ? `<h2 class="sec">อื่น ๆ</h2><div class="bill-list">${orphan.map((a) => assetCard(a, sts)).join('')}</div>` : ''}
    ${inactive.length ? `<details class="stopped"><summary>เลิกใช้/ขายแล้ว (${inactive.length})</summary><div class="bill-list">${inactive.sort(byName).map((a) => assetCard(a, sts)).join('')}</div></details>` : ''}
    ${nav()}`;
  updateSync();
}

// ---------- หน้า: รายละเอียดอุปกรณ์ ----------
function renderAsset() {
  const a = assetOf(state.assetId);
  if (!a) {
    app.innerHTML = `<header class="topbar"><a class="icon-btn plain" href="#/assets" aria-label="กลับ">${ICON.back}</a><h1>ไม่พบอุปกรณ์</h1></header>${nav()}`;
    return;
  }
  const c = catOf(a.category);
  const t = today();
  const logs = logList();
  const mine = statuses({ includeInactive: true }).filter((x) => x.asset.id === a.id);
  const order = { overdue: 0, soon: 1, ok: 2, done: 3 };
  mine.sort((x, y) => (x.task.active === y.task.active ? 0 : x.task.active ? -1 : 1) || order[x.s.state] - order[y.s.state] || x.s.sort - y.s.sort);
  const history = logs.filter((l) => l.asset_id === a.id).sort((x, y) => y.done_date.localeCompare(x.done_date) || y.updated_at - x.updated_at);
  const pending = pendingIds();
  const cur = a.meter_unit ? meterNow(a, logs) : null;
  const rate = a.meter_unit ? usageRate(a, logs, t) : null;
  const totalCost = history.reduce((s, l) => s + (l.cost || 0), 0);
  const info = [
    ['ประเภท', `${c.emoji} ${c.label}`],
    ['ที่ตั้ง', a.location],
    ['ยี่ห้อ/รุ่น', [a.brand, a.model].filter(Boolean).join(' ')],
    ['S/N / ทะเบียน', a.serial],
    ['วันที่ซื้อ', a.purchase_date ? fmtFull(a.purchase_date) : ''],
    ['ราคา', baht(a.price)],
    ['ประกัน', warrantyText(a)],
    ['ติดต่อ', a.contact],
  ].filter(([, v]) => v);
  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn plain" href="#/assets" aria-label="กลับ">${ICON.back}</a>
      <div class="brand grow"><h1>${esc(c.emoji)} ${esc(a.name)}</h1></div>
      <button type="button" class="btn sm ghost" data-action="edit-asset" data-id="${esc(a.id)}">แก้ไข</button>
    </header>
    <div class="sync" hidden></div>
    ${a.active ? '' : '<p class="warn-box">อุปกรณ์นี้ถูกตั้งเป็น "เลิกใช้แล้ว" — ไม่มีการเตือน</p>'}
    <section class="card info-grid">
      ${info.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      ${a.notes ? `<div class="full"><span>หมายเหตุ</span><p class="details">${esc(a.notes)}</p></div>` : ''}
      ${history.length ? `<div class="full"><span>ค่าดูแล/ซ่อมรวม</span><b>${esc(baht(totalCost) || '฿0')} <small class="muted">(${history.length} บันทึก)</small></b></div>` : ''}
    </section>
    ${
      a.meter_unit
        ? `<section class="card meter-card">
            <div><span class="muted">${a.meter_unit === 'กม.' ? 'เลขไมล์ล่าสุด' : 'ชั่วโมงใช้งานล่าสุด'}</span>
              <b>${cur != null ? `${esc(fmtN(cur))} ${esc(a.meter_unit)}` : 'ยังไม่ได้จด'}</b>
              ${rate ? `<small class="muted">ใช้งานเฉลี่ย ~${esc(fmtN(rate * 30))} ${esc(a.meter_unit)}/เดือน</small>` : ''}</div>
            <button type="button" class="btn sm" data-action="new-reading" data-id="${esc(a.id)}">อัปเดต${a.meter_unit === 'กม.' ? 'เลขไมล์' : 'ชั่วโมง'}</button>
          </section>`
        : ''
    }
    <div class="sec-row"><h2 class="sec">งานดูแลตามรอบ <span class="count">${mine.length}</span></h2>
      <button type="button" class="btn sm ghost" data-action="new-task" data-id="${esc(a.id)}">+ เพิ่มงาน</button></div>
    ${
      mine.length
        ? `<div class="due-list">${mine
            .map((x) => {
              const last = x.s.last;
              return `${taskRow(x, { showAsset: false })}${
                last ? `<p class="last-done">ทำล่าสุด ${esc(fmtFull(last.done_date))}${last.meter != null ? ` · ${esc(fmtN(last.meter))} ${esc(a.meter_unit)}` : ''}${last.cost != null ? ` · ${esc(baht(last.cost))}` : ''}</p>` : '<p class="last-done">ยังไม่เคยบันทึกว่าทำ — ถ้าเคยทำแล้ว กด "ทำแล้ว" แล้วใส่วันที่ทำครั้งล่าสุด</p>'
              }${x.task.active ? '' : '<p class="last-done">ปิดงานนี้ไว้ (ไม่เตือน)</p>'}`;
            })
            .join('')}</div>`
        : `<p class="empty">ยังไม่มีงานดูแล — กด "+ เพิ่มงาน"${TEMPLATES[a.category] ? ' (มีงานแนะนำสำหรับประเภทนี้)' : ''}</p>`
    }
    <div class="sec-row"><h2 class="sec">ประวัติ <span class="count">${history.length}</span></h2>
      <button type="button" class="btn sm ghost" data-action="new-repair" data-id="${esc(a.id)}">+ บันทึกซ่อม/อื่น ๆ</button></div>
    ${history.length ? `<div class="pay-list">${history.map((l) => logRow(l, pending.has(l.id), { showAsset: false })).join('')}</div>` : '<p class="empty">ยังไม่มีบันทึก</p>'}
    ${nav()}`;
  updateSync();
}

// ---------- หน้า: ประวัติ ----------
function historyList() {
  const h = state.hist;
  const src = logList();
  if (h.q) {
    const q = h.q.toLowerCase();
    return src.filter((l) => {
      const a = assetOf(l.asset_id);
      return `${logTitle(l)} ${l.note} ${l.provider} ${a ? a.name : ''}`.toLowerCase().includes(q);
    });
  }
  return src.filter((l) => monthOf(l.done_date) === h.month);
}

function renderHistory() {
  const h = state.hist;
  const list = historyList().sort((a, b) => b.done_date.localeCompare(a.done_date) || b.updated_at - a.updated_at);
  const total = list.reduce((s, l) => s + (l.cost || 0), 0);
  const byAsset = new Map();
  for (const l of list) if (l.cost) byAsset.set(l.asset_id, (byAsset.get(l.asset_id) || 0) + l.cost);
  const top = [...byAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top.length ? top[0][1] : 0;
  const pending = pendingIds();
  const groups = new Map();
  for (const l of list) {
    if (!groups.has(l.done_date)) groups.set(l.done_date, []);
    groups.get(l.done_date).push(l);
  }
  const isCurrent = h.month >= monthOf(today());
  const searchFocused = document.activeElement && document.activeElement.id === 'hist-q';
  app.innerHTML = `
    <header class="topbar"><div class="brand"><h1>ประวัติการดูแล</h1></div></header>
    <div class="sync" hidden></div>
    <input class="in search" id="hist-q" type="search" placeholder="ค้นหา เช่น ล้างแอร์, เปลี่ยนยาง, ชื่อร้าน" value="${esc(h.q)}" autocomplete="off">
    ${
      h.q
        ? `<p class="range-label">ผลการค้นหา "${esc(h.q)}" · ${list.length} รายการ</p>`
        : `<div class="month-nav">
            <button type="button" class="icon-btn" data-action="hist-prev" aria-label="เดือนก่อน">${ICON.prev}</button>
            <b>${esc(monthLabel(h.month))}</b>
            <button type="button" class="icon-btn" data-action="hist-next" aria-label="เดือนถัดไป" ${isCurrent ? 'disabled' : ''}>${ICON.next}</button>
          </div>`
    }
    <section class="month-card">
      <div class="mc-grid">
        <div><span>${h.q ? 'ค่าใช้จ่ายที่พบ' : 'ค่าใช้จ่ายเดือนนี้'}</span><b>${esc(baht(total) || '฿0')}</b><small>${list.length} บันทึก</small></div>
        <div class="cat-bars">${top
          .map(([id, v]) => {
            const a = assetOf(id);
            return `<div class="cb"><span>${esc(a ? `${catOf(a.category).emoji} ${a.name}` : '—')}</span><i><em data-w="${max ? Math.max(4, Math.round((v / max) * 100)) : 0}"></em></i><b>${esc(baht(v))}</b></div>`;
          })
          .join('')}</div>
      </div>
    </section>
    ${
      list.length
        ? [...groups.entries()]
            .map(([d, ls]) => `<h2 class="day-head">${esc(F_WD.format(dateObj(d)))} ${esc(String(dateObj(d).getFullYear() + 543))}</h2><div class="pay-list">${ls.map((l) => logRow(l, pending.has(l.id))).join('')}</div>`)
            .join('')
        : `<p class="empty">${h.q ? 'ไม่พบรายการ' : 'ไม่มีบันทึกในเดือนนี้'}</p>`
    }
    <div class="row no-print">
      <button type="button" class="btn ghost" data-action="hist-csv" ${list.length ? '' : 'disabled'}>ดาวน์โหลด CSV ${h.q ? 'ผลการค้นหา' : 'เดือนนี้'}</button>
    </div>
    ${nav()}`;
  for (const em of $$('.cat-bars em')) em.style.width = `${em.dataset.w}%`;
  if (searchFocused) {
    const q = $('#hist-q');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  updateSync();
}

// ---------- แผ่น (bottom sheet) ----------
let mode = null; // 'asset' | 'task' | 'log'
let A = null;
let K = null;
let L = null;

function openSheetHTML(html) {
  sheetEl.innerHTML = html;
  if (!sheetEl.open) sheetEl.showModal();
}
function closeSheet() {
  if (sheetEl.open) sheetEl.close();
  mode = A = K = L = null;
}
sheetEl.addEventListener('close', () => {
  mode = A = K = L = null;
});
const sheetHead = (title) => `<div class="grip" aria-hidden="true"></div>
  <div class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn plain" data-x="close" aria-label="ปิด">${ICON.close}</button></div>`;

function parseNum(v) {
  const s = String(v ?? '').replace(/[,\s฿]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
const val = (id) => {
  const el = $(id, sheetEl);
  return el ? el.value.trim() : '';
};

// ----- อุปกรณ์ -----
function openAsset(asset) {
  mode = 'asset';
  A = asset
    ? { ...asset, isNew: false }
    : {
        id: uuid(),
        name: '',
        category: 'other',
        location: '',
        brand: '',
        model: '',
        serial: '',
        purchase_date: null,
        price: null,
        warranty_until: null,
        warranty_remind_days: 30,
        contact: '',
        notes: '',
        meter_unit: '',
        meter_start: null,
        active: true,
        isNew: true,
        picks: new Set(),
      };
  renderAssetSheet();
}

function setAssetCategory(key) {
  A.category = key;
  const tpl = TEMPLATES[key];
  if (A.isNew) {
    A.picks = new Set(tpl ? tpl.tasks.map((t, i) => (t[4] ? i : -1)).filter((i) => i >= 0) : []);
    if (tpl && tpl.meter && !A.meter_unit) A.meter_unit = tpl.meter;
  }
}

function readAssetForm() {
  A.name = val('#a-name');
  A.location = val('#a-location');
  A.brand = val('#a-brand');
  A.model = val('#a-model');
  A.serial = val('#a-serial');
  A.purchase_date = val('#a-purchase') || null;
  A.price = parseNum(val('#a-price'));
  A.warranty_until = val('#a-warranty') || null;
  A.contact = val('#a-contact');
  A.notes = val('#a-notes');
  const ms = $('#a-meter', sheetEl);
  if (ms) A.meter_start = parseNum(ms.value);
  const act = $('#a-active', sheetEl);
  if (act) A.active = act.checked;
}

function renderAssetSheet() {
  const a = A;
  const tpl = a.isNew ? TEMPLATES[a.category] : null;
  const cats = state.categories.filter((c) => !c.hidden || c.key === a.category);
  openSheetHTML(`
    <form class="sheet-body" id="asset-form" novalidate>
      ${sheetHead(a.isNew ? 'เพิ่มอุปกรณ์' : 'แก้ไขอุปกรณ์')}
      <div class="field"><span class="label">ประเภท</span>
        <div class="chips">${cats.map((c) => `<button type="button" class="chip${a.category === c.key ? ' on' : ''}" data-x="a-cat" data-v="${esc(c.key)}">${esc(c.emoji)} ${esc(c.label)}</button>`).join('')}</div>
      </div>
      <div class="field"><label for="a-name">ชื่อ *</label>
        <input id="a-name" maxlength="120" value="${esc(a.name)}" placeholder="เช่น แอร์ห้องนอน, Honda City, เครื่องกรองน้ำครัว" autocomplete="off"></div>
      <div class="field"><label for="a-location">ที่ตั้ง/ห้อง</label><input id="a-location" maxlength="80" value="${esc(a.location)}" placeholder="เช่น ห้องนอนใหญ่, บ้านแม่"></div>
      <div class="field two">
        <div><label for="a-brand">ยี่ห้อ</label><input id="a-brand" class="in" maxlength="80" value="${esc(a.brand)}"></div>
        <div><label for="a-model">รุ่น</label><input id="a-model" class="in" maxlength="80" value="${esc(a.model)}"></div>
      </div>
      <div class="field"><label for="a-serial">S/N / ทะเบียน</label><input id="a-serial" maxlength="80" value="${esc(a.serial)}"></div>
      <div class="field two">
        <div><label for="a-purchase">วันที่ซื้อ</label><input id="a-purchase" class="in" type="date" value="${esc(a.purchase_date || '')}"></div>
        <div><label for="a-price">ราคา (บาท)</label><input id="a-price" class="in" inputmode="decimal" value="${a.price ?? ''}"></div>
      </div>
      <div class="field"><label for="a-warranty">ประกันถึงวันที่</label><input id="a-warranty" type="date" value="${esc(a.warranty_until || '')}">
        <div class="chips">${[0, 7, 30, 60]
          .map((d) => `<button type="button" class="chip soft${a.warranty_remind_days === d ? ' on' : ''}" data-x="a-wr" data-v="${d}">${d ? `เตือน ${d} วันก่อน` : 'ไม่เตือน'}</button>`)
          .join('')}</div></div>
      <div class="field"><span class="label">มีเลขไมล์/ชั่วโมงใช้งานไหม</span>
        <div class="chips">${[
          ['', 'ไม่มี'],
          ['กม.', 'เลขไมล์ (กม.)'],
          ['ชม.', 'ชั่วโมงใช้งาน'],
        ]
          .map(([v, l]) => `<button type="button" class="chip${a.meter_unit === v ? ' on' : ''}" data-x="a-mu" data-v="${v}">${l}</button>`)
          .join('')}</div>
        ${a.meter_unit && a.isNew ? `<input id="a-meter" class="in mt" inputmode="decimal" value="${a.meter_start ?? ''}" placeholder="ตอนนี้กี่ ${esc(a.meter_unit)}">` : ''}
      </div>
      <div class="field"><label for="a-contact">ช่าง/ร้าน/ศูนย์บริการที่ติดต่อ</label><input id="a-contact" maxlength="300" value="${esc(a.contact)}" placeholder="เช่น ร้านแอร์ช่างเอ 08x-xxx-xxxx"></div>
      <div class="field"><label for="a-notes">หมายเหตุ</label><textarea id="a-notes" rows="2" maxlength="2000" placeholder="เช่น ขนาดไส้กรอง, เบอร์ยาง, รหัสอะไหล่">${esc(a.notes)}</textarea></div>
      ${
        tpl
          ? `<div class="field"><span class="label">งานดูแลแนะนำ <small>(แก้ไขได้ภายหลัง)</small></span>
              <div class="tpl-list">${tpl.tasks
                .map(
                  ([name, every, unit, km], i) => `<label class="check tpl"><input type="checkbox" data-x="a-pick" value="${i}" ${a.picks.has(i) ? 'checked' : ''}>
                    <span><b>${esc(name)}</b> <span class="muted">${esc(intervalText({ unit, every, every_meter: km }, tpl.meter || a.meter_unit, fmtFull))}</span></span></label>`
                )
                .join('')}</div>
              <p class="hint">รอบแรกจะนับจากวันนี้ ถ้าเคยทำแล้วไปกด "ทำแล้ว" ในหน้าอุปกรณ์ แล้วใส่วันที่ทำครั้งล่าสุด</p></div>`
          : ''
      }
      ${a.isNew ? '' : `<label class="check big"><input type="checkbox" id="a-active" ${a.active ? 'checked' : ''}> ยังใช้งานอยู่ <span class="muted">(เอาออก = เลิกใช้/ขายแล้ว ไม่เตือน)</span></label>`}
      <div class="sheet-actions">
        ${a.isNew ? '' : '<button type="button" class="btn ghost danger" data-x="a-del">ลบ</button>'}
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`);
}

async function submitAsset() {
  readAssetForm();
  if (!A.name) return toast('กรุณาใส่ชื่ออุปกรณ์');
  if (Number.isNaN(A.price) || Number.isNaN(A.meter_start)) return toast('ตัวเลขไม่ถูกต้อง');
  const { isNew, picks, ...asset } = A;
  try {
    const r = await api(`/api/assets/${encodeURIComponent(asset.id)}`, { method: 'PUT', body: { asset } });
    const i = state.assets.findIndex((x) => x.id === asset.id);
    if (i >= 0) state.assets[i] = r.asset;
    else state.assets.push(r.asset);
    let made = 0;
    const tpl = isNew ? TEMPLATES[asset.category] : null;
    if (tpl && picks && picks.size) {
      const t = today();
      for (const idx of picks) {
        const [name, every, unit, km] = tpl.tasks[idx];
        const task = {
          id: uuid(),
          asset_id: asset.id,
          name,
          unit,
          every,
          every_meter: r.asset.meter_unit ? km : null,
          first_due: addInterval(t, every, unit),
          first_due_meter: r.asset.meter_unit && km && r.asset.meter_start != null ? r.asset.meter_start + km : null,
          remind_days: unit === 'month' && every === 1 ? 3 : 7,
          active: true,
        };
        const tr = await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: { task } });
        state.tasks.push(tr.task);
        made++;
      }
    }
    saveCache();
    closeSheet();
    toast(isNew ? `เพิ่ม ${r.asset.name} แล้ว${made ? ` พร้อมงานดูแล ${made} งาน` : ''}` : 'บันทึกแล้ว');
    if (isNew) location.hash = `#/asset/${encodeURIComponent(asset.id)}`;
    else rerender();
  } catch (e) {
    if (!handleErr(e)) toast(`บันทึกไม่สำเร็จ (${e.code || e.message})`);
    else if (e.network) toast('ต้องต่ออินเทอร์เน็ตเพื่อเพิ่ม/แก้อุปกรณ์');
  }
}

// ----- งานดูแล -----
function openTask(task, assetId) {
  mode = 'task';
  const a = assetOf(task ? task.asset_id : assetId);
  if (!a) return;
  const t = today();
  K = task
    ? { ...task, isNew: false }
    : { id: uuid(), asset_id: a.id, name: '', unit: 'month', every: 6, every_meter: null, first_due: addInterval(t, 6, 'month'), first_due_meter: null, remind_days: 7, est_cost: null, notes: '', active: true, isNew: true };
  K.custom = !FREQS.some(([u, e]) => u === K.unit && (u === 'once' || e === K.every));
  K.dueTouched = !K.isNew;
  renderTaskSheet();
}

function readTaskForm() {
  K.name = val('#k-name');
  if (K.custom && K.unit !== 'once' && K.unit !== '') {
    K.every = Math.max(1, parseInt(val('#k-every'), 10) || 1);
    K.unit = $('#k-unit', sheetEl).value;
  }
  const km = $('#k-km', sheetEl);
  K.every_meter = km ? parseNum(km.value) : null;
  K.first_due = val('#k-first') || null;
  const fm = $('#k-firstm', sheetEl);
  K.first_due_meter = fm ? parseNum(fm.value) : null;
  K.est_cost = parseNum(val('#k-cost'));
  K.notes = val('#k-notes');
  const act = $('#k-active', sheetEl);
  if (act) K.active = act.checked;
}

function taskPreview() {
  const a = assetOf(K.asset_id);
  const s = taskStatus({ ...K, every_meter: Number.isNaN(K.every_meter) ? null : K.every_meter }, a, logList(), today());
  const bits = [];
  if (s.due_date) bits.push(fmtFull(s.due_date));
  if (s.due_meter != null) bits.push(`${fmtN(s.due_meter)} ${a.meter_unit}`);
  if (s.state === 'done') return 'งานครั้งเดียวนี้ทำแล้ว';
  return bits.length ? `ครั้งถัดไป: ${bits.join(' หรือ ')}${s.last ? ` (นับจากที่ทำล่าสุด ${fmtFull(s.last.done_date)})` : ''}` : 'ยังคำนวณครั้งถัดไปไม่ได้';
}

function renderTaskSheet() {
  const k = K;
  const a = assetOf(k.asset_id);
  const tpl = k.isNew ? TEMPLATES[a.category] : null;
  const hasLog = logList().some((l) => l.task_id === k.id && l.kind === 'done');
  openSheetHTML(`
    <form class="sheet-body" id="task-form" novalidate>
      ${sheetHead(`${k.isNew ? 'เพิ่มงานดูแล' : 'แก้ไขงานดูแล'} · ${esc(a.name)}`)}
      <div class="field"><label for="k-name">งาน *</label>
        <input id="k-name" maxlength="120" value="${esc(k.name)}" placeholder="เช่น ล้างแอร์, เปลี่ยนไส้กรอง" autocomplete="off">
        ${tpl ? `<div class="chips">${tpl.tasks.map(([n], i) => `<button type="button" class="chip soft" data-x="k-tpl" data-v="${i}">${esc(n)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="field"><span class="label">ทำทุก ๆ</span>
        <div class="chips">${FREQS.map(
          ([u, e, label]) => `<button type="button" class="chip${!k.custom && k.unit === u && (u === 'once' || k.every === e) ? ' on' : ''}" data-x="k-freq" data-u="${u}" data-e="${e ?? ''}">${label}</button>`
        ).join('')}<button type="button" class="chip${k.custom && k.unit !== '' ? ' on' : ''}" data-x="k-custom">กำหนดเอง</button>${
          a.meter_unit ? `<button type="button" class="chip${k.unit === '' ? ' on' : ''}" data-x="k-meteronly">ตาม${a.meter_unit === 'กม.' ? 'เลขไมล์' : 'ชั่วโมง'}อย่างเดียว</button>` : ''
        }</div>
        ${
          k.custom && k.unit !== '' && k.unit !== 'once'
            ? `<div class="custom-freq">ทุก <input id="k-every" class="in" type="number" min="1" max="1000" value="${esc(k.every ?? 1)}">
                <select id="k-unit" class="in">${Object.entries(UNIT_TH).map(([u, l]) => `<option value="${u}" ${k.unit === u ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`
            : ''
        }
        ${
          a.meter_unit && k.unit !== 'once'
            ? `<div class="custom-freq">${k.unit === '' ? 'ทุก' : 'หรือทุก'} <input id="k-km" class="in wide" inputmode="decimal" value="${k.every_meter ?? ''}" placeholder="เช่น 10000"> ${esc(a.meter_unit)} <span class="muted">${k.unit === '' ? '' : '(อย่างไหนถึงก่อน)'}</span></div>`
            : ''
        }
      </div>
      ${
        hasLog && k.unit !== 'once'
          ? ''
          : `<div class="field two">
              ${k.unit === '' ? '' : `<div><label for="k-first">${k.unit === 'once' ? 'ต้องทำภายในวันที่' : 'ครบกำหนดครั้งแรก'}</label><input id="k-first" class="in" type="date" value="${esc(k.first_due || '')}"></div>`}
              ${a.meter_unit && k.unit !== 'once' ? `<div><label for="k-firstm">หรือที่ ${esc(a.meter_unit)}</label><input id="k-firstm" class="in" inputmode="decimal" value="${k.first_due_meter ?? ''}"></div>` : ''}
            </div>
            ${k.unit !== 'once' ? '<p class="hint">ใช้เฉพาะตอนยังไม่เคยบันทึกว่าทำ — หลังจากนั้นรอบถัดไปจะนับจากครั้งล่าสุดที่ทำจริง</p>' : ''}`
      }
      <p class="preview" id="k-preview"></p>
      <div class="field"><span class="label">เตือนล่วงหน้า</span>
        <div class="chips">${[1, 3, 7, 14, 30].map((d) => `<button type="button" class="chip${k.remind_days === d ? ' on' : ''}" data-x="k-remind" data-v="${d}">${d} วัน</button>`).join('')}</div>
        ${a.meter_unit && k.unit !== 'once' ? `<p class="hint">ตามระยะ: เตือนเมื่อเหลือไม่ถึง 10% ของรอบ</p>` : ''}
      </div>
      <div class="field"><label for="k-cost">ค่าใช้จ่ายโดยประมาณ (บาท)</label><input id="k-cost" inputmode="decimal" value="${k.est_cost ?? ''}"></div>
      <div class="field"><label for="k-notes">หมายเหตุ</label><textarea id="k-notes" rows="2" maxlength="1000" placeholder="เช่น ใช้น้ำมัน 5W-30 4 ลิตร, ไส้กรองรุ่น ...">${esc(k.notes)}</textarea></div>
      ${k.isNew ? '' : `<label class="check big"><input type="checkbox" id="k-active" ${k.active ? 'checked' : ''}> ยังทำงานนี้อยู่ <span class="muted">(เอาออก = ไม่เตือน)</span></label>`}
      <div class="sheet-actions">
        ${k.isNew ? '' : '<button type="button" class="btn ghost danger" data-x="k-del">ลบ</button>'}
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`);
  $('#k-preview', sheetEl).textContent = taskPreview();
}

async function submitTask() {
  readTaskForm();
  if (!K.name) return toast('กรุณาใส่ชื่องาน');
  if ([K.every_meter, K.first_due_meter, K.est_cost].some(Number.isNaN)) return toast('ตัวเลขไม่ถูกต้อง');
  if (K.unit === '' && !K.every_meter) return toast('กรุณาใส่ระยะ เช่น ทุก 10000 กม.');
  if (K.unit === 'once' && !K.first_due) return toast('กรุณาใส่วันที่ต้องทำ');
  const { isNew, custom, dueTouched, ...task } = K;
  try {
    const r = await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: { task } });
    const i = state.tasks.findIndex((x) => x.id === task.id);
    if (i >= 0) state.tasks[i] = r.task;
    else state.tasks.push(r.task);
    saveCache();
    closeSheet();
    toast(isNew ? 'เพิ่มงานดูแลแล้ว' : 'บันทึกแล้ว');
    rerender();
  } catch (e) {
    const m = { every_required: 'กรุณาใส่รอบ', schedule_required: 'กรุณาตั้งรอบเวลาหรือระยะ', first_due_required: 'กรุณาใส่วันที่ต้องทำ' };
    if (!handleErr(e)) toast(m[e.code] || `บันทึกไม่สำเร็จ (${e.code || e.message})`);
    else if (e.network) toast('ต้องต่ออินเทอร์เน็ตเพื่อเพิ่ม/แก้งาน');
  }
}

// ----- บันทึก (ทำแล้ว / ซ่อม / เลขไมล์ / อื่น ๆ) -----
function openLog({ log, taskId, assetId, kind }) {
  mode = 'log';
  const t = today();
  if (log) L = { ...log, isNew: false };
  else {
    const task = taskId ? taskOf(taskId) : null;
    const aid = task ? task.asset_id : assetId || (state.assets.find((a) => a.active) || {}).id;
    const a = assetOf(aid);
    L = {
      id: uuid(),
      asset_id: aid || null,
      task_id: task ? task.id : null,
      kind: kind || (task ? 'done' : 'repair'),
      done_date: t,
      title: '',
      meter: a && a.meter_unit ? meterNow(a, logList()) : null,
      cost: task ? task.est_cost : null,
      provider: '',
      note: '',
      isNew: true,
    };
  }
  renderLogSheet();
}

function readLogForm() {
  const g = (id) => $(id, sheetEl);
  if (g('#l-title')) L.title = val('#l-title');
  if (g('#l-date')) L.done_date = val('#l-date');
  if (g('#l-meter')) L.meter = parseNum(val('#l-meter'));
  if (g('#l-cost')) L.cost = parseNum(val('#l-cost'));
  if (g('#l-provider')) L.provider = val('#l-provider');
  if (g('#l-note')) L.note = val('#l-note');
  if (g('#l-task')) L.task_id = g('#l-task').value || null;
}

function renderLogSheet() {
  const l = L;
  const a = l.asset_id ? assetOf(l.asset_id) : null;
  const t = today();
  const tasks = a ? state.tasks.filter((k) => k.asset_id === a.id && (k.active || k.id === l.task_id)) : [];
  const providers = [...new Set(logList().filter((x) => x.provider).sort((x, y) => y.updated_at - x.updated_at).map((x) => x.provider))].slice(0, 6);
  const task = l.task_id ? taskOf(l.task_id) : null;
  const title = l.isNew ? (l.kind === 'done' && task ? `${esc(task.name)}` : l.kind === 'reading' ? 'อัปเดตเลขไมล์' : 'บันทึก') : 'แก้ไขบันทึก';
  const activeAssets = state.assets.filter((x) => x.active || x.id === l.asset_id);
  openSheetHTML(`
    <form class="sheet-body" id="log-form" novalidate>
      ${sheetHead(title)}
      ${
        l.isNew && !(l.kind === 'done' && task)
          ? `<div class="field"><span class="label">อุปกรณ์</span>
              <div class="chips">${activeAssets
                .map((x) => `<button type="button" class="chip${x.id === l.asset_id ? ' on' : ''}" data-x="l-asset" data-v="${esc(x.id)}">${esc(catOf(x.category).emoji)} ${esc(x.name)}</button>`)
                .join('')}</div>
              ${activeAssets.length ? '' : '<p class="hint">ยังไม่มีอุปกรณ์ — เพิ่มอุปกรณ์ก่อน</p>'}
            </div>
            <div class="field"><span class="label">บันทึกอะไร</span>
              <div class="chips">${Object.entries(KIND)
                .filter(([k]) => k !== 'reading' || (a && a.meter_unit))
                .map(([k, v]) => `<button type="button" class="chip${l.kind === k ? ' on' : ''}" data-x="l-kind" data-v="${k}">${v.icon} ${v.label}</button>`)
                .join('')}</div></div>`
          : `<div class="info-box"><div><b>${esc(a ? `${catOf(a.category).emoji} ${a.name}` : 'อุปกรณ์ถูกลบแล้ว')}</b> · ${esc(KIND[l.kind]?.label || '')}</div>
              ${task && task.notes ? `<div class="details">${esc(task.notes)}</div>` : ''}</div>`
      }
      ${
        l.kind === 'done' && a
          ? `<div class="field"><label for="l-task">งานที่ทำ</label>
              <select id="l-task" class="in">${tasks.map((k) => `<option value="${esc(k.id)}" ${k.id === l.task_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}${
                tasks.length ? '' : '<option value="">— ยังไม่มีงานดูแล —</option>'
              }</select></div>`
          : ''
      }
      ${l.kind === 'repair' || l.kind === 'note' ? `<div class="field"><label for="l-title">ทำอะไร *</label><input id="l-title" maxlength="160" value="${esc(l.title)}" placeholder="${l.kind === 'repair' ? 'เช่น เปลี่ยนคาปาซิเตอร์, ซ่อมท่อรั่ว' : 'เช่น ได้ยินเสียงดัง, ตรวจสภาพ'}" autocomplete="off"></div>` : ''}
      <div class="field"><label for="l-date">วันที่</label>
        <input id="l-date" type="date" value="${esc(l.done_date)}" max="${esc(addDays(t, 1))}">
        <div class="chips"><button type="button" class="chip soft" data-x="l-date" data-v="${t}">วันนี้</button><button type="button" class="chip soft" data-x="l-date" data-v="${addDays(t, -1)}">เมื่อวาน</button></div>
      </div>
      ${a && a.meter_unit ? `<div class="field"><label for="l-meter">${a.meter_unit === 'กม.' ? 'เลขไมล์' : 'ชั่วโมงใช้งาน'} (${esc(a.meter_unit)})</label><input id="l-meter" inputmode="decimal" value="${l.meter ?? ''}"></div>` : ''}
      ${
        l.kind === 'reading'
          ? ''
          : `<div class="field two">
              <div><label for="l-cost">ค่าใช้จ่าย (บาท)</label><input id="l-cost" class="in" inputmode="decimal" value="${l.cost ?? ''}"></div>
              <div><label for="l-provider">ทำโดย/ร้าน</label><input id="l-provider" class="in" maxlength="120" value="${esc(l.provider)}" placeholder="ทำเอง" list="dl-prov"></div>
            </div>
            <datalist id="dl-prov">${['ทำเอง', ...providers].map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
            <div class="field"><label for="l-note">หมายเหตุ</label><textarea id="l-note" rows="2" maxlength="2000" placeholder="เช่น เปลี่ยนอะไหล่อะไร, รับประกันงานซ่อมกี่เดือน">${esc(l.note)}</textarea></div>`
      }
      <div class="sheet-actions">
        ${l.isNew ? '' : '<button type="button" class="btn ghost danger" data-x="l-del">ลบ</button>'}
        <button type="submit" class="btn primary">${l.isNew && l.kind === 'done' ? '✓ บันทึกว่าทำแล้ว' : 'บันทึก'}</button>
      </div>
    </form>`);
}

function submitLog() {
  readLogForm();
  if (!L.asset_id) return toast('กรุณาเลือกอุปกรณ์');
  if (L.kind === 'done' && !L.task_id) return toast('อุปกรณ์นี้ยังไม่มีงานดูแล — เลือก "ซ่อม" หรือเพิ่มงานก่อน');
  if ((L.kind === 'repair' || L.kind === 'note') && !L.title) return toast('กรุณาใส่ว่าทำอะไร');
  if (L.kind === 'reading' && L.meter == null) return toast('กรุณาใส่เลขไมล์');
  if (Number.isNaN(L.meter) || Number.isNaN(L.cost)) return toast('ตัวเลขไม่ถูกต้อง');
  if (!L.done_date) return toast('กรุณาใส่วันที่');
  if (L.kind === 'done' && !L.title) L.title = taskOf(L.task_id)?.name || '';
  const a = assetOf(L.asset_id);
  const cur = a && a.meter_unit ? meterNow(a, logList().filter((x) => x.id !== L.id)) : null;
  if (L.isNew && L.meter != null && cur != null && L.meter < cur && L.done_date >= today() && !confirm(`เลข ${fmtN(L.meter)} น้อยกว่าล่าสุด (${fmtN(cur)}) — บันทึกต่อไหม?`)) return;
  const wasNew = L.isNew;
  const saved = saveLog(L);
  closeSheet();
  toast(wasNew ? `บันทึกแล้ว: ${logTitle(saved) || 'เลขไมล์'}` : 'แก้ไขแล้ว', wasNew ? { label: 'เลิกทำ', fn: () => deleteLog(saved.id, { silent: true }) } : undefined);
}

// ----- events ของแผ่น -----
sheetEl.addEventListener('click', async (ev) => {
  if (ev.target === sheetEl) return closeSheet();
  const b = ev.target.closest('[data-x]');
  if (!b) return;
  const x = b.dataset.x;
  if (x === 'close') return closeSheet();
  const toggleOn = (sel, v) => {
    for (const c of $$(sel, sheetEl)) c.classList.toggle('on', c.dataset.v === v);
  };

  if (mode === 'asset' && A) {
    if (x === 'a-cat') {
      readAssetForm();
      setAssetCategory(b.dataset.v);
      renderAssetSheet();
    } else if (x === 'a-mu') {
      readAssetForm();
      A.meter_unit = b.dataset.v;
      renderAssetSheet();
    } else if (x === 'a-wr') {
      A.warranty_remind_days = Number(b.dataset.v);
      toggleOn('[data-x="a-wr"]', b.dataset.v);
    } else if (x === 'a-pick') {
      b.checked ? A.picks.add(Number(b.value)) : A.picks.delete(Number(b.value));
    } else if (x === 'a-del') {
      if (!confirm(`ลบ "${A.name}" พร้อมงานดูแลและประวัติทั้งหมด? (ถ้าแค่เลิกใช้ ให้เอาเครื่องหมาย "ยังใช้งานอยู่" ออกแทน)`)) return;
      try {
        await api(`/api/assets/${encodeURIComponent(A.id)}`, { method: 'DELETE' });
        const id = A.id;
        state.assets = state.assets.filter((y) => y.id !== id);
        state.tasks = state.tasks.filter((y) => y.asset_id !== id);
        for (const l of logList()) if (l.asset_id === id) state.logs.delete(l.id);
        saveCache();
        closeSheet();
        toast('ลบแล้ว');
        location.hash = '#/assets';
      } catch (e) {
        if (!handleErr(e)) toast('ลบไม่สำเร็จ');
      }
    }
  } else if (mode === 'task' && K) {
    if (x === 'k-tpl') {
      readTaskForm();
      const a = assetOf(K.asset_id);
      const [name, every, unit, km] = TEMPLATES[a.category].tasks[Number(b.dataset.v)];
      Object.assign(K, { name, every, unit, every_meter: a.meter_unit ? km : null, custom: false, first_due: addInterval(today(), every, unit) });
      const cur = meterNow(a, logList());
      K.first_due_meter = a.meter_unit && km && cur != null ? cur + km : null;
      renderTaskSheet();
    } else if (x === 'k-freq') {
      readTaskForm();
      const unit = b.dataset.u;
      const every = b.dataset.e ? Number(b.dataset.e) : null;
      Object.assign(K, { unit, every, custom: false });
      if (K.isNew) K.first_due = unit === 'once' ? today() : addInterval(today(), every, unit);
      renderTaskSheet();
    } else if (x === 'k-custom') {
      readTaskForm();
      K.custom = true;
      if (K.unit === 'once' || K.unit === '') Object.assign(K, { unit: 'month', every: K.every || 1 });
      renderTaskSheet();
    } else if (x === 'k-meteronly') {
      readTaskForm();
      Object.assign(K, { unit: '', every: null, custom: true, first_due: null });
      renderTaskSheet();
    } else if (x === 'k-remind') {
      K.remind_days = Number(b.dataset.v);
      toggleOn('[data-x="k-remind"]', b.dataset.v);
    } else if (x === 'k-del') {
      if (!confirm(`ลบงาน "${K.name}"? (ประวัติที่บันทึกไว้ยังอยู่)`)) return;
      try {
        await api(`/api/tasks/${encodeURIComponent(K.id)}`, { method: 'DELETE' });
        state.tasks = state.tasks.filter((y) => y.id !== K.id);
        saveCache();
        closeSheet();
        toast('ลบงานแล้ว');
        rerender();
      } catch (e) {
        if (!handleErr(e)) toast('ลบไม่สำเร็จ');
      }
    }
  } else if (mode === 'log' && L) {
    if (x === 'l-asset') {
      readLogForm();
      L.asset_id = b.dataset.v;
      const a = assetOf(L.asset_id);
      L.meter = a && a.meter_unit ? meterNow(a, logList()) : null;
      L.task_id = null;
      if (L.kind === 'reading' && !(a && a.meter_unit)) L.kind = 'repair';
      if (L.kind === 'done') L.task_id = (state.tasks.find((k) => k.asset_id === L.asset_id && k.active) || {}).id || null;
      renderLogSheet();
    } else if (x === 'l-kind') {
      readLogForm();
      L.kind = b.dataset.v;
      if (L.kind === 'done' && !L.task_id) L.task_id = (state.tasks.find((k) => k.asset_id === L.asset_id && k.active) || {}).id || null;
      if (L.kind !== 'done') L.task_id = null;
      renderLogSheet();
    } else if (x === 'l-date') {
      $('#l-date', sheetEl).value = b.dataset.v;
    } else if (x === 'l-del') {
      const id = L.id;
      closeSheet();
      deleteLog(id);
    }
  }
});

sheetEl.addEventListener('input', () => {
  if (mode === 'task' && K) {
    readTaskForm();
    const pv = $('#k-preview', sheetEl);
    if (pv) pv.textContent = taskPreview();
  }
});
sheetEl.addEventListener('change', (ev) => {
  if (mode === 'task' && K && ev.target.id === 'k-unit') {
    readTaskForm();
    const pv = $('#k-preview', sheetEl);
    if (pv) pv.textContent = taskPreview();
  }
});
sheetEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'asset-form' && A) submitAsset();
  else if (ev.target.id === 'task-form' && K) submitTask();
  else if (ev.target.id === 'log-form' && L) submitLog();
});

// ---------- หน้า: ตั้งค่า ----------
let edit = null;

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'Asia/Bangkok';
  }
};
const keyBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (buf, b64) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = keyBytes(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

function renderSettings() {
  if (!edit) edit = JSON.parse(JSON.stringify(state.categories));
  let push;
  if (!pushSupported()) {
    push =
      isIOS() && !isStandalone()
        ? '<p class="hint warn-box">บน iPhone/iPad ต้อง <b>เพิ่มแอปไปที่หน้าจอโฮม</b> ก่อน (ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม) แล้วเปิดจากไอคอนนั้น จึงจะเปิดการแจ้งเตือนได้</p>'
        : '<p class="hint warn-box">เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือน ลองใช้ Chrome บน Android หรือคอมพิวเตอร์</p>';
  } else {
    push = `<p class="hint" id="push-status">กำลังตรวจสอบ…</p>
      <div class="row">
        <button type="button" class="btn primary" data-action="push-on" id="push-on" hidden>เปิดการแจ้งเตือนบนเครื่องนี้</button>
        <button type="button" class="btn" data-action="push-test" id="push-test" hidden>ส่งทดสอบ</button>
        <button type="button" class="btn" data-action="push-daily" id="push-daily" hidden>ส่งสรุปตอนนี้</button>
        <button type="button" class="btn ghost" data-action="push-off" id="push-off" hidden>ปิดบนเครื่องนี้</button>
      </div>`;
  }
  app.innerHTML = `
    <header class="topbar"><div class="brand"><h1>ตั้งค่า</h1></div></header>
    <div class="sync" hidden></div>
    <section class="card">
      <h2>การแจ้งเตือน</h2>
      <p class="hint">ทุกวันจะสรุปงานดูแลที่เลยกำหนด/ใกล้ถึง และประกันที่ใกล้หมด — เปิดได้หลายเครื่อง</p>
      <div class="field inline"><label for="remind-hour">เวลาที่เตือนทุกวัน</label>
        <select id="remind-hour" class="in">${Array.from({ length: 18 }, (_, i) => i + 5)
          .map((h) => `<option value="${h}">${pad(h)}:00</option>`)
          .join('')}</select></div>
      ${push}
    </section>
    <section class="card">
      <h2>ประเภทอุปกรณ์</h2>
      <p class="hint">แก้ไอคอน ชื่อ ลำดับ หรือซ่อนประเภทที่ไม่ใช้ (งานแนะนำมีเฉพาะประเภทเริ่มต้น)</p>
      <div id="cat-editor">${edit.map(catRow).join('')}</div>
      <div class="row"><button type="button" class="btn ghost" data-action="cat-add">+ เพิ่มประเภท</button></div>
      <div class="row end">
        <button type="button" class="btn ghost" data-action="cat-reset">คืนค่าเริ่มต้น</button>
        <button type="button" class="btn primary" data-action="cat-save">บันทึก</button>
      </div>
    </section>
    <section class="card">
      <h2>ข้อมูล</h2>
      <p class="hint">รอส่งขึ้นเซิร์ฟเวอร์: <b id="pending-count">${state.outbox.length}</b> รายการ</p>
      <div class="row">
        <button type="button" class="btn" data-action="export-json">สำรองข้อมูล (JSON)</button>
        <button type="button" class="btn" data-action="export-csv">ส่งออกประวัติทั้งหมด (CSV)</button>
        <label class="btn">นำเข้าข้อมูลสำรอง<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      </div>
    </section>
    <section class="card">
      <h2>บัญชี</h2>
      <p class="hint">ออกจากระบบจะล้างข้อมูลที่เก็บไว้ในเครื่องนี้ด้วย</p>
      <button type="button" class="btn danger" data-action="logout">ออกจากระบบ</button>
    </section>
    ${nav()}`;
  updateSync();
  refreshPushUI();
  api('/api/notify-settings')
    .then((r) => {
      const s = $('#remind-hour');
      if (s && !s.dataset.touched) s.value = String(r.hour);
    })
    .catch(() => {});
}

function catRow(c, i) {
  return `<div class="cat-edit${c.hidden ? ' is-hidden' : ''}" data-i="${i}">
    <input class="in emoji" data-f="emoji" value="${esc(c.emoji)}" maxlength="8" aria-label="ไอคอน">
    <input class="in label" data-f="label" value="${esc(c.label)}" maxlength="30" aria-label="ชื่อประเภท">
    <div class="mini-actions">
      <button type="button" class="icon-btn sm" data-action="cat-up" data-i="${i}" aria-label="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-btn sm" data-action="cat-down" data-i="${i}" aria-label="เลื่อนลง" ${i === edit.length - 1 ? 'disabled' : ''}>↓</button>
    </div>
    <div class="check"><label><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> ซ่อน</label></div>
  </div>`;
}

function readCats() {
  for (const row of $$('.cat-edit')) {
    const c = edit[Number(row.dataset.i)];
    c.emoji = $('[data-f="emoji"]', row).value.trim();
    c.label = $('[data-f="label"]', row).value.trim();
    c.hidden = $('[data-f="hidden"]', row).checked;
  }
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshPushUI() {
  const st = $('#push-status');
  if (!st || !pushSupported()) return;
  const show = (id, on) => {
    const el = $(id);
    if (el) el.hidden = !on;
  };
  try {
    const sub = await currentSub();
    if (Notification.permission === 'denied') {
      st.textContent = 'การแจ้งเตือนถูกปิดไว้ในการตั้งค่าของเบราว์เซอร์/เครื่อง — อนุญาตให้เว็บนี้แจ้งเตือนก่อน แล้วกลับมากดเปิดอีกครั้ง';
      show('#push-on', false);
    } else if (sub) {
      st.textContent = '✓ เครื่องนี้เปิดรับการแจ้งเตือนแล้ว';
      show('#push-on', false);
      show('#push-test', true);
      show('#push-daily', true);
      show('#push-off', true);
    } else {
      st.textContent = 'เครื่องนี้ยังไม่ได้เปิดรับการแจ้งเตือน';
      show('#push-on', true);
      show('#push-test', false);
      show('#push-daily', false);
      show('#push-off', false);
    }
  } catch {
    st.textContent = 'ตรวจสอบสถานะการแจ้งเตือนไม่ได้';
  }
}

async function pushOn() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('ยังไม่ได้รับอนุญาตให้แจ้งเตือน');
      return refreshPushUI();
    }
    const { publicKey } = await api('/api/push/key');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, publicKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), tz: localTz() } });
    toast('เปิดการแจ้งเตือนแล้ว — ลองกด "ส่งทดสอบ"');
  } catch (e) {
    if (!handleErr(e)) toast('เปิดการแจ้งเตือนไม่สำเร็จ');
  }
  refreshPushUI();
}

async function pushOff() {
  try {
    const sub = await currentSub();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    toast('ปิดการแจ้งเตือนบนเครื่องนี้แล้ว');
  } catch {
    toast('ไม่สำเร็จ');
  }
  refreshPushUI();
}

async function resyncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSub();
    if (!sub) return;
    const { publicKey } = await api('/api/push/key');
    if (!sameKey(sub.options && sub.options.applicationServerKey, publicKey)) return;
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), tz: localTz() } });
  } catch {}
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง');
  }
  const assets = Array.isArray(data && data.assets) ? data.assets : [];
  const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  const logs = Array.isArray(data && data.logs) ? data.logs : [];
  if (!assets.length && !logs.length) return toast('ไม่พบข้อมูลในไฟล์');
  if (!confirm(`นำเข้าอุปกรณ์ ${assets.length} รายการ งาน ${tasks.length} งาน และบันทึก ${logs.length} รายการ? (id ซ้ำจะถูกแทนถ้าไฟล์ใหม่กว่า)`)) return;
  try {
    for (const asset of assets) await api(`/api/assets/${encodeURIComponent(asset.id)}`, { method: 'PUT', body: { asset } });
    for (const task of tasks) await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: { task } });
    let rejected = 0;
    for (let i = 0; i < logs.length; i += 200) {
      const r = await api('/api/sync', { method: 'POST', body: { ops: logs.slice(i, i + 200).map((log) => ({ type: 'put', log })) } });
      rejected += r.rejected.length;
    }
    if (Array.isArray(data.categories) && confirm('ในไฟล์มีประเภทอุปกรณ์ด้วย ต้องการใช้จากไฟล์ไหม?')) {
      await api('/api/categories', { method: 'PUT', body: { categories: data.categories } });
      edit = null;
    }
    toast(`นำเข้าแล้ว${rejected ? ` (ข้าม ${rejected} รายการที่ไม่ถูกต้อง)` : ''}`);
    await refresh();
    if (state.view === 'settings') renderSettings();
  } catch (e) {
    if (!handleErr(e)) toast('นำเข้าไม่สำเร็จ');
  }
}

// ---------- actions ----------
const actions = {
  'open-asset': (b) => (location.hash = `#/asset/${encodeURIComponent(b.dataset.id)}`),
  'new-asset': () => openAsset(null),
  'edit-asset': (b) => openAsset(assetOf(b.dataset.id)),
  'new-task': (b) => openTask(null, b.dataset.id),
  'edit-task': (b) => openTask(taskOf(b.dataset.id)),
  done: (b) => openLog({ taskId: b.dataset.task }),
  'new-log': () => openLog({}),
  'new-repair': (b) => openLog({ assetId: b.dataset.id, kind: 'repair' }),
  'new-reading': (b) => openLog({ assetId: b.dataset.id, kind: 'reading' }),
  'edit-log': (b) => {
    const l = state.logs.get(b.dataset.id);
    if (l) openLog({ log: l });
  },
  'hist-prev': () => {
    state.hist.month = monthOf(addMonths(`${state.hist.month}-01`, -1));
    renderHistory();
  },
  'hist-next': () => {
    state.hist.month = monthOf(addMonths(`${state.hist.month}-01`, 1));
    renderHistory();
  },
  'hist-csv': () => {
    const h = state.hist;
    download(h.q ? 'maintenance_search.csv' : `maintenance_${h.month}.csv`, toCSV(historyList()), 'text/csv;charset=utf-8');
  },
  'push-on': () => pushOn(),
  'push-off': () => pushOff(),
  'push-test': async (b) => {
    b.disabled = true;
    try {
      const r = await api('/api/push/test', { method: 'POST' });
      toast(r.sent ? `ส่งแล้ว ${r.sent} เครื่อง — ถ้าไม่เด้ง ลองเช็กการตั้งค่าการแจ้งเตือนของเครื่อง` : 'ส่งไม่สำเร็จ ลองปิดแล้วเปิดการแจ้งเตือนใหม่');
    } catch (e) {
      if (!handleErr(e)) toast('ส่งไม่สำเร็จ');
    }
    b.disabled = false;
  },
  'push-daily': async (b) => {
    b.disabled = true;
    try {
      const r = await api('/api/push/daily-now', { method: 'POST' });
      toast(r.items ? `ส่งสรุป ${r.items} รายการแล้ว` : 'ตอนนี้ไม่มีงานที่ใกล้ถึงหรือเลยกำหนด');
    } catch (e) {
      if (!handleErr(e)) toast('ส่งไม่สำเร็จ');
    }
    b.disabled = false;
  },
  'cat-add': () => {
    readCats();
    edit.push({ key: 'c' + Date.now().toString(36), label: 'ประเภทใหม่', emoji: '⭐', hidden: false });
    renderSettings();
    const rows = $$('.cat-edit');
    $('[data-f="label"]', rows[rows.length - 1])?.select();
  },
  'cat-up': (b) => {
    readCats();
    const i = Number(b.dataset.i);
    if (i > 0) [edit[i - 1], edit[i]] = [edit[i], edit[i - 1]];
    renderSettings();
  },
  'cat-down': (b) => {
    readCats();
    const i = Number(b.dataset.i);
    if (i < edit.length - 1) [edit[i + 1], edit[i]] = [edit[i], edit[i + 1]];
    renderSettings();
  },
  'cat-save': async (b) => {
    readCats();
    if (edit.some((c) => !c.label)) return toast('กรุณาใส่ชื่อให้ครบ');
    b.disabled = true;
    try {
      const r = await api('/api/categories', { method: 'PUT', body: { categories: edit } });
      state.categories = r.categories;
      edit = null;
      saveCache();
      toast('บันทึกแล้ว');
      renderSettings();
    } catch (e) {
      if (!handleErr(e)) toast('บันทึกไม่สำเร็จ');
      b.disabled = false;
    }
  },
  'cat-reset': async () => {
    if (!confirm('คืนค่าประเภทเป็นค่าเริ่มต้น? (ข้อมูลเดิมไม่หาย)')) return;
    try {
      const r = await api('/api/categories/reset', { method: 'POST' });
      state.categories = r.categories;
      edit = null;
      saveCache();
      renderSettings();
    } catch (e) {
      if (!handleErr(e)) toast('ไม่สำเร็จ');
    }
  },
  'export-json': async () => {
    try {
      const d = await api('/api/data');
      const data = { app: 'maintenance-tracker', version: 1, exported_at: new Date().toISOString(), ...d };
      download(`maintenance-backup_${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
    } catch (e) {
      if (!handleErr(e)) toast('ส่งออกไม่สำเร็จ');
      else toast('ต้องต่ออินเทอร์เน็ตเพื่อส่งออก');
    }
  },
  'export-csv': () => download(`maintenance_all_${today()}.csv`, toCSV(logList()), 'text/csv;charset=utf-8'),
  logout: async () => {
    if (state.outbox.length && !confirm(`ยังมี ${state.outbox.length} รายการที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ ออกจากระบบแล้วจะหายไป ยืนยัน?`)) return;
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {}
    for (const k of ['mt_cache', 'mt_outbox']) store.del(k);
    state.assets = [];
    state.tasks = [];
    state.logs = new Map();
    state.outbox = [];
    location.hash = '#/';
    showLogin();
  },
};

app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const fn = actions[b.dataset.action];
  if (fn) {
    ev.preventDefault();
    fn(b, ev);
  }
});

let searchTimer;
app.addEventListener('input', (ev) => {
  if (ev.target.id === 'hist-q') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.hist.q = ev.target.value.trim();
      renderHistory();
    }, 250);
  }
});

app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'import-file' && t.files && t.files[0]) {
    importBackup(t.files[0]);
    t.value = '';
  } else if (t.id === 'remind-hour') {
    const hour = Number(t.value);
    t.dataset.touched = '1';
    api('/api/notify-settings', { method: 'PUT', body: { hour, tz: localTz() } })
      .then(() => toast(`จะเตือนทุกวันเวลา ${pad(hour)}:00`))
      .catch((e) => handleErr(e) || toast('บันทึกไม่สำเร็จ'));
  } else if (t.dataset && t.dataset.f === 'hidden') {
    t.closest('.cat-edit').classList.toggle('is-hidden', t.checked);
  }
});

app.addEventListener('submit', (ev) => {
  if (ev.target.id === 'login-form') {
    ev.preventDefault();
    doLogin(ev.target);
  }
});

// ---------- router ----------
function route() {
  if (state.authed === false) return renderLogin();
  const h = location.hash;
  const prev = `${state.view}:${state.assetId}`;
  const m = h.match(/^#\/asset\/(.+)$/);
  state.assetId = m ? decodeURIComponent(m[1]) : null;
  state.view = m ? 'asset' : h.startsWith('#/assets') ? 'assets' : h.startsWith('#/history') ? 'history' : h.startsWith('#/settings') ? 'settings' : 'home';
  if (sheetEl.open) closeSheet();
  if (state.view === 'settings') {
    if (!prev.startsWith('settings')) edit = null;
    renderSettings();
  } else if (state.view === 'assets') renderAssets();
  else if (state.view === 'asset') renderAsset();
  else if (state.view === 'history') renderHistory();
  else renderHome();
  if (prev !== `${state.view}:${state.assetId}`) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function openDeepLink() {
  // ลิงก์ลัดจากไอคอนบนหน้าจอโฮม: /?add=log หรือ /?add=asset
  const add = new URLSearchParams(location.search).get('add');
  if (!add) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (add === 'log') openLog({});
  else if (add === 'asset') openAsset(null);
}

// ---------- เริ่มต้น ----------
async function boot() {
  try {
    await api('/api/me');
    state.authed = true;
  } catch (e) {
    if (e.status === 401) return showLogin();
    state.authed = true;
    state.online = false;
  }
  route();
  if (state.online) {
    await refresh();
    openDeepLink();
    flush();
    resyncPush();
  } else openDeepLink();
}

window.addEventListener('online', () => {
  state.online = true;
  updateSync();
  flush();
  refresh();
});
window.addEventListener('offline', () => {
  state.online = false;
  updateSync();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.authed !== true) return;
  flush();
  if (Date.now() - state.lastRefresh > 60000) refresh();
  else if (!sheetEl.open) rerender();
});
setInterval(() => {
  if (state.outbox.length && state.authed === true) flush();
}, 20000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
