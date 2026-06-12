/**
 * The game's audio engine via the Web Audio API: an **original**, zero-asset, browser-only chiptune.
 * A lookahead scheduler walks an 8-bar song (E-minor, ~140 BPM) over four procedural tracks — driving
 * 8th-note bass, a syncopated lead hook (detuned twin squares), a 16th-note triad arpeggio, and a
 * kick/snare/hi-hat drum kit — plus the gunshot + combat SFX. Created lazily on a user gesture
 * (autoplay policy); degrades to silence where Web Audio is absent (SSR / jsdom). Music + sfx share
 * the master gain, so muting silences both.
 */
const ROOT_HZ = 82.41; // E2 — the low end the office anthem broods on
const STEP_SECONDS = 0.1; // 16th note at ~150 BPM — a touch more drive than before
const MASTER_LEVEL = 0.16;
const STEPS_PER_BAR = 16;
const LEAD_OCTAVE = 24; // semitones above the E2 root → the lead/riff sings around E4–C6

/** The mood of a bar — drives the bass/drum/lead/filter character, so the same engine narrates a
 *  corporate-muzak intro, a DOOM combat gallop, and a chaos breakdown. */
type Mood = 'muzak' | 'combat' | 'chaos';

/** Lowpass cutoff (Hz) per mood: warm + dull for the lounge muzak, bright + open for combat/chaos. */
const CUTOFF: Record<Mood, number> = { muzak: 1100, combat: 3200, chaos: 2600 };

/** A bar's harmony (root = semitone offset from E2, plus the third's quality) and its mood. */
interface Bar {
  readonly root: number;
  readonly major: boolean;
  readonly mood: Mood;
}

/**
 * `OPEN SPACE.EXE` — a 16-bar anthem that NARRATES the office turning hostile, then loops:
 *  • bars 0-3   MUZAK  — cheesy corporate hold-music (ii–V–I–vi in G major), clean + warm;
 *  • bars 4-11  COMBAT — the alert: an Em DOOM gallop, sawtooth power-chord chug, driving drums;
 *  • bars 12-15 CHAOS  — heaviest, a half-time breakdown + a riser that (ironically) resolves home
 *    to the V (B), pulling back into the muzak loop.
 * Sectioned + 16 bars long so it evolves instead of looping every 8. First-pass — tune by ear.
 */
const SONG: readonly Bar[] = [
  { root: 5, major: false, mood: 'muzak' }, // Am7
  { root: 10, major: true, mood: 'muzak' }, // D7
  { root: 3, major: true, mood: 'muzak' }, // Gmaj7
  { root: 0, major: false, mood: 'muzak' }, // Em7 (vi — bridges into the combat key)
  { root: 0, major: false, mood: 'combat' }, // Em
  { root: 0, major: false, mood: 'combat' }, // Em
  { root: 8, major: true, mood: 'combat' }, // C
  { root: 10, major: true, mood: 'combat' }, // D
  { root: 0, major: false, mood: 'combat' }, // Em
  { root: 3, major: true, mood: 'combat' }, // G
  { root: 5, major: false, mood: 'combat' }, // Am
  { root: 7, major: true, mood: 'combat' }, // B
  { root: 0, major: false, mood: 'chaos' }, // Em
  { root: 8, major: true, mood: 'chaos' }, // C
  { root: 0, major: false, mood: 'chaos' }, // Em
  { root: 7, major: true, mood: 'chaos' }, // B (V — leading-tone pull back to the loop)
];

/**
 * The MUZAK jingle — a sweet, sparse lounge melody over the four hold-music bars, `[stepInBar, semitone
 * above LEAD_OCTAVE]`. Deliberately corny (the corporate "please hold"); only plays in the muzak bars.
 */
const MUZAK_LEAD: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 12],
    [6, 15],
    [10, 17],
  ], // Am7 — E G A
  [
    [0, 18],
    [6, 17],
    [10, 14],
  ], // D7 — F# A F# (down)
  [
    [0, 15],
    [6, 19],
    [10, 22],
  ], // Gmaj7 — G B D (up, bright)
  [
    [0, 19],
    [8, 15],
  ], // Em7 — B G (settle, sparse)
];

