import Anthropic from '@anthropic-ai/sdk';

// Shared Anthropic client used by the ingest and report endpoints.
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
