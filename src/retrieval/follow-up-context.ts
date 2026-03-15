import OpenAI from 'openai';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

function formatHistory(history: ConversationTurn[]): string {
  return history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

export async function contextualizeFollowUpQuery(
  query: string,
  history: ConversationTurn[],
  options?: { client?: OpenAI }
): Promise<string> {
  if (history.length === 0) return query;

  const client = options?.client ?? getClient();
  const formattedHistory = formatHistory(history);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You rewrite follow-up questions about Hong Kong building regulations into standalone retrieval queries.

Rules:
1. Use the conversation history only to resolve references like "that", "those", "what about", or "how about".
2. Preserve the user's original intent and scope.
3. Keep the wording concise and optimized for regulation retrieval.
4. If the latest user query is already standalone, return it unchanged.
5. Return ONLY the rewritten standalone query.`,
      },
      {
        role: 'user',
        content: `Conversation history:
${formattedHistory}

Latest user query:
${query}`,
      },
    ],
  });

  const rewritten = response.choices[0]?.message?.content?.trim();
  return rewritten && rewritten.length > 0 ? rewritten : query;
}
