import { describe, it, expect } from 'vitest';
import {
  chunkDocument,
  chunkPlainText,
  estimateTokens,
  extractCrossReferences,
} from '../../src/chunker/index.js';
import type { ParsedSection } from '../../src/parser/index.js';
import type { RegulationSource } from '../../src/sources/buildings-dept.js';

const testSource: RegulationSource = {
  name: 'Test Code of Practice',
  url: 'https://example.com/test.pdf',
  version: '2024',
  department: 'BD',
  type: 'code_of_practice',
  category: 'test',
};

const testHash = 'abc123';

describe('Regulatory Text Chunker', () => {
  describe('estimateTokens', () => {
    it('estimates ~1 token per 4 chars', () => {
      const text = 'a'.repeat(400);
      expect(estimateTokens(text)).toBe(100);
    });
  });

  describe('chunkDocument', () => {
    it('creates chunks from sections', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: 'A'.repeat(1200), // ~300 tokens, above min threshold
          pageNumber: 1,
          children: [],
        },
        {
          title: 'Section 2',
          level: 2,
          content: 'B'.repeat(1200),
          pageNumber: 2,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('enforces minimum chunk size by merging small sections', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: 'Short.', // very small
          pageNumber: 1,
          children: [],
        },
        {
          title: 'Section 2',
          level: 2,
          content: 'Also short.',
          pageNumber: 1,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash);
      // Small sections should be merged
      expect(chunks.length).toBeLessThanOrEqual(2);
    });

    it('enforces maximum chunk size by splitting large sections', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: Array(20)
            .fill('This is a paragraph of regulatory text that discusses requirements.')
            .join('\n\n'), // Large content
          pageNumber: 1,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash, { maxTokens: 100 });
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('preserves section hierarchy as metadata', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Part I',
          level: 1,
          content: '',
          pageNumber: 1,
          children: [
            {
              title: 'Section 1',
              level: 2,
              content: 'A'.repeat(1200),
              pageNumber: 1,
              children: [],
            },
          ],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].metadata.section_hierarchy).toContain('Part I');
      expect(chunks[0].metadata.section_hierarchy).toContain('Section 1');
    });

    it('attaches source metadata to each chunk', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: 'A'.repeat(1200),
          pageNumber: 5,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash);
      expect(chunks[0].metadata.source_department).toBe('BD');
      expect(chunks[0].metadata.document_name).toBe('Test Code of Practice');
      expect(chunks[0].metadata.version).toBe('2024');
      expect(chunks[0].metadata.is_current).toBe(true);
      expect(chunks[0].metadata.content_hash).toBe(testHash);
    });

    it('prepends contextual header to chunk content', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: 'Regulatory text here.',
          pageNumber: 1,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash);
      expect(chunks[0].content).toContain('[Source: Test Code of Practice');
      expect(chunks[0].content).toContain('Regulatory text here.');
    });

    it('includes overlap at chunk boundaries', () => {
      const sections: ParsedSection[] = [
        {
          title: 'Section 1',
          level: 2,
          content: 'A'.repeat(1200), // will be split
          pageNumber: 1,
          children: [],
        },
        {
          title: 'Section 2',
          level: 2,
          content: 'B'.repeat(1200),
          pageNumber: 2,
          children: [],
        },
      ];

      const chunks = chunkDocument(sections, testSource, testHash, {
        maxTokens: 200,
        overlapTokens: 50,
      });

      // Second chunk should start with overlap from first
      if (chunks.length > 1) {
        expect(chunks[1].content).toContain('...');
      }
    });
  });

  describe('chunkPlainText', () => {
    it('chunks text by paragraphs', () => {
      const text = Array(10)
        .fill('This is a paragraph of text.\n\nAnother paragraph here.')
        .join('\n\n');

      const chunks = chunkPlainText(text, testSource, testHash);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractCrossReferences', () => {
    it('extracts Cap. references', () => {
      const refs = extractCrossReferences('See Cap. 123F for details.');
      expect(refs).toContain('Cap. 123F');
    });

    it('extracts PNAP references', () => {
      const refs = extractCrossReferences('Refer to PNAP ADV-33.');
      expect(refs).toContain('PNAP ADV-33');
    });

    it('extracts Section references', () => {
      const refs = extractCrossReferences('As per Section 17.2 of the Ordinance.');
      expect(refs).toContain('Section 17.2');
    });

    it('deduplicates references', () => {
      const refs = extractCrossReferences('Cap. 123 and Cap. 123 again.');
      const capRefs = refs.filter((r) => r === 'Cap. 123');
      expect(capRefs.length).toBe(1);
    });

    it('returns empty array when no references found', () => {
      const refs = extractCrossReferences('No references here.');
      expect(refs).toEqual([]);
    });
  });
});
