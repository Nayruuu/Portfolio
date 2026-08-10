/**
 * jsdom omits the scroll + IntersectionObserver APIs the article reading view relies on
 * (scroll-spy, smooth-scroll to a heading). Without these, mounting the component throws in
 * `afterNextRender` or logs "Not implemented". Stub them here — the behaviours themselves are
 * exercised by the Playwright E2E suite, which runs in a real browser.
 */
const noop = (): void => undefined;

class IntersectionObserverStub {
  public readonly observe = noop;
  public readonly unobserve = noop;
  public readonly disconnect = noop;
  public readonly takeRecords = (): IntersectionObserverEntry[] => [];
}

globalThis.IntersectionObserver ??=
  IntersectionObserverStub as unknown as typeof IntersectionObserver;
window.scrollTo = noop as typeof window.scrollTo;
Element.prototype.scrollIntoView = noop as typeof Element.prototype.scrollIntoView;
