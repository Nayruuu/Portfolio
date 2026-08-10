import { Injectable, signal } from '@angular/core';

/**
 * Cross-component channel search query: written by the command palette's "see all results" action,
 * read by the articles grid (which filters its cards live). A plain signal service — local UI state,
 * no store needed.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  public readonly query = signal('');
}
