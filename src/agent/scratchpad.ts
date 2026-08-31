import type { SearchResult } from '../retrieval/hybrid-search.js';

/**
 * Externalized scratchpad: the agent's todo list, observation log, and chunk
 * store live OUTSIDE the prompt. Each step the loop renders a lean view
 * (current objective + todo state + recent observation summaries) into the
 * working context. Full retrieved chunks are stored here as pointers and are
 * never pasted back into the prompt — that is the progressive-disclosure
 * defence against context rot.
 */

export interface ChunkPointer {
  chunkId: string;
  document: string;
  department: string;
  version: string;
  section: string;
  page: number;
  snippet: string;
}

export interface TodoItem {
  text: string;
  status: 'pending' | 'done';
}

export interface Observation {
  step: number;
  tool: string;
  summary: string;
}

const SNIPPET_CHARS = 350;
const MAX_RECENT_OBSERVATIONS = 6;
// Sized so a retrieve summary or an on-demand full-chunk fetch fits, while the
// recent-observation window keeps the total working context bounded.
const MAX_OBSERVATION_CHARS = 5200;

/** Compact a full search result into a pointer the model can reason about. */
export function toChunkPointer(result: SearchResult): ChunkPointer {
  return {
    chunkId: result.id,
    document: result.document_name,
    department: result.source_department,
    version: result.version,
    section: result.section_hierarchy.join(' > '),
    page: result.page_number,
    snippet:
      result.content.length > SNIPPET_CHARS
        ? `${result.content.slice(0, SNIPPET_CHARS)}...`
        : result.content,
  };
}

export class Scratchpad {
  private objective: string;
  private todos: TodoItem[] = [];
  private observations: Observation[] = [];
  private chunkStore = new Map<string, SearchResult>();

  constructor(objective: string) {
    this.objective = objective;
  }

  setTodos(items: string[]): void {
    this.todos = items.map((text) => ({ text, status: 'pending' as const }));
  }

  completeTodo(index: number): void {
    if (this.todos[index]) this.todos[index].status = 'done';
  }

  getTodos(): TodoItem[] {
    return [...this.todos];
  }

  /**
   * Store full chunks and return compact pointers. Deduplicates by chunk id
   * so repeated retrievals don't grow the store.
   */
  addChunks(results: SearchResult[]): ChunkPointer[] {
    for (const result of results) {
      if (!this.chunkStore.has(result.id)) {
        this.chunkStore.set(result.id, result);
      }
    }
    return results.map(toChunkPointer);
  }

  getChunk(id: string): SearchResult | undefined {
    return this.chunkStore.get(id);
  }

  getAllChunks(): SearchResult[] {
    return [...this.chunkStore.values()];
  }

  chunkCount(): number {
    return this.chunkStore.size;
  }

  addObservation(step: number, tool: string, summary: string): void {
    const trimmed =
      summary.length > MAX_OBSERVATION_CHARS
        ? `${summary.slice(0, MAX_OBSERVATION_CHARS)}... [truncated]`
        : summary;
    this.observations.push({ step, tool, summary: trimmed });
  }

  getObservations(): Observation[] {
    return [...this.observations];
  }

  /**
   * Render the lean working-context view. Older observations collapse to a
   * one-line ledger; only the most recent ones appear in full.
   */
  renderForPrompt(): string {
    const parts: string[] = [`OBJECTIVE: ${this.objective}`];

    if (this.todos.length > 0) {
      const todoLines = this.todos
        .map((t) => `- [${t.status === 'done' ? 'x' : ' '}] ${t.text}`)
        .join('\n');
      parts.push(`PLAN:\n${todoLines}`);
    }

    if (this.observations.length > 0) {
      const older = this.observations.slice(0, -MAX_RECENT_OBSERVATIONS);
      const recent = this.observations.slice(-MAX_RECENT_OBSERVATIONS);

      const lines: string[] = [];
      if (older.length > 0) {
        lines.push(
          `(steps 1-${older.length} summarized: ${older
            .map((o) => o.tool)
            .join(', ')} already executed; their chunks are in the store)`
        );
      }
      for (const obs of recent) {
        lines.push(`[step ${obs.step}] ${obs.tool}: ${obs.summary}`);
      }
      parts.push(`OBSERVATIONS SO FAR:\n${lines.join('\n')}`);
    }

    if (this.chunkStore.size > 0) {
      parts.push(
        `CHUNK STORE: ${this.chunkStore.size} retrieved chunk(s) available for citation. Cite only documents/sections that appear in observations.`
      );
    }

    return parts.join('\n\n');
  }
}
