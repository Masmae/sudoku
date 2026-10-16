// Sudoku variants: catalogue, rule compilation, and clue generation from a solved grid.
//
// A variant puzzle carries `features` (what is drawn on the board). `compile(features)`
// turns them into a constraint model used by the brute solver, the logical (hint)
// solver and the generator:
//   extraUnits  regions that must contain 1-9 (diagonals, windows)
//   peers       per cell: every cell it may not share a digit with
//   cellMask    per cell: digits allowed (even/odd shading)
//   pairs       two-cell relations (dots, X/V, inequalities, whisper/palindrome lines, ...)
//   groups      multi-cell rules with a partial-assignment check (cages, thermos, arrows, ...)
import { ROW, COL, PEERS, UNITS, ALL, bit, cellName, cellNames, shuffle } from "./geo.js";

const range = (n) => Array.from({ length: n }, (_, i) => i);
const rc = (r, c) => r * 9 + c;
const inGrid = (r, c) => r >= 0 && r < 9 && c >= 0 && c < 9;
export const ORTHO = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const EVEN = bit(2) | bit(4) | bit(6) | bit(8);
const ODD = ALL & ~EVEN;

/** All orthogonally adjacent pairs [a, b] with a < b. */
export const ORTHO_PAIRS = (() => {
  const out = [];
  for (let c = 0; c < 81; c++) {
    if (COL[c] < 8) out.push([c, c + 1]);
    if (ROW[c] < 8) out.push([c, c + 9]);
  }
  return out;
})();

export const DIAGONALS = [range(9).map((i) => i * 10), range(9).map((i) => i * 8 + 8)];
export const WINDOWS = [[1, 1], [1, 5], [5, 1], [5, 5]].map(([r0, c0]) => range(9).map((k) => rc(r0 + Math.floor(k / 3), c0 + (k % 3))));

// ---------------------------------------------------------------- catalogue

export const VARIANTS = [
  { id: "killer", name: "Killer", rules: "Normal Sudoku rules. Digits in each dashed cage add up to the small number in its corner, and can't repeat within a cage." },
  { id: "thermo", name: "Thermo", rules: "Normal Sudoku rules. Along each thermometer, digits strictly increase from the bulb end." },
  { id: "arrow", name: "Arrow", rules: "Normal Sudoku rules. Digits along each arrow add up to the digit in its circle. Digits may repeat on an arrow if the rules otherwise allow." },
  { id: "kropki", name: "Kropki", rules: "Normal Sudoku rules. Cells joined by a white dot are consecutive (e.g. 4 and 5). Cells joined by a black dot have one digit double the other (e.g. 3 and 6). Not all dots are given." },
  { id: "xv", name: "XV", rules: "Normal Sudoku rules. Cells joined by an X add up to 10; cells joined by a V add up to 5. Not all X's and V's are given." },
  { id: "greaterThan", name: "Greater Than", rules: "Normal Sudoku rules. Each arrow sign between two cells points to the smaller digit." },
  { id: "consecutive", name: "Consecutive", rules: "Normal Sudoku rules. Cells separated by a white bar are consecutive. All bars are given: neighbouring cells without a bar are NOT consecutive." },
  { id: "germanWhisper", name: "German Whisper", rules: "Normal Sudoku rules. Neighbouring cells along a green line differ by at least 5." },
  { id: "renban", name: "Renban", rules: "Normal Sudoku rules. Each purple line holds a set of consecutive digits in any order, without repeats (e.g. 4 2 5 3)." },
  { id: "palindrome", name: "Palindrome", rules: "Normal Sudoku rules. Each grey line reads the same from either end." },
  { id: "quadruple", name: "Quadruple", rules: "Normal Sudoku rules. The digits in a circle must appear at least once in the four cells around it." },
  { id: "sandwich", name: "Sandwich", rules: "Normal Sudoku rules. A number outside the grid is the sum of the digits between the 1 and the 9 in that row or column." },
  { id: "evenOdd", name: "Even Odd", rules: "Normal Sudoku rules. Cells with a grey square are even; cells with a grey circle are odd." },
  { id: "diagonal", name: "Diagonal", rules: "Normal Sudoku rules. Each of the two main diagonals also contains 1 to 9 once." },
  { id: "windoku", name: "Windoku", rules: "Normal Sudoku rules. Each of the four shaded 3×3 windows also contains 1 to 9 once." },
  { id: "antiKing", name: "Anti-King", rules: "Normal Sudoku rules. Cells a chess king's move apart (including diagonally touching) can't hold the same digit." },
  { id: "antiKnight", name: "Anti-Knight", rules: "Normal Sudoku rules. Cells a chess knight's move apart can't hold the same digit." },
  { id: "nonConsecutive", name: "Non Consecutive", rules: "Normal Sudoku rules. Orthogonally neighbouring cells can't hold consecutive digits." },
];
export const VARIANT = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

