CREATE TABLE IF NOT EXISTS creators (
  sec_uid TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_states (
  sec_uid TEXT PRIMARY KEY REFERENCES creators(sec_uid) ON DELETE CASCADE,
  initialized_at TEXT NOT NULL DEFAULT '',
  last_stable_status TEXT NOT NULL DEFAULT 'unknown',
  room_id TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  live_url TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL DEFAULT '',
  last_live_started_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS deliveries (
  event_key TEXT PRIMARY KEY,
  sec_uid TEXT NOT NULL REFERENCES creators(sec_uid) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runtime_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  name TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL,
  owner TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS creators_enabled_idx ON creators(enabled);
CREATE INDEX IF NOT EXISTS creator_states_checked_idx ON creator_states(last_checked_at);
CREATE INDEX IF NOT EXISTS deliveries_pending_idx ON deliveries(status, next_retry_at);
