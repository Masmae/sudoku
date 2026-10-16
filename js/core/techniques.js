// Technique finders, ported from SudokuCore/Techniques/*.swift with identical search order.
// Each finder is a generator yielding every instance it finds.
import {
  UNITS, UNITS_OF, BOXES, ROW, COL, BOX, sees, cell, commonPeers, cellName as N, cellNames as NS,
  unitName as U, capitalize, bit, has, popcount, digitsOf, firstDigit, cand, combinations, ALL,
} from "./geo.js";
import { makeStep } from "./technique.js";

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
/** Boxes, then rows, then columns. */
const SCAN = [...range(18, 27), ...range(0, 9), ...range(9, 18)];
const lineWord = (u) => (u < 9 ? "row" : "column");

// ---------- Singles ----------
function* fullHouse(s) {
  for (const u of SCAN) {
    const empty = UNITS[u].filter((c) => s.values[c] === 0);
    if (empty.length !== 1) continue;
    const c = empty[0];
    if (popcount(s.cands[c]) !== 1) continue;
    const d = firstDigit(s.cands[c]);
    const st = makeStep("fullHouse");
    st.placements = [cand(c, d)]; st.digits = [d]; st.units = [u]; st.cells = [c];
    st.explanation = `${capitalize(U(u))} has only one empty cell, ${N(c)}. The only digit missing from it is ${d}.`;
    yield st;
  }
}

function* hiddenSingle(s) {
  for (const u of SCAN) {
    for (let d = 1; d <= 9; d++) {
      if (s.unitHasValue(u, d)) continue;
      const cs = s.cellsWith(d, UNITS[u]);
      if (cs.length !== 1) continue;
      const c = cs[0];
      const st = makeStep("hiddenSingle");
      st.placements = [cand(c, d)]; st.digits = [d]; st.units = [u]; st.cells = [c]; st.keyCandidates = [cand(c, d)];
      st.explanation = `In ${U(u)}, ${d} can only go in ${N(c)} — every other cell in the ${U(u).split(" ")[0]} already sees ${d === 8 ? "an" : "a"} ${d} or is filled.`;
      yield st;
    }
  }
}

function* nakedSingle(s) {
  for (let c = 0; c < 81; c++) {
    if (s.values[c] !== 0 || popcount(s.cands[c]) !== 1) continue;
    const d = firstDigit(s.cands[c]);
    const st = makeStep("nakedSingle");
    st.placements = [cand(c, d)]; st.digits = [d]; st.cells = [c]; st.units = UNITS_OF[c].slice(); st.keyCandidates = [cand(c, d)];
    st.explanation = `${N(c)} has only one candidate left: ${d}. Every other digit already appears in its row, column, or box.`;
    yield st;
  }
}

// ---------- Intersections ----------
function* pointing(s) {
  for (let b = 0; b < 9; b++) {
    const bu = 18 + b;
    for (let d = 1; d <= 9; d++) {
      if (s.unitHasValue(bu, d)) continue;
      const cs = s.cellsWith(d, BOXES[b]);
      if (cs.length < 2) continue;
      let lu = null;
      if (new Set(cs.map((c) => ROW[c])).size === 1) lu = ROW[cs[0]];
      else if (new Set(cs.map((c) => COL[c])).size === 1) lu = 9 + COL[cs[0]];
      if (lu === null) continue;
      const elims = UNITS[lu].filter((c) => BOX[c] !== b && s.has(c, d)).map((c) => cand(c, d));
      if (!elims.length) continue;
      const st = makeStep("pointing");
      st.eliminations = elims; st.digits = [d]; st.units = [bu, lu]; st.cells = cs; st.keyCandidates = cs.map((c) => cand(c, d));
      st.explanation = `In box ${b + 1}, every ${d} candidate lies in ${U(lu)}. Whichever cell gets the ${d}, it will be in that ${lineWord(lu)}, so the rest of ${U(lu)} cannot be ${d}.`;
      yield st;
    }
  }
}