// ---------------------------------------------------------------- relations

const REL = {
  consec: (a, b) => Math.abs(a - b) === 1,
  notConsec: (a, b) => Math.abs(a - b) !== 1,
  double: (a, b) => a === 2 * b || b === 2 * a,
  sum10: (a, b) => a + b === 10,
  sum5: (a, b) => a + b === 5,
  gt: (a, b) => a > b,
  whisper: (a, b) => Math.abs(a - b) >= 5,
  equal: (a, b) => a === b,
};

const PAIR_TEXT = {
  consec: (a, b, bar) => `The white ${bar ? "bar" : "dot"} between ${cellName(a)} and ${cellName(b)} means they are consecutive`,
  notConsec: (a, b) => `${cellName(a)} and ${cellName(b)} are neighbours without a bar, so they can't be consecutive`,
  double: (a, b) => `The black dot between ${cellName(a)} and ${cellName(b)} means one is double the other`,
  sum10: (a, b) => `The X between ${cellName(a)} and ${cellName(b)} means they add up to 10`,
  sum5: (a, b) => `The V between ${cellName(a)} and ${cellName(b)} means they add up to 5`,
  gt: (a, b) => `The sign between ${cellName(a)} and ${cellName(b)} says ${cellName(a)} is bigger`,
  whisper: (a, b) => `${cellName(a)} and ${cellName(b)} are neighbours on a German Whisper line, so they differ by at least 5`,
  equal: (a, b) => `${cellName(a)} and ${cellName(b)} are mirror positions on a palindrome line, so they are equal`,
};

// ---------------------------------------------------------------- groups (partial checks)

function distinctAssigned(vals) {
  let seen = 0;
  for (const v of vals) if (v) { if (seen & (1 << v)) return false; seen |= 1 << v; }
  return true;
}

const GROUP = {
  cage: {
    ok(g, vals) {
      if (!distinctAssigned(vals)) return false;
      let s = 0, k = 0, used = 0;
      for (const v of vals) if (v) { s += v; used |= 1 << v; } else k++;
      if (k === 0) return s === g.sum;
      let lo = 0, hi = 0;
      for (let d = 1, n = 0; d <= 9 && n < k; d++) if (!(used & (1 << d))) { lo += d; n++; }
      for (let d = 9, n = 0; d >= 1 && n < k; d--) if (!(used & (1 << d))) { hi += d; n++; }
      return s + lo <= g.sum && g.sum <= s + hi;
    },
    describe: (g) => `The cage ${cellNames(g.cells)} adds up to ${g.sum}`,
  },
  thermo: {
    ok(g, vals) {
      const n = vals.length;
      let last = -1, lastV = 0;
      for (let i = 0; i < n; i++) {
        const v = vals[i];
        if (!v) continue;
        if (v < i + 1 || v > 9 - (n - 1 - i)) return false;
        if (last >= 0 && v - lastV < i - last) return false;
        last = i; lastV = v;
      }
      return true;
    },
    describe: (g) => `Digits increase along the thermometer from ${cellName(g.cells[0])}`,
  },
  arrow: {
    ok(g, vals) {
      const circle = vals[0];
      let s = 0, k = 0;
      for (let i = 1; i < vals.length; i++) if (vals[i]) s += vals[i]; else k++;
      if (!circle) return s + k <= 9;
      if (k === 0) return s === circle;
      return s + k <= circle && circle <= s + 9 * k;
    },
    describe: (g) => `The arrow from the circle at ${cellName(g.cells[0])} adds up to the circled digit`,
  },
  renban: {
    ok(g, vals) {
      if (!distinctAssigned(vals)) return false;
      let lo = 10, hi = 0;
      for (const v of vals) if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return hi === 0 || hi - lo <= vals.length - 1;
    },
    describe: (g) => `The renban line ${cellNames(g.cells)} holds consecutive digits`,
  },
  quad: {
    ok(g, vals) {
      let k = 0, present = 0;
      for (const v of vals) if (v) present |= 1 << v; else k++;
      const missing = g.digits.filter((d) => !(present & (1 << d))).length;
      return missing <= k;
    },
    describe: (g) => `The circle at the corner of ${cellNames(g.cells)} needs ${g.digits.join(", ")} in those four cells`,
  },
  sandwich: {
    ok(g, vals) {
      const p1 = vals.indexOf(1), p9 = vals.indexOf(9);
      if (p1 < 0 || p9 < 0) return true;
      const [a, b] = p1 < p9 ? [p1, p9] : [p9, p1];
      let s = 0, k = 0;
      for (let i = a + 1; i < b; i++) if (vals[i]) s += vals[i]; else k++;
      if (k === 0) return s === g.sum;
      return s + 2 * k <= g.sum && g.sum <= s + 8 * k;
    },
    describe: (g) => `The sandwich clue ${g.sum} for ${g.label}`,
  },
};

