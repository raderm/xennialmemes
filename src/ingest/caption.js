/**
 * Ask Claude to look at one meme and return its title, alt text, SEO
 * description, file name and tags. The answer comes back as structured
 * output, JSON that matches the schema below.
 */
import { bytesToBase64, normalizeTag, slugify } from '../lib/util.js';
import { CATEGORIES, normalizeCategory } from '../lib/tags.js';

import { callTool, DEFAULT_MODEL } from './claude.js';

export { DEFAULT_MODEL };

const TOOL = {
  name: 'describe_meme',
  description: 'JSON with the accessible and search-friendly metadata for this one meme image, following the schema field descriptions.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short headline for the post page, 3-10 words, plain and descriptive with a little wit. No quotes, no hashtags.'
      },
      alt_text: {
        type: 'string',
        description:
          'Alt text for screen readers, under 300 characters. Say what the image shows and transcribe every word of text in it exactly. Do not start with "Image of" or "Meme of".'
      },
      description: {
        type: 'string',
        description:
          '1-2 sentences for the meta description (under 160 characters) explaining the joke and the Xennial reference it plays on.'
      },
      filename: {
        type: 'string',
        description:
          '3-7 lowercase keywords joined by hyphens that someone would search for to find this meme, e.g. "oregon-trail-dysentery-meme". No file extension.'
      },
      tags: {
        type: 'array',
        description:
          '3-6 topic tags, most specific first. Reuse a tag from the existing list whenever one fits, copying its slug exactly. Only add a new tag for a specific reference (a show, toy, game, product, event) or a theme the list is missing.',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Slug: lowercase words joined by hyphens, e.g. "saved-by-the-bell".' },
            label: { type: 'string', description: 'Display name with natural capitalization, e.g. "Saved by the Bell".' },
            category: { type: 'string', enum: CATEGORIES.map((c) => c.id) }
          },
          required: ['tag', 'label', 'category']
        }
      }
    },
    required: ['title', 'alt_text', 'description', 'filename', 'tags']
  }
};

const SYSTEM = `You write metadata for xennialmemes.com, a site of memes for Xennials: people born roughly 1977-1983 who had an analog childhood and a digital adulthood. For each image you get, reply with its metadata as JSON.

Alt text is for blind and low-vision readers: describe the picture plainly and transcribe all visible text word for word, in reading order. Never guess at people's identities unless the image itself names them; describe them instead. The title, description, file name and tags are for search engines: use the words people would actually search, name the specific cultural reference when there is one (a show, toy, game, technology, product), and keep them accurate to the image.

Tags are how visitors browse the site, so they must be consistent. Prefer one specific tag (the exact show, toy, game or gadget) plus one or two broader themes over many near-synonyms. Never use "meme", "funny", "xennial", "nostalgia" or a bare decade by itself as a tag: every meme here is all of those. Categories: ${CATEGORIES.map((c) => `${c.id} (${c.label})`).join(', ')}.`;

/** Tags that would apply to every post, so they help nobody browse. */
const BANNED_TAGS = new Set(['meme', 'memes', 'funny', 'humor', 'xennial', 'xennials', 'nostalgia', 'retro', '80s', '90s', '1980s', '1990s']);

/** The existing vocabulary, as Claude sees it: "slug | Label | category | posts". */
export function vocabularyPrompt(vocab, limit = 300) {
  if (!vocab?.length) return '';
  const lines = vocab.slice(0, limit).map((t) => `${t.tag} | ${t.label} | ${t.category} | ${t.n ?? 0}`);
  return `Existing tags (slug | label | category | posts), most used first:\n${lines.join('\n')}`;
}

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

/** Clean up whatever the model returned so it is always safe to store. */
export function normalizeCaption(input, { fallbackName = 'meme' } = {}) {
  const title = clip(input?.title, 90) || 'Xennial meme';
  const altText = clip(input?.alt_text, 420) || title;
  const description = clip(input?.description, 200);
  const filename = slugify(input?.filename) || slugify(title) || slugify(fallbackName) || 'xennial-meme';
  const tags = [];
  for (const raw of Array.isArray(input?.tags) ? input.tags : []) {
    const item = typeof raw === 'string' ? { tag: raw } : raw || {};
    const tag = normalizeTag(item.tag || item.label);
    if (!tag || BANNED_TAGS.has(tag) || tags.some((t) => t.tag === tag)) continue;
    tags.push({
      tag,
      label: clip(item.label, 60) || tag.replace(/-/g, ' '),
      category: normalizeCategory(item.category)
    });
    if (tags.length >= 6) break;
  }
  return { title, alt_text: altText, description, filename, tags };
}

/**
 * @param {object} args
 * @param {Uint8Array} args.bytes   image to describe (JPEG, PNG, GIF or WebP, under ~7 MB)
 * @param {string} args.mimeType
 * @param {string} [args.hint]      the uploader's own note (Drive file name / description)
 * @param {Array}  [args.vocab]     existing tags, so Claude reuses them instead of inventing synonyms
 */
export async function captionImage({ bytes, mimeType, hint, vocab = [], apiKey, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: bytesToBase64(bytes) } },
    {
      type: 'text',
      text: hint
        ? `Describe this meme. The uploader's file name or note, which may help with context: ${hint}`
        : 'Describe this meme.'
    }
  ];
  const vocabText = vocabularyPrompt(vocab);
  if (vocabText) content.push({ type: 'text', text: vocabText });
  const input = await callTool({ apiKey, model, system: SYSTEM, content, tool: TOOL, fetchImpl });
  return normalizeCaption(input, { fallbackName: hint });
}
