# ดูแลอุปกรณ์ (maintenance-tracker)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/monthop-gmail/maintenance-tracker)

เว็บแอปดูแลอุปกรณ์ในชีวิตประจำวัน — รถ แอร์ เครื่องกรองน้ำ ถังดับเพลิง คอมพิวเตอร์ บ้าน ฯลฯ
บอกว่าอะไรถึงรอบต้องดูแล (ตามเวลาหรือเลขไมล์) เก็บประวัติการดูแล/ซ่อมพร้อมค่าใช้จ่าย และเตือนก่อนประกันหมด
รันบน **Cloudflare Workers + D1** (ใช้แผนฟรีได้) ไม่มีขั้นตอน build ฝั่งหน้าเว็บ

> A Thai-language home & vehicle maintenance tracker for Cloudflare Workers + D1: interval tasks by time and/or odometer
> (counted from the last time actually done), repair history with costs, warranty reminders and daily push notifications.

ใครจะเอาไปใช้ กดปุ่ม **Deploy to Cloudflare** ด้านบนได้เลย แต่ละคนจะได้แอปและฐานข้อมูลของตัวเองในบัญชี Cloudflare ของตัวเอง

## ทำอะไรได้บ้าง

- **อุปกรณ์** — ประเภท ที่ตั้ง ยี่ห้อ รุ่น S/N/ทะเบียน วันซื้อ ราคา **วันหมดประกัน** ช่าง/ร้านที่ติดต่อ หมายเหตุ (เบอร์ยาง รุ่นไส้กรอง ฯลฯ)
- **งานดูแลตามรอบ** — *รอบถัดไปนับจากครั้งล่าสุดที่ทำจริง* (ทำช้า รอบถัดไปก็เลื่อนตาม)
  - ตามเวลา: ทุก n วัน/สัปดาห์/เดือน/ปี · ตามเลขไมล์/ชั่วโมงใช้งาน: ทุก n กม. · หรือทั้งสองแบบ "อย่างไหนถึงก่อน"
  - งานครั้งเดียว (ทำภายในวันที่)
  - ประมาณว่าอีกกี่วันจะถึงระยะไมล์ จากอัตราการใช้งานจริง
  - **งานแนะนำตามประเภท** เช่น รถ → เปลี่ยนน้ำมันเครื่อง 6 เดือน/10,000 กม., แอร์ → ล้างแอร์ 6 เดือน,
    เครื่องกรองน้ำ → เปลี่ยนไส้กรอง, ถังดับเพลิง → ตรวจเกจทุกเดือน, บ้าน → ล้างรางน้ำ ฉีดปลวก
- **ต้องทำ** (หน้าแรก) — เลยกำหนด / ใกล้ถึง / ถัดไป 60 วัน / ประกันใกล้หมด แตะ **ทำแล้ว** ครั้งเดียว (บันทึกย้อนหลังได้)
- **บันทึก** — ทำตามรอบ, ซ่อม/เปลี่ยนอะไหล่, จดเลขไมล์, บันทึกอื่น พร้อมค่าใช้จ่ายและผู้ทำ/ร้าน
- **ประวัติ** — รายเดือน ค่าใช้จ่ายแยกตามอุปกรณ์ ค้นหา ("ช่างเอ", "เปลี่ยนยาง") และดาวน์โหลด CSV
- **แจ้งเตือนบนมือถือ** (Web Push) สรุปทุกวันตามเวลาที่เลือก
- **ใช้ได้ตอนเน็ตหลุด**, สำรอง/นำเข้าข้อมูล (JSON), ติดตั้งเป็นแอปบนหน้าจอโฮม (PWA), โหมดมืด

## วิธี deploy

### แบบที่ 1: ปุ่ม Deploy to Cloudflare (ง่ายที่สุด)

กดปุ่มด้านบน → ล็อกอิน Cloudflare + GitHub → ตั้งรหัสผ่าน `APP_PASSWORD` (อย่างน้อย 8 ตัว) → รอระบบสร้างฐานข้อมูลและ deploy

### แบบที่ 2: GitHub Actions (repo นี้หรือ fork)

ตั้ง secrets ใน repo (Settings → Secrets and variables → Actions) แล้ว push เข้า `main` หรือกด Run workflow

| Secret | | ค่า |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | จำเป็น | template **Edit Cloudflare Workers** + สิทธิ์ **Account → D1 → Edit** |
| `APP_PASSWORD` | แนะนำ | รหัสผ่านเข้าแอป (อย่างน้อย 8 ตัว) — workflow ตั้งให้ Worker เอง |
| `CLOUDFLARE_ACCOUNT_ID` | ไม่บังคับ | ใส่เมื่อ token เข้าถึงได้หลาย account |
| `API_TOKEN` | ไม่บังคับ | token สำหรับบันทึกผ่าน API / Shortcuts |

