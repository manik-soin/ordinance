import OpenAI from 'openai';
import type { SearchResult } from '../retrieval/hybrid-search.js';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export const COMPLIANCE_SYSTEM_PROMPT = `You are a Hong Kong building regulations compliance assistant with deep expertise in HK building codes, ordinances, and codes of practice. Your primary job is to synthesize answers from retrieved regulatory text.

RULES:
1. PRIMARILY answer based on the retrieved regulation text provided below. Synthesize information from multiple sources when relevant.
2. If the retrieved context only partially covers the question, supplement with your own knowledge of HK building regulations — but clearly distinguish: cite retrieved text with [Document Name (Dept), Version, Section X.X], and note supplementary knowledge as "per general HK regulatory practice".
3. If the retrieved context is clearly unrelated to the question, you may still answer using your regulatory knowledge, but note that the answer is based on general knowledge rather than retrieved sources.
4. NEVER fabricate specific clause numbers or section references. Only cite specific sections when they appear in the retrieved context.
5. When regulations cross-reference other documents, note the cross-reference explicitly.
6. Always note the version/edition date of the regulation you are citing.
7. If a regulation may have been superseded or amended, flag this explicitly.
8. Be CONCISE. Answer in 2-4 short paragraphs maximum. Do not repeat information. Do not list every possible scenario — focus on the most directly relevant answer. Aim for under 500 words.
9. For multiple-choice questions: evaluate EACH option systematically against the regulations before selecting your answer. State your final answer clearly.

OUTPUT FORMAT:
- Direct, substantive answer to the question
- Citations in brackets: [Document Name (Dept), Version, Section X.X]
- Cross-references to other HK codes only if directly relevant
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

function buildUserMessage(
  query: string,
  context: SearchResult[],
  supplementaryContext?: string
): string {
  const contextText = context
    .map(
      (c, i) =>
        `[Context ${i + 1}]\nSource: ${c.document_name} (${c.source_department}), ${c.version}\nSection: ${c.section_hierarchy.join(' > ')}\nPage: ${c.page_number}\n\n${c.content}`
    )
    .join('\n\n---\n\n');

  const extraContext = supplementaryContext?.trim()
    ? `\n\nSupplementary official references:\n${supplementaryContext.trim()}`
    : '';

  return `Retrieved regulation context:\n\n${contextText}${extraContext}\n\n---\n\nQuestion: ${query}`;
}

/**
 * Generate a cited compliance answer from retrieved context.
 */
export async function generateAnswer(
  query: string,
  context: SearchResult[],
  options?: { client?: OpenAI; model?: string; supplementaryContext?: string }
): Promise<GenerationResult> {
  const client = options?.client ?? getClient();
  const model = options?.model ?? 'gpt-5.4';

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_completion_tokens: 800,
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserMessage(query, context, options?.supplementaryContext),
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
  options?: { client?: OpenAI; model?: string; supplementaryContext?: string }
): AsyncGenerator<string> {
  const client = options?.client ?? getClient();
  const model = options?.model ?? 'gpt-5.4';

  const stream = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_completion_tokens: 800,
    stream: true,
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserMessage(query, context, options?.supplementaryContext),
      },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
