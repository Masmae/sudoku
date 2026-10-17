// Solver, logical (hint) engine, grader and generator for variant puzzles.
import { ALL, bit, has, popcount, digitsOf, firstDigit, cand, cellName, cellNames, shuffle, UNITS } from "./geo.js";
import { parsePuzzle, puzzleString } from "./board.js";
import { SolveState } from "./state.js";
import { TECHNIQUES, T, makeStep } from "./technique.js";
import { FINDERS } from "./techniques.js";
import { compile, rulesFor, makeFeatures, mergeFeatures, canCombine, groupOk, groupText, pairOk, pairText, satisfies } from "./variants.js";

// ---------------------------------------------------------------- brute force (uniqueness + generation)

/** Counts solutions up to `limit`. `cm` is a compiled model. */
export function variantSolve(cm, values, limit = 2, rand = null, nodeLimit = 2_000_000) {
  const v = values.slice();
  let count = 0, first = null, nodes = 0;
  // Reject givens that already break a rule.
  for (let c = 0; c < 81; c++) if (v[c] && !okAt(cm, v, c)) return { count: 0, solution: null };
  function okAt(cm, v, c) {
    const d = v[c];
    if (!(cm.cellMask[c] & bit(d))) return false;
    for (const p of cm.peers[c]) if (v[p] === d) return false;
    for (const p of cm.pairsOf[c]) { const a = v[p.a], b = v[p.b]; if (a && b && !pairOk(p, a, b)) return false; }
    for (const g of cm.groupsOf[c]) if (!groupOk(g, g.cells.map((x) => v[x]))) return false;
    return true;
  }
  function search() {
    if (++nodes > nodeLimit) return;
    let best = -1, bestMask = 0, bestN = 10;
    for (let c = 0; c < 81; c++) {
      if (v[c]) continue;
      let m = cm.cellMask[c];
      for (const p of cm.peers[c]) if (v[p]) m &= ~bit(v[p]);
      const n = popcount(m);
      if (n < bestN) { best = c; bestMask = m; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; if (!first) first = v.slice(); return; }
    if (bestN === 0) return;
    const ds = digitsOf(bestMask);
    if (rand) shuffle(ds, rand);
    for (const d of ds) {
      v[best] = d;
      if (okAt(cm, v, best)) search();
      v[best] = 0;
      if (count >= limit || nodes > nodeLimit) return;
    }
  }
  search();
  return { count: nodes > nodeLimit ? -1 : count, solution: first };
}

// ---------------------------------------------------------------- logical state

/** SolveState whose candidates and placements respect the variant's extra peers and shading. */
export class VariantState extends SolveState {
  constructor(cm, values, cands = null) {
    super(values, cands ?? values.map((v, c) => {
      if (v) return 0;
      let m = cm.cellMask[c];
      for (const p of cm.peers[c]) if (values[p]) m &= ~bit(values[p]);
      return m;
    }));
    this.cm = cm;
  }
  clone() { return new VariantState(this.cm, this.values, this.cands); }
  place(c, d) {
    super.place(c, d);
    for (const p of this.cm.peers[c]) this.cands[p] &= ~bit(d);
  }
}

/** Candidates for display / "fill notes" in a variant game. */
export function variantCandidates(cm, values, notes = null) {
  const s = new VariantState(cm, values);
  if (notes) for (let c = 0; c < 81; c++) if (!values[c] && notes[c] && (s.cands[c] & notes[c])) s.cands[c] &= notes[c];
  return s;
}

// ---------------------------------------------------------------- variant-specific steps

/** Hidden singles / full houses in the extra regions (diagonals, windows). */
function extraUnitSingle(s) {
  for (const [k, unit] of s.cm.extraUnits.entries()) {
    const label = s.cm.features.rules?.diagonal && k < 2 ? (k === 0 ? "the main diagonal" : "the anti-diagonal") : "this window";
    for (let d = 1; d <= 9; d++) {
      if (unit.some((c) => s.values[c] === d)) continue;
      const cs = unit.filter((c) => has(s.cands[c], d));
      if (cs.length !== 1) continue;
      const st = makeStep("hiddenSingle");
      st.placements = [cand(cs[0], d)]; st.digits = [d]; st.cells = unit.slice(); st.keyCandidates = [cand(cs[0], d)];
      st.explanation = `In ${label}, ${d} can only go in ${cellName(cs[0])}.`;
      return st;
    }
  }
  return null;
}

/** Arc consistency on one pair relation. */
function pairStep(s, p) {
  const sees = s.cm.peerSet[p.a].has(p.b);
  const elims = [];
  const support = (x, y, xIsA) => digitsOf(s.cands[x]).filter((d) => !digitsOf(s.values[y] ? bit(s.values[y]) : s.cands[y])
    .some((e) => (!sees || e !== d) && (xIsA ? pairOk(p, d, e) : pairOk(p, e, d))));
  if (!s.values[p.a]) for (const d of support(p.a, p.b, true)) elims.push(cand(p.a, d));
  if (!s.values[p.b]) for (const d of support(p.b, p.a, false)) elims.push(cand(p.b, d));
  if (!elims.length) return null;
  const st = makeStep("variantRule");
  st.eliminations = elims; st.cells = [p.a, p.b]; st.digits = [...new Set(elims.map((e) => e.digit))];
  st.keyCandidates = [p.a, p.b].flatMap((c) => digitsOf(s.cands[c]).filter((d) => !elims.some((e) => e.cell === c && e.digit === d)).map((d) => cand(c, d)));
  st.explanation = `${pairText(p)}. ${describeElims(elims)} — nothing in the other cell would work with ${elims.length === 1 ? "it" : "them"}.`;
  return st;
}

/** Arc consistency on a multi-cell rule, by enumerating the ways to fill it. */
function groupStep(s, g, nodeCap = 60000) {
  const cells = g.cells;
  const vals = cells.map((c) => s.values[c]);
  const open = cells.map((c, i) => i).filter((i) => !vals[i]);
  if (!open.length) return null;
  open.sort((x, y) => popcount(s.cands[cells[x]]) - popcount(s.cands[cells[y]]));
  const supported = new Map(open.map((i) => [i, 0]));
  let nodes = 0, aborted = false;
  const rec = (k) => {
    if (aborted) return;
    if (++nodes > nodeCap) { aborted = true; return; }
    if (k === open.length) { for (const i of open) supported.set(i, supported.get(i) | bit(vals[i])); return; }
    const i = open[k];
    for (const d of digitsOf(s.cands[cells[i]])) {
      // Cells of the rule that see each other can't repeat a digit.
      let clash = false;
      for (let j = 0; j < cells.length; j++) if (j !== i && vals[j] === d && s.cm.peerSet[cells[i]].has(cells[j])) { clash = true; break; }
      if (clash) continue;
      vals[i] = d;
      if (groupOk(g, vals)) rec(k + 1);
      vals[i] = 0;
      if (aborted) return;
    }
  };
  rec(0);
  if (aborted) return null;
  const elims = [];
  for (const i of open) for (const d of digitsOf(s.cands[cells[i]] & ~supported.get(i))) elims.push(cand(cells[i], d));
  if (!elims.length) return null;
  const st = makeStep("variantRule");
  st.eliminations = elims; st.cells = cells.slice(); st.digits = [...new Set(elims.map((e) => e.digit))];
  // The shaded cells show the rule; only the eliminations are marked (level 3).
  st.explanation = `${groupText(g)}. ${describeElims(elims)} — no way of filling it works with ${elims.length === 1 ? "that digit" : "those digits"}.`;
  return st;
}

function describeElims(elims) {
  const byCell = new Map();
  for (const e of elims) { if (!byCell.has(e.cell)) byCell.set(e.cell, []); byCell.get(e.cell).push(e.digit); }
  return "So " + [...byCell].map(([c, ds]) => `${cellName(c)} can't be ${ds.sort((a, b) => a - b).join(" or ")}`).join(", ");
}

function variantRuleStep(s) {
  for (const p of s.cm.pairs) { const st = pairStep(s, p); if (st) return st; }
  // Smaller rules first: they are easier to reason about.
  const groups = [...s.cm.groups].sort((a, b) => a.cells.length - b.cells.length);
  for (const g of groups) { const st = groupStep(s, g); if (st) return st; }
  return null;
}

const first = (id, s) => { for (const st of FINDERS[id](s)) return st; return null; };
// Uniqueness techniques assume swapping digits keeps every rule; extra rules can break that.
const CLASSIC_AFTER_SINGLES = TECHNIQUES.filter((t) => t.rank > T.nakedSingle.rank && t.id !== "uniqueRectangle" && t.id !== "bugPlusOne");

/** Singles only (used by autocomplete). */
export function variantSingleStep(s) {
  return first("fullHouse", s) ?? first("hiddenSingle", s) ?? extraUnitSingle(s) ?? first("nakedSingle", s);
}

/** Easiest step in a variant position. */
export function variantNextStep(s) {
  return first("fullHouse", s) ?? first("hiddenSingle", s) ?? extraUnitSingle(s) ?? first("nakedSingle", s)
    ?? variantRuleStep(s)
    ?? CLASSIC_AFTER_SINGLES.reduce((found, t) => found ?? first(t.id, s), null);
}

export function variantLogicalSolve(cm, values, maxSteps = 800) {
  const s = new VariantState(cm, values);
  const steps = [];
  while (!s.isSolved && steps.length < maxSteps) {
    const st = variantNextStep(s);
    if (!st) break;
    s.apply(st);
    steps.push(st);
  }
  return { steps, solved: s.isSolved, final: s };
}

/** Same order as the classic hint engine: mistakes, bad notes, then the easiest step. */
export function variantHint(cm, values, notes, solution) {
  const wrong = [];
  for (let c = 0; c < 81; c++) if (values[c] && values[c] !== solution[c]) wrong.push(c);
  if (wrong.length) return { kind: "mistakes", cells: wrong };
  if (!values.includes(0)) return { kind: "solved" };
  const s = new VariantState(cm, values);
  const bad = [];
  for (let c = 0; c < 81; c++) if (!values[c] && notes[c]) { if (!has(notes[c], solution[c])) bad.push(c); else s.cands[c] &= notes[c]; }
  if (bad.length) return { kind: "badNotes", cells: bad };
  const st = variantNextStep(s);
  return st ? { kind: "step", step: st } : { kind: "stuck" };
}

// ---------------------------------------------------------------- grading + generation

export const VARIANT_LEVELS = [
  { id: 1, title: "Easy" }, { id: 2, title: "Medium" }, { id: 3, title: "Hard" }, { id: 4, title: "Expert" }, { id: 5, title: "Master" },
];

/**
 * Same five levels as classic puzzles: the level is the hardest classic technique the
 * solve path needs (Hard = X-Wing tier, Expert = wings/Swordfish/coloring, Master =
 * chains). A long run of variant-rule steps lifts an otherwise Easy puzzle to Medium.
 */
export function gradeVariant(cm, values) {
  const r = variantLogicalSolve(cm, values);
  if (!r.solved) return null;
  let classic = 1, ruleSteps = 0;
  for (const st of r.steps) {
    if (st.technique === "variantRule") ruleSteps++;
    else classic = Math.max(classic, T[st.technique].difficulty);
  }
  const level = classic === 1 && ruleSteps > 25 ? 2 : classic;
  const used = new Set(r.steps.map((s) => s.technique));
  return { level, steps: r.steps.length, techniques: [...TECHNIQUES, T.variantRule].filter((t) => used.has(t.id)).map((t) => t.id) };
}

/**
 * Generates a variant puzzle at roughly `level` (1-3). Every puzzle has exactly one
 * solution and can be solved by the hint engine.
 */
export function generateVariant(variant, level = 2, rand = Math.random, budgetMs = 6000) {
  const ids = [].concat(variant);
  if (!canCombine(ids)) return null;
  const t0 = Date.now();
  let best = null, gridFailures = 0;
  while (Date.now() - t0 < budgetMs || !best) {
    // A full grid that obeys every grid rule at once (diagonal, anti-knight, ...).
    const rulesModel = compile({ rules: rulesFor(ids) });
    const full = variantSolve(rulesModel, new Array(81).fill(0), 1, rand, 400000).solution;
    if (!full) {
      if (++gridFailures >= 4 || Date.now() - t0 > budgetMs * 2) return best;   // too restrictive a mix
      continue;
    }
    // Each variant contributes its clues, all read off the same grid.
    const features = mergeFeatures(ids.map((id) => makeFeatures(id, full, rand)));
    const cm = compile(features);
    if (!satisfies(cm, full)) continue;   // safety net for the clue generators

    // Remove givens while the solution stays unique.
    const vals = full.slice();
    for (const c of shuffle(Array.from({ length: 81 }, (_, i) => i), rand)) {
      const keep = vals[c];
      vals[c] = 0;
      const r = variantSolve(cm, vals, 2, null, 60000);
      if (r.count !== 1) vals[c] = keep;
      if (Date.now() - t0 > budgetMs * 3) break;
    }
    // Add givens back until the hint engine can solve it, then until it matches the level.
    let grade = gradeVariant(cm, vals);
    let guard = 0;
    while ((!grade || grade.level > level) && guard++ < 81) {
      const s = variantLogicalSolve(cm, vals).final;
      const stuck = vals.map((v, c) => (v ? -1 : c)).filter((c) => c >= 0 && !s.values[c]);
      const pool = stuck.length ? stuck : vals.map((v, c) => (v ? -1 : c)).filter((c) => c >= 0);
      const c = pool[Math.floor(rand() * pool.length)];
      vals[c] = full[c];
      grade = gradeVariant(cm, vals);
    }
    if (!grade) continue;
    // Too easy for the requested level? Drop clues the puzzle doesn't need (whole lines,
    // dots, arrows, sandwich numbers, ...) while it stays unique and hint-solvable.
    let thinned = features;
    if (grade.level < level) {
      ({ features: thinned, grade } = thinFeatures(features, vals, level, grade, rand, t0 + budgetMs * 1.5));
    }
    const puzzle = {
      kind: "variant", variant: ids.length === 1 ? ids[0] : ids.join("+"), variants: ids, features: thinned,
      puzzle: puzzleString(vals), solution: puzzleString(full),
      difficulty: grade.level, techniques: grade.techniques, hardest: grade.techniques[grade.techniques.length - 1] ?? "hiddenSingle",
    };
    if (grade.level === level) return puzzle;
    if (!best || Math.abs(grade.level - level) < Math.abs(best.difficulty - level)) best = puzzle;
    if (Date.now() - t0 > budgetMs) break;
  }
  return best;
}

// Clue lists that may be partially given ("not all dots are given" etc.). Greater-than
// signs and consecutive bars are complete by definition, so they are never thinned.
const THINNABLE = ["thermos", "arrows", "whispers", "renbans", "palindromes", "dots", "xv", "quads", "parity", "cages"];

function thinFeatures(features, vals, level, grade, rand, deadline) {
  let f = structuredClone(features);
  const items = [];
  for (const k of THINNABLE) (f[k] ?? []).forEach((_, i) => items.push([k, i]));
  if (f.sandwich) for (const side of ["rows", "cols"]) f.sandwich[side].forEach((_, i) => items.push(["sandwich", side, i]));
  shuffle(items, rand);
  const removed = new Set();
  for (const item of items) {
    if (grade.level >= level || Date.now() > deadline) break;
    const trial = structuredClone(f);
    if (item[0] === "sandwich") trial.sandwich[item[1]][item[2]] = null;
    else trial[item[0]][item[1]] = null;               // mark; compacted below
    const compacted = compact(trial);
    const cm = compile(compacted);
    if (variantSolve(cm, vals, 2, null, 60000).count !== 1) continue;
    const g = gradeVariant(cm, vals);
    if (!g) continue;
    f = trial; grade = g; removed.add(item.join(":"));
  }
  return { features: compact(f), grade };
}

function compact(f) {
  const out = { ...f };
  for (const k of THINNABLE) if (Array.isArray(out[k])) out[k] = out[k].filter(Boolean);
  return out;
}

/** Re-verifies a stored variant puzzle: unique, consistent, solvable by the hint engine. */
export function verifyVariant(p) {
  const values = parsePuzzle(p.puzzle), sol = parsePuzzle(p.solution);
  if (!values || !sol) return false;
  const cm = compile(p.features);
  if (!satisfies(cm, sol)) return false;
  const r = variantSolve(cm, values, 2, null, 400000);
  return r.count === 1 && r.solution.join("") === sol.join("") && !!gradeVariant(cm, values);
}