function* claiming(s) {
  for (let lu = 0; lu < 18; lu++) {
    for (let d = 1; d <= 9; d++) {
      if (s.unitHasValue(lu, d)) continue;
      const cs = s.cellsWith(d, UNITS[lu]);
      if (cs.length < 2 || new Set(cs.map((c) => BOX[c])).size !== 1) continue;
      const b = BOX[cs[0]];
      const elims = BOXES[b].filter((c) => !UNITS[lu].includes(c) && s.has(c, d)).map((c) => cand(c, d));
      if (!elims.length) continue;
      const st = makeStep("claiming");
      st.eliminations = elims; st.digits = [d]; st.units = [lu, 18 + b]; st.cells = cs; st.keyCandidates = cs.map((c) => cand(c, d));
      st.explanation = `In ${U(lu)}, every ${d} candidate lies inside box ${b + 1}. So the ${d} of that ${lineWord(lu)} is in box ${b + 1}, and no other cell of box ${b + 1} can be ${d}.`;
      yield st;
    }
  }
}

// ---------- Subsets ----------
function* naked(s, n) {
  const tech = n === 2 ? "nakedPair" : n === 3 ? "nakedTriple" : "nakedQuad";
  for (const u of SCAN) {
    const unit = UNITS[u];
    const pool = unit.filter((c) => s.values[c] === 0 && popcount(s.cands[c]) >= 2 && popcount(s.cands[c]) <= n);
    const emptyCount = unit.filter((c) => s.values[c] === 0).length;
    if (pool.length < n || emptyCount <= n) continue;
    for (const combo of combinations(pool, n)) {
      const union = combo.reduce((m, c) => m | s.cands[c], 0);
      if (popcount(union) !== n) continue;
      const elims = [];
      for (const c of unit) {
        if (combo.includes(c) || !(s.cands[c] & union)) continue;
        for (const d of digitsOf(s.cands[c] & union)) elims.push(cand(c, d));
      }
      if (!elims.length) continue;
      const st = makeStep(tech);
      st.eliminations = elims; st.digits = digitsOf(union); st.units = [u]; st.cells = combo;
      st.keyCandidates = combo.flatMap((c) => digitsOf(s.cands[c]).map((d) => cand(c, d)));
      st.explanation = `In ${U(u)}, the ${n} cells ${NS(combo)} together hold only the ${n} digits ${digitsOf(union).join("/")}. Those digits must go in exactly those cells, so they can be removed from every other cell of ${U(u)}.`;
      yield st;
    }
  }
}

function* hidden(s, n) {
  const tech = n === 2 ? "hiddenPair" : n === 3 ? "hiddenTriple" : "hiddenQuad";
  for (const u of SCAN) {
    const unit = UNITS[u];
    const emptyCount = unit.filter((c) => s.values[c] === 0).length;
    if (emptyCount <= n) continue;
    const pos = new Map();
    for (let d = 1; d <= 9; d++) {
      if (s.unitHasValue(u, d)) continue;
      const cs = s.cellsWith(d, unit);
      if (cs.length >= 1 && cs.length <= n) pos.set(d, cs);
    }
    if (pos.size < n) continue;
    const keys = [...pos.keys()].sort((a, b) => a - b);
    for (const combo of combinations(keys, n)) {
      const cells = [...new Set(combo.flatMap((d) => pos.get(d)))].sort((a, b) => a - b);
      if (cells.length !== n) continue;
      const keep = combo.reduce((m, d) => m | bit(d), 0);
      const elims = [];
      for (const c of cells) for (const d of digitsOf(s.cands[c] & ~keep)) elims.push(cand(c, d));
      if (!elims.length) continue;
      const st = makeStep(tech);
      st.eliminations = elims; st.digits = combo; st.units = [u]; st.cells = cells;
      st.keyCandidates = cells.flatMap((c) => combo.filter((d) => s.has(c, d)).map((d) => cand(c, d)));
      st.explanation = `In ${U(u)}, the digits ${combo.join("/")} can only go in the ${n} cells ${NS(cells)}. Those cells must hold exactly those digits, so every other candidate in them can be removed.`;
      yield st;
    }
  }
}