export const groupOk = (g, vals) => GROUP[g.type].ok(g, vals);
export const groupText = (g) => GROUP[g.type].describe(g);
export const pairOk = (p, a, b) => REL[p.rel](a, b);
export const pairText = (p) => PAIR_TEXT[p.rel](p.a, p.b, p.bar);

// ---------------------------------------------------------------- compile

export function compile(features = {}) {
  const rules = features.rules ?? {};
  const extraUnits = [];
  if (rules.diagonal) extraUnits.push(...DIAGONALS);
  if (rules.windoku) extraUnits.push(...WINDOWS);

  const peerSets = PEERS.map((p) => new Set(p));
  const link = (a, b) => { if (a !== b) { peerSets[a].add(b); peerSets[b].add(a); } };
  for (const u of extraUnits) for (const a of u) for (const b of u) link(a, b);
  for (const [flag, offs] of [[rules.antiKing, KING], [rules.antiKnight, KNIGHT]]) {
    if (!flag) continue;
    for (let c = 0; c < 81; c++) for (const [dr, dc] of offs) {
      const r = ROW[c] + dr, cc = COL[c] + dc;
      if (inGrid(r, cc)) link(c, rc(r, cc));
    }
  }

  const cellMask = new Array(81).fill(ALL);
  for (const p of features.parity ?? []) cellMask[p.cell] = p.even ? EVEN : ODD;

  const pairs = [];
  const addPair = (a, b, rel, extra = {}) => pairs.push({ a, b, rel, ...extra });
  for (const d of features.dots ?? []) addPair(d.a, d.b, d.color === "black" ? "double" : "consec");
  for (const x of features.xv ?? []) addPair(x.a, x.b, x.sum === 5 ? "sum5" : "sum10");
  for (const g of features.gt ?? []) addPair(g.a, g.b, "gt");
  if (features.bars) {
    const marked = new Set(features.bars.map((b) => Math.min(b.a, b.b) * 81 + Math.max(b.a, b.b)));
    for (const b of features.bars) addPair(b.a, b.b, "consec", { bar: true });
    for (const [a, b] of ORTHO_PAIRS) if (!marked.has(a * 81 + b)) addPair(a, b, "notConsec");
  }
  if (rules.nonConsecutive) for (const [a, b] of ORTHO_PAIRS) addPair(a, b, "notConsec");
  for (const l of features.whispers ?? []) for (let i = 1; i < l.cells.length; i++) addPair(l.cells[i - 1], l.cells[i], "whisper");
  for (const l of features.palindromes ?? []) {
    const n = l.cells.length;
    for (let i = 0; i < Math.floor(n / 2); i++) addPair(l.cells[i], l.cells[n - 1 - i], "equal");
  }

  const groups = [];
  for (const c of features.cages ?? []) groups.push({ type: "cage", cells: c.cells, sum: c.sum });
  for (const t of features.thermos ?? []) groups.push({ type: "thermo", cells: t.cells });
  for (const a of features.arrows ?? []) groups.push({ type: "arrow", cells: [a.circle, ...a.cells] });
  for (const l of features.renbans ?? []) groups.push({ type: "renban", cells: l.cells });
  for (const q of features.quads ?? []) groups.push({ type: "quad", cells: q.cells, digits: q.digits });
  if (features.sandwich) {
    features.sandwich.rows.forEach((sum, r) => { if (sum !== null) groups.push({ type: "sandwich", cells: UNITS[r], sum, label: `row ${r + 1}` }); });
    features.sandwich.cols.forEach((sum, c) => { if (sum !== null) groups.push({ type: "sandwich", cells: UNITS[9 + c], sum, label: `column ${c + 1}` }); });
  }

  const pairsOf = range(81).map(() => []);
  pairs.forEach((p) => { pairsOf[p.a].push(p); pairsOf[p.b].push(p); });
  const groupsOf = range(81).map(() => []);
  groups.forEach((g) => g.cells.forEach((c) => groupsOf[c].push(g)));

  return { features, extraUnits, peers: peerSets.map((s) => [...s]), peerSet: peerSets, cellMask, pairs, groups, pairsOf, groupsOf };
}

