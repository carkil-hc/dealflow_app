import Anthropic from '@anthropic-ai/sdk';

// Shared Anthropic client used by the ingest and report endpoints.
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface AskJsonOpts {
  content: string | Anthropic.MessageParam['content'];
  model?: string;
  maxTokens?: number;
  array?: boolean; // extract a top-level [...] array instead of a {...} object
}

// Call Claude and return its plain-text reply (no JSON parsing).
export async function askClaudeText(opts: { content: string | Anthropic.MessageParam['content']; model?: string; maxTokens?: number }): Promise<string> {
  const message = await anthropic.messages.create({
    model: opts.model ?? 'claude-sonnet-4-5',
    max_tokens: opts.maxTokens ?? 2048,
    messages: [{ role: 'user', content: opts.content }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

// Call Claude and parse the single JSON value out of its reply. Centralizes the
// "create message → find text block → regex the JSON → JSON.parse" pattern used
// by the ingest and report endpoints.
export async function askClaudeJson<T = unknown>(opts: AskJsonOpts): Promise<T> {
  const message = await anthropic.messages.create({
    model: opts.model ?? 'claude-sonnet-4-5',
    max_tokens: opts.maxTokens ?? 2048,
    messages: [{ role: 'user', content: opts.content }],
  });
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');
  const match = textBlock.text.match(opts.array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in Claude response. Raw: ${textBlock.text.slice(0, 300)}`);
  return JSON.parse(match[0]) as T;
}
