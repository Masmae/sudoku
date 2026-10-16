import { TECHNIQUES, T } from "./technique.js";
import { FINDERS } from "./techniques.js";
import { SolveState } from "./state.js";
import { parsePuzzle, puzzleString, hasNoConflicts } from "./board.js";
import { bruteSolve } from "./brute.js";
import { ck, cellName, cellNames } from "./geo.js";

export function firstStep(id, s) {
  for (const st of FINDERS[id](s)) return st;
  return null;
}

export function allSteps(id, s, limit = 200) {
  const out = [];
  for (const st of FINDERS[id](s)) { out.push(st); if (out.length >= limit) break; }
  return out;
}

/** Easiest technique that makes progress. */
export function nextStep(s, maxRank = Infinity) {
  for (const t of TECHNIQUES) {
    if (t.rank > maxRank) break;
    const st = firstStep(t.id, s);
    if (st) return st;
  }
  return null;
}

export function logicalSolve(values, maxSteps = 600) {
  const s = new SolveState(values);
  const steps = [];
  while (!s.isSolved && steps.length < maxSteps) {
    const st = nextStep(s);
    if (!st) break;
    s.apply(st);
    steps.push(st);
    if (!s.isConsistent) break;
  }
  return { steps, solved: s.isSolved, final: s };
}

/**
 * Verifies and grades a puzzle locally. Returns null if malformed, not unique,
 * or beyond the techniques the app can hint. Same output shape as the Swift GradedPuzzle.
 */
export function gradePuzzle(puzzle) {
  const values = parsePuzzle(puzzle);
  if (!values || values.filter((v) => v).length < 17 || !hasNoConflicts(values)) return null;
  const brute = bruteSolve(values, 2);
  if (brute.count !== 1) return null;
  const r = logicalSolve(values);
  if (!r.solved || r.final.values.join("") !== brute.solution.join("")) return null;
  const used = new Set(r.steps.map((s) => s.technique));
  const hardestUsed = r.steps.length ? r.steps.reduce((h, s) => (T[s.technique].rank > T[h].rank ? s.technique : h), r.steps[0].technique) : "hiddenSingle";
  return {
    puzzle: puzzleString(values),
    solution: puzzleString(brute.solution),
    difficulty: T[hardestUsed].difficulty,
    hardest: hardestUsed,
    techniques: TECHNIQUES.filter((t) => used.has(t.id)).map((t) => t.id),
  };
}

export const nudge = (st) => {
  const name = T[st.technique].name;
  if (["fullHouse", "hiddenSingle", "nakedSingle"].includes(st.technique)) {
    return st.units.length ? `Look for a ${name} in ${unitNameOf(st.units[0])}.` : `Look for a ${name}.`;
  }
  const ds = [...st.digits].sort((a, b) => a - b).join(", ");
  return ds ? `Look for a ${name} on ${st.digits.length > 1 ? "digits" : "digit"} ${ds}.` : `Look for a ${name}.`;
};

import { unitName as unitNameOf } from "./geo.js";

export function resultText(st) {
  const parts = [];
  if (st.placements.length) parts.push("Place " + st.placements.map((p) => `${p.digit} in ${cellName(p.cell)}`).join(", "));
  if (st.eliminations.length) {
    const byDigit = new Map();
    for (const e of st.eliminations) { if (!byDigit.has(e.digit)) byDigit.set(e.digit, []); byDigit.get(e.digit).push(e.cell); }
    parts.push("Remove " + [...byDigit.entries()].sort((a, b) => a[0] - b[0])
      .map(([d, cs]) => `${d} from ${cellNames(cs.sort((a, b) => a - b))}`).join("; "));
  }
  return parts.join(". ") + ".";
}

export const candidateKeys = (cs) => new Set(cs.map((c) => ck(c.cell, c.digit)));
