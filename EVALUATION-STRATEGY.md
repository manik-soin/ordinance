# HK Compliance RAG — Evaluation Strategy & Improvement Roadmap

## 1. Current System Assessment

### Architecture Summary
| Component | Implementation | Quality |
|---|---|---|
| Chunking | Structure-aware, 256-512 tokens, 75-token overlap, hierarchy preserved | Good |
| Embeddings | OpenAI text-embedding-3-large (3072 dims) | Excellent |
| Retrieval | Hybrid search (pgvector cosine + BM25 FTS), RRF fusion (k=60) | Good |
| Reranking | Cohere rerank-v3.5, threshold 0.1 | Good |
| Query Expansion | GPT-5-mini, 2-3 variant phrasings | Good |
| Generation | GPT-5.4, citation-aware system prompt, 800-token cap | Good |
| Safety | Faithfulness scoring, citation verification, prompt injection detection | Good |
| Caching | Exact + semantic cache (95% similarity threshold, 1hr TTL) | Good |
| Live Data | BD/FSD/gov.hk keyword-based URL matching | Basic |
| Follow-up | Conversation history contextualization via GPT-5-mini | Good |

### Existing Evaluation Infrastructure
- **Golden QA set**: 50 questions across 5+ departments, 4+ difficulty levels, 8+ categories
- **RAGAS-style metrics**: Braintrust AutoEvals (Factuality, ClosedQA, Battle)
- **Faithfulness tests**: Mock-based + live LLM scoring
- **Citation accuracy tests**: Phantom detection, uncited claims, extraction precision
- **Hallucination detection**: 7 categories (intrinsic, extrinsic, phantom, conflation, temporal, numeric, entity)
- **Retrieval quality**: RRF fusion invariants, department filtering, edge cases
- **Regression tests**: Golden QA structural validation

### What's Missing
- **Live end-to-end evaluation** — no tests actually run questions through the full pipeline against a database
- **MCQ-format evaluation** — exam-style questions test different skills than open-ended Q&A
- **Retrieval recall/precision measurement** — `.todo` placeholders only
- **Failure categorization** — no systematic "retrieval failure vs generation failure" diagnosis
- **Benchmark baselines** — no recorded performance numbers to track regression
- **Multi-document reasoning evaluation** — limited coverage of cross-regulatory questions

---

## 2. Colleague's MCQ Dataset Analysis

### Dataset Overview
- **27 multiple-choice questions** from HK Building Ordinance professional exams
- **Format**: Question + 4 options (A/B/C/D) + correct answer + statutory reference
- **Now stored at**: `tests/fixtures/colleague-mcq-dataset.json`

### Coverage Analysis

**By Difficulty:**
| Type | Count | Description |
|---|---|---|
| Factual | 14 | Direct regulatory recall (specific clause/section) |
| Multi-statement | 11 | Evaluate 3-4 individual claims, pick correct combination |
| Application | 2 | Apply regulations to a specific scenario |

**By Category:**
| Category | Count | Key Legislation |
|---|---|---|
| Fire Safety | 10 | FS Code, FRC Code, MOE Code, B(C)R, Cap. 502 |
| Planning | 5 | B(P)R, Joint Practice Notes, PNAP |
| Primary Legislation | 5 | BO Cap. 123, sections 9/14/21/23/41 |
| Administration | 3 | B(A)R, PNAP |
| Demolition | 1 | Building (Demolition Works) Regulations |
| Accessibility | 1 | DDO / B(P)R 72 |
| Licensing | 1 | Food Business Regulation Cap. 132X |

**By Source Document (10 unique):**
- Building (Planning) Regulations — 5 questions
- Buildings Ordinance Cap. 123 — 5 questions
- Code of Practice for Fire Safety in Buildings — 4 questions
- Building (Administration) Regulations — 2 questions
- Building (Construction) Regulations — 2 questions
- Code of Practice for Fire Resisting Construction — 1 question
- Code of Practice for Means of Escape — 1 question
- FSD Code of Practice — 1 question
- Joint Practice Notes — 1 question
- Town Planning Ordinance — 1 question
- Food Business Regulation — 1 question (outside current corpus)
- Disability Discrimination Ordinance — 1 question (cross-regulatory)

### Key Challenges This Dataset Poses
1. **MCQ format** — system must evaluate all 4 options, not just retrieve and summarize
2. **Multi-statement compound questions** (11/27) — must evaluate 3-4 individual claims and determine which combination is correct/incorrect
3. **Precise clause-level knowledge** — exact section numbers, specific thresholds, specific conditions
4. **Cross-document questions** — 7 questions reference multiple regulatory instruments (using `/` or `&`)
5. **Negative questions** — "which is NOT required" / "does NOT apply" requires understanding all options
6. **Out-of-corpus content** — Food Business Regulation (Cap. 132X) likely not in the current database
7. **Temporal specificity** — "before 1 March 1987" (Q15), specific amendment dates

