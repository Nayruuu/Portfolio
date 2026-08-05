import { describe, expect, it } from 'vitest';
import { articleOgImage } from './og-image';

describe('articleOgImage', () => {
  it('builds the per-article, per-locale card URL', () => {
    expect(articleOgImage('moteur-doom-software-webgpu', 'de')).toBe(
      'https://super-dev.app/og/moteur-doom-software-webgpu.de.jpg',
    );
  });
});
