/** One real client/peer recommendation (republished verbatim from its public source). */
export interface Review {
  who: string;
  /** Role + company, as stated by the author (e.g. "DSI chez Giraudy"). */
  role: string;
  body: string;
  /** Avatar accent for the initial-letter disc. */
  color: string;
}
