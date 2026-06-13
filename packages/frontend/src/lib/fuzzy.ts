// Tiny dependency-free fuzzy matcher used by the tag search autocomplete.
//
// fuzzyScore returns a relevance score for a query against a target, or null
// when the query is not a subsequence of the target (i.e. no match). Higher is
// better. Scoring rewards, in rough order of weight: exact match, prefix match,
// substring match, matches at word boundaries (start / after - _ : space), and
// runs of consecutive characters. Shorter targets win ties.

const BOUNDARY = new Set([" ", "_", "-", ":", "/", "."]);

/** Relevance of `query` within `target`, or null when not a subsequence. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (q.length > t.length) return null;

  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  let run = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let charScore = 1;
    if (ti === 0 || BOUNDARY.has(t[ti - 1])) charScore += 3; // word boundary
    if (prevMatch === ti - 1) {
      run += 1;
      charScore += run * 2; // consecutive run
    } else {
      run = 0;
    }
    score += charScore;
    prevMatch = ti;
    qi += 1;
  }

  if (qi < q.length) return null; // query not fully matched -> no match

  if (t === q) score += 100;
  else if (t.startsWith(q)) score += 30;
  else if (t.includes(q)) score += 15;

  score -= t.length * 0.1; // prefer shorter targets on ties
  return score;
}

/**
 * Rank `items` by fuzzy relevance of `query` against `getText(item)`, dropping
 * non-matches. Returns at most `limit` items, best first. Ties keep input order
 * (stable), so callers can pre-sort the source (e.g. by count) for empty / weak
 * queries.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  limit = 8,
): T[] {
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const score = fuzzyScore(query, getText(item));
    if (score !== null) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
