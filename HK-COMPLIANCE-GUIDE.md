# HK Compliance RAG — Technical Architecture & Developer Guide

## System Overview

HK Compliance RAG is a **production-grade, 100% live** AI system for Hong Kong building regulatory compliance. It combines a Retrieval-Augmented Generation (RAG) pipeline with real-time government data APIs to deliver cited answers grounded in official codes of practice, ordinances, and practice notes.

**Production URL:** `https://hk-compliance-api-production.up.railway.app`

### Key Metrics

| Metric | Value |
|--------|-------|
| Indexed Chunks | 5,499 |
| Source Documents | 214 (from BD + FSD) |
| Government Departments | BD, FSD (with data.gov.hk for 5 more) |
| Live API Integrations | 10 endpoints (data.gov.hk, geodata.gov.hk, freshness checks) |
| Approved Products DB | 1,175 (fire doorsets, glazing, materials, MiC systems) |
| Embedding Dimensions | 3,072 (text-embedding-3-large) |
| Generation Model | GPT-4o |
| Faithfulness Judge | GPT-4o-mini |
| Unit Tests | 333 (all passing, zero API calls) |
| Query Latency | ~8s (cold), ~50ms (cache hit) |
| Streaming TTFB | ~0.5s |
| Cost per Query | ~$0.026 |

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              CLIENT (SPA)                    │
                    │  Single HTML file, vanilla JS, SSE streaming │
                    └──────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────────┐
                    │           EXPRESS 5 SERVER                   │
                    │  Helmet CSP · CORS · Rate Limit (30/min)    │
                    │  Request ID · Logging · SPA Fallback         │
                    └──────────────┬──────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────────┐
          │                        │                            │
┌─────────▼──────────┐  ┌─────────▼──────────┐  ┌──────────────▼───────────┐
│   QUERY PIPELINE    │  │   LIVE DATA APIs    │  │   GOVERNMENT DATA APIs   │
│                     │  │                     │  │                          │
│ 1. Semantic Cache   │  │ GET /live/freshness │  │ GET /gov/fire-doorsets    │
│ 2. Query Expansion  │  │ GET /live/circulars │  │ GET /gov/fire-glazing     │
│ 3. Hybrid Search    │  │ GET /live/status    │  │ GET /gov/fire-stop-mats   │
│ 4. Live Web Search  │  │                     │  │ GET /gov/mic-systems      │
│ 5. Rerank (Cohere)  │  │ HEAD requests to    │  │ GET /gov/fire-safety      │
│ 6. Generate (GPT-4o)│  │ bd.gov.hk PDFs      │  │ GET /gov/location?q=      │
│ 7. Citation Verify  │  │ hkfsd.gov.hk PDFs   │  │ GET /gov/summary          │
│ 8. Faithfulness     │  │                     │  │                          │
│ 9. Audit Log        │  │ Probe URL patterns  │  │ Live CSV from data.gov.hk │
│ 10. Cache Write     │  │ for new circulars   │  │ JSON from geodata.gov.hk  │
└─────────┬──────────┘  └─────────────────────┘  └──────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────┐
│                    NEON POSTGRESQL + pgvector                │
│                                                              │
│  regulation_chunks  (5,499 rows, 3072-dim HNSW vectors)     │
│  document_versions  (214 rows, PDF URL tracking)             │
│  query_audit_log    (full query audit trail)                 │
│  query_cache        (semantic cache, 95% threshold)          │
│  scrape_log         (change detection history)               │
│  migrations         (schema versioning)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Query Pipeline (Deep Dive)

Every query goes through this exact sequence:

### Step 0: Semantic Cache Check
```
Query → Embed → Cosine similarity search in query_cache
If similarity > 0.95 AND within 1-hour TTL → return cached answer (~50ms)
Otherwise → continue to full pipeline
```
The cache uses HNSW indexing on 3072-dim vectors. A 95% threshold was chosen (from enterprise RAG research) because lower thresholds risk returning answers to semantically similar but factually different questions — unacceptable in compliance.

### Step 1: Parallel Execution (Query Expansion + Primary Search + Web Search)
Three operations run simultaneously:

**Query Expansion** (GPT-4o-mini):
```
User: "What are the ramp requirements?"
→ Expanded: [
    "What are the ramp requirements?",
    "Barrier free access ramp gradient and width requirements under Design Manual BFA 2008",
    "Cap 123F Building Planning Regulations ramp specifications for disabled access"
  ]
```

**Primary Hybrid Search** (pgvector + PostgreSQL FTS):
- Vector search: embed query → cosine similarity against 5,499 chunks → top 15
- Keyword search: PostgreSQL `ts_rank_cd` with `plainto_tsquery` → top 15
- RRF fusion: `score(doc) = Σ 1/(60 + rank_i)` → top 14

