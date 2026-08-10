import { describe, it, expect } from 'vitest';
import { typingSchedule } from './typing-schedule';

describe('typingSchedule', () => {
  it('returns an empty schedule for no texts', () => {
    expect(typingSchedule([], 2, 50)).toEqual([]);
  });

  it('starts the first text at startAt', () => {
    expect(typingSchedule([10], 2, 50)).toEqual([2]);
  });

  it('chains each start after the previous text finishes plus the gap', () => {
    // 10 chars @ 50cps = 0.2s; default gap 0.15 → second starts at 2 + 0.2 + 0.15 = 2.35
    // 20 chars @ 50cps = 0.4s → third starts at 2.35 + 0.4 + 0.15 = 2.9
    const result = typingSchedule([10, 20, 5], 2, 50);

    expect(result[0]).toBeCloseTo(2, 5);
    expect(result[1]).toBeCloseTo(2.35, 5);
    expect(result[2]).toBeCloseTo(2.9, 5);
  });

  it('honours a custom gap', () => {
    const result = typingSchedule([10, 10], 1, 50, 0.5);

    expect(result[0]).toBeCloseTo(1, 5);
    expect(result[1]).toBeCloseTo(1.7, 5);
  });
});