// ---------- Fish ----------
function* fish(s, n) {
  const tech = n === 2 ? "xWing" : n === 3 ? "swordfish" : "jellyfish";
  for (let d = 1; d <= 9; d++) {
    for (const rowBase of [true, false]) {
      const eligible = [];
      for (let i = 0; i < 9; i++) {
        const lu = rowBase ? i : 9 + i;
        if (s.unitHasValue(lu, d)) continue;
        let m = 0;
        UNITS[lu].forEach((c, j) => { if (s.has(c, d)) m |= 1 << j; });
        const k = popcount(m);
        if (k >= 2 && k <= n) eligible.push({ line: i, mask: m });
      }
      if (eligible.length < n) continue;
      for (const combo of combinations(eligible, n)) {
        const cover = combo.reduce((m, e) => m | e.mask, 0);
        if (popcount(cover) !== n) continue;
        const baseLines = combo.map((e) => e.line).sort((a, b) => a - b);
        const coverLines = range(0, 9).filter((j) => cover & (1 << j));
        const elims = [];
        for (const j of coverLines) for (let i = 0; i < 9; i++) {
          if (baseLines.includes(i)) continue;
          const c = rowBase ? cell(i, j) : cell(j, i);
          if (s.has(c, d)) elims.push(cand(c, d));
        }
        if (!elims.length) continue;
        const st = makeStep(tech);
        st.eliminations = elims; st.digits = [d];
        const baseUnits = baseLines.map((l) => (rowBase ? l : 9 + l));
        const coverUnits = coverLines.map((l) => (rowBase ? 9 + l : l));
        st.units = [...baseUnits, ...coverUnits];
        st.cells = baseUnits.flatMap((bu) => s.cellsWith(d, UNITS[bu]));
        st.keyCandidates = st.cells.map((c) => cand(c, d));
        const bName = rowBase ? "rows" : "columns", cName = rowBase ? "columns" : "rows";
        const bList = baseLines.map((l) => l + 1).join(", "), cList = coverLines.map((l) => l + 1).join(", ");
        st.explanation = `In ${bName} ${bList}, digit ${d} can only appear in ${cName} ${cList}. Each of those ${n} ${bName} needs its own ${d}, and they all fall inside those ${n} ${cName} — so the ${d}s of ${cName} ${cList} are used up by these ${bName}. Remove ${d} from the rest of ${cName} ${cList}.`;
        yield st;
      }
    }
  }
}

// ---------- Single-digit patterns ----------
export function conjugatePairs(s, d, from = 0, to = 27) {
  const out = [];
  for (let u = from; u < to; u++) {
    const cs = s.cellsWith(d, UNITS[u]);
    if (cs.length === 2) out.push({ unit: u, a: cs[0], b: cs[1] });
  }
  return out;
}

function* skyscraper(s) {
  for (let d = 1; d <= 9; d++) {
    for (const rowBase of [true, false]) {
      const pairs = rowBase ? conjugatePairs(s, d, 0, 9) : conjugatePairs(s, d, 9, 18);
      const along = rowBase ? (c) => COL[c] : (c) => ROW[c];
      for (let i = 0; i < pairs.length; i++) for (let k = i + 1; k < pairs.length; k++) {
        const p = pairs[i], q = pairs[k];
        for (const [base1, top1] of [[p.a, p.b], [p.b, p.a]]) for (const [base2, top2] of [[q.a, q.b], [q.b, q.a]]) {
          if (along(base1) !== along(base2) || along(top1) === along(top2)) continue;
          const elims = s.eliminationsSeeing([top1, top2], d);
          if (!elims.length) continue;
          const st = makeStep("skyscraper");
          st.eliminations = elims; st.digits = [d]; st.units = [p.unit, q.unit]; st.cells = [base1, top1, base2, top2];
          st.keyCandidates = st.cells.map((c) => cand(c, d));
          st.links = [
            { from: cand(base1, d), to: cand(top1, d), strong: true },
            { from: cand(base1, d), to: cand(base2, d), strong: false },
            { from: cand(base2, d), to: cand(top2, d), strong: true },
          ];
          st.explanation = `${capitalize(U(p.unit))} and ${U(q.unit)} each have only two places for ${d}. Their bases ${N(base1)} and ${N(base2)} share a line, so at most one of them is ${d} — which means at least one of the tops, ${N(top1)} or ${N(top2)}, is ${d}. Any cell seeing both tops cannot be ${d}.`;
          yield st;
        }
      }
    }
  }
}

