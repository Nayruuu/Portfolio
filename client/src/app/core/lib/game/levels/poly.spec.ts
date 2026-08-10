import { describe, it, expect } from 'vitest';
import { poly } from './poly';

describe('poly', () => {
  it('throws on an odd-length coordinate list', () => {
    expect(() => poly([1])).toThrow('poly: odd coordinate count');
  });
});
