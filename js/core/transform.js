// Validity-preserving board symmetries: relabel digits, permute rows within bands,
// bands, columns within stacks, stacks, and optionally transpose. They preserve
// which techniques are available at every position, so a drill stays a drill.
import { shuffle } from "./geo.js";
import { parsePuzzle } from "./board.js";

export function randomTransform(rand = Math.random) {
  const perm = (n) => shuffle(Array.from({ length: n }, (_, i) => i), rand);
  const lines = () => {
    const out = [];
    for (const b of perm(3)) for (const i of perm(3)) out.push(b * 3 + i);
    return out; // new index -> old index
  };
  const digits = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand)]; // old digit -> new digit
  return { rows: lines(), cols: lines(), transpose: rand() < 0.5, digits };
}

/** Old cell index that lands on new cell `i`. */
function source(t, i) {
  let r = Math.floor(i / 9), c = i % 9;
  if (t.transpose) [r, c] = [c, r];
  return t.rows[r] * 9 + t.cols[c];
}

export function transformValues(values, t) {
  return values.map((_, i) => t.digits[values[source(t, i)]] ?? 0);
}

export function transformMask(m, t) {
  let out = 0;
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) out |= 1 << t.digits[d];
  return out;
}

const str = (vals) => vals.map((v) => (v ? String(v) : ".")).join("");

export function transformPuzzleString(s, t) {
  const v = parsePuzzle(s);
  return v ? str(transformValues(v, t)) : null;
}

/** Transforms a graded puzzle record; the technique labels carry over unchanged. */
export function transformPuzzle(p, t) {
  return { ...p, puzzle: transformPuzzleString(p.puzzle, t), solution: transformPuzzleString(p.solution, t) };
}

export function transformDrill(d, t) {
  const masks = [];
  for (let i = 0; i < 81; i++) masks.push(parseInt(d.candidates.slice(i * 3, i * 3 + 3), 16));
  const newMasks = Array.from({ length: 81 }, (_, i) => transformMask(masks[source(t, i)], t));
  return {
    ...d,
    values: transformPuzzleString(d.values, t),
    solution: transformPuzzleString(d.solution, t),
    candidates: newMasks.map((m) => m.toString(16).padStart(3, "0")).join(""),
  };
}
