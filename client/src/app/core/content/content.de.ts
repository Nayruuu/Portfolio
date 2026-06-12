import type { Content } from '../../domain';
import type { JsonContent } from './json-content';
import data from './content.de.json';

/** DE content — AI-generated from FR (`make i18n`), typed `Content` (validated against the source shape). */
export const DE = data satisfies JsonContent as Content;