### Comparison with Golden QA Set
| Dimension | Golden QA (50 Qs) | Colleague MCQ (27 Qs) |
|---|---|---|
| Format | Open-ended | Multiple choice A/B/C/D |
| Answer type | Narrative with citations | Single letter + reasoning |
| Difficulty range | factual → scenario → cross-regulatory | factual → multi-statement → application |
| Departments | BD, FSD, EPD, EMSD, HA | BD, FSD, FEHD (1 out-of-scope) |
| Multi-doc | 5 cross-regulatory | 7 multi-reference |
| Eval metric | Contains keywords + correct source | Exact answer match + source match |

---

## 3. Evaluation Framework Design

### Metrics We Should Track

#### Tier 1: Core Pipeline Metrics (run on every PR)
| Metric | Target | How Measured |
|---|---|---|
| **MCQ Accuracy** | >= 60% overall | Exact answer letter match |
| **Source Hit Rate** | >= 80% | Correct document in top-7 retrieved |
| **Citation Precision** | >= 90% | Verified citations / total citations |
| **Faithfulness Score** | >= 7/10 | LLM judge (existing) |
| **Latency p95** | < 15s | End-to-end query pipeline |

#### Tier 2: Diagnostic Metrics (weekly eval runs)
| Metric | Target | How Measured |
|---|---|---|
| **Retrieval Recall@10** | >= 90% | Relevant chunks in top-10 (golden QA) |
| **Retrieval Precision@5** | >= 70% | Relevant chunks / retrieved chunks |
| **Reranker NDCG** | >= 0.8 | Pre/post rerank ordering |
| **Multi-statement Accuracy** | >= 50% | MCQ compound question subset |
| **Cross-doc Accuracy** | >= 40% | Questions spanning 2+ documents |
| **Uncited Claims Rate** | < 10% | Claims without bracket citations |

#### Tier 3: LLM-as-Judge Metrics (monthly deep eval)
| Metric | Target | How Measured |
|---|---|---|
| **RAGAS Faithfulness** | >= 0.85 | RAGAS framework |
| **RAGAS Context Precision** | >= 0.80 | RAGAS framework |
| **Answer Correctness** | >= 0.75 | Braintrust Factuality scorer |
| **Hallucination Rate** | < 5% | Patronus Lynx or custom LLM judge |

### Failure Categorization Framework

When a question is answered incorrectly, categorize the failure:

| Failure Type | Diagnosis | Fix Domain |
|---|---|---|
| **Retrieval Miss** | Correct document/chunk not in top-K | Chunking, embedding, query expansion |
| **Ranking Miss** | Correct chunk retrieved but ranked below top-5 | Reranker, RRF weights |
| **Generation Error** | Correct chunks in context, wrong answer produced | Prompt engineering, model choice |
| **Coverage Gap** | Document not in corpus at all | Ingest pipeline, source coverage |
| **Multi-hop Failure** | Need info from 2+ chunks, only 1 found | Multi-step retrieval, cross-ref graph |
| **Answer Extraction** | LLM answered correctly but answer parsing failed | MCQ prompt template, extraction regex |

---

## 4. Identified Gaps & Weaknesses

### Gap 1: Chunk Context Loss (HIGH IMPACT)
**Problem**: Chunks lose document-level context when retrieved in isolation. A clause about "minimum width" is meaningless without knowing which building type and structural element it governs.
**Evidence**: Chunker prepends `[Source: ... ][Location: ...]` headers, but these are metadata — the embedding doesn't capture the surrounding regulatory context.
**Impact**: Retrieval scores drop for queries requiring contextual understanding.

### Gap 2: No Multi-Statement Reasoning (HIGH IMPACT)
**Problem**: 11 of 27 MCQ questions require evaluating 3-4 individual statements and determining which combination is correct. The system has no explicit multi-claim evaluation capability.
**Evidence**: The generator prompt instructs to "synthesize answers" but doesn't handle structured claim-by-claim evaluation.
**Impact**: Expected < 40% accuracy on multi-statement questions.

### Gap 3: No Retrieval Quality Feedback Loop (MEDIUM IMPACT)
**Problem**: No CRAG-style "was my retrieval good enough?" check before generation. If retrieved chunks are irrelevant, the system generates a low-quality answer instead of requesting better retrieval.
**Evidence**: Pipeline goes directly from rerank to generate without confidence assessment.
**Impact**: Confabulated answers when retrieval fails silently.

