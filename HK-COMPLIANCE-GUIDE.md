# Hong Kong Building Compliance — A Developer's Guide

## The Regulatory Landscape

Hong Kong has one of the most comprehensive building regulatory frameworks in the world. Any building project — from a minor alteration to a skyscraper — must comply with multiple layers of legislation, codes of practice, and administrative guidelines issued by several government departments.

This guide explains **what regulations exist**, **who enforces them**, **how they interact**, and **how this system (HK Compliance RAG) makes them searchable with AI**.

---

## Government Departments & Their Roles

### Buildings Department (BD)
The primary regulatory body for building works in Hong Kong.

**Responsibilities:**
- Processing building plans and approvals
- Enforcing the Buildings Ordinance and subsidiary regulations
- Issuing codes of practice and practice notes
- Building inspection and enforcement actions
- Certifying Authorized Persons (APs), Registered Structural Engineers (RSEs), and Registered Geotechnical Engineers (RGEs)

**Key Publications:**
| Document | Coverage |
|----------|----------|
| Code of Practice for Fire Safety in Buildings (2011) | Fire resistance periods, means of escape, compartmentation |
| Code of Practice for Structural Use of Concrete | Concrete design, reinforcement detailing, durability |
| Code of Practice for Structural Use of Steel | Steel design, connections, fatigue |
| Code of Practice for Foundations | Pile design, ground investigation, settlement |
| Code of Practice for Wind Effects | Wind load calculation, dynamic analysis, cladding pressure |
| Code of Practice for Demolition of Buildings | Demolition methodology, safety, environmental control |
| Code of Practice for Site Supervision | Supervision plans, TCP (technically competent persons) |
| Practice Notes for Authorized Persons (PNAPs) | Procedural guidance on plan submissions, inspections, compliance |

### Fire Services Department (FSD)
Responsible for fire safety installations and equipment.

**Responsibilities:**
- Fire service installation (FSI) requirements
- Ventilation and air conditioning system fire safety
- Means of access for firefighting
- Fire safety certificates and compliance inspections

**Key Regulations:**
- Minimum Provision of Fire Service Installations and Equipment (FP&E)
- Fire Safety (Buildings) Ordinance (Cap. 572)
- Fire Safety (Commercial Premises) Ordinance (Cap. 502)

### Environmental Protection Department (EPD)
Environmental compliance for construction and building operations.

**Responsibilities:**
- Construction noise permits
- Air quality assessment for development projects
- Waste management plans
- Environmental Impact Assessment (EIA) process

**Key Regulations:**
- Noise Control Ordinance (Cap. 400)
- Air Pollution Control Ordinance (Cap. 311)
- Environmental Impact Assessment Ordinance (Cap. 499)

### Electrical and Mechanical Services Department (EMSD)
Regulates building services installations.

**Responsibilities:**
- Electrical installations safety
- Lift and escalator safety
- Gas supply safety
- Energy efficiency of buildings

**Key Regulations:**
- Electricity Ordinance (Cap. 406)
- Lifts and Escalators Ordinance (Cap. 618)
- Building Energy Efficiency Ordinance (Cap. 610)

### Housing Authority (HA)
Public housing design and construction standards.

**Responsibilities:**
- Public rental housing design standards
- Home Ownership Scheme specifications
- Estate management and maintenance
- Specification library for HA projects

---

## The Legislation Hierarchy

Hong Kong building law follows a clear hierarchy:

```
Primary Legislation (Ordinances)
  └── Buildings Ordinance (Cap. 123)
  └── Fire Safety (Buildings) Ordinance (Cap. 572)
  └── Building Energy Efficiency Ordinance (Cap. 610)
      │
Subsidiary Legislation (Regulations)
  └── Building (Planning) Regulations (Cap. 123F)
  └── Building (Construction) Regulations (Cap. 123B)
  └── Building (Standards of Sanitary Fitments) Regs (Cap. 123I)
      │
Codes of Practice
  └── Approved by the Building Authority under s.39 of Cap. 123
  └── Quasi-mandatory: non-compliance requires alternative justification
      │
Practice Notes (PNAPs)
  └── Administrative guidance from BD
  └── Inform how BD interprets regulations in practice
      │
Circular Letters
  └── Updates, policy changes, new procedures
```

