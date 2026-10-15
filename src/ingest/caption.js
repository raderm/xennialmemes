/**
 * Ask Claude to look at one meme and return its title, alt text, SEO
 * description, file name and tags. The answer comes back through a forced
 * tool call, so it is always structured JSON.
 */
import { bytesToBase64, normalizeTag, slugify } from '../lib/util.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const TOOL = {
  name: 'describe_meme',
  description: 'Record the accessible and search-friendly metadata for one meme image.',
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
        items: { type: 'string' },
        description: '3-6 lowercase topic tags (e.g. "90s tv", "dial-up internet", "mixtapes").'
      }
    },
    required: ['title', 'alt_text', 'description', 'filename', 'tags']
  }
};

const SYSTEM = `You write metadata for xennialmemes.com, a site of memes for Xennials: people born roughly 1977-1983 who had an analog childhood and a digital adulthood. For each image you get, call describe_meme once.

Alt text is for blind and low-vision readers: describe the picture plainly and transcribe all visible text word for word, in reading order. Never guess at people's identities unless the image itself names them; describe them instead. The title, description, file name and tags are for search engines: use the words people would actually search, name the specific cultural reference when there is one (a show, toy, game, technology, product), and keep them accurate to the image.`;

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
  const tags = [...new Set((Array.isArray(input?.tags) ? input.tags : []).map(normalizeTag).filter(Boolean))].slice(0, 6);
  return { title, alt_text: altText, description, filename, tags };
}

/**
 * @param {object} args
 * @param {Uint8Array} args.bytes   image to describe (JPEG, PNG, GIF or WebP, under ~7 MB)
 * @param {string} args.mimeType
 * @param {string} [args.hint]      the uploader's own note (Drive file name / description)
 */
export async function captionImage({ bytes, mimeType, hint, apiKey, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: bytesToBase64(bytes) } },
    {
      type: 'text',
      text: hint
        ? `Describe this meme. The uploader's file name or note, which may help with context: ${hint}`
        : 'Describe this meme.'
    }
  ];
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude API error (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  const call = (body.content || []).find((block) => block.type === 'tool_use' && block.name === TOOL.name);
  if (!call) throw new Error('Claude did not return describe_meme output');
  return normalizeCaption(call.input, { fallbackName: hint });
}