### Gap 4: Cross-Reference Blindness (MEDIUM IMPACT)
**Problem**: HK building codes are dense with cross-references ("subject to Part VI" / "as defined in regulation 25"). Retrieved chunks don't follow these references.
**Evidence**: `extractCrossReferences()` extracts references but they're stored as metadata, not used during retrieval.
**Impact**: Questions spanning multiple sections/documents get incomplete context.

### Gap 5: No HyDE or Hypothetical Document Embeddings (MEDIUM IMPACT)
**Problem**: Query expansion generates phrasings but doesn't generate hypothetical answer documents that would be in the same semantic space as regulation text.
**Evidence**: `expandQuery()` produces 2-3 variants but they're still questions, not answer-like text.
**Impact**: Semantic gap between user questions and regulation language.

### Gap 6: Citation Verification is Document-Level Only (LOW-MEDIUM)
**Problem**: Citation verifier checks if document name matches but doesn't verify section-level accuracy.
**Evidence**: `verifyCitations()` — `ctx.document_name === citation.document_name` matches the document but Section 999.99 on a real document passes.
**Impact**: Phantom section numbers in citations go undetected.

### Gap 7: No Query Routing by Regulatory Domain (LOW IMPACT)
**Problem**: All queries search the entire corpus. No metadata pre-filtering based on detected regulatory domain.
**Evidence**: `hybridSearch()` accepts a `filter` parameter but it's rarely used by the query pipeline.
**Impact**: Noise in results, slower retrieval for targeted questions.

---

## 5. Improvement Strategy — Prioritized Roadmap

### Phase 1: Evaluation Foundation (Week 1)
*Establish baselines before making any pipeline changes.*

| # | Task | Impact | Effort | Details |
|---|---|---|---|---|
| 1.1 | Run MCQ benchmark against live pipeline | Critical | Low | `npx tsx tests/evals/mcq-eval-runner.ts` — establish accuracy baseline |
| 1.2 | Run golden QA set through pipeline | Critical | Low | Implement the `.todo` tests in regression.test.ts |
| 1.3 | Categorize failures into the 6 failure types | Critical | Medium | Manual analysis of wrong answers — is it retrieval, ranking, or generation? |
| 1.4 | Record baseline metrics | Critical | Low | Save retrieval recall@10, precision@5, accuracy, faithfulness |

### Phase 2: Quick Wins (Week 2)
*High impact, low effort improvements informed by baseline measurements.*

| # | Task | Impact | Effort | Expected Gain |
|---|---|---|---|---|
| 2.1 | **Contextual chunking** — prepend LLM-generated or template context to each chunk before embedding | Very High | Low | +10-15% retrieval recall |
| 2.2 | **HyDE** — generate hypothetical answer docs in parallel with query expansion | High | Low | +5-10% retrieval recall |
| 2.3 | **Query routing** — detect regulatory domain, apply metadata filter before search | Medium | Low | Reduce noise, +5% precision |
| 2.4 | **MCQ-specific prompt** — add explicit multi-option evaluation instructions to generator | High | Very Low | +10-15% MCQ accuracy |

### Phase 3: Structural Improvements (Weeks 3-4)
*Medium effort, high impact changes to the pipeline architecture.*

| # | Task | Impact | Effort | Expected Gain |
|---|---|---|---|---|
| 3.1 | **Parent-child chunk retrieval** — retrieve on small chunks, expand to parent for generation | High | Medium | Better context for generation |
| 3.2 | **CRAG** — add retrieval confidence scoring, re-retrieve if low confidence | High | Medium | Reduce hallucination on retrieval failures |
| 3.3 | **Cross-reference graph** — store directed edges between cross-referencing chunks, traverse at retrieval time | Medium-High | Medium | +10% on cross-doc questions |
| 3.4 | **Structured citation output** — JSON output with chunk IDs, not free-text brackets | Medium | Low | Deterministic citation verification |
| 3.5 | **Multi-step retrieval** — first pass broad, LLM identifies gaps, second pass targeted | High | Medium | +15% on multi-doc questions |

### Phase 4: Advanced Techniques (Month 2+)
*Higher effort improvements for long-term quality gains.*

| # | Task | Impact | Effort | Expected Gain |
|---|---|---|---|---|
| 4.1 | **Cross-encoder fine-tuning** on domain data | Medium-High | High | +5-10% reranker quality |
| 4.2 | **Expand corpus** — ingest Town Planning Ordinance, Food Business Regulation, DDO | Medium | Medium | Cover 3 currently-missing question sources |
| 4.3 | **Self-RAG** or iterative retrieval-generation | Medium | High | Better answer quality on complex queries |
| 4.4 | **Agentic RAG** — tool-using agent for "research mode" queries | Medium | High | Handle complex multi-hop scenarios |
| 4.5 | **CI/CD eval gates** — block deploys if accuracy drops below baseline | High | Medium | Prevent regression |