**Why this matters:** When answering compliance questions, the system traces each answer back to a specific level in this hierarchy. A code of practice clause carries different weight than a practice note recommendation.

---

## Key Regulatory Topics

### Fire Safety
The most heavily regulated area. Key requirements include:
- **Fire Resistance Periods (FRP)**: Structural elements must resist fire for specified durations (30 min to 4 hours depending on building purpose group and height)
- **Means of Escape**: Maximum travel distances, exit widths, emergency lighting
- **Compartmentation**: Fire-rated walls and floors dividing buildings into compartments
- **Active Systems**: Sprinklers, fire detection, voice alarm, emergency generators
- **Firefighting Access**: Fireman's lifts, fire hydrants, landing valves

### Structural Design
- **Wind Effects**: Hong Kong's typhoon exposure requires sophisticated wind load analysis — the wind code specifies terrain categories, topographic multipliers, and dynamic response factors
- **Seismic**: While not in a high seismic zone, seismic provisions have been progressively introduced
- **Foundation Design**: Complex geology (decomposed granite, marine deposits, reclaimed land) demands thorough ground investigation
- **Concrete and Steel Codes**: Aligned with international standards but adapted for HK conditions

### Accessibility
- **Barrier-Free Access**: Design Manual for Barrier-Free Access covers ramps, lifts, tactile guide paths, accessible toilets
- **Universal Design**: Increasingly mandated for new developments
- **Signage**: Braille, tactile, and visual contrast requirements

### Energy Efficiency
- **OTTV (Overall Thermal Transfer Value)**: Maximum thermal transfer through building envelope
- **BEC (Building Energy Code)**: Efficiency requirements for lighting, air conditioning, electrical, and lift/escalator installations
- **Green Building**: BEAM Plus rating system (voluntary but increasingly expected)

### Environmental
- **Construction Noise**: Permits required for powered mechanical equipment; restricted hours in residential zones
- **Air Quality**: Dust monitoring, emission controls during construction
- **Waste Management**: Construction and demolition waste sorting and disposal requirements

---

## How HK Compliance RAG Works

### Architecture Overview

```
User Question
     │
     ▼
┌─────────────┐
│  Guardrails  │ ← Prompt injection detection, input validation
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Query      │ ← LLM rewrites query into multiple search variants
│  Expansion   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│       Hybrid Search          │
│  ┌──────────┐ ┌──────────┐  │
│  │  Vector   │ │   BM25   │  │ ← pgvector cosine similarity + PostgreSQL FTS
│  │ Similarity│ │ Full-Text│  │
│  └────┬─────┘ └────┬─────┘  │
│       └──────┬──────┘        │
│         RRF Fusion           │ ← Reciprocal Rank Fusion merges results
└──────────────┬───────────────┘
               │
               ▼
┌─────────────┐
│   Reranker   │ ← Cohere Rerank 3.5 for precision
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Generator   │ ← GPT-4o with citation-enforcing system prompt
└──────┬──────┘
       │
       ▼
┌────────────────────────────────┐
│       Verification              │
│  ┌──────────────┐ ┌──────────┐ │
│  │   Citation    │ │Faithful- │ │ ← Flag phantom citations, score faithfulness
│  │   Verifier    │ │ness Judge│ │
│  └──────────────┘ └──────────┘ │
└────────────────┬───────────────┘
                 │
                 ▼
┌─────────────┐
│  Audit Log   │ ← Every query logged for regulatory accountability
└─────────────┘
```

### Data Ingestion Pipeline

1. **Source Discovery**: URLs for government PDFs are defined in `src/sources/` — each department has its own source definition with document names, types, URLs, and metadata.