const GRID_RULES = ["diagonal", "windoku", "antiKing", "antiKnight", "nonConsecutive"];

/** Rules that shape the solution grid itself (used to build the full grid first). */
export function rulesFor(variants) {
  const r = {};
  for (const v of [].concat(variants)) if (GRID_RULES.includes(v)) r[v] = true;
  return r;
}

/** Pairs that can't be combined: contradictory, or one makes the other empty. */
const CLASHES = [
  ["consecutive", "nonConsecutive"],   // "all consecutive pairs marked" vs "none exist"
  ["kropki", "nonConsecutive"],        // white dots could never appear
];
export function canCombine(ids) {
  return !CLASHES.some(([a, b]) => ids.includes(a) && ids.includes(b));
}
export const comboKey = (ids) => [...ids].sort().join("+");
export const comboName = (ids) => ids.map((id) => VARIANT[id]?.name ?? id).join(" + ");

/** Merges the clue sets of several variants into one feature object. */
export function mergeFeatures(list) {
  const out = { rules: {} };
  for (const f of list) {
    Object.assign(out.rules, f.rules ?? {});
    for (const [k, v] of Object.entries(f)) {
      if (k === "rules") continue;
      if (Array.isArray(v)) out[k] = [...(out[k] ?? []), ...v];
      else out[k] = v;
    }
  }
  return out;
}

/** Curated pairings that play well together (used by "Surprise me"). */
export const GOOD_COMBOS = [
  ["killer", "antiKnight"], ["killer", "diagonal"], ["thermo", "antiKing"], ["thermo", "diagonal"],
  ["arrow", "windoku"], ["arrow", "antiKnight"], ["kropki", "xv"], ["kropki", "diagonal"],
  ["germanWhisper", "antiKing"], ["renban", "antiKnight"], ["sandwich", "diagonal"], ["greaterThan", "windoku"],
  ["palindrome", "antiKing"], ["quadruple", "antiKnight"], ["evenOdd", "killer"], ["xv", "nonConsecutive"],
  ["thermo", "kropki"], ["killer", "thermo"], ["arrow", "renban"], ["diagonal", "antiKnight"],
];

/** Does a complete grid satisfy every constraint of the model? */
export function satisfies(cm, values) {
  for (let c = 0; c < 81; c++) {
    if (!values[c] || !(cm.cellMask[c] & bit(values[c]))) return false;
    for (const p of cm.peers[c]) if (values[p] === values[c]) return false;
  }
  for (const p of cm.pairs) if (!REL[p.rel](values[p.a], values[p.b])) return false;
  for (const g of cm.groups) if (!GROUP[g.type].ok(g, g.cells.map((c) => values[c]))) return false;
  return true;
}

// ---------------------------------------------------------------- clue generation from a solution

/** Random path of `len` cells using `step` neighbours, accepted cell-by-cell by `accept(path, next)`. */
function randomPath(rand, len, accept, start = null, steps = KING) {
  const path = [start ?? Math.floor(rand() * 81)];
  if (!accept([], path[0])) return null;
  while (path.length < len) {
    const last = path[path.length - 1];
    const nexts = shuffle(steps.map(([dr, dc]) => [ROW[last] + dr, COL[last] + dc]).filter(([r, c]) => inGrid(r, c)).map(([r, c]) => rc(r, c)), rand)
      .filter((n) => !path.includes(n) && accept(path, n));
    if (!nexts.length) return null;
    path.push(nexts[0]);
  }
  return path;
}

/**
 * Diagonal steps of a path as "block:orientation" keys. Two diagonals in the same 2x2
 * block with opposite orientations cross in the middle, which makes a line ambiguous.
 */
