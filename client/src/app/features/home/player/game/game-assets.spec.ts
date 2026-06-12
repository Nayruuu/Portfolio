import { describe, it, expect } from 'vitest';
import { criticalAssetUrls, deferredAssetUrls, gameAssetUrls } from './game-assets';

describe('gameAssetUrls', () => {
  it('aggregates every served game image across the bridges, deduped, all under /game/', () => {
    const urls = gameAssetUrls();

    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length); // deduped (the bridges can name the same file)
    expect(urls.every((url) => url.startsWith('/game/'))).toBe(true);
    expect(urls.every((url) => url.length > 0)).toBe(true); // no empty (un-arted) entries
  });

  it('is exactly the union of the critical + deferred sets', () => {
    expect(new Set(gameAssetUrls())).toEqual(
      new Set([...criticalAssetUrls(), ...deferredAssetUrls()]),
    );
  });
});

describe('criticalAssetUrls — the immediately-visible set (gates the loop start)', () => {
  it('holds the world, the foes, the HUD and the starting weapon, deduped, all under /game/', () => {
    const urls = criticalAssetUrls();

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith('/game/'))).toBe(true);
    expect(urls.some((url) => url.startsWith('/game/textures/'))).toBe(true); // env textures
    expect(urls.some((url) => url.startsWith('/game/enemies/pinky/'))).toBe(true); // directional foe atlases
    expect(urls.some((url) => url.startsWith('/game/hud/'))).toBe(true); // tiered HUD art
    expect(urls.some((url) => url.startsWith('/game/weapons/'))).toBe(true); // the starting weapon's strips
  });

  it('excludes action-only art (door anim, climb hands) — that streams in later', () => {
    const urls = criticalAssetUrls();

    expect(urls).not.toContain('/game/textures/door_open_strip.webp');
    expect(urls).not.toContain('/game/hands/climb/0.webp');
  });
});

describe('deferredAssetUrls — the action-triggered set (streams behind the first frame)', () => {
  it('holds the door anim, climb hands and effects, all under /game/', () => {
    const urls = deferredAssetUrls();

    expect(urls).toContain('/game/textures/door_open_strip.webp'); // only at a door
    expect(urls).toContain('/game/hands/climb/0.webp'); // only mid-climb
    expect(urls.some((url) => url.startsWith('/game/weapons/effects/'))).toBe(true); // first thrown report / first hit
    expect(urls.every((url) => url.startsWith('/game/'))).toBe(true);
  });

  it('never double-loads — it shares no URL with the critical set', () => {
    const critical = new Set(criticalAssetUrls());

    expect(deferredAssetUrls().some((url) => critical.has(url))).toBe(false);
  });
});