function* twoStringKite(s) {
  for (let d = 1; d <= 9; d++) {
    const rowPairs = conjugatePairs(s, d, 0, 9), colPairs = conjugatePairs(s, d, 9, 18);
    for (const rp of rowPairs) for (const cp of colPairs) {
      for (const [rEnd, rOther] of [[rp.a, rp.b], [rp.b, rp.a]]) for (const [cEnd, cOther] of [[cp.a, cp.b], [cp.b, cp.a]]) {
        if (new Set([rEnd, rOther, cEnd, cOther]).size !== 4 || BOX[rEnd] !== BOX[cEnd] ||
            BOX[rOther] === BOX[rEnd] || BOX[cOther] === BOX[cEnd]) continue;
        const elims = s.eliminationsSeeing([rOther, cOther], d);
        if (!elims.length) continue;
        const st = makeStep("twoStringKite");
        st.eliminations = elims; st.digits = [d]; st.units = [rp.unit, cp.unit, 18 + BOX[rEnd]];
        st.cells = [rOther, rEnd, cEnd, cOther]; st.keyCandidates = st.cells.map((c) => cand(c, d));
        st.links = [
          { from: cand(rOther, d), to: cand(rEnd, d), strong: true },
          { from: cand(rEnd, d), to: cand(cEnd, d), strong: false },
          { from: cand(cEnd, d), to: cand(cOther, d), strong: true },
        ];
        st.explanation = `${capitalize(U(rp.unit))} has ${d} only in ${N(rEnd)} and ${N(rOther)}; ${U(cp.unit)} has ${d} only in ${N(cEnd)} and ${N(cOther)}. ${N(rEnd)} and ${N(cEnd)} share box ${BOX[rEnd] + 1}, so they can't both be ${d} — therefore ${N(rOther)} or ${N(cOther)} is ${d}. Cells seeing both lose ${d}.`;
        yield st;
      }
    }
  }
}

function erStep(b, d, r, c, cs, linkUnit, a, other, t) {
  const st = makeStep("emptyRectangle");
  st.eliminations = [cand(t, d)]; st.digits = [d]; st.units = [18 + b, linkUnit];
  st.cells = [...cs, a, other]; st.keyCandidates = cs.map((x) => cand(x, d));
  st.secondaryCandidates = [cand(a, d), cand(other, d)];
  st.links = [{ from: cand(a, d), to: cand(other, d), strong: true }];
  st.explanation = `In box ${b + 1}, every ${d} lies on row ${r + 1} or column ${c + 1} (an empty rectangle). ${capitalize(U(linkUnit))} has ${d} only in ${N(a)} and ${N(other)}. If ${N(t)} were ${d}, then ${N(other)} isn't, so ${N(a)} is — and between them they'd wipe out every ${d} in box ${b + 1}. So ${N(t)} cannot be ${d}.`;
  return st;
}

function* emptyRectangle(s) {
  for (let b = 0; b < 9; b++) {
    const box = BOXES[b];
    for (let d = 1; d <= 9; d++) {
      if (s.unitHasValue(18 + b, d)) continue;
      const cs = s.cellsWith(d, box);
      if (cs.length < 2) continue;
      const boxRows = [...new Set(box.map((x) => ROW[x]))].sort((x, y) => x - y);
      const boxCols = [...new Set(box.map((x) => COL[x]))].sort((x, y) => x - y);
      for (const r of boxRows) for (const c of boxCols) {
        if (!cs.every((x) => ROW[x] === r || COL[x] === c) ||
            !cs.some((x) => ROW[x] === r && COL[x] !== c) ||
            !cs.some((x) => COL[x] === c && ROW[x] !== r)) continue;
        for (const cp of conjugatePairs(s, d, 9, 18)) {
          if (boxCols.includes(cp.unit - 9)) continue;
          for (const [a, other] of [[cp.a, cp.b], [cp.b, cp.a]]) {
            if (ROW[a] !== r || boxRows.includes(ROW[other])) continue;
            const t = cell(ROW[other], c);
            if (!s.has(t, d)) continue;
            yield erStep(b, d, r, c, cs, cp.unit, a, other, t);
          }
        }
        for (const cp of conjugatePairs(s, d, 0, 9)) {
          if (boxRows.includes(cp.unit)) continue;
          for (const [a, other] of [[cp.a, cp.b], [cp.b, cp.a]]) {
            if (COL[a] !== c || boxCols.includes(COL[other])) continue;
            const t = cell(r, COL[other]);
            if (!s.has(t, d)) continue;
            yield erStep(b, d, r, c, cs, cp.unit, a, other, t);
          }
        }
      }
    }
  }
}

// ---------- Wings ----------
const bivalueCells = (s) => range(0, 81).filter((c) => s.values[c] === 0 && popcount(s.cands[c]) === 2);

