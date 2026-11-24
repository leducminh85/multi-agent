import { describe, expect, it } from 'vitest';
import { extractJson, parseAgentOutput, validatePlan } from '../src/orchestrator/protocol.js';

describe('agent output protocol', () => {
  it('returns plain output when no action block exists', () => {
    expect(parseAgentOutput('  hello  ')).toEqual({ output: 'hello', actions: {} });
  });

  it('extracts and strips the mao-actions block', () => {
    const text = 'Result here.\n\n```mao-actions\n{"help_requests":[{"role":"researcher","request":"find X"}],"memory":["likes tables"]}\n```';
    const r = parseAgentOutput(text);
    expect(r.output).toBe('Result here.');
    expect(r.actions.help_requests?.[0]).toMatchObject({ role: 'researcher', request: 'find X' });
    expect(r.actions.memory).toEqual(['likes tables']);
  });

  it('reports invalid action JSON without losing the output', () => {
    const r = parseAgentOutput('Done.\n```mao-actions\n{not json}\n```');
    expect(r.output).toBe('Done.');
    expect(r.actions).toEqual({});
    expect(r.actionError).toMatch(/Invalid JSON/);
  });
});

describe('plan parsing', () => {
  it('extracts JSON from fenced or surrounding prose', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"a": {"b": "}"}} trailing')).toEqual({ a: { b: '}' } });
    expect(() => extractJson('no json')).toThrow();
  });

  it('drops unknown and self dependencies', () => {
    const p = validatePlan({ tasks: [{ key: 'a', title: 'A', depends_on: ['a', 'zzz'] }, { key: 'b', title: 'B', depends_on: ['a'] }] });
    expect(p.tasks[0].depends_on).toEqual([]);
    expect(p.tasks[1].depends_on).toEqual(['a']);
    expect(p.tasks[0].role).toBe('general');
  });

  it('rejects cycles and duplicate keys', () => {
    expect(() =>
      validatePlan({ tasks: [{ key: 'a', title: 'A', depends_on: ['b'] }, { key: 'b', title: 'B', depends_on: ['a'] }] }),
    ).toThrow(/cycle/i);
    expect(() => validatePlan({ tasks: [{ key: 'a', title: 'A' }, { key: 'a', title: 'B' }] })).toThrow(/Duplicate/);
  });

  it('rejects empty plans', () => {
    expect(() => validatePlan({ tasks: [] })).toThrow();
  });
});
