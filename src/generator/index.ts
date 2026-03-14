import OpenAI from 'openai';
import type { SearchResult } from '../retrieval/hybrid-search.js';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export const COMPLIANCE_SYSTEM_PROMPT = `You are a Hong Kong building regulations compliance assistant.

RULES — these are non-negotiable:
1. ONLY answer based on the retrieved regulation text provided below.
2. CITE every factual claim using [Document Name, Section X.X] format.
   Include the department (BD/FSD/EPD/EMSD/HA) and version in each citation.
3. If the retrieved context does not contain the answer, say:
   "I don't have sufficient information in the current regulations database to answer this.
   Please consult the relevant department directly."
4. NEVER fabricate clause numbers, section references, or regulatory requirements.
5. When regulations cross-reference other documents, note the cross-reference explicitly.
6. Always note the version/edition date of the regulation you are citing.
7. If a regulation may have been superseded or amended, flag this explicitly.

OUTPUT FORMAT:
- Direct answer to the question
- Specific clause citations in [brackets]
- Any relevant cross-references
- Version/date caveat if applicable`;

export interface Citation {
  document_name: string;
  section: string;
  department: string;
  version: string;
  page_number?: number;
}

export interface GenerationResult {
  answer: string;
  citations: Citation[];
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * Generate a cited compliance answer from retrieved context.
 */
export async function generateAnswer(
  query: string,
  context: SearchResult[],
  options?: { client?: OpenAI; model?: string }
): Promise<GenerationResult> {
  const client = options?.client ?? getClient();
  const model = options?.model ?? 'gpt-4o';

  const contextText = context
    .map(
      (c, i) =>
        `[Context ${i + 1}]\nSource: ${c.document_name} (${c.source_department}), ${c.version}\nSection: ${c.section_hierarchy.join(' > ')}\nPage: ${c.page_number}\n\n${c.content}`
    )
    .join('\n\n---\n\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Retrieved regulation context:\n\n${contextText}\n\n---\n\nQuestion: ${query}`,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content ?? '';
  const citations = extractCitations(answer, context);

  return {
    answer,
    citations,
    model,
    prompt_tokens: response.usage?.prompt_tokens ?? 0,
    completion_tokens: response.usage?.completion_tokens ?? 0,
  };
}

/**
 * Extract citations from the generated answer.
 * Matches patterns like [Document Name, Section X.X]
 */
export function extractCitations(
  answer: string,
  context: SearchResult[]
): Citation[] {
  const citations: Citation[] = [];
  const citationRegex = /\[([^\]]+)\]/g;

  let match: RegExpExecArray | null;
  while ((match = citationRegex.exec(answer)) !== null) {
    const citationText = match[1];

    // Try to match against known context documents
    for (const ctx of context) {
      if (
        citationText.includes(ctx.document_name) ||
        citationText.includes(ctx.source_department)
      ) {
        const sectionMatch = citationText.match(
          /(?:Section|Clause|Part|Table)\s+[\d.]+[A-Za-z]*/i
        );

        citations.push({
          document_name: ctx.document_name,
          section: sectionMatch?.[0] ?? citationText,
          department: ctx.source_department,
          version: ctx.version,
          page_number: ctx.page_number,
        });
        break;
      }
    }
  }

  return citations;
}

/**
 * Stream a compliance answer using SSE.
 */
export async function* streamAnswer(
  query: string,
  context: SearchResult[],
  options?: { client?: OpenAI; model?: string }
): AsyncGenerator<string> {
  const client = options?.client ?? getClient();
  const model = options?.model ?? 'gpt-4o';

  const contextText = context
    .map(
      (c, i) =>
        `[Context ${i + 1}]\nSource: ${c.document_name} (${c.source_department}), ${c.version}\nSection: ${c.section_hierarchy.join(' > ')}\nPage: ${c.page_number}\n\n${c.content}`
    )
    .join('\n\n---\n\n');

  const stream = await client.chat.completions.create({
    model,
    temperature: 0.1,
    stream: true,
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Retrieved regulation context:\n\n${contextText}\n\n---\n\nQuestion: ${query}`,
      },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
