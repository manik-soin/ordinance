# HK Compliance RAG: Technical Guide

This document is the implementation-level companion to [README.md](./README.md). It focuses on the actual runtime behavior in this repository rather than aspirational architecture.

## System Overview

HK Compliance RAG is an Express-based API and single-page client for Hong Kong building-regulation question answering. It combines:

- curated PDF ingestion from Hong Kong government sources
- PostgreSQL + `pgvector` storage
- hybrid retrieval over embeddings and PostgreSQL full-text search
- OpenAI generation with citation constraints
- verification and audit logging
- live government data lookups for freshness checks and open-data APIs

Production URL:

`https://hk-compliance-api-production.up.railway.app`

## Production Snapshot

The following values were queried from the deployed production API on **March 15, 2026**:

- `/api/health`: `documentChunks = 5707`, `database = true`
- `/api/sources`:
  - `BD`: `201` current documents, `4626` current chunks
  - `EPD`: `10` current documents, `208` current chunks
  - `FSD`: `13` current documents, `873` current chunks
- `/api/live/status`: `stale_documents = 0` across `10` checked documents, `new_circulars.total = 7`

These figures are intentionally date-stamped because they are operational data, not fixed design limits.

## Runtime Architecture

```text
                         Browser SPA (public/index.html)
                                      |
                                      v
                           Express 5 API server
                helmet | cors | JSON body parser | request logging
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
         v                            v                            v
   Query pipeline               Live monitoring APIs         Open-data APIs
   /api/query                   /api/live/*                  /api/gov/*
   /api/query/stream
         |
         v
   PostgreSQL + pgvector
```

Key boot behavior from `src/server.ts`:

- starts listening before migrations finish, so Railway health checks can succeed quickly
- runs migrations in the background after the HTTP server starts
- creates the semantic cache table after migrations
- applies in-memory rate limiting only to `/api/query*`
- serves the frontend as static files with an SPA fallback

## Query Pipeline

Implemented in [src/pipeline/query.ts](./src/pipeline/query.ts).

### 1. Semantic cache

- Reads from `query_cache`
- Uses embedding cosine similarity with a `0.95` threshold
- TTL is `1 hour`
- Returns cached answers before any generation/reranking work

### 2. Parallel retrieval setup

The non-streaming query path runs these concurrently:

- primary hybrid search for the original query
- query expansion
- live official web lookup via `src/retrieval/web-search.ts`

### 3. Retrieval

Hybrid search in [src/retrieval/hybrid-search.ts](./src/retrieval/hybrid-search.ts):

- vector search: cosine similarity over `regulation_chunks.embedding`
- keyword search: PostgreSQL `plainto_tsquery('english', ...)`
- merge: Reciprocal Rank Fusion with `RRF_K = 60`

### 4. Reranking

Reranking in [src/retrieval/reranker.ts](./src/retrieval/reranker.ts):

- Cohere `rerank-v3.5`
- skipped automatically if `COHERE_API_KEY` is absent
- thresholded at `0.1`

### 5. Generation

Generation in [src/generator/index.ts](./src/generator/index.ts):

- default model: `gpt-4o`
- low temperature: `0.1`
- prompt forces cited, regulation-grounded answers
- non-streaming generation now includes supplementary official references discovered by live web lookup

### 6. Verification and scoring

- citation verification: [src/safety/citation-verifier.ts](./src/safety/citation-verifier.ts)
- faithfulness scoring: [src/safety/faithfulness.ts](./src/safety/faithfulness.ts)
- audit logging: `query_audit_log`

### 7. Streaming path

Streaming is handled separately in [src/api/routes.ts](./src/api/routes.ts):

- retrieves and reranks context first
- emits `status`, `sources`, `token`, `web_sources`, and `done` SSE events
- intentionally sends `web_sources` after answer generation to preserve faster time-to-first-byte

## Ingestion Pipeline

Implemented in [src/pipeline/ingest.ts](./src/pipeline/ingest.ts).

Flow:

1. Fetch PDF
2. Compute content hash
3. Skip unchanged documents unless forced
4. Store PDF locally
5. Parse text/sections
6. Chunk by hierarchy or plain text fallback
7. Embed chunks
8. Mark older chunks for the same document as non-current
9. Insert new chunks
10. Record `document_versions`

CLI entrypoints:

- [src/cli/scrape.ts](./src/cli/scrape.ts)
- [src/cli/scrape-all.ts](./src/cli/scrape-all.ts)
- [src/cli/scrape-extra.ts](./src/cli/scrape-extra.ts)
- [src/cli/scrape-epd.ts](./src/cli/scrape-epd.ts)
- [src/cli/ingest.ts](./src/cli/ingest.ts)

## Data Sources

Curated source definitions live in `src/sources/` and the CLI scripts.

Current indexed/queried departments in this repo:

- `BD`: core codes, design manuals, PNAPs, JPNs, circulars
- `FSD`: fire-service-installation codes, notices, and technical guidance
- `EPD`: noise-control and related guidance

Live open-data and government APIs:

- `data.gov.hk`
- `geodata.gov.hk`
- direct `bd.gov.hk` and `hkfsd.gov.hk` freshness/circular probes

## Database Schema

