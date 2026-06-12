import type { Content } from '../../domain';
import type { JsonContent } from './json-content';
import data from './content.en.json';

/** EN content — lives in `content.en.json`, typed `Content` (validated against the source shape). */
export const EN = data satisfies JsonContent as Content;
