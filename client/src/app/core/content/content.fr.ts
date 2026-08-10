import type { Content } from '../../domain';
import type { JsonContent } from './json-content';
import data from './content.fr.json';

/** FR content (source of truth) — lives in `content.fr.json`, typed `Content`. */
export const FR = data satisfies JsonContent as Content;
