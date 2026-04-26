-- Mining Platform — D1 (SQLite) Schema
-- Run: wrangler d1 execute mining-platform-db --file=src/db/schema.sql --remote

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Companies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  country      TEXT NOT NULL DEFAULT 'GH',
  license_no   TEXT UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  employee_id   TEXT,
  role          TEXT NOT NULL CHECK(role IN ('super_admin','admin','instructor','analyst','worker')),
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_role    ON users(company_id, role);

-- ─── Refresh tokens (rotation table) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

-- ─── API Keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT '["read"]',
  last_used_at TEXT,
  expires_at   TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Mining Sites ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  latitude     REAL NOT NULL,
  longitude    REAL NOT NULL,
  elevation_m  REAL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed','exploration')),
  ore_type     TEXT NOT NULL,
  concession   TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sites_company ON sites(company_id);

-- ─── Work Jobs / Shifts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL REFERENCES sites(id),
  company_id     TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  shift_type     TEXT NOT NULL CHECK(shift_type IN ('day','night','swing')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','in_progress','completed','cancelled')),
  instructor_id  TEXT NOT NULL REFERENCES users(id),
  scheduled_at   TEXT NOT NULL,
  completed_at   TEXT,
  ai_brief       TEXT,
  safety_flags   TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_site      ON jobs(site_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_at);

-- ─── Job Assignments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_assignments (
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, user_id)
);

-- ─── Safety Incidents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id),
  company_id   TEXT NOT NULL,
  reported_by  TEXT NOT NULL REFERENCES users(id),
  severity     TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  description  TEXT NOT NULL,
  ai_analysis  TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved')),
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_site   ON incidents(site_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(company_id, status);

-- ─── Production Reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_reports (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id),
  site_id        TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  submitted_by   TEXT NOT NULL REFERENCES users(id),
  ore_extracted  REAL NOT NULL DEFAULT 0,
  grade          REAL,
  recovery_rate  REAL,
  hours_worked   REAL NOT NULL DEFAULT 0,
  equipment_used TEXT,
  notes          TEXT DEFAULT '',
  ai_summary     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_site ON production_reports(site_id, created_at DESC);

-- ─── Wallets (CQRS write model) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE,
  company_id  TEXT NOT NULL,
  balance     INTEGER NOT NULL DEFAULT 0,   -- pesewas (GHS × 100)
  pending     INTEGER NOT NULL DEFAULT 0,   -- held during payment processing
  currency    TEXT NOT NULL DEFAULT 'GHS',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallets_company ON wallets(company_id);

-- ─── Transactions (append-only event ledger) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  from_user_id      TEXT,
  to_user_id        TEXT,
  amount            INTEGER NOT NULL,
  fee_amount        INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'GHS',
  type              TEXT NOT NULL CHECK(type IN ('PAYMENT','PAYOUT','FEE','REFUND')),
  status            TEXT NOT NULL DEFAULT 'INITIATED'
                    CHECK(status IN ('INITIATED','PENDING','CONFIRMED','FAILED','REFUNDED')),
  gateway           TEXT NOT NULL,
  gateway_reference TEXT,
  reference         TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL DEFAULT '',
  metadata          TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_company    ON transactions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_from_user  ON transactions(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_to_user    ON transactions(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status     ON transactions(status, gateway);

-- ─── Notifications (Outbox) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_company ON notifications(company_id, created_at DESC);

-- ─── Audit Log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  user_id     TEXT,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  resource_id TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  payload     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_company  ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource, resource_id);
