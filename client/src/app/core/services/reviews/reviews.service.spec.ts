import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReviewsService } from './reviews.service';

const KEY = 'super-dev-reviews';

describe('ReviewsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('starts empty when nothing is stored', () => {
    expect(TestBed.inject(ReviewsService).posted()).toEqual([]);
  });

  it('readInitial: restores a valid stored array', () => {
    localStorage.setItem(KEY, JSON.stringify(['great work', 'solid Angular']));
    expect(TestBed.inject(ReviewsService).posted()).toEqual(['great work', 'solid Angular']);
  });

  it('readInitial: ignores a non-array payload', () => {
    localStorage.setItem(KEY, JSON.stringify({ nope: true }));
    expect(TestBed.inject(ReviewsService).posted()).toEqual([]);
  });

  it('readInitial: ignores an array holding non-strings', () => {
    localStorage.setItem(KEY, JSON.stringify(['ok', 42]));
    expect(TestBed.inject(ReviewsService).posted()).toEqual([]);
  });

  it('readInitial: falls back to empty if localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage indisponible');
    });

    expect(TestBed.inject(ReviewsService).posted()).toEqual([]);
    spy.mockRestore();
  });

  it('add prepends the newest review and persists it', () => {
    const service = TestBed.inject(ReviewsService);

    service.add('first');
    service.add('second');

    expect(service.posted()).toEqual(['second', 'first']);
    TestBed.inject(ApplicationRef).tick();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['second', 'first']);
  });

  it('swallows a persistence failure (private mode)', () => {
    const service = TestBed.inject(ReviewsService);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage indisponible');
    });

    service.add('still works');

    expect(() => TestBed.inject(ApplicationRef).tick()).not.toThrow();
    expect(service.posted()).toEqual(['still works']);
    spy.mockRestore();
  });
});
