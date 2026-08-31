import OpenAI from 'openai';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

/**
 * Expand an ambiguous query into 2-3 variant phrasings for multi-query retrieval.
 * Uses a lightweight model (gpt-5-mini) for cost efficiency.
 */
export async function expandQuery(
  query: string,
  options?: { client?: OpenAI }
): Promise<string[]> {
  const client = options?.client ?? getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      {
        role: 'system',
        content: `You are a Hong Kong building regulations expert. Given a user query, generate 2-3 alternative phrasings that would help retrieve relevant regulation clauses. Include:
1. A more technical/formal version using HK regulatory terminology
2. A version referencing specific known codes (Cap. numbers, BD codes, FSD documents)
3. (Optional) A version using common abbreviations or alternative names

Return ONLY the alternative queries, one per line. Do not number them or add explanations.`,
      },
      {
        role: 'user',
        content: query,
      },
    ],
  });

  const expansions = (response.choices[0]?.message?.content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Always include the original query
  return [query, ...expansions];
}

/**
 * Generate a hypothetical answer document for HyDE (Hypothetical Document Embeddings).
 * The hypothetical answer is in the same semantic space as regulation text,
 * improving retrieval recall over question-form queries.
 */
export async function generateHyDE(
  query: string,
  options?: { client?: OpenAI }
): Promise<string> {
  const client = options?.client ?? getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-5-mini',
    max_completion_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are a Hong Kong building regulations reference document. Given a question, write a SHORT passage (2-3 sentences) that would appear in the relevant regulation or code of practice to answer it. Use formal regulatory language with specific section references, clause numbers, and technical terminology as they would appear in HK building codes. Do not explain — write as if you ARE the regulation text.`,
      },
      {
        role: 'user',
        content: query,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}