**Live Web Search** (bd.gov.hk + hkfsd.gov.hk + data.gov.hk):
- Maps query keywords to known government resource URLs
- Returns clickable links to official PDFs and live datasets
- Zero latency cost (runs in parallel)

### Step 2: Expanded Query Search + Fusion
If expansion produced 2-3 extra queries, each runs a separate hybrid search. Results are merged with the primary results via RRF.

### Step 3: Reranking
Cohere Rerank 3.5 (if API key set) reorders results by semantic relevance. Threshold: 0.1 (low, to preserve borderline-relevant results). Falls back to RRF score ordering if no Cohere key.

### Step 4: Generation (GPT-4o)
System prompt enforces:
- Every claim must cite `[Document Name (Dept), Version, Section X.X]`
- Never fabricate clause numbers
- Synthesize from partial context (don't refuse if context is relevant)
- Note cross-references and version dates

### Step 5: Citation Verification (Regex + Cross-Check)
- Extract all `[...]` citations from the answer
- Match against retrieved document names
- Flag phantom citations (cited but not in context)
- Flag uncited claims (facts without citations)

### Step 6: Disclaimer Append
Regulatory disclaimer added to every answer.

### Step 7: Parallel Faithfulness + Audit + Cache
Three operations run simultaneously:
- **Faithfulness** (GPT-4o-mini judge): Scores 0-10 how well the answer reflects source text
- **Audit log**: Full query/response/scores written to `query_audit_log`
- **Cache write**: Answer cached with 3072-dim embedding for future similarity lookup

---

## Data Sources

### Static RAG Knowledge Base (5,499 chunks)

| Category | Count | Source |
|----------|-------|--------|
| BD Codes of Practice | 12 docs (1,828 chunks) | `bd.gov.hk` PDFs |
| BD Practice Notes ADM | 22 docs (160 chunks) | `bd.gov.hk` PDFs |
| BD Practice Notes APP | 54 docs (602 chunks) | `bd.gov.hk` PDFs |
| BD Practice Notes ADV | 5 docs | `bd.gov.hk` PDFs |
| BD Joint Practice Notes | 8 docs (108 chunks) | `bd.gov.hk` PDFs |
| BD Circular Letters | 6 docs (21 chunks) | `bd.gov.hk` PDFs |
| BD Extra Codes & Manuals | 11 docs | `bd.gov.hk` PDFs |
| BD Guidelines | 8 docs | `bd.gov.hk` PDFs |
| BD PNBI (Inspection) | 10 docs | `bd.gov.hk` PDFs |
| BD PNRC (Contractors) | 65 docs | `bd.gov.hk` PDFs |
| FSD Codes of Practice | 5 docs | `hkfsd.gov.hk` PDFs |
| FSD Technical Guidance | 4 docs | `hkfsd.gov.hk` PDFs |
| FSD Fire Protection Notices | 4 docs | `hkfsd.gov.hk` PDFs |

Every document has: SHA-256 content hash, source PDF URL, version, department, document type, ingestion timestamp.

### Live Government Data APIs

| Endpoint | Data Source | Records | Auth |
|----------|-----------|---------|------|
| `/api/gov/fire-doorsets` | `data.gov.hk/bd/opendata/cdbbc/cdbfrd.csv` | 860 | None |
| `/api/gov/fire-glazing` | `data.gov.hk/bd/opendata/cdbbc/cdbfrg.csv` | 126 | None |
| `/api/gov/fire-stop-materials` | `data.gov.hk/bd/opendata/cdbbm/cdbfsm.csv` | 12 | None |
| `/api/gov/mic-systems` | `data.gov.hk/bd/opendata/mic/mic.csv` | 135 | None |
| `/api/gov/fire-safety` | `data.gov.hk/bd/opendata/fso/fso.csv` | 42 | None |
| `/api/gov/location?q=` | `geodata.gov.hk/gs/api/v1.0.0/locationSearch` | Real-time | None |

All fetched live on each request (with 10-minute TTL cache).

### Live Monitoring APIs

| Endpoint | What It Does |
|----------|-------------|
| `/api/live/freshness` | HEAD requests to 20 source PDFs, compares Last-Modified headers |
| `/api/live/new-circulars` | Probes `bd.gov.hk` and `hkfsd.gov.hk` for newly published circulars |
| `/api/live/status` | Combined dashboard: chunks, freshness, new circulars |

### Live Web Search (Per Query)

Every query triggers parallel searches against:
- `bd.gov.hk` — Maps keywords to known BD regulation URLs
- `hkfsd.gov.hk` — Maps fire-related keywords to FSD resources
- `data.gov.hk` — Maps product keywords to Central Data Bank datasets

Results appear as clickable "Live Web Sources" after the RAG answer.

---

## Database Schema

### regulation_chunks (Primary)
```sql
id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
content           TEXT NOT NULL
embedding         VECTOR(3072)  -- OpenAI text-embedding-3-large
source_department TEXT           -- BD, FSD, EPD, EMSD, HA
document_type     TEXT           -- code_of_practice, practice_note, etc.
document_name     TEXT
version           TEXT           -- e.g., "2011 (2024 Edition)"
effective_date    DATE
section_hierarchy TEXT[]         -- ["Part 1", "Section 2.1", "Clause 2.1.3"]
page_number       INT
is_current        BOOL DEFAULT true
superseded_by     UUID FK
content_hash      TEXT           -- SHA-256
cross_references  TEXT[]         -- ["Cap. 123F", "PNAP APP-75"]
search_vector     TSVECTOR       -- Generated, for BM25 FTS
ingested_at       TIMESTAMPTZ
```

**Indexes:**
- HNSW on `embedding` (vector cosine similarity)
- GIN on `search_vector` (BM25 full-text search)
- B-tree on `(source_department, document_type)`, `is_current`, `cap_number`

### query_cache (Semantic Cache)
```sql
id              UUID PRIMARY KEY
query           TEXT
query_embedding VECTOR(3072)   -- For cosine similarity lookup
answer          TEXT
citations       JSONB
sources         JSONB
department      TEXT
cached_at       TIMESTAMPTZ
```
HNSW index on `query_embedding` for sub-millisecond similarity search.

### document_versions
Tracks every ingested document with `pdf_url`, `content_hash`, `chunk_count`, `status` (current/superseded).

### query_audit_log
Full audit trail: query, filters, retrieved chunk IDs, response, citations, faithfulness score, citation accuracy, model, latency.

---

## Performance Optimizations

| Optimization | Impact |
|---|---|
| Semantic cache (95% threshold, 1h TTL) | 160x faster on cache hit (~50ms vs ~8s) |
| Parallel expansion + search + web search | Expansion LLM latency hidden behind search |
| Parallel faithfulness + audit + cache write | 3 operations overlap instead of sequential |
| Embedding cache (5-min TTL) | Skip OpenAI API call on repeated queries |
| Batch chunk inserts (10/batch) | 10x fewer DB round-trips during ingestion |
| Gov data cache (10-min TTL) | Avoid re-parsing CSV on every request |
| Streaming skips expansion | 0.5s TTFB (no query expansion overhead) |
| RRF fusion (no LLM reranking) | Deterministic merge, no extra API call |

---

## API Reference

### Query Endpoints

**POST /api/query** — Full pipeline with quality metrics
```json
// Request
{ "query": "What are the ramp requirements?", "filter": { "department": "BD" } }

// Response
{
  "answer": "...[citations]...",
  "citations": [{ "document_name": "...", "section": "Section 15", "department": "BD", "version": "2008 (2025 Edition)" }],
  "sources": [{ "document_name": "...", "department": "BD", "score": 0.057 }],
  "quality": { "faithfulness": 10, "citationAccuracy": 1, "phantomCitations": 0, "uncitedClaims": 0 },
  "webSources": [{ "title": "Design Manual - Barrier Free Access 2008", "url": "https://...", "source": "bd.gov.hk" }],
  "cached": false,
  "latency_ms": 7060,
  "audit_id": "uuid"
}
```

**POST /api/query/stream** — SSE streaming with real-time progress
```
Events: status → sources (with pdf_url) → token → web_sources → done
```

### Document & Source Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health, chunk count, last scrape |
| `GET /api/sources` | Department summary (doc count, chunk count) |
| `GET /api/documents` | All 214 documents with PDF URLs |
| `GET /api/audit/:id` | Full audit trail for a query |

### Live Government Data

| Endpoint | Source | Data |
|----------|--------|------|
| `GET /api/gov/fire-doorsets` | data.gov.hk | 860 BD-approved fire doorsets |
| `GET /api/gov/fire-glazing` | data.gov.hk | 126 fire glazing products |
| `GET /api/gov/fire-stop-materials` | data.gov.hk | 12 fire stop materials |
| `GET /api/gov/mic-systems` | data.gov.hk | 135 MiC construction systems |
| `GET /api/gov/fire-safety` | data.gov.hk | Cap 502/572 compliance stats |
| `GET /api/gov/location?q=` | geodata.gov.hk | Building/address geocoding |
| `GET /api/gov/summary` | data.gov.hk | Combined summary |

### Live Monitoring

| Endpoint | What It Checks |
|----------|---------------|
| `GET /api/live/freshness` | HEAD requests to source PDFs for Last-Modified |
| `GET /api/live/new-circulars` | Probe BD/FSD for new circular letters |
| `GET /api/live/status` | Combined: freshness + circulars + chunk count |

### Admin

| Endpoint | Action |
|----------|--------|
| `POST /api/admin/scrape` | Trigger change detection + re-ingestion |
| `GET /api/admin/changes` | Recent document version changes (30 days) |

---

## Cost Model

### Per-Query Costs (GPT-4o pipeline)

| Component | Model | Cost |
|-----------|-------|------|
| Query expansion | gpt-4o-mini | ~$0.0002 |
| Query embedding | text-embedding-3-large | ~$0.00001 |
| Answer generation | gpt-4o | ~$0.025 |
| Faithfulness check | gpt-4o-mini | ~$0.001 |
| **Total per query** | | **~$0.026** |
| **Cached query** | embedding lookup only | **~$0.0001** |

### Monthly Projections

| Usage | OpenAI | Railway | Neon | Total |
|-------|--------|---------|------|-------|
| 10 queries/day | $7.80 | $5 | $0 | ~$13/mo |
| 50 queries/day | $39 | $5 | $0 | ~$44/mo |
| 100 queries/day | $78 | $5 | $0 | ~$83/mo |

### One-Time Ingestion Cost
- 5,499 chunks × 400 tokens/chunk × $0.13/1M tokens = **$0.29**

---

## Regulatory Landscape

### The Legislation Hierarchy

```
Primary Legislation (Ordinances)
  └── Buildings Ordinance (Cap. 123)
  └── Fire Safety (Buildings) Ordinance (Cap. 572)
  └── Building Energy Efficiency Ordinance (Cap. 610)
      │
Subsidiary Legislation (Regulations)
  └── Building (Planning) Regulations (Cap. 123F)
  └── Building (Construction) Regulations (Cap. 123B)
      │
Codes of Practice (quasi-mandatory)
  └── Fire Safety Code 2011 · Concrete 2013 · Steel 2011 · Foundations 2017
      │
Practice Notes (PNAPs — administrative guidance)
  └── ADM (22) · APP (54+) · ADV (5) · PNRC (65) · PNBI (10)
      │
Joint Practice Notes (JPNs — multi-department)
  └── Green buildings · Height restrictions · Site coverage · MiC
      │
Circular Letters (updates)
  └── BD circulars (2025-2026) · FSD circulars
```

### Government Departments

| Dept | Name | Regulations Indexed | Chunks |
|------|------|-------------------|--------|
| **BD** | Buildings Department | 201 documents | 4,626 |
| **FSD** | Fire Services Department | 13 documents | 873 |
| **EPD** | Environmental Protection Department | Via data.gov.hk | Live |
| **EMSD** | Electrical & Mechanical Services | Via data.gov.hk | Live |
| **HA** | Housing Authority | Via data.gov.hk | Live |

---

## Glossary

| Term | Definition |
|------|------------|
| **AP** | Authorized Person — architect/engineer/surveyor authorized to submit building plans |
| **RSE** | Registered Structural Engineer |
| **RGE** | Registered Geotechnical Engineer |
| **BA** | Building Authority (Buildings Department) |
| **BO** | Buildings Ordinance (Cap. 123) |
| **B(P)R** | Building (Planning) Regulations (Cap. 123F) |
| **PNAP** | Practice Note for Authorized Persons |
| **PNRC** | Practice Note for Registered Contractors |
| **PNBI** | Practice Note for Building/Window Inspection |
| **JPN** | Joint Practice Note (multi-department) |
| **FRP** | Fire Resistance Period |
| **FSI** | Fire Service Installation |
| **OTTV** | Overall Thermal Transfer Value |
| **BEC** | Building Energy Code |
| **GBP** | General Building Plans |
| **TCP** | Technically Competent Person |
| **MiC** | Modular Integrated Construction |
| **RRF** | Reciprocal Rank Fusion |
| **RAG** | Retrieval-Augmented Generation |
| **HNSW** | Hierarchical Navigable Small World (vector index algorithm) |
| **SSE** | Server-Sent Events (streaming protocol) |
| **pgvector** | PostgreSQL extension for vector similarity search |

---

## Disclaimer

This system assists professionals in navigating Hong Kong building regulations. It does **not** constitute legal advice. Regulations are subject to amendment. Always verify with official government publications and consult qualified Authorized Persons, Registered Structural Engineers, or legal professionals.

## License

MIT
