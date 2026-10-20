# xennialmemes.com

A Tumblr-style mosaic of memes. Drop an image into a Google Drive folder and,
within ten minutes, it's on the site with:

- **alt text** that describes the picture and transcribes its words, written by Claude
- an **SEO file name** (`/i/oregon-trail-dysentery-meme.jpg`), title, meta description and topic tags
- its own page (`/p/oregon-trail-dysentery-meme`) with Open Graph tags and `ImageObject` structured data, plus a sitemap and RSS feed
- **topic tags drawn from a shared vocabulary**, so related memes find each other (see [Tags](#tags))

Visitors log in with [engine9](https://github.com/engine9-ai/core) (delegate) to
**favorite** memes and **comment**. Everything runs as one Cloudflare Worker with a
D1 database and an R2 bucket.

## How it fits together

```
Google Drive folder ──(every 10 min)──► Worker cron ──► Claude API: alt text, title, file name, tags
                                              │
                                              ├─► R2 (MEDIA): <seo-name>.jpg + thumbs/<seo-name>.webp
                                              └─► D1 (DB): xm_post, xm_post_tag

Daily cron ──► tag upkeep ──► Claude API: merge duplicate tags, fix labels/categories, write tag intros

Browser ──► Worker ──► pages: /, /p/:slug, /tags, /tag/:tag, /favorites, /sitemap.xml, /feed.xml
                  ├──► /i/*         images from R2
                  ├──► /api/site/*  favorites, comments, handles   (src/site/api.js)
                  └──► /api/*       engine9 core: login, people    (@engine9/core)
```

| Path | What it is |
| --- | --- |
| `src/worker.js` | Entry point: routing, engine9 core, cron |
| `src/ingest/` | Drive listing and download, Claude captioning, posting, daily tag upkeep |
| `src/lib/tags.js` | Tag categories, matching new tags to existing ones, tag queries |
| `src/site/` | Page HTML (`render.js`), page routes, the member API |
| `src/lib/db.js` | All SQL for the site's `xm_` tables |
| `migrations-site/` | The site's tables, applied by `npm run db:migrate` (`scripts/migrate.js`). `migrations/` is engine9's, written by `e9core setup`; don't add files there |
| `public/assets/` | CSS, browser JS, icons. `public/assets/vendor/engine9-id.js` (the login library) is copied from `@engine9/id` by `scripts/vendor-id.js` on install, dev and deploy; it isn't committed |
| `test/` | `npm test`: ingest, pages, API, against an in-memory SQLite |

## One-time setup

You need Node.js 22+, a Cloudflare account with `xennialmemes.com` on it, a
Google account, and an Anthropic API key.

### 1. Install and create the database

```bash
git clone https://github.com/raderm/xennialmemes && cd xennialmemes
npm install
npx wrangler login
npx e9core setup              # fills in wrangler.jsonc, creates engine9 tables, writes .env with keys
npm run db:migrate            # adds the site's tables to the local database
```

### 2. Google Drive access

1. In [Google Cloud console](https://console.cloud.google.com/), create a project
   (or pick one) and **enable the Google Drive API**.
2. **IAM & Admin → Service accounts → Create service account.** No roles needed.
   Open it, **Keys → Add key → JSON**, and download the file.
3. In Google Drive, create the folder for memes and **share it with the service
   account's email** (`…@….iam.gserviceaccount.com`) as **Viewer**.
4. Copy the folder id (the last part of its URL,
   `drive.google.com/drive/folders/<this part>`) into `DRIVE_FOLDER_ID` in
   `wrangler.jsonc`.

### 3. Keys in `.env`

Add these two lines to the `.env` that setup created (see `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SERVICE_ACCOUNT_JSON=<the key file, base64: base64 -i key.json | tr -d '\n'>
```

Also set `ADMIN_EMAILS` in `wrangler.jsonc` to your email. Admins can delete any
comment and hide any post from its page.

### 4. Try it locally

```bash
npm run dev                   # http://localhost:8787
npm run ingest:local          # in another terminal: pull memes from Drive now
```

Login works on localhost once `localhost:8787` is allowed on delegate (step 6).

## Deploy

```bash
npx wrangler r2 bucket create xennialmemes-media
npx e9core setup --remote                                         # production D1, engine9 keys, first deploy
npm run db:migrate:remote                                         # site tables in production
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npm run deploy
```

`wrangler.jsonc` already attaches `xennialmemes.com` and `www.xennialmemes.com`
(www redirects to the bare domain). Then:

5. Run `npm run ingest:prod` once to pull in what's already in the folder. After
   that the cron picks up new files every 10 minutes, 5 at a time
   (`INGEST_BATCH`).
6. **Allow your domain on delegate.** Ask the delegate operator to allow
   `xennialmemes.com` (and `localhost:8787` for testing). Until then, browsing
   works and the Log in button won't complete.
7. Submit `https://xennialmemes.com/sitemap.xml` in Google Search Console.

## Tags

Tags are how visitors browse, so the site keeps them as one tidy vocabulary
instead of letting every meme invent its own words.

**When a meme comes in,** Claude sees the existing tags (most used first) and is
told to reuse them, adding a new tag only for a specific reference the list is
missing: a show, toy, game, gadget or event. Each tag has a display label
("Saved by the Bell") and one of eleven categories (TV & movies, Music, Games,
Toys & collectibles, Tech & the internet, School days, Food & drink, Fashion &
style, Home & family, Adulting, Everything else). Whatever Claude returns is
then matched against the vocabulary in code: plural and spelling variants
("tamagotchis", "1990s-cartoons", "the-simpsons"), one-letter typos, and retired
slugs all land on the existing tag. Tags that would fit every meme here
("meme", "nostalgia", a bare "90s") are dropped.

**Once a day** (08:23 UTC) the upkeep job:

1. drops tags no meme uses any more;
2. if tags were added since its last pass, shows Claude the whole vocabulary
   and applies what it finds: duplicates and synonyms are **merged** (the old
   slug becomes an alias, so `/tag/old-slug` redirects permanently), and wrong
   labels or categories are fixed;
3. writes a one- or two-sentence intro for every tag with 3 or more memes
   (`TAG_DESCRIBE_MIN`). It's the tag page's opening line and its meta
   description.

Set `TAG_AUTOMERGE` to `"false"` in `wrangler.jsonc` if you'd rather review
merges yourself; labels, categories and intros still update.

**On the site:**

- **Topics** (`/tags`, linked in the masthead) lists every tag by category,
  with bigger type for tags that have more memes, and a filter box.
- **Tag pages** show the category, Claude's intro, the tags that most often
  appear alongside this one, and the mosaic.
- **Post pages** end with **More like this**: memes sharing the most tags,
  with rare shared tags counting for more than common ones.
- The home page's topic row shows the 16 busiest tags plus **All topics**.

**Correcting tags by hand** (with `E9_ADMIN_API_KEY` from `.env`):

```bash
KEY=$(grep E9_ADMIN_API_KEY .env | cut -d= -f2)
SITE=https://xennialmemes.com

# Rename, recategorize, or rewrite a tag's intro. Hand edits stick: upkeep won't revisit them.
curl -X POST $SITE/api/site/admin/tags/pogs -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"label":"Pogs","category":"toys"}'

# Fold one tag into another (the old URL redirects).
curl -X POST $SITE/api/site/admin/tags/merge -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"from":"milk-caps","to":"pogs"}'

# Run the daily upkeep now.
curl -X POST $SITE/api/site/admin/tags/upkeep -H "Authorization: Bearer $KEY"
```

## Running it

| You want to… | Do this |
| --- | --- |
| Add a meme | Put the image in the Drive folder. JPEG, PNG, GIF and WebP; up to 20 MB |
| Choose the file name yourself | Name the file in URL form before uploading, e.g. `oregon-trail-dysentery-meme.jpg` (lowercase words joined by hyphens; underscores and capitals are fine too). That name is kept as-is instead of the one Claude writes. Names with spaces, camera names and one-word names get Claude's. If the name is already taken, `-2` is added |
| Give Claude context | Name the file meaningfully (`tamagotchi-funeral.png`) or fill in the Drive file's description. Camera names like `IMG_2034` are ignored |
| Take a meme down | Delete it from the Drive folder (it hides on the next run), or press **Hide from site** on its page while logged in as an admin. Its page and its image address both stop working; comments and favorites are kept, so putting the file back restores it |
| Pull in new files now | `npm run ingest:prod` |
| See what went wrong | `npm run logs`; files that fail are retried 3 times, and the reason is in the `xm_ingest_error` table |
| Fix a tag | See [Correcting tags by hand](#tags) |
| Change captioning model | `CLAUDE_MODEL` in `wrangler.jsonc` (`claude-haiku-5-5` is cheaper, `claude-sonnet-5-5` reads meme text better) |
| Update engine9 | `npm install @engine9/core@latest @engine9/schemas@latest`, `npm run deploy`, `npx e9core upgrade --url https://xennialmemes.com` |

Edits to a post's title or alt text are SQL updates for now:
`npx wrangler d1 execute DB --remote --command "UPDATE xm_post SET alt_text='…' WHERE slug='…'"`.

## Notes

- **Images binding.** Used to shrink very large uploads before captioning and to
  make 640px WebP thumbnails for the grid. It's billed per unique transformation
  (two per meme). Remove the `images` block from `wrangler.jsonc` and the site
  serves originals in the grid instead.
- **Cost of captions.** One Claude call per meme: the image plus a short prompt in, about 200 tokens out.
- **Accounts.** Members are engine9 `person` rows. A member picks a public handle
  before their first comment; emails are never shown. Sessions are verified with
  `SESSION_SECRET`, which `e9core setup` creates.
- **Tests.** `npm test` runs the ingest, pages and member API against an
  in-memory SQLite database with Drive, Claude and R2 stubbed out.
