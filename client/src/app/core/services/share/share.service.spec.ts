import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ShareService } from './share.service';

type MutableNavigator = {
  share?: (data: { url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(() => {
    service = TestBed.inject(ShareService);
  });

  afterEach(() => {
    (navigator as unknown as MutableNavigator).share = undefined;
  });

  const target = { title: 'Titre', text: 'Extrait', url: 'https://super-dev.app/fr/articles/x' };

  it('uses the native share sheet with the target and reports "shared"', async () => {
    const calls: Array<{ url?: string }> = [];

    (navigator as unknown as MutableNavigator).share = (data) => {
      calls.push(data);

      return Promise.resolve();
    };

    const outcome = await service.share(target);

    expect(outcome).toBe('shared');
    expect(calls).toEqual([target]);
  });

  it('swallows a cancelled native share and still reports "shared"', async () => {
    (navigator as unknown as MutableNavigator).share = () => Promise.reject(new Error('cancelled'));

    await expect(service.share(target)).resolves.toBe('shared');
  });

  it('copies the URL and reports "copied" when the native sheet is unavailable', async () => {
    (navigator as unknown as MutableNavigator).share = undefined;
    let copied = '';

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied = text;

          return Promise.resolve();
        },
      },
    });

    const outcome = await service.share(target);

    expect(outcome).toBe('copied');
    expect(copied).toBe(target.url);
  });
});
