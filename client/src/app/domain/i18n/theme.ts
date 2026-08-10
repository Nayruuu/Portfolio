/** Supported UI themes — value set + derived type (single source of truth). */
export const THEME = { LIGHT: 'light', DARK: 'dark' } as const;

export type Theme = (typeof THEME)[keyof typeof THEME];
