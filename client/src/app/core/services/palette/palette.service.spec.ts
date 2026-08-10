import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PaletteService } from './palette.service';

describe('PaletteService', () => {
  let service: PaletteService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PaletteService);
  });

  it('starts closed', () => {
    expect(service.open()).toBe(false);
  });

  it('show() opens it', () => {
    service.show();
    expect(service.open()).toBe(true);
  });

  it('close() closes it', () => {
    service.show();
    service.close();
    expect(service.open()).toBe(false);
  });

  it('toggle() flips both ways', () => {
    service.toggle();
    expect(service.open()).toBe(true);

    service.toggle();
    expect(service.open()).toBe(false);
  });
});
