-- The tag vocabulary. xm_post_tag (from 0001) still links posts to tags by
-- slug; these tables give each tag a display label, a category, and a short
-- description, and record retired spellings so their URLs keep working.

CREATE TABLE IF NOT EXISTS xm_tag (
  tag            TEXT PRIMARY KEY,             -- slug, e.g. "saved-by-the-bell"
  label          TEXT NOT NULL,                -- display name, e.g. "Saved by the Bell"
  category       TEXT NOT NULL DEFAULT 'other',-- see CATEGORIES in src/lib/tags.js
  description    TEXT,                         -- 1-2 sentences for the tag page; written by the daily upkeep job
  reviewed_at    TEXT,                         -- last time the upkeep job looked at this tag
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS xm_tag_category ON xm_tag (category);

-- A retired tag slug and the tag it now means. /tag/<alias> redirects.
CREATE TABLE IF NOT EXISTS xm_tag_alias (
  alias      TEXT PRIMARY KEY,
  tag        TEXT NOT NULL REFERENCES xm_tag (tag) ON DELETE CASCADE,
  reason     TEXT,                             -- "auto-merge", "admin", ...
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS xm_post_tag_post ON xm_post_tag (post_id);

-- Bring tags that existed before this migration into the vocabulary.
INSERT OR IGNORE INTO xm_tag (tag, label)
SELECT DISTINCT tag, REPLACE(tag, '-', ' ') FROM xm_post_tag;
