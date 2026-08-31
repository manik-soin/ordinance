import { describe, it, expect } from 'vitest';
import { routeComplexity } from '../../src/agent/complexity-router.js';

describe('complexity router', () => {
  it('routes simple single-hop lookups to the static pipeline', () => {
    const decision = routeComplexity(
      'What is the minimum fire resistance period for structural elements?'
    );
    expect(decision.path).toBe('static');
    expect(decision.reasons).toEqual(['single-hop']);
    expect(decision.fanOutTasks).toBeUndefined();
  });

  it('routes freshness-sensitive queries to the agent', () => {
    const decision = routeComplexity(
      'Is the Fireshield FD-60 fire door model still approved?'
    );
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('freshness');
  });

  it('detects live-dataset queries combining product and approval terms', () => {
    const decision = routeComplexity(
      'Which fire doorsets from Chubb are on the approved list?'
    );
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('freshness');
  });

  it('routes comparisons across occupancies to the agent with fan-out tasks', () => {
    const decision = routeComplexity(
      'Compare the means-of-escape requirements across residential, commercial and industrial occupancies'
    );
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('multi-hop-comparison');
    expect(decision.fanOutTasks).toEqual([
      'residential occupancy',
      'commercial occupancy',
      'industrial occupancy',
    ]);
  });

  it('caps fan-out tasks at 3 to match the spawn schema', () => {
    const decision = routeComplexity(
      'Compare means-of-escape across residential, commercial, industrial and hotel occupancies'
    );
    expect(decision.path).toBe('agent');
    expect(decision.fanOutTasks).toHaveLength(3);
  });

  it('does not fan out a comparison with fewer than two occupancies', () => {
    const decision = routeComplexity(
      'Compare the residential fire safety requirements with the old edition'
    );
    expect(decision.path).toBe('agent');
    expect(decision.fanOutTasks).toBeUndefined();
  });

  it('routes cross-reference chasing to the agent', () => {
    const decision = routeComplexity(
      'The clause says it is subject to Part IV — what does that part actually require?'
    );
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('cross-reference');
  });

  it('routes context-heavy compliance checks to the agent', () => {
    const decision = routeComplexity(
      'Does my 12-storey residential building meet the means-of-escape rules?'
    );
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('context-dependent');
  });

  it('uses pinned memory to route deictic follow-ups to the agent', () => {
    const decision = routeComplexity('Does this building need a sprinkler system?', {
      memory: { storeys: 12, buildingType: 'residential' },
    });
    expect(decision.path).toBe('agent');
    expect(decision.reasons).toContain('context-dependent');
  });

  it('keeps deictic queries static when no memory is pinned', () => {
    const decision = routeComplexity('Does this building need a sprinkler system?');
    expect(decision.path).toBe('static');
  });
});
