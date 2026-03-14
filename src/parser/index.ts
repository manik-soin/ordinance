import { PDFParse } from 'pdf-parse';

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedSection {
  title: string;
  level: number; // 1 = Part, 2 = Section, 3 = Clause
  content: string;
  pageNumber: number;
  children: ParsedSection[];
}

export interface ParsedDocument {
  title: string;
  fullText: string;
  pages: ParsedPage[];
  sections: ParsedSection[];
  pageCount: number;
}

/**
 * Extract text from a PDF buffer.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const parser = new PDFParse({ data: buffer });
  const info = await parser.getInfo();
  const numPages = info.total ?? 1;

  const textResult = await parser.getText();

  const pages: ParsedPage[] = textResult.pages.map((p) => ({
    pageNumber: p.num,
    text: p.text.trim(),
  }));

  const fullText = textResult.text;
  const sections = extractSections(fullText);
  const title = extractTitle(fullText);

  await parser.destroy();

  return {
    title,
    fullText,
    pages,
    sections,
    pageCount: numPages,
  };
}

/**
 * Split full text into approximate pages based on form feed characters
 * or estimated character counts.
 */
function extractPages(text: string, numPages: number): ParsedPage[] {
  // pdf-parse uses form feed (\f) to separate pages
  const rawPages = text.split('\f').filter((p) => p.trim().length > 0);

  if (rawPages.length >= numPages * 0.8) {
    // Form feed splitting worked reasonably
    return rawPages.map((pageText, i) => ({
      pageNumber: i + 1,
      text: pageText.trim(),
    }));
  }

  // Fallback: split by estimated character count per page
  const charsPerPage = Math.ceil(text.length / numPages);
  const pages: ParsedPage[] = [];
  for (let i = 0; i < numPages; i++) {
    const start = i * charsPerPage;
    const end = Math.min(start + charsPerPage, text.length);
    pages.push({
      pageNumber: i + 1,
      text: text.slice(start, end).trim(),
    });
  }

  return pages;
}

/**
 * Extract hierarchical section structure from regulatory text.
 */
export function extractSections(text: string): ParsedSection[] {
  const lines = text.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let contentBuffer: string[] = [];

  for (const line of lines) {
    const partMatch = line.match(/^(PART\s+[IVX\d]+[\s.:-]*.*)/i);
    const sectionMatch = line.match(/^(Section\s+\d+[\s.:-]*.*)/i);
    const clauseMatch = line.match(/^(\d+\.\d+(?:\.\d+)?[\s.:-]+.*)/);

    if (partMatch || sectionMatch || clauseMatch) {
      // Flush previous section
      if (currentSection) {
        currentSection.content = contentBuffer.join('\n').trim();
        sections.push(currentSection);
      }

      const level = partMatch ? 1 : sectionMatch ? 2 : 3;
      const title = (partMatch?.[1] ?? sectionMatch?.[1] ?? clauseMatch?.[1] ?? '').trim();

      currentSection = {
        title,
        level,
        content: '',
        pageNumber: estimatePageNumber(text, line),
        children: [],
      };
      contentBuffer = [];
    } else {
      contentBuffer.push(line);
    }
  }

  // Flush last section
  if (currentSection) {
    currentSection.content = contentBuffer.join('\n').trim();
    sections.push(currentSection);
  }

  return nestSections(sections);
}

/**
 * Nest flat sections into a hierarchy based on level.
 */
function nestSections(flat: ParsedSection[]): ParsedSection[] {
  const root: ParsedSection[] = [];
  const stack: ParsedSection[] = [];

  for (const section of flat) {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return root;
}

/**
 * Extract document title from the first few lines.
 */
function extractTitle(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  // Usually the first meaningful line is the title
  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && trimmed.length < 200) {
      return trimmed;
    }
  }
  return 'Unknown Document';
}

/**
 * Rough page number estimate based on position in text.
 */
function estimatePageNumber(fullText: string, line: string): number {
  const pos = fullText.indexOf(line);
  if (pos === -1) return 1;
  const textBefore = fullText.slice(0, pos);
  const pageBreaks = (textBefore.match(/\f/g) || []).length;
  return pageBreaks + 1;
}
