-- Site tables for xennialmemes.com.
-- The engine9 tables (person, person_email, segment, api_key, ...) are
-- installed by `npx e9core setup`; these live beside them in the same D1
-- database. Every name uses the `xm_` stem so it can never collide with a
-- published engine9 table.

-- One row per image that came in from the Google Drive folder.
CREATE TABLE IF NOT EXISTS xm_post (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,          -- SEO file name stem, e.g. "oregon-trail-dysentery-meme"
  title         TEXT NOT NULL,
  alt_text      TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',    -- JSON array of lowercase tags
  image_key     TEXT NOT NULL,                 -- R2 key of the original, e.g. "oregon-trail-dysentery-meme.jpg"
  thumb_key     TEXT,                          -- R2 key of the grid thumbnail (null when no Images binding)
  mime_type     TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  drive_file_id TEXT NOT NULL UNIQUE,
  drive_name    TEXT,
  status        TEXT NOT NULL DEFAULT 'published', -- published | hidden (by an admin) | removed (gone from Drive)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS xm_post_status_id ON xm_post (status, id DESC);

-- Tags split out so tag pages are an index lookup.
CREATE TABLE IF NOT EXISTS xm_post_tag (
  post_id INTEGER NOT NULL REFERENCES xm_post (id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (tag, post_id)
);

-- Public handle a member picks before commenting. person_id is engine9 person.id.
CREATE TABLE IF NOT EXISTS xm_profile (
  person_id  INTEGER PRIMARY KEY,
  handle     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS xm_favorite (
  person_id  INTEGER NOT NULL,
  post_id    INTEGER NOT NULL REFERENCES xm_post (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (person_id, post_id)
);
CREATE INDEX IF NOT EXISTS xm_favorite_post ON xm_favorite (post_id);

CREATE TABLE IF NOT EXISTS xm_comment (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES xm_post (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'visible',  -- visible | deleted
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS xm_comment_post ON xm_comment (post_id, id);
CREATE INDEX IF NOT EXISTS xm_comment_person ON xm_comment (person_id, created_at);

-- Drive files that failed to ingest, so a bad file is retried a few times
-- and then left alone instead of burning API calls every run.
CREATE TABLE IF NOT EXISTS xm_ingest_error (
  drive_file_id TEXT PRIMARY KEY,
  drive_name    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 1,
  last_error    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
