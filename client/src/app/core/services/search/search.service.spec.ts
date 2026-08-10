import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SearchService } from './search.service';

describe('SearchService', () => {
  it('starts with an empty query', () => {
    expect(TestBed.inject(SearchService).query()).toBe('');
  });

  it('exposes the query as a writable signal', () => {
    const service = TestBed.inject(SearchService);

    service.query.set('angular');

    expect(service.query()).toBe('angular');
  });
});
