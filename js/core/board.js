import { UNITS, PEERS, bit, ALL } from "./geo.js";

/** Strict parse: exactly 81 chars of 1-9, 0 or '.'. Returns null otherwise. */
export function parsePuzzle(s) {
  if (typeof s !== "string" || s.length !== 81) return null;
  const out = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i];
    if (ch === "." || ch === "0") out[i] = 0;
    else if (ch >= "1" && ch <= "9") out[i] = ch.charCodeAt(0) - 48;
    else return null;
  }
  return out;
}

export const puzzleString = (values) => values.map((v) => (v === 0 ? "." : String(v))).join("");

export function hasNoConflicts(values) {
  for (const unit of UNITS) {
    let seen = 0;
    for (const c of unit) {
      if (values[c] === 0) continue;
      const b = bit(values[c]);
      if (seen & b) return false;
      seen |= b;
    }
  }
  return true;
}

export function conflictingCells(values) {
  const out = new Set();
  for (let c = 0; c < 81; c++) {
    if (values[c] === 0) continue;
    for (const p of PEERS[c]) if (values[p] === values[c]) out.add(c);
  }
  return out;
}

export { ALL };