2. **PDF Fetching**: The scraper downloads PDFs and computes SHA-256 hashes for change detection. If a document hasn't changed since last fetch, it's skipped.

3. **Text Extraction**: `pdf-parse` extracts raw text from PDFs. The parser uses heuristics and regex patterns to identify structural elements (Parts, Sections, Clauses, Tables).

4. **Structure-Aware Chunking**: Unlike naive chunking by character count, this system preserves the regulatory hierarchy:
   ```
   Part 1: General
     Section 1.1: Scope
       Clause 1.1.1: This code applies to...
       Clause 1.1.2: The provisions of...
     Section 1.2: Definitions
       Clause 1.2.1: "Building" means...
   ```
   Each chunk retains its full `section_hierarchy` path (e.g., `["Part 1", "Section 1.1", "Clause 1.1.1"]`), so citations can reference exact locations.

5. **Embedding**: OpenAI `text-embedding-3-large` generates 3072-dimensional vectors for each chunk. These are stored in PostgreSQL using the `pgvector` extension.

6. **Versioning**: Each document version is tracked. When regulations are updated, old chunks are marked `is_current = false` and linked to their replacements via `superseded_by`.

### Search Strategy

**Why hybrid search?** Vector search excels at semantic similarity ("what are the fire safety requirements?" matches "fire resistance period" even without exact keywords). BM25 full-text search excels at exact term matching ("Cap. 123F Section 17" needs keyword precision). Combining both via Reciprocal Rank Fusion gives the best of both worlds.

**Reciprocal Rank Fusion (RRF):**
```
score(doc) = Σ  1 / (k + rank_i(doc))
```
Where `k` is a constant (typically 60) and `rank_i` is the document's rank in search method `i`. This normalizes scores across different ranking systems without requiring score calibration.

### Quality Assurance

Every generated answer is automatically assessed:

- **Faithfulness Score (0-10)**: An LLM judge evaluates whether the answer accurately reflects the retrieved source material. Scores below 7 trigger a warning.

- **Citation Accuracy**: Each citation reference (e.g., "[Section 2.1.3]") is checked against the actual retrieved chunks. Citations that don't match any source are flagged as "phantom citations."

- **Uncited Claims**: Factual statements in the answer that should have a citation but don't are flagged.

---

## Setup & Deployment

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ with `pgvector` extension (Neon recommended)
- OpenAI API key
- Cohere API key (optional, for reranking)

### Local Development

```bash
# 1. Clone and install
git clone <repo-url>
cd hk-compliance-rag
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Run database migrations
npm run migrate

# 4. Ingest regulations (fetch PDFs, parse, chunk, embed)
npm run scrape    # Fetch PDFs from government sites
npm run ingest    # Parse, chunk, embed, and store

# 5. Start development server
npm run dev       # http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings (text-embedding-3-large) and generation (GPT-4o) |
| `DATABASE_URL` | Yes | PostgreSQL connection string with pgvector support |
| `COHERE_API_KEY` | No | Cohere API key for Rerank 3.5 (falls back to score-based ranking) |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment: development, production, or test |
| `SCRAPE_CONCURRENCY` | No | Parallel PDF download limit (default: 3) |
| `PDF_STORAGE_DIR` | No | Local PDF cache directory (default: ./data/pdfs) |

### Railway Deployment

The project is configured for Railway with Nixpacks:

```toml
# railway.toml
[build]
builder = "NIXPACKS"
buildCommand = "npm ci && npx tsc"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**Deploy steps:**
1. Push to GitHub
2. Connect repo in Railway
3. Set environment variables in Railway dashboard
4. Railway auto-detects `railway.toml` and builds with Nixpacks
5. Health check at `/api/health` confirms deployment

**Database:** Use Neon (neon.tech) for PostgreSQL with pgvector — it provides serverless Postgres with the pgvector extension pre-installed.

### Database Schema

The system uses 5 main tables:

