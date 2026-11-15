#!/usr/bin/env node
// ใช้ใน CI: ถ้า wrangler.jsonc ยังเป็น database_id ว่าง (0000...) ให้หาฐานข้อมูล D1 ตามชื่อ
// ถ้ายังไม่มีก็สร้างใหม่ แล้วใส่ id ลงไฟล์ config (เฉพาะในเครื่อง CI ไม่ได้ commit กลับ)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'wrangler.jsonc';
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

const text = readFileSync(CONFIG, 'utf8');
if (!text.includes(PLACEHOLDER)) {
  console.log('database_id ถูกตั้งไว้แล้ว — ไม่ต้องทำอะไร');
  process.exit(0);
}
const name = (text.match(/"database_name"\s*:\s*"([^"]+)"/) || [])[1];
if (!name) throw new Error('ไม่พบ database_name ใน wrangler.jsonc');

const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/** ดึง array JSON ออกจากผลลัพธ์ (เผื่อมีข้อความอื่นปนมา) */
export function parseList(out) {
  const end = out.lastIndexOf(']');
  // ลองทุกตำแหน่ง '[' (กันข้อความอย่าง "▲ [WARNING]" ที่อาจขึ้นก่อน JSON)
  for (let i = out.indexOf('['); i >= 0 && i < end; i = out.indexOf('[', i + 1)) {
    try {
      const v = JSON.parse(out.slice(i, end + 1));
      if (Array.isArray(v)) return v;
    } catch {}
  }
  return [];
}

const findId = () => {
  const db = parseList(wrangler(['d1', 'list', '--json'])).find((d) => d.name === name);
  return db ? db.uuid || db.id || db.database_id : null;
};

let id = findId();
if (id) console.log(`พบฐานข้อมูล ${name} (${id})`);
else {
  console.log(`ยังไม่มีฐานข้อมูล ${name} — กำลังสร้าง…`);
  wrangler(['d1', 'create', name, '--location', 'apac', '--update-config=false']);
  id = findId();
  if (!id) throw new Error('สร้างฐานข้อมูลแล้วแต่หา id ไม่พบ');
  console.log(`สร้างฐานข้อมูล ${name} แล้ว (${id})`);
}
writeFileSync(CONFIG, text.replace(PLACEHOLDER, id));
