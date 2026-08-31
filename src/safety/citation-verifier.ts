import type { SearchResult } from '../retrieval/hybrid-search.js';
import type { Citation } from '../generator/index.js';

export interface VerificationResult {
  totalCitations: number;
  verifiedCitations: number;
  phantomCitations: Citation[];
  uncitedClaims: string[];
  citationAccuracy: number;
}

/**
 * Verify citations in a generated answer against retrieved context.
 */
export function verifyCitations(
  answer: string,
  citations: Citation[],
  context: SearchResult[]
): VerificationResult {
  const verifiedCitations: Citation[] = [];
  const phantomCitations: Citation[] = [];

  for (const citation of citations) {
    const isVerified = context.some(
      (ctx) =>
        ctx.document_name === citation.document_name ||
        ctx.content.includes(citation.section) ||
        ctx.section_hierarchy.some((h) =>
          h.toLowerCase().includes(citation.section.toLowerCase())
        )
    );

    if (isVerified) {
      verifiedCitations.push(citation);
    } else {
      phantomCitations.push(citation);
    }
  }

  const uncitedClaims = findUncitedClaims(answer, citations);

  return {
    totalCitations: citations.length,
    verifiedCitations: verifiedCitations.length,
    phantomCitations,
    uncitedClaims,
    citationAccuracy:
      citations.length > 0 ? verifiedCitations.length / citations.length : 1,
  };
}

/**
 * Find factual-sounding statements that lack citations.
 * Looks for sentences containing regulatory keywords without bracket citations.
 */
export function findUncitedClaims(answer: string, citations: Citation[]): string[] {
  const sentences = answer.split(/[.!?]\s+/);
  const uncited: string[] = [];

  const regulatoryKeywords = [
    /\bmust\b/i,
    /\bshall\b/i,
    /\brequired\b/i,
    /\bminimum\b/i,
    /\bmaximum\b/i,
    /\bnot\s+less\s+than\b/i,
    /\bnot\s+more\s+than\b/i,
    /\bnot\s+exceed/i,
    /\bprescribed\b/i,
    /\bmandatory\b/i,
    /\bprohibited\b/i,
    /\bcompli(?:ance|ant)\b/i,
  ];

  for (const sentence of sentences) {
    const hasRegulatoryLanguage = regulatoryKeywords.some((kw) =>
      kw.test(sentence)
    );
    const hasCitation = /\[[^\]]+\]/.test(sentence);

    if (hasRegulatoryLanguage && !hasCitation && sentence.trim().length > 20) {
      uncited.push(sentence.trim());
    }
  }

  return uncited;
}

/**
 * Append regulatory disclaimer to every response.
 */
export function appendDisclaimer(answer: string): string {
  const disclaimer = `\n\n---\n**Disclaimer:** This information is provided for reference purposes only and does not constitute legal advice. Regulations may have been amended since last ingestion. Always verify with the relevant Hong Kong government department and consult qualified professionals for compliance decisions.`;
  return answer + disclaimer;
}