function* xyWing(s) {
  const bv = bivalueCells(s);
  for (const pivot of bv) {
    const pd = digitsOf(s.cands[pivot]);
    const wings = bv.filter((c) => c !== pivot && sees(c, pivot));
    for (const a of wings) {
      const shared = s.cands[a] & s.cands[pivot];
      if (popcount(shared) !== 1) continue;
      const x = firstDigit(shared);
      const y = pd.find((d) => d !== x);
      const zMask = s.cands[a] & ~shared;
      const z = firstDigit(zMask);
      const want = bit(y) | zMask;
      for (const b of wings) {
        if (b === a || s.cands[b] !== want) continue;
        const elims = s.eliminationsSeeing([a, b], z).filter((e) => e.cell !== pivot);
        if (!elims.length) continue;
        const st = makeStep("xyWing");
        st.eliminations = elims; st.digits = [x, y, z]; st.cells = [pivot, a, b];
        st.keyCandidates = [cand(pivot, x), cand(pivot, y)];
        st.secondaryCandidates = [cand(a, z), cand(b, z)];
        st.explanation = `Pivot ${N(pivot)} is ${x} or ${y}. If it's ${x}, pincer ${N(a)} (${x}/${z}) becomes ${z}; if it's ${y}, pincer ${N(b)} (${y}/${z}) becomes ${z}. Either way one pincer is ${z}, so any cell seeing both pincers cannot be ${z}.`;
        yield st;
      }
    }
  }
}

function* xyzWing(s) {
  const bv = bivalueCells(s);
  for (let pivot = 0; pivot < 81; pivot++) {
    if (s.values[pivot] !== 0 || popcount(s.cands[pivot]) !== 3) continue;
    const pm = s.cands[pivot];
    const wings = bv.filter((c) => sees(c, pivot) && (s.cands[c] & ~pm) === 0);
    for (let i = 0; i < wings.length; i++) for (let k = i + 1; k < wings.length; k++) {
      const a = wings[i], b = wings[k];
      if ((s.cands[a] | s.cands[b]) !== pm) continue;
      const common = s.cands[a] & s.cands[b];
      if (popcount(common) !== 1) continue;
      const z = firstDigit(common);
      const elims = s.eliminationsSeeing([pivot, a, b], z);
      if (!elims.length) continue;
      const st = makeStep("xyzWing");
      st.eliminations = elims; st.digits = digitsOf(pm); st.cells = [pivot, a, b];
      st.keyCandidates = digitsOf(pm).filter((d) => d !== z).map((d) => cand(pivot, d));
      st.secondaryCandidates = [cand(pivot, z), cand(a, z), cand(b, z)];
      st.explanation = `Pivot ${N(pivot)} holds ${digitsOf(pm).join("/")}; pincers ${N(a)} and ${N(b)} each hold two of those digits and share ${z}. Whatever the pivot is, one of the three cells must be ${z}. A cell seeing all three cannot be ${z}.`;
      yield st;
    }
  }
}

function* wWing(s) {
  const bv = bivalueCells(s);
  for (let i = 0; i < bv.length; i++) for (let k = i + 1; k < bv.length; k++) {
    const a = bv[i], b = bv[k];
    if (s.cands[b] !== s.cands[a] || sees(a, b)) continue;
    const ds = digitsOf(s.cands[a]);
    for (const x of ds) {
      const y = ds.find((d) => d !== x);
      const elims = s.eliminationsSeeing([a, b], y);
      if (!elims.length) continue;
      for (const cp of conjugatePairs(s, x)) {
        if ([a, b].includes(cp.a) || [a, b].includes(cp.b)) continue;
        for (const [c, dd] of [[cp.a, cp.b], [cp.b, cp.a]]) {
          if (!sees(c, a) || !sees(dd, b)) continue;
          const st = makeStep("wWing");
          st.eliminations = elims; st.digits = [x, y]; st.units = [cp.unit]; st.cells = [a, c, dd, b];
          st.keyCandidates = [cand(a, y), cand(b, y)];
          st.secondaryCandidates = [cand(a, x), cand(c, x), cand(dd, x), cand(b, x)];
          st.links = [
            { from: cand(a, x), to: cand(c, x), strong: false },
            { from: cand(c, x), to: cand(dd, x), strong: true },
            { from: cand(dd, x), to: cand(b, x), strong: false },
          ];
          st.explanation = `${N(a)} and ${N(b)} are both ${x}/${y}. ${capitalize(U(cp.unit))} has ${x} only in ${N(c)} and ${N(dd)}. If ${N(a)} were ${x}, ${N(c)} isn't, so ${N(dd)} is ${x} and ${N(b)} must be ${y}. So at least one of the two cells is ${y}, and cells seeing both lose ${y}.`;
          yield st;
        }
      }
    }
  }
}

