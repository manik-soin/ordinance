import type { SearchResult } from '../retrieval/hybrid-search.js';
import type { Citation } from '../generator/index.js';
import type { VerificationResult } from '../safety/citation-verifier.js';
import { findUncitedClaims } from '../safety/citation-verifier.js';

/**
 * Strict citation verification for the agent's exit gate.
 *
 * The shared `verifyCitations`/`extractCitations` pair (used by the static
 * pipeline) cannot flag a fabricated citation: it only ever builds a Citation
 * whose document name is copied from a retrieved chunk, then confirms that same
 * document exists — so its phantom branch is structurally dead, and a bare
 * two-character department substring ("BD") is enough to launder a made-up
 * document/section into a real one.
 *
 * This verifier parses the model's brackets independently of the chunk store,
 * then flags:
 *  - a cited document that is NOT in the retrieved set (fabricated document), and
 *  - a specific Section/Clause/Part/Table identifier that does NOT appear in any
 *    retrieved chunk of the cited document (fabricated section).
 * It stays lenient on matching (word-boundary id match, full-name doc match) so
 * genuinely grounded answers are not falsely flagged.
 */

const BRACKET_RE = /\[([^\]]+)\]/g;
// A specific location identifier inside a citation, e.g. "Section 4.1",
// "Clause B4.1", "Part IV", "Table B1", "Schedule 2".
const SECTION_RE =
  /\b(?:Section|Clause|Part|Table|Schedule|Regulation|Reg\.?|Cap\.?)\s+([A-Za-z]?\d+(?:\.\d+)*[A-Za-z]?|[IVXLC]+)\b/i;
const DEPT_TAG_RE = /\((?:BD|FSD|EPD|EMSD|HA)\)/;

/** A bracketed span is citation-like if it names a section id or a department tag. */
function isCitationLike(text: string): boolean {
  return SECTION_RE.test(text) || DEPT_TAG_RE.test(text);
}

/** Retrieved chunks whose full document name appears in the citation text. */
function matchDocuments(citationText: string, chunks: SearchResult[]): SearchResult[] {
  const haystack = citationText.toLowerCase();
  return chunks.filter(
    (c) => c.document_name && haystack.includes(c.document_name.toLowerCase())
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the section identifier appears (word-bounded) in a chunk. */
function sectionGrounded(sectionId: string, docChunks: SearchResult[]): boolean {
  const idRe = new RegExp(`\\b${escapeRegExp(sectionId)}\\b`, 'i');
  return docChunks.some(
    (c) => idRe.test(c.content) || c.section_hierarchy.some((h) => idRe.test(h))
  );
}

export function verifyAgentCitations(
  answer: string,
  chunks: SearchResult[]
): { verification: VerificationResult; citations: Citation[] } {
  const verified: Citation[] = [];
  const phantoms: Citation[] = [];
  let total = 0;

  BRACKET_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BRACKET_RE.exec(answer)) !== null) {
    const text = match[1];
    if (!isCitationLike(text)) continue; // e.g. [live BD dataset ...] notes
    total++;

    const docs = matchDocuments(text, chunks);
    const sectionMatch = SECTION_RE.exec(text);
    const sectionId = sectionMatch?.[1];
    const sectionLabel = sectionMatch?.[0] ?? text;

    const citation: Citation = {
      document_name: docs[0]?.document_name ?? text.slice(0, 80),
      section: sectionLabel,
      department: docs[0]?.source_department ?? 'UNKNOWN',
      version: docs[0]?.version ?? '',
      page_number: docs[0]?.page_number,
    };

    if (docs.length === 0) {
      // Cited a document that was never retrieved.
      phantoms.push(citation);
    } else if (sectionId && !sectionGrounded(sectionId, docs)) {
      // Real document, but the specific section/clause is not in its chunks.
      phantoms.push(citation);
    } else {
      verified.push(citation);
    }
  }

  const uncitedClaims = findUncitedClaims(answer, verified);

  return {
    citations: [...verified, ...phantoms],
    verification: {
      totalCitations: total,
      verifiedCitations: verified.length,
      phantomCitations: phantoms,
      uncitedClaims,
      citationAccuracy: total > 0 ? verified.length / total : 1,
    },
  };
}
