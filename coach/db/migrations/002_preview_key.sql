-- Which pattern a free user previewed this month, so the same one stays visible.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_pattern_preview_key text;
