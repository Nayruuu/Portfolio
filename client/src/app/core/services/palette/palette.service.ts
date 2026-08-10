import { Injectable, signal } from '@angular/core';

/**
 * Open/closed state of the global ⌘K command palette. A plain signal service — one flag, read by
 * the palette component and flipped by its triggers (the nav search box, `⌘K`/`Ctrl+K`, `/`).
 * `open` is the readable state signal; `show`/`close`/`toggle` mutate it.
 */
@Injectable({ providedIn: 'root' })
export class PaletteService {
  public readonly open = signal(false);

  public show(): void {
    this.open.set(true);
  }

  public close(): void {
    this.open.set(false);
  }

  public toggle(): void {
    this.open.update((open) => !open);
  }
}
