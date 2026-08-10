export interface Series {
  /** URL slug — kebab-case, ASCII, identical across locales. */
  slug: string;
  title: string;
  description: string;
  colors: string[];
  symbol: string;
}