ไม่ต้องสร้างฐานข้อมูลเอง — `scripts/ensure-d1.mjs` จะหา/สร้างฐานข้อมูลชื่อ `maintenance-tracker` ให้ตอน deploy

### แบบที่ 3: deploy เองด้วย Wrangler

```bash
npm ci && npx wrangler login
npx wrangler d1 create maintenance-tracker     # เอา database_id ไปใส่แทน 00000000-... ใน wrangler.jsonc
npx wrangler secret put APP_PASSWORD
npm run deploy
```

รันในเครื่อง: `cp .dev.vars.example .dev.vars` (ใส่ APP_PASSWORD) → `npm run db:migrate:local` → `npm run dev`

## ใช้บนมือถือ

- **iPhone**: Safari → แชร์ → "เพิ่มไปยังหน้าจอโฮม" · **Android**: Chrome → ⋮ → "ติดตั้งแอป"
- เปิดแจ้งเตือน: แท็บ **ตั้งค่า → การแจ้งเตือน** (iPhone ต้องเปิดจากไอคอนบนหน้าจอโฮม iOS 16.4+)

## บันทึกผ่าน API (iOS Shortcuts / สคริปต์)

ตั้ง token: `npx wrangler secret put API_TOKEN`

```bash
# จดเลขไมล์
curl -X POST https://<your-worker>/api/logs -H "Authorization: Bearer <API_TOKEN>" -H "Content-Type: application/json" \
  -d '{"asset":"Honda City","meter":55210}'
# บันทึกว่าทำงานดูแลแล้ว
curl -X POST https://<your-worker>/api/logs -H "Authorization: Bearer <API_TOKEN>" -H "Content-Type: application/json" \
  -d '{"asset":"แอร์ห้องนอน","task":"ล้างแอร์","cost":600,"provider":"ช่างเอ"}'
```

## ความปลอดภัยและข้อมูล

- ทุก API ต้องล็อกอิน (cookie HttpOnly ที่เซ็นด้วย HMAC) หรือ Bearer token; ผิดเกิน 10 ครั้งใน 15 นาทีล็อกชั่วคราว
- ไม่ยอมให้ใช้งานถ้า `APP_PASSWORD` ว่าง สั้นกว่า 8 ตัว หรือเป็นค่าตัวอย่าง
- ฟอนต์และไฟล์ทั้งหมดเสิร์ฟจาก Worker เอง ไม่เรียกบริการภายนอก
- D1 Time Travel กู้ฐานข้อมูลย้อนหลังได้ (ฟรี 7 วัน / Paid 30 วัน) และสำรองเป็น JSON ได้จากหน้าตั้งค่า

## โครงสร้าง

```
public/schedule.js        คำนวณรอบ (เวลา/เลขไมล์/อัตราการใช้งาน) — ใช้ร่วมกันทั้งหน้าเว็บและ Worker
public/app.js             หน้าเว็บ (ES module ไม่ต้อง build)
src/index.ts              Worker: router + cron
src/assets.ts             อุปกรณ์ งานดูแล บันทึก หมวด + สรุปเตือนรายวัน
src/auth.ts               ล็อกอิน
src/notify.ts, push.ts    Web Push (VAPID + aes128gcm ด้วย WebCrypto)
migrations/0001_init.sql  assets, tasks, logs, settings, push_subs, ...
scripts/ensure-d1.mjs     CI: หา/สร้างฐานข้อมูล D1 อัตโนมัติ
```

### API

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| POST | `/api/login` · `/api/logout` | เข้า/ออกจากระบบ |
| GET | `/api/data` | อุปกรณ์ งาน บันทึก และประเภท |
| POST | `/api/sync` | `{ops:[{type:'put',log} \| {type:'del',id,updated_at}]}` (idempotent, last-write-wins) |
| POST | `/api/logs` | บันทึกแบบอ้างชื่ออุปกรณ์/งาน (Shortcuts) |
| PUT/DELETE | `/api/assets/:id` · `/api/tasks/:id` | เพิ่ม/แก้/ลบอุปกรณ์และงานดูแล |
| GET/PUT | `/api/categories`, POST `/api/categories/reset` | ประเภทอุปกรณ์ |
| GET/PUT | `/api/notify-settings` | เวลาเตือนรายวัน |
| GET/POST | `/api/push/key`, `/subscribe`, `/unsubscribe`, `/test`, `/daily-now` | การแจ้งเตือน |

## สัญญาอนุญาต

โค้ดใช้สัญญาอนุญาต MIT (ดู `LICENSE`) · ฟอนต์ IBM Plex Sans Thai ใช้ SIL Open Font License 1.1