function diagonalKeys(path) {
  const keys = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dr = ROW[b] - ROW[a], dc = COL[b] - COL[a];
    if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) continue;
    keys.push({ block: Math.min(ROW[a], ROW[b]) * 9 + Math.min(COL[a], COL[b]), back: dr * dc > 0 });
  }
  return keys;
}
export function lineCrosses(path, taken = new Set()) {
  const seen = new Set(taken);
  for (const k of diagonalKeys(path)) {
    if (seen.has(`${k.block}:${!k.back}`)) return true;
    seen.add(`${k.block}:${k.back}`);
  }
  return false;
}

/** Picks non-overlapping paths that cross neither themselves nor each other. */
function pickPaths(rand, count, attempts, makeOne, used = new Set()) {
  const out = [];
  const diag = new Set();
  for (let i = 0; i < attempts && out.length < count; i++) {
    const p = makeOne();
    if (!p || p.some((c) => used.has(c)) || lineCrosses(p, diag)) continue;
    p.forEach((c) => used.add(c));
    for (const k of diagonalKeys(p)) diag.add(`${k.block}:${k.back}`);
    out.push(p);
  }
  return out;
}

const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/** Partitions the whole grid into cages of 1-5 orthogonally connected cells. */
function makeCages(sol, rand) {
  const cageOf = new Array(81).fill(-1);
  const cages = [];
  for (const start of shuffle(range(81), rand)) {
    if (cageOf[start] >= 0) continue;
    const size = randInt(rand, 2, 5);
    const cells = [start];
    cageOf[start] = cages.length;
    while (cells.length < size) {
      const options = [];
      for (const c of cells) for (const [dr, dc] of ORTHO) {
        const r = ROW[c] + dr, cc = COL[c] + dc;
        if (!inGrid(r, cc)) continue;
        const n = rc(r, cc);
        if (cageOf[n] < 0 && !cells.some((x) => sol[x] === sol[n])) options.push(n);
      }
      if (!options.length) break;
      const n = options[Math.floor(rand() * options.length)];
      cageOf[n] = cages.length;
      cells.push(n);
    }
    cages.push(cells);
  }
  return cages.map((cells) => ({ cells: cells.sort((a, b) => a - b), sum: cells.reduce((s, c) => s + sol[c], 0) }));
}

