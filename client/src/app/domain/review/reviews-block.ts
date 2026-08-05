import { Review } from './review';

/** The home "recommandations" section — real, attributed, source-linked reviews. */
export interface ReviewsBlock {
  subtitle: string;
  /** Collapsed one-liner ("Adrien, Marc et Nicolas recommandent Stéphane"). */
  teaser: string;
  source: string;
  url: string;
  linkLabel: string;
  items: Review[];
}