Migrations live in [src/db/migrate.ts](./src/db/migrate.ts).

### `regulation_chunks`

Primary retrieval table:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
content TEXT NOT NULL
embedding VECTOR(3072)
source_department TEXT NOT NULL
document_type TEXT NOT NULL
document_name TEXT NOT NULL
version TEXT
effective_date DATE
cap_number TEXT
pnap_number TEXT
section_hierarchy TEXT[]
page_number INTEGER
is_current BOOLEAN DEFAULT true
superseded_by UUID
content_hash TEXT NOT NULL
cross_references TEXT[]
search_vector TSVECTOR GENERATED ALWAYS AS (...)
ingested_at TIMESTAMPTZ DEFAULT NOW()
source_fetched_at TIMESTAMPTZ
```

Indexes:

- GIN on `search_vector`
- B-tree on `(source_department, document_type)`
- B-tree on `is_current`
- B-tree on `cap_number`
- HNSW on `embedding` via migration `009_enable_pgcrypto_and_chunk_vector_index`

### `document_versions`

Tracks document-level ingestion/version state:

- `document_name`
- `source_department`
- `version`
- `content_hash`
- `status`
- `pdf_url`
- `chunk_count`
- `fetched_at`

### `query_audit_log`

Stores:

- original query
- filters
- retrieved chunk IDs
- final response
- citations
- faithfulness score
- citation accuracy
- model used
- latency

### `scrape_log`

Tracks change-detection runs, not full ingestion history.

### `query_cache`

Created separately by [src/cache/semantic-cache.ts](./src/cache/semantic-cache.ts):

- query text
- query embedding
- answer
- citations
- sources
- optional department scope
- timestamp

It also creates an HNSW index on `query_embedding`.

## API Reference

### Core query endpoints

- `POST /api/query`
  - full pipeline response
  - returns `answer`, `citations`, `sources`, `quality`, `audit_id`, `latency_ms`, `model`, `cached`, `webSources`, and `cost`
- `POST /api/query/stream`
  - SSE response with token streaming

### System/document endpoints

- `GET /api/health`
  - always returns HTTP `200`
  - DB status is informational in the JSON body
- `GET /api/sources`
- `GET /api/documents`
- `GET /api/audit/:id`

### Live monitoring endpoints

- `GET /api/live/freshness`
- `GET /api/live/new-circulars`
- `GET /api/live/status`

### Open-data endpoints

- `GET /api/gov/summary`
- `GET /api/gov/fire-doorsets`
- `GET /api/gov/fire-glazing`
- `GET /api/gov/fire-stop-materials`
- `GET /api/gov/mic-systems`
- `GET /api/gov/fire-safety`
- `GET /api/gov/location?q=...`

### Admin endpoints

- `POST /api/admin/scrape`
- `GET /api/admin/changes`
- `GET /api/admin/costs`

Important nuance:

- `POST /api/admin/scrape` currently calls `checkForChanges(BD_CODES_OF_PRACTICE)` and returns change-detection results.
- It does not run the full ingestion pipeline for all sources.

## Frontend

The frontend is a single HTML file at [public/index.html](./public/index.html).

Characteristics:

- no build step
- vanilla JS
- SSE-based token streaming
- live source panels and department filters
- served directly by Express

## Deployment

Railway config lives in [railway.toml](./railway.toml):

- build: `npx tsc`
- runtime start: `node dist/server.js`
- health check: `/api/health`
- Node version: `22`

Recommended release sequence:

```bash
npm run lint
npm test
npm run build
git push origin main
railway redeploy
```

## Testing Strategy

Available commands:

```bash
npm run test:unit
npm run test:integration
npm run test:evals
npm run test:coverage
```

Practical meaning:

- unit tests cover parsing, chunking, routing, migrations, pool behavior, prompt rules, and pipeline orchestration
- integration tests cover retrieval/generation behavior with more realistic flows
- evals cover hallucination, faithfulness, citation accuracy, and regression checks
- CI currently runs typecheck, unit tests, and coverage, but not integration/eval suites

## Known Caveats

- Scheduler support exists in [src/scheduler/index.ts](./src/scheduler/index.ts), but the web server does not automatically start cron jobs.
- Live circular detection relies on guessed upstream filename patterns and can miss newly published files if naming changes.
- `/api/admin/*` endpoints are application-level admin surfaces and should be protected at the network/edge layer if exposed publicly.
- `GET /api/health` is intentionally optimistic for Railway and is not a strict readiness probe.
- Streaming and non-streaming query paths do not have identical behavior: streaming defers web-source emission until after answer generation.

## Regulatory Glossary

- `AP`: Authorized Person
- `RSE`: Registered Structural Engineer
- `RGE`: Registered Geotechnical Engineer
- `PNAP`: Practice Note for Authorized Persons
- `PNRC`: Practice Note for Registered Contractors
- `PNBI`: Practice Note for Building/Window Inspection
- `JPN`: Joint Practice Note
- `FSI`: Fire Service Installation
- `MiC`: Modular Integrated Construction
- `RRF`: Reciprocal Rank Fusion
- `SSE`: Server-Sent Events

## Disclaimer

This system is an engineering aid, not legal advice. Always verify final conclusions against official government publications and qualified professionals.
