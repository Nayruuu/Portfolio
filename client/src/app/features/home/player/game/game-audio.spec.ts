import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameAudio } from './game-audio';

/** A minimal Web Audio mock — object literals (no class) keep the test lint-clean. */
let oscillatorCount = 0;

function fakeParam(): Record<string, unknown> {
  return {
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined, // the ADSR attack ramps linearly
    exponentialRampToValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
  };
}

function fakeNode(): Record<string, unknown> {
  return {
    frequency: fakeParam(),
    detune: fakeParam(), // the detuned twin-oscillator lead sets oscillator.detune
    gain: fakeParam(),
    type: '',
    buffer: null,
    connect: (destination: unknown) => destination,
    start: () => undefined,
    stop: () => undefined,
  };
}

function fakeContext(): Record<string, unknown> {
  return {
    currentTime: 0,
    sampleRate: 44100,
    destination: fakeNode(),
    createOscillator: () => {
      oscillatorCount += 1;

      return fakeNode();
    },
    createGain: fakeNode,
    createBiquadFilter: fakeNode,
    createBufferSource: fakeNode,
    createBuffer: (channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

describe('GameAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('degrades to silence (never throws) where Web Audio is absent — SSR / jsdom', () => {
    const audio = new GameAudio();

    expect(() => audio.ensureStarted()).not.toThrow();
    expect(() => audio.setMuted(true)).not.toThrow(); // master is null → no-op branch
    expect(() => audio.playMelee()).not.toThrow(); // no context → no-op
    expect(() => audio.playHit()).not.toThrow(); // every combat SFX degrades to silence too
    expect(() => audio.playKill()).not.toThrow();
    expect(() => audio.playHurt()).not.toThrow();
    expect(() => audio.playPickup()).not.toThrow();
    expect(() => audio.playNail()).not.toThrow(); // the chaingun nail tick too
    expect(() => audio.playSaw()).not.toThrow(); // the chainsaw grind tick too
    expect(() => audio.dispose()).not.toThrow();
  });

  it('builds the graph, schedules notes, swings the fist, mutes, and disposes (mocked Web Audio)', () => {
    oscillatorCount = 0;
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', function FakeAudioContext(this: unknown) {
      return fakeContext();
    });

    const audio = new GameAudio();

    audio.ensureStarted(); // creates context + graph + the lookahead scheduler
    audio.ensureStarted(); // idempotent → the resume() path
    vi.advanceTimersByTime(30); // fire the scheduler once → queues bass + lead + arp + drum voices

    expect(oscillatorCount).toBeGreaterThan(0);

    expect(() => audio.playMelee()).not.toThrow(); // key-clack through the master
    expect(() => audio.playHit()).not.toThrow(); // combat SFX reach only existing mock nodes/params
    expect(() => audio.playKill()).not.toThrow();
    expect(() => audio.playHurt()).not.toThrow();
    expect(() => audio.playPickup()).not.toThrow();
    expect(() => audio.playNail()).not.toThrow(); // the chaingun nail tick (band-passed noise burst)
    expect(() => audio.playSaw()).not.toThrow(); // the chainsaw grind tick (sawtooth growl + noise grit)
    audio.setMuted(true); // master-gain branch
    audio.setMuted(false);
    audio.dispose(); // clearInterval + close
    expect(() => audio.dispose()).not.toThrow();
  });
});
