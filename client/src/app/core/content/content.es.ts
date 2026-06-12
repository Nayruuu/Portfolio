import type { Content } from '../../domain';
import type { JsonContent } from './json-content';
import data from './content.es.json';

/** ES content — AI-generated from FR (`make i18n`), typed `Content` (validated against the source shape). */
export const ES = data satisfies JsonContent as Content;
