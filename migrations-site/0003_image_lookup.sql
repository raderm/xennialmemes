-- Indexes for looking a post up by its image or thumbnail address, which
-- /i/* does on every image request to serve only published memes.
CREATE INDEX IF NOT EXISTS xm_post_image_key ON xm_post (image_key);
CREATE INDEX IF NOT EXISTS xm_post_thumb_key ON xm_post (thumb_key);
