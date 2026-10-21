-- Small key/value store for values that are expensive to recompute:
--   tags_used   JSON list of tags with their published-meme counts, read by
--               every page that shows tags; cleared whenever posts or tags
--               change and rebuilt on the next read.
--   drive_fp    fingerprint of the Drive folder listing, so the 10-minute
--               check skips the database when nothing in Drive changed.
CREATE TABLE IF NOT EXISTS xm_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
