import { describe, it, expect } from 'vitest';
import { poly } from './poly';

// The happy paths of `poly`/`rect` are exercised by construction — every room-graph level runs
// `buildMap()` (which calls both) at module load. Only the guard arm needs an explicit test: callers
// pass even-length literals, so its `throw` is otherwise unreachable under the core 100% guard.
describe('poly', () => {
  it('throws on an odd-length coordinate list', () => {
    expect(() => poly([1])).toThrow('poly: odd coordinate count');
  });
});