/**
 * The COMBAT riff — relative to the bar's chord root, so it follows the changes and stays in key. A
 * driving gallop on the root octave with E-phrygian darkness: the b2 (1) and the tritone (6) give the
 * "evil" DOOM bite. `[stepInBar, semitone relative to chord root + LEAD_OCTAVE]`.
 */
const COMBAT_RIFF: readonly (readonly [number, number])[] = [
  [0, 12],
  [2, 12],
  [3, 13], // root, root, b2 push
  [4, 15],
  [6, 12],
  [7, 18], // 3rd, root, tritone(6)+12
  [8, 12],
  [10, 12],
  [11, 13],
  [12, 19], // 5th up
  [14, 12],
  [15, 18], // tritone tag
];

const MUZAK_BASS_STEPS = new Set([0, 4, 8, 12]); // gentle root on each beat (lounge)
const MUZAK_HAT_STEPS = new Set([2, 6, 10, 14]); // soft off-beat brush
const COMBAT_KICK_STEPS = new Set([0, 3, 4, 7, 8, 11, 12, 14]); // busy, near-double-kick drive
const SNARE_STEPS = new Set([4, 12]); // backbeat on 2 & 4
const COMBAT_HAT_STEPS = new Set([0, 2, 4, 6, 8, 10, 12, 14]); // closed hat on every 8th
const CHAOS_KICK_STEPS = new Set([0, 1, 4, 6, 8, 9, 12, 14]); // heavier, syncopated breakdown

export class GameAudio {
  private audioContext: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private muted = true; // start MUTED by default — the player opts into sound via the speaker toggle

