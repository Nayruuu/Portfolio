import { SITE_ORIGIN } from './site';

/** Absolute URL for an app path (must start with '/'). */
export function absUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}
