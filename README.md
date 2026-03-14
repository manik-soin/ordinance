# HK Compliance RAG

AI-powered Hong Kong building regulatory compliance knowledge base. Ingests live government regulation PDFs, provides instant cited compliance answers, and maintains full audit trails.

## Architecture

```
Scrape → Parse → Chunk → Embed → Store (pgvector)
                                       ↓
Query → Expand → Hybrid Search → Rerank → Generate → Verify → Audit
```

### Data Sources
- **Buildings Department (BD)**: Codes of Practice, Practice Notes (PNAPs), Circular Letters
- **Fire Services Department (FSD)**: Fire safety documents
- **Environmental Protection Department (EPD)**: Environmental regulations
- **Electrical & Mechanical Services Department (EMSD)**: Energy/MEP codes
- **Housing Authority (HA)**: Specification Library
- **e-Legislation**: Primary and subsidiary legislation (Cap. 123, 572, etc.)

### Key Features
- Structure-aware chunking for regulatory text (Part > Section > Clause)
- Hybrid search: vector similarity + BM25 keyword via PostgreSQL FTS
- Reciprocal Rank Fusion (RRF) for result merging
- Cohere Rerank 3.5 for precision
- Citation verification — flags phantom citations and uncited claims
- Faithfulness scoring via LLM judge
- Full audit trail for regulatory accountability
- Change detection via SHA-256 content hashing

## Setup

```bash
cp .env.example .env
# Fill in OPENAI_API_KEY, DATABASE_URL, COHERE_API_KEY

npm install
npm run migrate    # Set up database schema
npm run scrape     # Ingest BD codes of practice
npm run dev        # Start API server
```

## Testing

```bash
npm test              # All unit tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests (requires DB + API keys)
npm run test:evals    # Evaluation suite (requires populated DB)
npm run test:coverage # Coverage report
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/query` | POST | Ask a compliance question |
| `/api/query/stream` | POST | SSE streaming query |
| `/api/health` | GET | Health check |
| `/api/sources` | GET | List ingested sources |
| `/api/audit/:id` | GET | Query audit trail |
| `/api/admin/scrape` | POST | Trigger manual scrape |
| `/api/admin/changes` | GET | Recent regulation changes |

## Stack

- **Runtime**: Node.js + TypeScript (strict, ESM)
- **Database**: PostgreSQL + pgvector (Neon)
- **Embeddings**: OpenAI text-embedding-3-large (3072 dims)
- **LLM**: GPT-4o (generation), GPT-4o-mini (routing/eval)
- **Reranker**: Cohere Rerank 3.5
- **Testing**: Vitest (unit/integration) + golden Q&A set (evals)
- **Deployment**: Railway + Neon

## License

MIT