| Table | Purpose |
|-------|---------|
| `regulation_chunks` | Primary store: text chunks with embeddings, metadata, versioning |
| `document_versions` | Version history for each document (tracks updates) |
| `query_audit_log` | Full audit trail: query, results, quality scores, latency |
| `scrape_log` | Change detection results: what was checked, what changed |
| `migrations` | Schema version tracking |

---

## API Reference

### Query Endpoints

**POST /api/query** — Full query with quality metrics
```json
{
  "query": "What is the minimum fire resistance period for beams?",
  "filter": { "department": "BD" }
}
```

Response includes answer, citations, sources, quality scores, audit ID, and latency.

**POST /api/query/stream** — Server-Sent Events streaming
Same request format. Streams events: `status`, `sources`, `token`, `done`, `error`.

### Information Endpoints

**GET /api/health** — System health, document count, last scrape date

**GET /api/sources** — Ingested documents by department with counts

**GET /api/audit/:id** — Retrieve full audit log for a specific query

### Admin Endpoints

**POST /api/admin/scrape** — Trigger manual change detection scan

**GET /api/admin/changes** — Recent regulation changes (last 30 days)

---

## Testing

The project has 22 unit test files covering every component:

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:evals    # Golden Q&A evaluation suite (50 questions)
npm run test:coverage # Coverage report
```

Tests use `vitest` with mocked dependencies (pg.Pool, OpenAI client). Golden Q&A tests at `tests/fixtures/golden-qa.json` validate end-to-end answer quality.

---

## Common Compliance Questions This System Handles

1. **Fire Resistance Periods**: "What FRP is required for columns in a 40-storey residential building?"
2. **Means of Escape**: "What is the maximum travel distance to an exit in an office building?"
3. **Structural Design**: "What wind load should be used for a 300m building in Kowloon?"
4. **Foundation Requirements**: "What ground investigation is needed for a pile foundation in reclaimed land?"
5. **Barrier-Free Access**: "What ramp gradient is required for wheelchair access?"
6. **Site Coverage**: "What is the maximum site coverage for a domestic building in the New Territories?"
7. **Energy Efficiency**: "What OTTV limit applies to commercial buildings?"
8. **Construction Noise**: "What are the permitted hours for percussive piling near residential areas?"
9. **Practice Notes**: "What does PNAP ADV-33 require for building works near the MTR?"
10. **Legislation Cross-References**: "How do Cap. 123F and the Fire Safety Code interact for means of escape?"

---

## Glossary

| Term | Definition |
|------|------------|
| **AP** | Authorized Person — architect, engineer, or surveyor authorized to submit building plans |
| **RSE** | Registered Structural Engineer — specialist for structural submissions |
| **RGE** | Registered Geotechnical Engineer — specialist for geotechnical submissions |
| **BA** | Building Authority — the government body (effectively the Buildings Department) |
| **BO** | Buildings Ordinance (Cap. 123) |
| **B(P)R** | Building (Planning) Regulations (Cap. 123F) |
| **PNAP** | Practice Note for Authorized Persons |
| **FRP** | Fire Resistance Period |
| **FSI** | Fire Service Installation |
| **OTTV** | Overall Thermal Transfer Value |
| **BEC** | Building Energy Code |
| **GBP** | General Building Plans |
| **TCP** | Technically Competent Person (for site supervision) |
| **FSD** | Fire Services Department |
| **BD** | Buildings Department |
| **EPD** | Environmental Protection Department |
| **EMSD** | Electrical & Mechanical Services Department |
| **RRF** | Reciprocal Rank Fusion (search algorithm) |
| **RAG** | Retrieval-Augmented Generation |

---

## License

MIT — see [LICENSE](LICENSE) for details.

## Disclaimer

This system is designed to assist professionals in navigating Hong Kong building regulations. It does **not** constitute legal advice. Regulations are subject to amendment, and the information provided should always be verified against the latest official government publications. Consult qualified Authorized Persons, Registered Structural Engineers, or legal professionals for definitive compliance guidance.
