import { ROW, COL, BOX, ALL, popcount, digitsOf, shuffle } from "./geo.js";
import { hasNoConflicts } from "./board.js";

/** Backtracking solver for uniqueness checks and generation (never for hints). */
export function bruteSolve(values, limit = 2, rand = null) {
  if (!values || values.length !== 81 || !hasNoConflicts(values)) return { count: 0, solution: null };
  const v = values.slice();
  const rowM = new Array(9).fill(0), colM = new Array(9).fill(0), boxM = new Array(9).fill(0);
  for (let c = 0; c < 81; c++) if (v[c]) {
    const b = 1 << v[c];
    rowM[ROW[c]] |= b; colM[COL[c]] |= b; boxM[BOX[c]] |= b;
  }
  let count = 0, first = null;
  function search() {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let c = 0; c < 81; c++) {
      if (v[c]) continue;
      const m = ALL & ~(rowM[ROW[c]] | colM[COL[c]] | boxM[BOX[c]]);
      const n = popcount(m);
      if (n < bestCount) { best = c; bestMask = m; bestCount = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; if (!first) first = v.slice(); return; }
    if (bestCount === 0) return;
    let ds = digitsOf(bestMask);
    if (rand) shuffle(ds, rand);
    const r = ROW[best], c = COL[best], b = BOX[best];
    for (const d of ds) {
      const bt = 1 << d;
      v[best] = d; rowM[r] |= bt; colM[c] |= bt; boxM[b] |= bt;
      search();
      rowM[r] &= ~bt; colM[c] &= ~bt; boxM[b] &= ~bt; v[best] = 0;
      if (count >= limit) return;
    }
  }
  search();
  return { count, solution: first };
}

export const hasUniqueSolution = (values) => bruteSolve(values, 2).count === 1;

export function randomSolution(rand = Math.random) {
  return bruteSolve(new Array(81).fill(0), 1, rand).solution;
}