// ---------- Coloring ----------
function* simpleColoring(s) {
  for (let d = 1; d <= 9; d++) {
    const pairs = conjugatePairs(s, d);
    const adj = new Map();
    for (const p of pairs) {
      if (!adj.has(p.a)) adj.set(p.a, []);
      if (!adj.has(p.b)) adj.set(p.b, []);
      adj.get(p.a).push(p.b); adj.get(p.b).push(p.a);
    }
    const color = new Map();
    for (const start of [...adj.keys()].sort((x, y) => x - y)) {
      if (color.has(start)) continue;
      const comp = [];
      const stack = [start]; color.set(start, 0);
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const n of adj.get(c)) if (!color.has(n)) { color.set(n, 1 - color.get(c)); stack.push(n); }
      }
      if (comp.length < 3) continue;
      const sides = [comp.filter((c) => color.get(c) === 0).sort((x, y) => x - y), comp.filter((c) => color.get(c) === 1).sort((x, y) => x - y)];
      const make = () => {
        const st = makeStep("simpleColoring");
        st.digits = [d]; st.cells = comp.slice().sort((x, y) => x - y);
        st.keyCandidates = sides[0].map((c) => cand(c, d));
        st.secondaryCandidates = sides[1].map((c) => cand(c, d));
        const seen = new Set();
        for (const p of pairs) {
          if (!color.has(p.a) || !comp.includes(p.a)) continue;
          const key = Math.min(p.a, p.b) * 81 + Math.max(p.a, p.b);
          if (seen.has(key)) continue;
          seen.add(key);
          st.links.push({ from: cand(p.a, d), to: cand(p.b, d), strong: true });
        }
        return st;
      };
      for (let k = 0; k < 2; k++) {
        const side = sides[k];
        let clash = null;
        outer: for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) {
          if (sees(side[i], side[j])) { clash = [side[i], side[j]]; break outer; }
        }
        if (clash) {
          const st = make();
          st.eliminations = side.map((c) => cand(c, d));
          const name = k === 0 ? "blue" : "green";
          st.explanation = `Chain the cells where ${d} has only two spots in a unit, alternating two colors: exactly one color is the true ${d}s. Here two ${name} cells, ${N(clash[0])} and ${N(clash[1])}, see each other, so ${name} can't be true — remove ${d} from every ${name} cell.`;
          yield st;
        }
      }
      // Any cell outside this chain that sees both colors (cells of other chains included).
      const inComp = new Set(comp);
      const elims = range(0, 81).filter((c) => s.has(c, d) && !inComp.has(c) &&
        sides[0].some((x) => sees(x, c)) && sides[1].some((x) => sees(x, c))).map((c) => cand(c, d));
      if (elims.length) {
        const st = make();
        st.eliminations = elims;
        st.explanation = `Chain the cells where ${d} has only two spots in a unit, alternating blue and green: either all blue cells are ${d} or all green cells are. A cell that sees both a blue and a green cell can't be ${d} either way.`;
        yield st;
      }
    }
  }
}

// ---------- Uniqueness ----------
function* uniqueRectangle(s) {
  for (let r1 = 0; r1 < 8; r1++) for (let r2 = r1 + 1; r2 < 9; r2++)
  for (let c1 = 0; c1 < 8; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
    if ((Math.floor(r1 / 3) === Math.floor(r2 / 3)) === (Math.floor(c1 / 3) === Math.floor(c2 / 3))) continue;
    const corners = [cell(r1, c1), cell(r1, c2), cell(r2, c1), cell(r2, c2)];
    if (!corners.every((c) => s.values[c] === 0)) continue;
    const common = corners.reduce((m, c) => m & s.cands[c], ALL);
    if (popcount(common) < 2) continue;
    for (const pair of combinations(digitsOf(common), 2)) {
      const pm = bit(pair[0]) | bit(pair[1]);
      const floor = corners.filter((c) => s.cands[c] === pm);
      const roof = corners.filter((c) => s.cands[c] !== pm);
      const st = makeStep("uniqueRectangle");
      st.digits = pair; st.cells = corners;
      st.keyCandidates = corners.flatMap((c) => pair.map((d) => cand(c, d)));
      if (floor.length === 3 && roof.length === 1) {
        const t = roof[0];
        st.eliminations = pair.map((d) => cand(t, d));
        st.explanation = `${NS(floor)} are all ${pair[0]}/${pair[1]}, forming three corners of a rectangle over two boxes. If ${N(t)} were also ${pair[0]} or ${pair[1]}, the four cells could swap those digits and the puzzle would have two solutions. So ${N(t)} must be one of its other candidates. (Unique Rectangle Type 1)`;
        yield st;
      } else if (floor.length === 2 && roof.length === 2 && s.cands[roof[0]] === s.cands[roof[1]] && popcount(s.cands[roof[0]] & ~pm) === 1) {
        const z = firstDigit(s.cands[roof[0]] & ~pm);
        const elims = s.eliminationsSeeing(roof, z);
        if (!elims.length) continue;
        st.eliminations = elims;
        st.secondaryCandidates = roof.map((c) => cand(c, z));
        st.explanation = `${NS(floor)} are ${pair[0]}/${pair[1]} and ${NS(roof)} are ${pair[0]}/${pair[1]}/${z}. If neither roof cell were ${z}, all four corners would hold only ${pair[0]}/${pair[1]} — a deadly pattern with two solutions. So one roof cell is ${z}, and cells seeing both lose ${z}. (Unique Rectangle Type 2)`;
        yield st;
      }
    }
  }
}

