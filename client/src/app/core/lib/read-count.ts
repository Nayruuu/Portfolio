/**
 * Parse a localized reads label ("2,4k lectures", "892 lectures", "1,2M reads") to a comparable
 * count, honouring the k/M magnitude suffix — so "2,4k" (2400) correctly outranks "892".
 */
export function readCount(reads: string): number {
  const parsedReads = parseFloat(reads.replace(',', '.'));

  if (/m/i.test(reads)) {
    return parsedReads * 1_000_000;
  }
  if (/k/i.test(reads)) {
    return parsedReads * 1_000;
  }

  return parsedReads;
}
