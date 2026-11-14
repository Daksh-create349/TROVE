-- 002_indexes_and_triggers.sql
-- Query indexes plus automatic updated_at maintenance.

CREATE INDEX folders_parent_idx ON folders (parent_id);
CREATE INDEX files_folder_idx ON files (folder_id);
CREATE INDEX files_status_idx ON files (status);
CREATE INDEX files_sha256_idx ON files (sha256);
CREATE INDEX files_created_at_idx ON files (created_at DESC);
CREATE INDEX file_parts_file_idx ON file_parts (file_id, part_index);
CREATE INDEX upload_jobs_status_idx ON upload_jobs (status, created_at);
CREATE INDEX upload_jobs_file_idx ON upload_jobs (file_id);
CREATE INDEX download_jobs_status_idx ON download_jobs (status, created_at);
CREATE INDEX download_jobs_file_idx ON download_jobs (file_id);
CREATE INDEX telegram_accounts_status_idx ON telegram_accounts (status);

-- At most one non-terminal upload/download job may exist per file.
CREATE UNIQUE INDEX upload_jobs_one_active_per_file
  ON upload_jobs (file_id)
  WHERE status IN ('queued', 'processing', 'paused');

CREATE UNIQUE INDEX download_jobs_one_active_per_file
  ON download_jobs (file_id)
  WHERE status IN ('queued', 'processing', 'paused');

CREATE TRIGGER app_profiles_set_updated_at
AFTER UPDATE ON app_profiles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE app_profiles
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER folders_set_updated_at
AFTER UPDATE ON folders
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE folders
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER telegram_accounts_set_updated_at
AFTER UPDATE ON telegram_accounts
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE telegram_accounts
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER files_set_updated_at
AFTER UPDATE ON files
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE files
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER file_parts_set_updated_at
AFTER UPDATE ON file_parts
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE file_parts
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER upload_jobs_set_updated_at
AFTER UPDATE ON upload_jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE upload_jobs
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER download_jobs_set_updated_at
AFTER UPDATE ON download_jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE download_jobs
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER settings_set_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE key = NEW.key;
END;
