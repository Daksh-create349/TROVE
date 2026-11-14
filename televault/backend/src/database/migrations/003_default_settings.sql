-- 003_default_settings.sql
-- Safe application defaults. Values are JSON so they can evolve without
-- schema changes.

INSERT INTO settings (key, value) VALUES
  ('ui.theme', '"system"'),
  ('uploads.concurrency', '2'),
  ('downloads.concurrency', '2'),
  ('security.requireApiToken', 'true')
ON CONFLICT (key) DO NOTHING;
