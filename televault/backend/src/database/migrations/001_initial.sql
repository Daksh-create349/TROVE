-- 001_initial.sql
-- Core TeleVault schema. File contents are never stored in SQLite; only
-- metadata, Telegram message references and job state are persisted.

CREATE TABLE app_profiles (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT app_profiles_singleton_unique UNIQUE (singleton)
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 255),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX folders_name_per_parent_unique
  ON folders (IFNULL(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE telegram_accounts (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  session_ciphertext TEXT NOT NULL,
  session_updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'logged_out', 'error')),
  last_connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL
    CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'
    CHECK (length(trim(mime_type)) BETWEEN 1 AND 255),
  total_size INTEGER NOT NULL CHECK (total_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  part_count INTEGER NOT NULL DEFAULT 0 CHECK (part_count >= 0),
  telegram_peer_id TEXT,
  telegram_message_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(telegram_message_ids)
      AND json_type(telegram_message_ids) = 'array'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'paused', 'failed', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE file_parts (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  telegram_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'paused', 'failed', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (file_id, part_index)
);

CREATE TABLE upload_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'paused', 'failed', 'completed')),
  progress_bytes INTEGER NOT NULL DEFAULT 0 CHECK (progress_bytes >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE download_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'paused', 'failed', 'completed')),
  progress_bytes INTEGER NOT NULL DEFAULT 0 CHECK (progress_bytes >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  target_directory TEXT,
  target_filename TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
