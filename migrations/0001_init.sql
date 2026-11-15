-- อุปกรณ์
CREATE TABLE IF NOT EXISTS assets (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,                  -- เช่น แอร์ห้องนอน, Honda City
  category              TEXT NOT NULL DEFAULT 'other',  -- ประเภท (car, aircon, water, ...)
  location              TEXT NOT NULL DEFAULT '',       -- ห้อง/ที่ตั้ง
  brand                 TEXT NOT NULL DEFAULT '',
  model                 TEXT NOT NULL DEFAULT '',
  serial                TEXT NOT NULL DEFAULT '',       -- S/N, ทะเบียนรถ
  purchase_date         TEXT,
  price                 REAL,
  warranty_until        TEXT,                           -- วันหมดประกัน
  warranty_remind_days  INTEGER NOT NULL DEFAULT 30,
  contact               TEXT NOT NULL DEFAULT '',       -- ช่าง/ร้าน/ศูนย์บริการ เบอร์โทร
  notes                 TEXT NOT NULL DEFAULT '',
  meter_unit            TEXT NOT NULL DEFAULT '',       -- '' / กม. / ชม. (ถ้ามีเลขไมล์หรือชั่วโมงใช้งาน)
  meter_start           REAL,                           -- เลขไมล์ตอนเพิ่มอุปกรณ์
  meter_start_date      TEXT,
  active                INTEGER NOT NULL DEFAULT 1,     -- 0 = เลิกใช้/ขายแล้ว
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

-- งานดูแลตามรอบ (นับรอบถัดไปจากครั้งล่าสุดที่ทำจริง)
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL,
  name             TEXT NOT NULL,                 -- เช่น ล้างแอร์, เปลี่ยนน้ำมันเครื่อง
  unit             TEXT NOT NULL DEFAULT 'month', -- day / week / month / year / once / '' (ตามเลขไมล์อย่างเดียว)
  every            INTEGER,                       -- ทุก ๆ กี่หน่วย
  every_meter      REAL,                          -- ทุก ๆ กี่ กม./ชม.
  first_due        TEXT,                          -- ครบกำหนดครั้งแรก (ใช้เมื่อยังไม่เคยบันทึกว่าทำ)
  first_due_meter  REAL,
  remind_days      INTEGER NOT NULL DEFAULT 7,
  remind_meter     REAL,                          -- เตือนก่อนกี่ กม. (ว่าง = 10% ของรอบ)
  est_cost         REAL,
  notes            TEXT NOT NULL DEFAULT '',
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_asset ON tasks (asset_id);

-- บันทึก: ทำตามงานดูแล / ซ่อม / จดเลขไมล์ / บันทึกอื่น
CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY,                   -- UUID สร้างจากฝั่งเครื่อง (รองรับบันทึกตอนออฟไลน์)
  asset_id    TEXT NOT NULL,
  task_id     TEXT,
  kind        TEXT NOT NULL DEFAULT 'done',       -- done / repair / reading / note
  done_date   TEXT NOT NULL,                      -- YYYY-MM-DD (บันทึกย้อนหลังได้)
  title       TEXT NOT NULL DEFAULT '',
  meter       REAL,
  cost        REAL,
  provider    TEXT NOT NULL DEFAULT '',           -- ทำเอง / ร้าน / ช่าง
  note        TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_asset ON logs (asset_id, done_date);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs (deleted, done_date);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip            TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  ua          TEXT,
  created_at  INTEGER NOT NULL,
  last_ok     INTEGER,
  fails       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  key      TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL
);