  /** Idempotent: create the audio graph + scheduler on the first call (must be a user gesture). */
  public ensureStarted(): void {
    if (this.audioContext) {
      void this.audioContext.resume();

      return;
    }
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtor) {
      return; // no Web Audio (SSR / jsdom) — stay silent
    }
    this.audioContext = new AudioCtor();
    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = CUTOFF.muzak; // opens warm on the muzak intro, then sweeps per mood
    this.master = this.audioContext.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    this.filter.connect(this.master).connect(this.audioContext.destination);
    this.nextNoteTime = this.audioContext.currentTime + 0.06;
    this.step = 0;
    this.schedulerId = setInterval(() => this.schedule(), 25);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.audioContext) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER_LEVEL,
        this.audioContext.currentTime,
        0.02,
      );
    }
  }

  /** A short percussive key-clack — the mechanical-fist melee swing. A bright switch-click transient
   *  over a low keycap thock. Routed through the master so mute silences it. */
  public playMelee(): void {
    this.noiseBurst(0.045, 5200, 1400, 0.32); // bright switch-click transient
    this.blip('square', 220, 110, 0.34, 0.06); // low keycap thock body
  }

  /** A tight high-pitched zap — a bullet just landed on an enemy. */
  public playHit(): void {
    this.blip('square', 880, 260, 0.3, 0.06);
  }

  /** A descending thud plus a short noise burst — an enemy went down. */
  public playKill(): void {
    this.blip('sine', 200, 48, 0.55, 0.24);
    this.noiseBurst(0.2, 1400, 220, 0.5);
  }

  /** A low body thump — the player took a hit. */
  public playHurt(): void {
    this.blip('sine', 170, 52, 0.6, 0.22);
  }

  /** A bright ascending two-note blip — a floor pickup was collected. */
  public playPickup(): void {
    if (!this.audioContext) {
      return;
    }
    const now = this.audioContext.currentTime;

    this.blip('triangle', 660, 660, 0.32, 0.08, now);
    this.blip('triangle', 988, 988, 0.32, 0.1, now + 0.07);
  }

  /** A short, cheap pneumatic tick — one nail leaving the chaingun. Fired ~14×/s, so deliberately tiny:
   *  a single brief band-passed noise click with no tail (reusing the shared noise engine), kept quiet so
   *  the rapid stream never drowns the music. Degrades to silence with no audio context. */
  public playNail(): void {
    if (!this.audioContext) {
      return;
    }
    this.noise(this.audioContext.currentTime, 0.028, 'bandpass', 3200, 1400, 0.26);
  }

  /** One grind tick of the chainsaw's motor — played ~9×/s while sawing, so it reads as a continuous buzz:
   *  a low sawtooth growl under a band-passed noise grit (the teeth biting). Kept short + quiet so the rapid
   *  stream sits under the music. Degrades to silence with no audio context. */
  public playSaw(): void {
    if (!this.audioContext) {
      return;
    }
    const now = this.audioContext.currentTime;

    this.blip('sawtooth', 130, 116, 0.22, 0.06, now); // low motor growl
    this.noise(now, 0.05, 'bandpass', 1700, 850, 0.16); // gritty teeth
  }

  /** A pneumatic door servo — played once when a keycard door starts opening: a short rising filtered-noise
   *  hiss (the slide) under a low mechanical clunk. Degrades to silence with no audio context. */
  public playDoor(): void {
    if (!this.audioContext) {
      return;
    }
    const now = this.audioContext.currentTime;

    this.noise(now, 0.3, 'bandpass', 600, 1500, 0.18); // rising pneumatic slide hiss
    this.blip('square', 90, 70, 0.3, 0.12, now); // low mechanical clunk
  }

  public dispose(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    void this.audioContext?.close();
    this.audioContext = null;
    this.master = null;
    this.filter = null;
  }

  /** Lookahead: queue every step whose start falls within the next 100 ms. */
  private schedule(): void {
    if (!this.audioContext) {
      return;
    }
    while (this.nextNoteTime < this.audioContext.currentTime + 0.1) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += STEP_SECONDS;
      this.step++;
    }
  }

  /** Fire the tracks for one 16th-note step. The bar's mood sweeps the filter + picks the bass / lead /
   *  drum character, so the song narrates muzak → combat → chaos and loops home. */
  private playStep(globalStep: number, time: number): void {
    const bar = Math.floor(globalStep / STEPS_PER_BAR) % SONG.length;
    const stepInBar = globalStep % STEPS_PER_BAR;
    const cell = SONG[bar];

    if (stepInBar === 0 && this.filter) {
      this.filter.frequency.setTargetAtTime(CUTOFF[cell.mood], time, 0.08); // open/close per mood
    }
    this.bassNote(cell, stepInBar, time);
    this.leadNote(cell, bar, stepInBar, time);
    this.arpNote(cell, stepInBar, time);
    this.drumHit(cell.mood, bar, stepInBar, time);
    if (bar === SONG.length - 1 && stepInBar === 8) {
      this.riser(time); // a rising whoosh that sweeps the chaos breakdown back into the muzak loop
    }
  }

  /** Bass: a gentle lounge root in the muzak; a sawtooth power-chord chug (palm-muted gallop) on every
   *  16th in combat; a heavier, spaced pound in the chaos breakdown. */
  private bassNote(cell: Bar, stepInBar: number, time: number): void {
    if (cell.mood === 'muzak') {
      if (!MUZAK_BASS_STEPS.has(stepInBar)) {
        return;
      }
      this.voice({
        type: 'triangle',
        frequency: ROOT_HZ * Math.pow(2, cell.root / 12),
        time,
        peak: 0.34,
        attack: 0.01,
        decay: 0.06,
        sustain: 0.6,
        hold: 0.2,
        release: 0.1,
      });

      return;
    }
    if (cell.mood === 'combat') {
      this.chug(cell.root, time, 0.46);

      return;
    }
    if (stepInBar % 4 === 0 || stepInBar % 8 === 6) {
      this.chug(cell.root, time, 0.6); // chaos: heavy, syncopated breakdown pounds
    }
  }

  /** Lead: the corny MUZAK jingle in the lounge bars; the COMBAT riff (transposed to the chord root,
   *  sawtooth bite, E-phrygian tritone) in combat / chaos. */
  private leadNote(cell: Bar, bar: number, stepInBar: number, time: number): void {
    if (cell.mood === 'muzak') {
      for (const [eventStep, semitone] of MUZAK_LEAD[bar]) {
        if (eventStep === stepInBar) {
          this.voice({
            type: 'triangle',
            frequency: ROOT_HZ * Math.pow(2, (LEAD_OCTAVE + semitone) / 12),
            time,
            peak: 0.14,
            attack: 0.02,
            decay: 0.08,
            sustain: 0.6,
            hold: 0.22,
            release: 0.12,
          });
        }
      }

      return;
    }
    for (const [eventStep, semitone] of COMBAT_RIFF) {
      if (eventStep === stepInBar) {
        this.voice({
          type: 'sawtooth',
          frequency: ROOT_HZ * Math.pow(2, (LEAD_OCTAVE + cell.root + semitone) / 12),
          time,
          peak: 0.13,
          attack: 0.004,
          decay: 0.05,
          sustain: 0.5,
          hold: 0.05,
          release: 0.06,
          detune: 8,
        });
      }
    }
  }

  /** A soft lounge arpeggio — muzak only; in combat / chaos the chug + riff carry the texture. */
  private arpNote(cell: Bar, stepInBar: number, time: number): void {
    if (cell.mood !== 'muzak') {
      return;
    }
    const third = cell.major ? 4 : 3;
    const triad = [0, third, 7, 12];
    const offset = triad[stepInBar % triad.length];
    const frequency = ROOT_HZ * Math.pow(2, (cell.root + 12 + offset) / 12);

    this.pluck(frequency, time, 'triangle', 0.1);
  }

  /** Drums: a light brush kit in the muzak; a busy near-double-kick drive in combat; a heavier
   *  syncopated breakdown in chaos, with a snare roll filling the final bar into the loop. */
  private drumHit(mood: Mood, bar: number, stepInBar: number, time: number): void {
    if (mood === 'muzak') {
      if (stepInBar === 0) {
        this.kick(time);
      }
      if (stepInBar === 8) {
        this.noise(time, 0.1, 'highpass', 1200, 700, 0.16); // light brush on beat 3
      }
      if (MUZAK_HAT_STEPS.has(stepInBar)) {
        this.noise(time, 0.025, 'highpass', 8000, 9000, 0.07);
      }

      return;
    }
    if (mood === 'chaos' && bar === SONG.length - 1 && stepInBar >= 8 && stepInBar % 2 === 0) {
      this.noise(time, 0.09, 'highpass', 1400, 800, 0.3); // snare roll fill into the loop

      return;
    }
    if ((mood === 'chaos' ? CHAOS_KICK_STEPS : COMBAT_KICK_STEPS).has(stepInBar)) {
      this.kick(time);
    }
    if (SNARE_STEPS.has(stepInBar)) {
      this.noise(time, 0.13, 'highpass', 1200, 700, 0.34);
    }
    if (COMBAT_HAT_STEPS.has(stepInBar)) {
      this.noise(time, 0.03, 'highpass', 8000, 9000, 0.11);
    }
  }

  /** A sawtooth power-chord (root + fifth) palm-mute chug — the DOOM combat bass voice. */
  private chug(root: number, time: number, peak: number): void {
    for (const interval of [0, 7]) {
      this.voice({
        type: 'sawtooth',
        frequency: ROOT_HZ * Math.pow(2, (root + interval) / 12),
        time,
        peak: interval === 0 ? peak : peak * 0.7,
        attack: 0.002,
        decay: 0.03,
        sustain: 0.4,
        hold: 0.02,
        release: 0.05,
      });
    }
  }

  /** A rising band-passed noise whoosh — sweeps the chaos breakdown back up into the muzak loop. */
  private riser(time: number): void {
    this.noise(time, STEP_SECONDS * 8, 'bandpass', 400, 6000, 0.16);
  }

  /**
   * A warm ADSR voice through the shared lowpass: linear attack → exponential decay to a held
   * sustain → exponential release. With `detune` it adds a second oscillator at the opposite
   * cents offset (sharing one gain) for a thick, chorused lead. Degrades to silence with no context.
   */
  private voice(parameters: {
    type: OscillatorType;
    frequency: number;
    time: number;
    peak: number;
    attack: number;
    decay: number;
    sustain: number;
    hold: number;
    release: number;
    detune?: number;
  }): void {
    if (!this.audioContext || !this.filter) {
      return;
    }
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = parameters.type;
    oscillator.frequency.setValueAtTime(parameters.frequency, parameters.time);
    let detuned: OscillatorNode | null = null;

    if (parameters.detune) {
      oscillator.detune.setValueAtTime(parameters.detune, parameters.time);
      detuned = this.audioContext.createOscillator();
      detuned.type = parameters.type;
      detuned.frequency.setValueAtTime(parameters.frequency, parameters.time);
      detuned.detune.setValueAtTime(-parameters.detune, parameters.time);
    }
    const peak = Math.max(0.0001, parameters.peak);
    const sustainLevel = Math.max(0.0001, peak * parameters.sustain);
    const decayEnd = parameters.time + parameters.attack + parameters.decay;
    const holdEnd = decayEnd + parameters.hold;
    const end = holdEnd + parameters.release;

    gainNode.gain.setValueAtTime(0.0001, parameters.time);
    gainNode.gain.linearRampToValueAtTime(peak, parameters.time + parameters.attack);
    gainNode.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
    gainNode.gain.setValueAtTime(sustainLevel, holdEnd);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gainNode).connect(this.filter);
    oscillator.start(parameters.time);
    oscillator.stop(end + 0.02);

    if (detuned) {
      detuned.connect(gainNode);
      detuned.start(parameters.time);
      detuned.stop(end + 0.02);
    }
  }

  /** A short plucked note through the shared lowpass — a fast attack then exponential decay. */
  private pluck(
    frequency: number,
    time: number,
    type: OscillatorType = 'sawtooth',
    peak = 0.3,
  ): void {
    if (!this.audioContext || !this.filter) {
      return;
    }
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0.0001, time);
    gainNode.gain.exponentialRampToValueAtTime(peak, time + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    oscillator.connect(gainNode).connect(this.filter);
    oscillator.start(time);
    oscillator.stop(time + 0.1);
  }

  /** A pitch-dropping sine thump on the beat, straight to the master (un-filtered). */
  private kick(time: number): void {
    if (!this.audioContext || !this.master) {
      return;
    }
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(140, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gainNode.gain.setValueAtTime(0.7, time);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    oscillator.connect(gainNode).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + 0.16);
  }

  /** A short pitched blip through the master: a start→end pitch sweep with a fast attack/decay.
   *  Degrades to silence (like the other SFX) when the audio context is absent. */
  private blip(
    type: OscillatorType,
    startHz: number,
    endHz: number,
    peak: number,
    duration: number,
    startTime?: number,
  ): void {
    if (!this.audioContext || !this.master) {
      return;
    }
    const now = startTime ?? this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), now + duration);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gainNode).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  /** The kill's percussive tail — a decaying low-passed white-noise burst at the current time. */
  private noiseBurst(duration: number, fromHz: number, toHz: number, peak: number): void {
    if (!this.audioContext) {
      return;
    }
    this.noise(this.audioContext.currentTime, duration, 'lowpass', fromHz, toHz, peak);
  }

  /**
   * A scheduled, filtered white-noise burst through the master — the shared engine behind the
   * kill tail (low-passed) and the drum snare/hat (high-passed). Decaying gain + buffer envelope.
   */
  private noise(
    time: number,
    duration: number,
    filterType: BiquadFilterType,
    fromHz: number,
    toHz: number,
    peak: number,
  ): void {
    if (!this.audioContext || !this.master) {
      return;
    }
    const buffer = this.audioContext.createBuffer(
      1,
      Math.ceil(this.audioContext.sampleRate * duration),
      this.audioContext.sampleRate,
    );
    const data = buffer.getChannelData(0);

    for (let sampleIndex = 0; sampleIndex < data.length; sampleIndex++) {
      data[sampleIndex] =
        (deterministicNoise(sampleIndex) * 2 - 1) * (1 - sampleIndex / data.length);
    }
    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    const shaper = this.audioContext.createBiquadFilter();

    source.buffer = buffer;
    shaper.type = filterType;
    shaper.frequency.setValueAtTime(fromHz, time);
    shaper.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), time + duration);
    gainNode.gain.setValueAtTime(peak, time);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(shaper).connect(gainNode).connect(this.master);
    source.start(time);
  }
}

/** Deterministic 0..1 hash for the gunshot noise (no `Math.random` — keeps the burst reproducible). */
function deterministicNoise(sampleIndex: number): number {
  const value = Math.sin(sampleIndex * 12.9898) * 43758.5453;

  return value - Math.floor(value);
}