function* bugPlusOne(s) {
  const empty = range(0, 81).filter((c) => s.values[c] === 0);
  const extra = empty.filter((c) => popcount(s.cands[c]) !== 2);
  if (extra.length !== 1 || popcount(s.cands[extra[0]]) !== 3) return;
  const x = extra[0];
  for (const d of digitsOf(s.cands[x])) {
    const counts = UNITS_OF[x].map((u) => s.cellsWith(d, UNITS[u]).length);
    if (counts.some((n) => n !== 3)) continue;
    let ok = true;
    check: for (let u = 0; u < 27; u++) for (let dd = 1; dd <= 9; dd++) {
      const n = s.cellsWith(dd, UNITS[u]).length;
      const isExtra = dd === d && UNITS_OF[x].includes(u);
      if (isExtra ? n !== 3 : n !== 0 && n !== 2) { ok = false; break check; }
    }
    if (!ok) continue;
    const st = makeStep("bugPlusOne");
    st.placements = [cand(x, d)]; st.digits = [d]; st.cells = [x]; st.keyCandidates = [cand(x, d)];
    st.explanation = `Every unsolved cell has exactly two candidates except ${N(x)}. Without it the board would be a 'Bivalue Universal Grave' with more than one solution. ${d} appears three times in ${N(x)}'s row, column and box, so ${N(x)} must be ${d}.`;
    yield st;
  }
}

// ---------- Chains ----------
const MAX_LINKS = 14;

function* xChain(s) {
  let best = null;
  for (let d = 1; d <= 9; d++) {
    const nodes = range(0, 81).filter((c) => s.has(c, d));
    if (nodes.length < 4) continue;
    const strong = new Map();
    for (const p of conjugatePairs(s, d)) {
      if (!strong.has(p.a)) strong.set(p.a, []);
      if (!strong.has(p.b)) strong.set(p.b, []);
      strong.get(p.a).push(p.b); strong.get(p.b).push(p.a);
    }
    const weak = new Map(nodes.map((c) => [c, nodes.filter((n) => sees(c, n))]));
    for (const start of nodes) {
      if (!strong.has(start)) continue;
      const parent = new Int32Array(162).fill(-1);
      const depth = new Int32Array(162).fill(-1);
      const queue = [];
      for (const n of strong.get(start)) {
        const k = n * 2 + 1;
        if (depth[k] < 0) { depth[k] = 1; parent[k] = start * 2; queue.push(k); }
      }
      depth[start * 2] = 0; depth[start * 2 + 1] = 0;
      let head = 0, found = null;
      while (head < queue.length) {
        const k = queue[head++];
        const c = k >> 1, viaStrong = (k & 1) === 1;
        if (viaStrong && depth[k] >= 3 && c !== start) {
          if (s.eliminationsSeeing([start, c], d).length) { found = { end: c, key: k }; break; }
        }
        if (depth[k] >= MAX_LINKS) continue;
        const next = viaStrong ? weak.get(c) : (strong.get(c) ?? []);
        for (const n of next) {
          const nk = n * 2 + (viaStrong ? 0 : 1);
          if (depth[nk] < 0) { depth[nk] = depth[k] + 1; parent[nk] = k; queue.push(nk); }
        }
      }
      if (!found) continue;
      if (best && best.links.length <= depth[found.key]) continue;
      const path = [];
      let k = found.key;
      while (k >= 0) { path.push(k); if ((k >> 1) === start) break; k = parent[k]; }
      path.reverse();
      const st = makeStep("xChain");
      st.digits = [d];
      st.eliminations = s.eliminationsSeeing([start, found.end], d);
      st.cells = path.map((p) => p >> 1);
      for (let i = 1; i < path.length; i++) {
        st.links.push({ from: cand(path[i - 1] >> 1, d), to: cand(path[i] >> 1, d), strong: (path[i] & 1) === 1 });
      }
      st.keyCandidates = st.cells.filter((_, i) => i % 2 === 0).map((c) => cand(c, d));
      st.secondaryCandidates = st.cells.filter((_, i) => i % 2 === 1).map((c) => cand(c, d));
      st.explanation = `Follow the chain on digit ${d} from ${N(start)} to ${N(found.end)}: solid lines are strong links (one of the two must be ${d}), dashed lines are weak links (they can't both be ${d}). If ${N(start)} is not ${d}, the chain forces ${N(found.end)} to be ${d}. So one of the two ends is ${d}, and any cell seeing both ends cannot be ${d}.`;
      best = st;
    }
  }
  if (best) yield best;
}