/** Builds the drawn clues for a variant from a solution grid. */
export function makeFeatures(variant, sol, rand) {
  const f = { rules: {} };
  switch (variant) {
    case "diagonal": f.rules.diagonal = true; break;
    case "windoku": f.rules.windoku = true; break;
    case "antiKing": f.rules.antiKing = true; break;
    case "antiKnight": f.rules.antiKnight = true; break;
    case "nonConsecutive": f.rules.nonConsecutive = true; break;
    case "killer": f.cages = makeCages(sol, rand); break;
    case "thermo":
      f.thermos = pickPaths(rand, randInt(rand, 5, 7), 400, () =>
        randomPath(rand, randInt(rand, 4, 7), (path, n) => !path.length || sol[n] > sol[path[path.length - 1]])).map((cells) => ({ cells }));
      break;
    case "arrow":
      f.arrows = pickPaths(rand, randInt(rand, 5, 7), 2000, () => {
        const circle = Math.floor(rand() * 81);
        if (sol[circle] < 3) return null;
        const p = randomPath(rand, randInt(rand, 3, 4), (path, n) => path.length === 0 || path.slice(1).reduce((s, c) => s + sol[c], 0) + sol[n] <= sol[circle], circle);
        if (!p || p.slice(1).reduce((s, c) => s + sol[c], 0) !== sol[circle]) return null;
        return p;
      }).map((p) => ({ circle: p[0], cells: p.slice(1) }));
      break;
    case "kropki":
      f.dots = ORTHO_PAIRS.filter(([a, b]) => REL.consec(sol[a], sol[b]) || REL.double(sol[a], sol[b]))
        .filter(() => rand() < 0.7)
        .map(([a, b]) => ({ a, b, color: REL.double(sol[a], sol[b]) && !(REL.consec(sol[a], sol[b]) && rand() < 0.5) ? "black" : "white" }));
      break;
    case "xv":
      f.xv = ORTHO_PAIRS.filter(([a, b]) => sol[a] + sol[b] === 10 || sol[a] + sol[b] === 5)
        .filter(() => rand() < 0.75).map(([a, b]) => ({ a, b, sum: sol[a] + sol[b] }));
      break;
    case "greaterThan":
      f.gt = ORTHO_PAIRS.filter(([a, b]) => Math.floor(ROW[a] / 3) === Math.floor(ROW[b] / 3) && Math.floor(COL[a] / 3) === Math.floor(COL[b] / 3))
        .map(([a, b]) => (sol[a] > sol[b] ? { a, b } : { a: b, b: a }));
      break;
    case "consecutive":
      f.bars = ORTHO_PAIRS.filter(([a, b]) => REL.consec(sol[a], sol[b])).map(([a, b]) => ({ a, b }));
      break;
    case "germanWhisper":
      f.whispers = pickPaths(rand, randInt(rand, 4, 6), 600, () =>
        randomPath(rand, randInt(rand, 4, 8), (path, n) => !path.length || Math.abs(sol[n] - sol[path[path.length - 1]]) >= 5)).map((cells) => ({ cells }));
      break;
    case "renban":
      f.renbans = pickPaths(rand, randInt(rand, 4, 6), 3000, () => {
        const len = randInt(rand, 3, 5);
        const p = randomPath(rand, len, (path, n) => {
          const vals = [...path.map((c) => sol[c]), sol[n]];
          return new Set(vals).size === vals.length && Math.max(...vals) - Math.min(...vals) <= len - 1;
        });
        if (!p) return null;
        const vals = p.map((c) => sol[c]);
        return Math.max(...vals) - Math.min(...vals) === p.length - 1 ? p : null;
      }).map((cells) => ({ cells }));
      break;
    case "palindrome":
      f.palindromes = pickPaths(rand, randInt(rand, 4, 6), 6000, () => {
        // Grow outward from a centre so mirrored cells hold equal digits.
        const odd = rand() < 0.5;
        const len = randInt(rand, 2, 3);
        const left = [Math.floor(rand() * 81)];
        let right;
        if (odd) right = [left[0]];
        else {
          const ns = KING.map(([dr, dc]) => [ROW[left[0]] + dr, COL[left[0]] + dc]).filter(([r, c]) => inGrid(r, c)).map(([r, c]) => rc(r, c));
          right = [ns[Math.floor(rand() * ns.length)]];
          if (sol[right[0]] !== sol[left[0]]) return null;
        }
        for (let k = 0; k < len; k++) {
          const ext = (arm) => KING.map(([dr, dc]) => [ROW[arm[arm.length - 1]] + dr, COL[arm[arm.length - 1]] + dc]).filter(([r, c]) => inGrid(r, c)).map(([r, c]) => rc(r, c));
          const opts = [];
          for (const a of ext(left)) for (const b of ext(right)) {
            if (a !== b && sol[a] === sol[b] && ![...left, ...right].includes(a) && ![...left, ...right].includes(b)) opts.push([a, b]);
          }
          if (!opts.length) return null;
          const [a, b] = opts[Math.floor(rand() * opts.length)];
          left.push(a); right.push(b);
        }
        const cells = [...left.slice().reverse(), ...(odd ? right.slice(1) : right)];
        return cells;
      }).map((cells) => ({ cells }));
      break;
    case "quadruple":
      f.quads = shuffle(range(64).map((i) => rc(Math.floor(i / 8), i % 8)), rand).slice(0, randInt(rand, 8, 11)).map((tl) => {
        const cells = [tl, tl + 1, tl + 9, tl + 10];
        const ds = shuffle([...new Set(cells.map((c) => sol[c]))], rand).slice(0, randInt(rand, 2, 4)).sort((a, b) => a - b);
        return { cells, digits: ds };
      });
      break;
    case "sandwich": {
      const lineSum = (cells) => {
        const vals = cells.map((c) => sol[c]);
        const a = vals.indexOf(1), b = vals.indexOf(9);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return vals.slice(lo + 1, hi).reduce((s, v) => s + v, 0);
      };
      f.sandwich = { rows: range(9).map((r) => lineSum(UNITS[r])), cols: range(9).map((c) => lineSum(UNITS[9 + c])) };
      break;
    }
    case "evenOdd":
      f.parity = shuffle(range(81), rand).slice(0, randInt(rand, 18, 26)).map((cell) => ({ cell, even: sol[cell] % 2 === 0 }));
      break;
    default: throw new Error("unknown variant " + variant);
  }
  return f;
}
