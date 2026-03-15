/**
 * Live data services — real-time checks against HK government sources.
 * These supplement the static ingested data with live verification.
 */

export interface FreshnessResult {
  document_name: string;
  source_url: string;
  last_modified: string | null;
  content_length: number | null;
  is_stale: boolean;
  ingested_at: string | null;
  checked_at: string;
}

export interface NewDocumentResult {
  url: string;
  name: string;
  department: string;
  type: string;
  status: number;
}

const BD_BASE = 'https://www.bd.gov.hk';
const FSD_BASE = 'https://www.hkfsd.gov.hk';
const REQUEST_TIMEOUT = 8000;

/**
 * Check freshness of a source document by issuing a HEAD request.
 * Compares Last-Modified header against ingestion timestamp.
 */
export async function checkDocumentFreshness(
  sourceUrl: string,
  documentName: string,
  ingestedAt: string | null
): Promise<FreshnessResult> {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(sourceUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'HK-Compliance-RAG/1.0 (freshness-check)' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    const lastModified = response.headers.get('last-modified');
    const contentLength = response.headers.get('content-length');

    let isStale = false;
    if (lastModified && ingestedAt) {
      const sourceDate = new Date(lastModified);
      const ingestDate = new Date(ingestedAt);
      isStale = sourceDate > ingestDate;
    }

    return {
      document_name: documentName,
      source_url: sourceUrl,
      last_modified: lastModified,
      content_length: contentLength ? parseInt(contentLength, 10) : null,
      is_stale: isStale,
      ingested_at: ingestedAt,
      checked_at: checkedAt,
    };
  } catch {
    return {
      document_name: documentName,
      source_url: sourceUrl,
      last_modified: null,
      content_length: null,
      is_stale: false,
      ingested_at: ingestedAt,
      checked_at: checkedAt,
    };
  }
}

/**
 * Check multiple documents for freshness in parallel.
 */
export async function checkBulkFreshness(
  documents: Array<{ url: string; name: string; ingested_at: string | null }>
): Promise<FreshnessResult[]> {
  return Promise.all(
    documents.map((doc) =>
      checkDocumentFreshness(doc.url, doc.name, doc.ingested_at)
    )
  );
}

/**
 * Probe for newly published BD circular letters by trying known URL patterns.
 * Returns any new circulars found that respond with HTTP 200.
 */
export async function detectNewBDCirculars(
  year: number = new Date().getFullYear()
): Promise<NewDocumentResult[]> {
  const found: NewDocumentResult[] = [];
  const clBase = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/circular`;

  // BD circular letters use cryptic filenames, but we can check the year folders
  const yearFolders = [year, year - 1];

  for (const yr of yearFolders) {
    // Try common prefixes for BD circulars
    const prefixes = [
      `CL_USFMWCS${yr}e`,
      `CL_TSNCQP${yr}e`,
      `CL_ASMTR${yr}e`,
      `CL_PMCSRTS${yr}e`,
      `CL_ATGMWCS${yr}e`,
      `CL_FSMFW${yr}e`,
      `CL_TGMWCS${yr - 1}E${yr}e`,
    ];

    for (const prefix of prefixes) {
      const url = `${clBase}/${yr}/${prefix}.pdf`;
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'HK-Compliance-RAG/1.0 (discovery)' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        if (response.status === 200) {
          found.push({
            url,
            name: `BD Circular Letter ${prefix}`,
            department: 'BD',
            type: 'circular_letter',
            status: 200,
          });
        }
      } catch {
        // Skip timeouts and errors
      }
    }
  }

  return found;
}

/**
 * Probe for newly published FSD circular letters.
 */
export async function detectNewFSDCirculars(
  year: number = new Date().getFullYear()
): Promise<NewDocumentResult[]> {
  const found: NewDocumentResult[] = [];
  const clBase = `${FSD_BASE}/eng/source/circular`;

  // FSD circulars follow pattern: {year}_{number}_eng_{date}.pdf
  for (let num = 1; num <= 10; num++) {
    const numStr = String(num).padStart(2, '0');
    const url = `${clBase}/${year}_${numStr}_eng.pdf`;
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'HK-Compliance-RAG/1.0 (discovery)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (response.status === 200) {
        found.push({
          url,
          name: `FSD Circular Letter ${num}/${year}`,
          department: 'FSD',
          type: 'circular_letter',
          status: 200,
        });
      }
    } catch {
      // Skip
    }
  }

  return found;
}

/**
 * Get document source URLs from the database for freshness checking.
 */
export async function getDocumentSourceUrls(
  pool: import('pg').Pool
): Promise<Array<{ url: string; name: string; ingested_at: string }>> {
  const { rows } = await pool.query(
    `SELECT document_name AS name, pdf_url AS url, fetched_at AS ingested_at
     FROM document_versions
     WHERE status = 'current' AND pdf_url IS NOT NULL
     ORDER BY document_name`
  );
  return rows as Array<{ url: string; name: string; ingested_at: string }>;
}