function* xyChain(s) {
  const bv = bivalueCells(s);
  if (bv.length < 3) return;
  const neighbors = new Map(bv.map((c) => [c, bv.filter((n) => sees(c, n))]));
  let best = null, bestLen = Infinity;
  for (const start of bv) {
    for (const z of digitsOf(s.cands[start])) {
      const o = firstDigit(s.cands[start] & ~bit(z));
      const parent = new Map();
      const depth = new Map([[start * 10 + o, 1]]);
      const queue = [start * 10 + o];
      let head = 0, found = null;
      while (head < queue.length) {
        const k = queue[head++];
        const c = Math.floor(k / 10), t = k % 10;
        if (t === z && c !== start && depth.get(k) >= 3 && s.eliminationsSeeing([start, c], z).length) { found = k; break; }
        if (depth.get(k) >= MAX_LINKS || depth.get(k) + 1 >= bestLen) continue;
        for (const n of neighbors.get(c)) {
          if (n === start || !has(s.cands[n], t)) continue;
          const nt = firstDigit(s.cands[n] & ~bit(t));
          const nk = n * 10 + nt;
          if (!depth.has(nk)) { depth.set(nk, depth.get(k) + 1); parent.set(nk, k); queue.push(nk); }
        }
      }
      if (found === null || depth.get(found) >= bestLen) continue;
      const path = [found];
      while (parent.has(path[path.length - 1])) path.push(parent.get(path[path.length - 1]));
      path.reverse();
      const cells = path.map((p) => Math.floor(p / 10));
      const end = Math.floor(found / 10);
      const st = makeStep("xyChain");
      st.digits = [z]; st.cells = cells;
      st.eliminations = s.eliminationsSeeing([start, end], z);
      st.keyCandidates = [cand(start, z), cand(end, z)];
      st.secondaryCandidates = path.map((p) => cand(Math.floor(p / 10), p % 10));
      for (let i = 1; i < path.length; i++) {
        const t = path[i - 1] % 10;
        st.links.push({ from: cand(Math.floor(path[i - 1] / 10), t), to: cand(Math.floor(path[i] / 10), t), strong: false });
      }
      st.explanation = `Every cell in this chain has two candidates: ${NS(cells)}. If ${N(start)} isn't ${z} it must be ${o}, which forces the next cell, and so on down the chain until ${N(end)} becomes ${z}. So one end of the chain is ${z}, and any cell seeing both ends cannot be ${z}.`;
      best = st; bestLen = depth.get(found);
    }
  }
  if (best) yield best;
}

export const FINDERS = {
  fullHouse, hiddenSingle, nakedSingle, pointing, claiming,
  nakedPair: (s) => naked(s, 2), nakedTriple: (s) => naked(s, 3), nakedQuad: (s) => naked(s, 4),
  hiddenPair: (s) => hidden(s, 2), hiddenTriple: (s) => hidden(s, 3), hiddenQuad: (s) => hidden(s, 4),
  xWing: (s) => fish(s, 2), swordfish: (s) => fish(s, 3), jellyfish: (s) => fish(s, 4),
  skyscraper, twoStringKite, emptyRectangle, xyWing, xyzWing, wWing, simpleColoring,
  uniqueRectangle, bugPlusOne, xChain, xyChain,
};
