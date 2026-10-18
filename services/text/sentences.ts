/**
 * Split text into sentences. A sentence ends at . ! or ? followed by
 * whitespace, so decimals (3.6), placeholders ({AAPL.pct_1m}), and "vs."
 * stay intact.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])(?<!\bvs\.)(?<!\be\.g\.)(?<!\bi\.e\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
