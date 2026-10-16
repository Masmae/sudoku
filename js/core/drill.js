import { SolveState } from "./state.js";
import { parsePuzzle, puzzleString } from "./board.js";
import { bruteSolve } from "./brute.js";
import { nextStep, allSteps } from "./solver.js";
import { randomPuzzle } from "./generator.js";
import { has, ck } from "./geo.js";

export const drillState = (d) => SolveState.fromStrings(d.values, d.candidates);

/** The target technique must be the easiest move, and every instance must agree with the solution. */
export function isValidDrill(d) {
  const s = drillState(d);
  const sol = parsePuzzle(d.solution);
  if (!s || !sol || !s.isConsistent) return false;
  const brute = bruteSolve(s.values);
  if (!brute.solution || brute.solution.join("") !== sol.join("")) return false;
  for (let c = 0; c < 81; c++) if (s.values[c] === 0 && !has(s.cands[c], sol[c])) return false;
  const st = nextStep(s);
  if (!st || st.technique !== d.technique) return false;
  return allSteps(d.technique, s).every((x) =>
    x.eliminations.every((e) => sol[e.cell] !== e.digit) && x.placements.every((p) => sol[p.cell] === p.digit));
}

export function drillsFromPath(values, technique, max = 1) {
  const sol = bruteSolve(values).solution;
  if (!sol) return [];
  const s = new SolveState(values);
  const out = [];
  while (!s.isSolved && out.length < max) {
    const st = nextStep(s);
    if (!st) break;
    if (st.technique === technique) {
      out.push({ technique, values: puzzleString(s.values), candidates: s.candidateString, solution: puzzleString(sol) });
      break;
    }
    s.apply(st);
  }
  return out;
}

export function findDrills(technique, count, rand = Math.random, maxPuzzles = 3000) {
  const out = [];
  for (let i = 0; i < maxPuzzles && out.length < count; i++) {
    for (const d of drillsFromPath(randomPuzzle(rand), technique, 1)) if (isValidDrill(d)) out.push(d);
  }
  return out;
}

/** Judge the player's marks. Accepts any instance of the technique, not just ours. */
export function judgeDrill(d, elimKeys, placeKeys) {
  const s = drillState(d);
  if (!s) return { kind: "empty" };
  if (!elimKeys.size && !placeKeys.size) return { kind: "empty" };
  const steps = allSteps(d.technique, s);
  const validE = new Set(steps.flatMap((x) => x.eliminations.map((e) => ck(e.cell, e.digit))));
  const validP = new Set(steps.flatMap((x) => x.placements.map((p) => ck(p.cell, p.digit))));
  const wrong = [...elimKeys].filter((k) => !validE.has(k)).concat([...placeKeys].filter((k) => !validP.has(k)));
  if (wrong.length) return { kind: "wrong", keys: wrong.sort((a, b) => a - b) };
  const chosen = new Set([...elimKeys, ...placeKeys]);
  for (const x of steps) {
    if (x.eliminations.every((e) => elimKeys.has(ck(e.cell, e.digit))) &&
        x.placements.every((p) => placeKeys.has(ck(p.cell, p.digit)))) return { kind: "correct" };
  }
  let best = { found: 0, of: 0 };
  for (const x of steps) {
    const keys = [...x.eliminations, ...x.placements].map((c) => ck(c.cell, c.digit));
    const f = keys.filter((k) => chosen.has(k)).length;
    if (f > best.found || best.of === 0) best = { found: f, of: keys.length };
  }
  return { kind: "partial", ...best };
}
