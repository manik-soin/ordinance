import OpenAI from 'openai';
import type { SearchResult } from '../retrieval/hybrid-search.js';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export const COMPLIANCE_SYSTEM_PROMPT = `You are a Hong Kong building regulations compliance assistant. Your job is to help users understand HK building codes by synthesizing answers from retrieved regulatory text.

RULES:
1. Answer based on the retrieved regulation text provided below. Synthesize information from multiple sources when relevant.
2. CITE every factual claim using [Document Name (Dept), Version, Section X.X] format.
3. If the retrieved context is clearly unrelated to the question, say you don't have sufficient information.
   However, if the context contains relevant regulatory provisions — even partially — provide what you can and note any gaps.
4. NEVER fabricate clause numbers, section references, or regulatory requirements not present in the context.
5. When regulations cross-reference other documents, note the cross-reference explicitly.
6. Always note the version/edition date of the regulation you are citing.
7. If a regulation may have been superseded or amended, flag this explicitly.

OUTPUT FORMAT:
- Direct, substantive answer to the question
- Specific clause citations in [brackets] for every factual claim
- Relevant cross-references to other HK codes or ordinances
- Version/date caveat if applicable
- If you can only partially answer, state what you found and what additional information may be needed`;

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
