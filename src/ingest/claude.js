/** One forced tool call to the Claude Messages API; returns the tool's input object. */

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

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
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude API error (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  const call = (body.content || []).find((block) => block.type === 'tool_use' && block.name === tool.name);
  if (!call) throw new Error(`Claude did not return ${tool.name} output`);
  return call.input;
}
