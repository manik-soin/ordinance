import OpenAI from 'openai';
import type { SearchResult } from '../retrieval/hybrid-search.js';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export interface FaithfulnessResult {
  score: number; // 0-10
  reasoning: string;
  flaggedClaims: string[];
}

/**
 * Score the faithfulness of a generated answer against its source context.
 * Uses an LLM judge (gpt-5-mini for cost efficiency).
 */
export async function scoreFaithfulness(
  query: string,
  answer: string,
  context: SearchResult[],
  options?: { client?: OpenAI }
): Promise<FaithfulnessResult> {
  const client = options?.client ?? getClient();

  const contextText = context
    .map((c) => `[${c.document_name}]\n${c.content}`)
    .join('\n\n---\n\n');

  const response = await client.chat.completions.create({
    model: 'gpt-5-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a faithfulness evaluator for a regulatory compliance system. Your job is to determine if the answer is fully supported by the provided source context.

Score on a scale of 0-10:
- 10: Every claim in the answer is directly supported by the source text
- 7-9: Most claims are supported, minor unsupported inferences
- 4-6: Some claims are supported but significant unsupported content
- 1-3: Mostly unsupported or fabricated content
- 0: Completely fabricated

Return JSON:
{
  "score": <number 0-10>,
  "reasoning": "<brief explanation>",
  "flagged_claims": ["<any claims not supported by context>"]
}`,
      },
      {
        role: 'user',
        content: `Source Context:\n${contextText}\n\nQuestion: ${query}\n\nAnswer to evaluate:\n${answer}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as {
    score?: number;
    reasoning?: string;
    flagged_claims?: string[];
  };

  return {
    score: parsed.score ?? 0,
    reasoning: parsed.reasoning ?? 'Failed to evaluate',
    flaggedClaims: parsed.flagged_claims ?? [],
  };
}
