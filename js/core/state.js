import { PEERS, UNITS, ALL, bit, has, cand } from "./geo.js";
import { hasNoConflicts, parsePuzzle } from "./board.js";
import { commonPeers } from "./geo.js";

/** Board position with candidates. Filled cells have cands 0. */
export class SolveState {
  constructor(values, cands = null) {
    this.values = values.slice();
    if (cands) this.cands = cands.slice();
    else {
      this.cands = values.map((v, c) => {
        if (v) return 0;
        let m = ALL;
        for (const p of PEERS[c]) if (values[p]) m &= ~bit(values[p]);
        return m;
      });
    }
  }
  clone() { return new SolveState(this.values, this.cands); }
  get isSolved() { return !this.values.includes(0); }
  get isConsistent() {
    for (let c = 0; c < 81; c++) if (this.values[c] === 0 && this.cands[c] === 0) return false;
    for (const unit of UNITS) {
      let h = 0;
      for (const c of unit) h |= this.values[c] ? bit(this.values[c]) : this.cands[c];
      if (h !== ALL) return false;
    }
    return hasNoConflicts(this.values);
  }
  place(c, d) {
    this.values[c] = d; this.cands[c] = 0;
    const m = ~bit(d);
    for (const p of PEERS[c]) this.cands[p] &= m;
  }
  eliminate(c, d) { this.cands[c] &= ~bit(d); }
  apply(step) {
    for (const e of step.eliminations) this.eliminate(e.cell, e.digit);
    for (const p of step.placements) if (this.values[p.cell] === 0) this.place(p.cell, p.digit);
  }
  has(c, d) { return has(this.cands[c], d); }
  cellsWith(d, unit) { return unit.filter((c) => has(this.cands[c], d)); }
  unitHasValue(u, d) { return UNITS[u].some((c) => this.values[c] === d); }
  eliminationsSeeing(cells, d) { return commonPeers(cells).filter((c) => this.has(c, d)).map((c) => cand(c, d)); }

  get candidateString() { return this.cands.map((m) => m.toString(16).padStart(3, "0")).join(""); }

  static fromStrings(values, candidates) {
    const v = parsePuzzle(values);
    if (!v || typeof candidates !== "string" || candidates.length !== 243) return null;
    const cs = [];
    for (let i = 0; i < 81; i++) {
      const s = candidates.slice(i * 3, i * 3 + 3);
      if (!/^[0-9a-f]{3}$/.test(s)) return null;
      const m = parseInt(s, 16);
      if (m & ~ALL) return null;
      cs.push(v[i] === 0 ? m : 0);
    }
    return new SolveState(v, cs);
  }
}
