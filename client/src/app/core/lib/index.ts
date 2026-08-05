// core/lib — pure functions & shared constants. One declaration per file; this barrel is the surface.
export * from './constants';
export * from './markdown';
export * from './select-articles';
export * from './tokenize';
export * from './lang-label';
export * from './reveal';
export * from './typed';
export * from './format-time';
export * from './series-map';
export * from './series-idx-for-article';
export * from './article-idxs-for-series';
export * from './series-total-read';
export * from './site';
export * from './projects';
export * from './abs-url';
export * from './lang-path';
export * from './article-description';
export * from './typing-schedule';
export * from './focused-index';
export * from './tab-segments';
export * from './truncate-at-word';
export * from './og-image';
export * from './format-article-date';
// `./game` is deliberately NOT re-exported: the engine is only ever imported via its own
// subpath (`core/lib/game`, lazy routes/workers) — re-exporting it here drags the whole
// engine graph into the initial bundle through every eager barrel consumer.
