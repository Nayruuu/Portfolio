export interface Series {
  /** URL slug — kebab-case, ASCII, identical FR/EN. */
  slug: string;
  title: string;
  description: string;
  colors: string[];
  symbol: string;
}
