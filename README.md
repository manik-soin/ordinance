# HK Compliance RAG

Hong Kong building-regulation retrieval-augmented generation system built on Node.js, TypeScript, PostgreSQL, and pgvector. It ingests official government PDFs, chunks and embeds them, serves cited answers over HTTP/SSE, and exposes live government/open-data endpoints alongside the core RAG workflow.

Production: `https://hk-compliance-api-production.up.railway.app`

For a deeper architecture and operations guide, see [HK-COMPLIANCE-GUIDE.md](./HK-COMPLIANCE-GUIDE.md).

## What This Repo Does

- Ingests official PDFs from BD, FSD, and EPD source lists.
- Stores chunked regulatory text plus embeddings in PostgreSQL with `pgvector`.
- Answers questions with hybrid retrieval, optional Cohere reranking, citation verification, faithfulness scoring, audit logging, and semantic caching.
- Streams answers over SSE for the browser client in `public/index.html`.
- Exposes live-data helpers for change detection, open datasets from `data.gov.hk`, and geodata lookups from `geodata.gov.hk`.

## Architecture

```text
PDF sources / live government URLs
        |
        v
Fetch -> Parse -> Chunk -> Embed -> Store
                                 |
                                 v
                        PostgreSQL + pgvector
                                 |
                                 v
Query -> Cache -> Expand -> Hybrid Search -> Rerank -> Generate
                                                   -> Verify
                                                   -> Faithfulness
                                                   -> Audit
```

The server is an Express 5 app that:

- auto-runs DB migrations on boot
- ensures the semantic cache table exists on boot
- serves the API under `/api`
- serves the SPA from `public/`
- rate-limits `/api/query*` to 30 requests/minute/IP

## Stack

- Runtime: Node.js 20+ with TypeScript and ESM
- API server: Express 5
- Database: PostgreSQL + `pgvector`
- Embeddings: `text-embedding-3-large` (3072 dimensions)
- Generation: `gpt-4o`
- Query expansion and faithfulness judge: OpenAI chat models
- Reranking: Cohere `rerank-v3.5` when `COHERE_API_KEY` is set
- Deployment: Railway (`railway.toml`) + Neon/Postgres

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required:

- `OPENAI_API_KEY`
- `DATABASE_URL`

Optional:

- `COHERE_API_KEY`: enables reranking; the app degrades cleanly without it
- `PORT`: defaults to `3000`
- `NODE_ENV`: `development`, `production`, or `test`
- `SCRAPE_CONCURRENCY`: defaults to `3`
- `PDF_STORAGE_DIR`: defaults to `./data/pdfs`

Database notes:

- The DB user must be able to create `vector`, `uuid-ossp`, and `pgcrypto` extensions.
- The server runs migrations automatically, but you can also apply them manually with `npm run migrate`.

## Local Development

Install and run:

```bash
npm install
npm run migrate
npm run scrape
npm run dev
```

The API will be available on `http://localhost:3000` unless `PORT` is overridden.

## Ingestion Workflows

Primary scripts:

- `npm run scrape`: ingest the curated BD code/design-manual starter set
- `npm run scrape:all`: ingest the broader BD corpus including PNAPs, JPNs, and circulars
- `npm run scrape:extra`: ingest additional BD/FSD sources not covered by the starter set
- `npm run scrape:epd`: ingest EPD noise-control sources
- `npm run ingest -- <pdf-path> [department] [name]`: manually ingest a local PDF

Ingestion pipeline details:

- PDFs are fetched and SHA-256 hashed.
- Existing `document_versions` hashes are checked to skip unchanged documents.
- Parsed sections are chunked hierarchically when possible and by plain text fallback otherwise.
- Embeddings are generated before chunk rows are inserted.
- Previous chunks for the same document are marked `is_current = false`.

## Query Pipeline

`POST /api/query` runs the full non-streaming pipeline:

1. Semantic cache lookup in `query_cache`
2. Query expansion
3. Hybrid retrieval: vector similarity + PostgreSQL full-text search
4. Reciprocal Rank Fusion
5. Optional Cohere rerank
6. Answer generation with citation-constrained system prompt
7. Citation verification
8. Faithfulness scoring
9. Audit log write
10. Cache write

Important behavior:

- Non-streaming queries also pass supplementary official web references into generation when live government resources are matched.
- Streaming queries keep web search off the critical path and emit `web_sources` after answer tokens to preserve faster time-to-first-byte.
- The health endpoint intentionally returns HTTP `200` even when DB connectivity is degraded so Railway health checks do not flap.

## API Surface

Core query/data endpoints:

- `POST /api/query`
- `POST /api/query/stream`
- `GET /api/health`
- `GET /api/sources`
- `GET /api/documents`
- `GET /api/audit/:id`

Live monitoring endpoints:

- `GET /api/live/freshness`
- `GET /api/live/new-circulars`
- `GET /api/live/status`

Government open-data endpoints:

- `GET /api/gov/summary`
- `GET /api/gov/fire-doorsets`
- `GET /api/gov/fire-glazing`
- `GET /api/gov/fire-stop-materials`
- `GET /api/gov/mic-systems`
- `GET /api/gov/fire-safety`
- `GET /api/gov/location?q=<query>`

Admin endpoints:

- `POST /api/admin/scrape`
- `GET /api/admin/changes`
- `GET /api/admin/costs`

Operational note: `POST /api/admin/scrape` currently performs change detection for the BD starter set and records version metadata. Full re-ingestion is still driven by the CLI scripts.

## Testing

```bash
npm run lint
npm test
npm run test:unit
npm run test:integration
npm run test:evals
npm run test:coverage
npm run build
```

Current CI behavior:

- GitHub Actions runs typecheck, unit tests, and coverage.
- Integration tests and evals are available locally, but are not part of CI because they need a live database and API keys.

## Deployment

Railway is configured through [railway.toml](./railway.toml):

- builder: `NIXPACKS`
- build command: `npx tsc`
- start command: `node dist/server.js`
- health check path: `/api/health`
- Node version: `22`

Typical deploy flow:

```bash
npm run lint
npm test
npm run build
git push origin main
railway redeploy
```

The server will apply migrations on boot, then create the semantic cache table if needed.

## Repo Layout

```text
src/api           HTTP routes plus live/open-data integrations
src/cache         semantic query cache
src/cli           ingestion entrypoints
src/db            migrations, pool, persistence helpers
src/generator     answer generation and streaming
src/pipeline      query and ingestion orchestration
src/retrieval     hybrid search, reranking, query expansion, web lookup
src/safety        prompt-injection checks, citation verification, faithfulness
src/scheduler     cron-based change-detection helpers
src/sources       curated source definitions
public/           single-file frontend
tests/            unit, integration, and eval suites
```

## Known Operational Caveats

- The scheduler module exists, but the web server does not automatically start cron jobs.
- Live-data probes rely on upstream government URL conventions and may miss newly published documents if naming patterns change.
- Admin endpoints are application-level admin surfaces; if you expose this beyond a trusted environment, protect them at the edge or add auth.

## License

MIT
