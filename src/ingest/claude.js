/**
 * One Claude Messages API call that returns JSON matching a schema.
 *
 * Uses structured outputs (`output_config.format` with a JSON schema): the
 * reply is a text block holding JSON that matches the schema. Forced tool
 * calls (`tool_choice` of type "tool") are rejected by newer models such as
 * Claude Sonnet 5.5, so they are not used.
 *
 * Callers pass a `tool`-shaped object ({ name, description, input_schema })
 * because that is a convenient way to keep a schema next to its purpose; its
 * `input_schema` becomes the output schema and its description is added to
 * the system prompt.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Structured outputs need `additionalProperties: false` on every object. */
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === 'enum' || key === 'required' ? value : strictSchema(value);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the outermost {...} in case anything surrounds the JSON.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Claude returned text that is not JSON');
  }
}

export async function callTool({ apiKey, model = DEFAULT_MODEL, system, content, tool, maxTokens = 1024, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: tool.description ? `${system}\n\nYour reply: ${tool.description}` : system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: strictSchema(tool.input_schema) } }
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude API error (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  if (body.stop_reason === 'refusal') throw new Error('Claude declined to describe this image');
  if (body.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing its answer');
  const text = (body.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
  if (!text) throw new Error(`Claude returned no ${tool.name} output`);
  return parseJson(text);
}
