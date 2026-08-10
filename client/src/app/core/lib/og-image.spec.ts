import { describe, expect, it } from 'vitest';
import { articleOgImage } from './og-image';

describe('articleOgImage', () => {
  it('builds the per-article, per-locale card URL', () => {
    expect(articleOgImage('moteur-doom-software-webgpu', 'en')).toBe(
      'https://super-dev.app/og/moteur-doom-software-webgpu.en.jpg',
    );
  });
});