---

## 6. MCQ-Specific Improvements

The MCQ format requires different optimization than open-ended Q&A:

### MCQ Prompt Engineering
```
You are answering a multiple-choice question about Hong Kong building regulations.

APPROACH:
1. Read all four options carefully
2. For each option, determine if it is TRUE or FALSE based on the retrieved regulations
3. For combination questions (1), (2), (3), (4): evaluate each statement independently
4. State which option is correct and WHY, citing the specific regulation

IMPORTANT: If the retrieved context doesn't cover all options, say which you can verify
and which require additional sources.

State the answer letter clearly at the start: "The answer is X."
```

### Multi-Statement Evaluation Strategy
For questions like "Which combination of (1)(2)(3)(4) is correct?":
1. Extract each individual statement
2. Run a focused retrieval for each statement
3. Evaluate truth/falsity of each
4. Map back to the answer options

This could be implemented as a specialized `evaluateMCQ()` pipeline variant that:
- Decomposes compound questions into individual claims
- Runs parallel retrievals per claim
- Aggregates evidence before answering

---

## 7. Running the Evaluation

### Quick Start
```bash
# Run dataset integrity + logic tests (no API/DB needed)
npm run test:evals

# Run MCQ benchmark against live pipeline (needs DB + API keys)
npx tsx tests/evals/mcq-eval-runner.ts

# Dry run to see formatted prompts
npx tsx tests/evals/mcq-eval-runner.ts --dry-run

# Run first 5 questions only
npx tsx tests/evals/mcq-eval-runner.ts --first 5

# Run a single question
npx tsx tests/evals/mcq-eval-runner.ts --question mcq-007
```

### Interpreting Results
- **Accuracy >= 70%**: System is performing well for a regulatory RAG
- **Accuracy 50-70%**: Acceptable but significant room for improvement
- **Accuracy < 50%**: Major pipeline issues — likely retrieval failures
- **Source Hit Rate >= 80%**: Retrieval is working, failures are in generation
- **Source Hit Rate < 60%**: Retrieval is the bottleneck, prioritize chunking/embedding/expansion

### Baseline Expectations (Pre-improvement)
Based on system analysis, expected baseline performance:
- **Overall MCQ Accuracy**: 40-55% (constrained by multi-statement questions)
- **Factual Question Accuracy**: 55-70%
- **Multi-statement Accuracy**: 25-40%
- **Source Hit Rate**: 65-80%
- **Fire Safety Category**: 45-60% (well-covered in corpus)
- **Primary Legislation**: 40-55% (precise clause knowledge needed)

---

## 8. Key Metrics Definitions

### MCQ Accuracy
```
accuracy = correct_answers / total_questions
```
Exact match of extracted answer letter against ground truth.

### Source Hit Rate
```
hit_rate = questions_where_correct_doc_in_top_K / total_questions
```
Uses fuzzy matching on document names from retrieved chunks.

### Faithfulness (existing)
LLM judge scores 0-10, with flagged unsupported claims.
Target: >= 7/10 for production queries.

### Citation Accuracy (existing)
```
citation_accuracy = verified_citations / total_citations
```
Verified means the cited document exists in the retrieved context.

### Retrieval Recall@K
```
recall@K = |relevant_docs_in_top_K| / |all_relevant_docs|
```
Requires relevance judgments per question (from golden QA expected_source field).

---

## 9. File Reference

| File | Purpose |
|---|---|
| `tests/fixtures/colleague-mcq-dataset.json` | 27 MCQ questions parsed from colleague's CSV |
| `tests/fixtures/golden-qa.json` | 50 open-ended Q&A (existing) |
| `tests/evals/mcq-benchmark.test.ts` | MCQ eval harness, answer extraction, scoring, source matching |
| `tests/evals/mcq-eval-runner.ts` | CLI runner for live pipeline evaluation |
| `tests/evals/ragas-metrics.test.ts` | RAGAS-style metrics via AutoEvals |
| `tests/evals/faithfulness.test.ts` | Faithfulness scoring tests |
| `tests/evals/hallucination-detection.test.ts` | Hallucination detection across 7 categories |
| `tests/evals/citation-accuracy.test.ts` | Citation extraction and verification tests |
| `tests/evals/retrieval-quality.test.ts` | RRF fusion quality invariants |
| `tests/evals/regression.test.ts` | Golden QA structural validation |
