# CLAUDE.md

## Project
HK Compliance RAG — AI-powered Hong Kong building regulatory compliance knowledge base.

## Commands
- `npm test` — Run all unit tests
- `npm run test:unit` — Unit tests only
- `npm run test:coverage` — Tests with coverage report
- `npm run lint` — TypeScript type check (`tsc --noEmit`)
- `npm run dev` — Start dev server
- `npm run migrate` — Run database migrations
- `npm run scrape` — Ingest BD codes of practice

## Architecture
```
src/
  sources/     — HK government regulation URL definitions
  scraper/     — PDF fetching, change detection via SHA-256
  parser/      — PDF text extraction, section hierarchy parsing
  chunker/     — Structure-aware chunking (Part > Section > Clause)
  embedder/    — OpenAI text-embedding-3-large (3072 dims)
  retrieval/   — Hybrid search (vector + BM25 FTS), RRF fusion, Cohere reranker
  generator/   — gpt-5.4 citation-aware generation
  safety/      — Prompt injection detection, citation verification, faithfulness scoring
  agent/       — Agent harness: complexity router, ReAct loop, 4 tools, scratchpad, project memory, subagents
  pipeline/    — Orchestration (ingest + query pipelines)
  db/          — PostgreSQL + pgvector (pool, migrations, store)
  api/         — Express routes
  scheduler/   — Cron-based change detection
```

## Testing
- Tests use vitest with vi.mock() for dependencies
- Mock pg.Pool as `{ query: vi.fn() }` for DB tests
- Mock OpenAI client for LLM tests
- Golden Q&A set at `tests/fixtures/golden-qa.json`
- Never commit `.env` or API keys

## Conventions
- TypeScript strict mode, ESM modules
- All source in `src/`, tests in `tests/unit/`
- Parameterized SQL queries only (no string interpolation)
- Every public function has JSDoc comment
