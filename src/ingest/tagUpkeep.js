/**
 * Daily tag upkeep, run by the second cron trigger in wrangler.jsonc and by
 * POST /api/site/admin/tags/upkeep.
 *
 *   1. Prune: drop tags no post uses any more.
 *   2. Organize: when tags were added since the last review, show Claude the
 *      whole vocabulary and apply what it finds: duplicates and synonyms are
 *      merged (the old slug becomes an alias, so /tag/<old> redirects), and
 *      labels and categories are fixed. Set TAG_AUTOMERGE=false to keep
 *      merges out of it.
 *   3. Describe: write a one- or two-sentence intro for each tag page that
 *      has at least TAG_DESCRIBE_MIN posts and no description yet.
 */
import { callTool, DEFAULT_MODEL } from './claude.js';
import { CATEGORIES, CATEGORY_IDS, mergeTag, updateTag, vocabulary } from '../lib/tags.js';

const MAX_MERGES = 25;
const DESCRIBE_BATCH = 25;

const ORGANIZE_TOOL = {
  name: 'organize_tags',
  description: 'Record cleanups for the tag vocabulary of a meme site.',
  input_schema: {
    type: 'object',
    properties: {
      merges: {
        type: 'array',
        description:
          'Tags that mean the same thing as another tag. "from" is folded into "to". Pick the clearer, more common slug as "to". Only merge true duplicates, synonyms, spelling or plural variants; never merge a specific tag into a broader one.',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } },
          required: ['from', 'to']
        }
      },
      updates: {
        type: 'array',
        description: 'Tags whose label (display name) or category is wrong. Omit tags that are fine.',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            label: { type: 'string', description: 'Natural capitalization, e.g. "Saved by the Bell", "Dial-up internet".' },
            category: { type: 'string', enum: CATEGORY_IDS }
          },
          required: ['tag']
        }
      }
    },
    required: ['merges', 'updates']
  }
};

const DESCRIBE_TOOL = {
  name: 'describe_tags',
  description: 'Record an intro sentence for each tag page.',
  input_schema: {
    type: 'object',
    properties: {
      descriptions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            description: {
              type: 'string',
              description:
                'One or two sentences, under 200 characters, that set up the topic for a Xennial reader and work as a search snippet. Warm, specific, no hype, no "this page".'
            }
          },
          required: ['tag', 'description']
        }
      }
    },
    required: ['descriptions']
  }
};

const SYSTEM = `You maintain the tag vocabulary of xennialmemes.com, a meme site for Xennials (born roughly 1977-1983: analog childhood, digital adulthood). Tags are how visitors browse, so the vocabulary should be small, consistent and specific. Categories: ${CATEGORIES.map((c) => `${c.id} = ${c.label}`).join('; ')}.`;

export async function runTagUpkeep(env, { call = callTool, log = console } = {}) {
  const db = env.DB;
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
  const summary = { pruned: 0, merged: [], updated: 0, described: 0 };

  // 1. Prune tags with no posts at all (hidden posts still count, so unhiding works).
  const prune = await db
    .prepare(
      `DELETE FROM xm_tag WHERE tag NOT IN (SELECT DISTINCT tag FROM xm_post_tag)
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`
    )
    .run();
  summary.pruned = prune.meta?.changes || 0;

  let vocab = (await vocabulary(db)).filter((t) => t.n > 0);
  const known = new Set(vocab.map((t) => t.tag));

  // 2. Organize, but only when something is new since the last review.
  const fresh = vocab.filter((t) => !t.reviewed_at);
  if (fresh.length && vocab.length >= 2) {
    const list = vocab.map((t) => `${t.tag} | ${t.label} | ${t.category} | ${t.n}${t.reviewed_at ? '' : ' | NEW'}`).join('\n');
    const result = await call({
      apiKey: env.ANTHROPIC_API_KEY,
      model,
      system: SYSTEM,
      tool: ORGANIZE_TOOL,
      maxTokens: 4096,
      content: [
        {
          type: 'text',
          text: `Here is the full tag list (slug | label | category | posts | NEW if added since the last review). Look hardest at the NEW tags: does each duplicate an existing tag, and are its label and category right?\n\n${list}`
        }
      ]
    });

    if (env.TAG_AUTOMERGE !== 'false') {
      const froms = new Set();
      const tos = new Set();
      for (const m of (result.merges || []).slice(0, MAX_MERGES)) {
        const { from, to } = m;
        // Both must exist, and no chains: a tag merged away can't be a target,
        // and a target can't itself be merged away in the same run.
        if (!known.has(from) || !known.has(to) || from === to || froms.has(to) || tos.has(from)) continue;
        try {
          const moved = await mergeTag(db, from, to, 'auto-merge');
          froms.add(from);
          tos.add(to);
          known.delete(from);
          summary.merged.push({ from, to, posts: moved, reason: m.reason || '' });
        } catch (err) {
          log.error?.(`tag merge ${from} -> ${to} failed: ${err.message}`);
        }
      }
    }

    for (const u of result.updates || []) {
      if (!known.has(u.tag)) continue;
      const category = CATEGORY_IDS.includes(u.category) ? u.category : undefined;
      if (!u.label && !category) continue;
      await updateTag(db, u.tag, { label: u.label, category });
      summary.updated++;
    }
    await db.prepare("UPDATE xm_tag SET reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE reviewed_at IS NULL").run();
    vocab = (await vocabulary(db)).filter((t) => t.n > 0);
  }

  // 3. Describe tag pages that have enough posts to be worth landing on.
  const min = Number(env.TAG_DESCRIBE_MIN ?? 3);
  const needing = vocab.filter((t) => !t.description && t.n >= min).slice(0, DESCRIBE_BATCH);
  if (needing.length) {
    const blocks = [];
    for (const t of needing) {
      const { results } = await db
        .prepare(
          `SELECT p.title FROM xm_post_tag pt JOIN xm_post p ON p.id = pt.post_id
            WHERE pt.tag = ? AND p.status = 'published' ORDER BY p.id DESC LIMIT 5`
        )
        .bind(t.tag)
        .all();
      blocks.push(`${t.tag} (${t.label}, ${t.category}): ${results.map((r) => r.title).join('; ')}`);
    }
    const result = await call({
      apiKey: env.ANTHROPIC_API_KEY,
      model,
      system: SYSTEM,
      tool: DESCRIBE_TOOL,
      maxTokens: 4096,
      content: [
        {
          type: 'text',
          text: `Write the intro for each of these tag pages. Each line is a tag and the titles of a few memes filed under it.\n\n${blocks.join('\n')}`
        }
      ]
    });
    const wanted = new Set(needing.map((t) => t.tag));
    for (const d of result.descriptions || []) {
      if (!wanted.has(d.tag) || !d.description) continue;
      await updateTag(db, d.tag, { description: String(d.description).replace(/\s+/g, ' ').trim() });
      summary.described++;
    }
  }

  return summary;
}
