/** Supported UI languages — value set + derived type (single source of truth). */
export const LANG = { FR: 'fr', EN: 'en' } as const;

export type Lang = (typeof LANG)[keyof typeof LANG];
