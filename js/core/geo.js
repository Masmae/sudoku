// Board geometry. Cells 0..80 row-major. Units 0..26: rows 0-8, columns 9-17, boxes 18-26.
export const ROW = Array.from({ length: 81 }, (_, i) => Math.floor(i / 9));
export const COL = Array.from({ length: 81 }, (_, i) => i % 9);
export const BOX = Array.from({ length: 81 }, (_, i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));

const range = (n) => Array.from({ length: n }, (_, i) => i);
export const ROWS = range(9).map((r) => range(9).map((c) => r * 9 + c));
export const COLS = range(9).map((c) => range(9).map((r) => r * 9 + c));
export const BOXES = range(9).map((b) => {
  const r0 = Math.floor(b / 3) * 3, c0 = (b % 3) * 3;
  return range(9).map((k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3));
});
export const UNITS = [...ROWS, ...COLS, ...BOXES];
export const UNITS_OF = range(81).map((c) => [ROW[c], 9 + COL[c], 18 + BOX[c]]);
export const PEERS = range(81).map((c) =>
  range(81).filter((p) => p !== c && (ROW[p] === ROW[c] || COL[p] === COL[c] || BOX[p] === BOX[c])));

const SEES = new Uint8Array(81 * 81);
for (let c = 0; c < 81; c++) for (const p of PEERS[c]) SEES[c * 81 + p] = 1;
export const sees = (a, b) => SEES[a * 81 + b] === 1;
export const cell = (r, c) => r * 9 + c;

/** Cells outside `cells` that see every cell in `cells`. */
export function commonPeers(cells) {
  if (cells.length === 0) return [];
  return PEERS[cells[0]].filter((p) => !cells.includes(p) && cells.every((c) => c === p || sees(c, p)));
}

export const cellName = (c) => `r${ROW[c] + 1}c${COL[c] + 1}`;
export const cellNames = (cs) => cs.map(cellName).join(", ");
export function unitName(u) {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 8}`;
  return `box ${u - 17}`;
}
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Candidate bitmasks: bit d set = digit d possible (d in 1..9).
export const ALL = 0x3fe;
export const bit = (d) => 1 << d;
export const has = (m, d) => (m & (1 << d)) !== 0;
export function popcount(m) { let n = 0; while (m) { m &= m - 1; n++; } return n; }
export function digitsOf(m) { const out = []; for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d); return out; }
export function firstDigit(m) { for (let d = 1; d <= 9; d++) if (m & (1 << d)) return d; return 0; }

/** Candidate key for maps/sets: cell*10+digit. */
export const ck = (cell, digit) => cell * 10 + digit;
export const cand = (cell, digit) => ({ cell, digit });
export const candName = (c) => `${cellName(c.cell)}=${c.digit}`;

/** k-combinations, same order as the Swift engine. */
export function combinations(items, k) {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const result = [];
  const idx = range(k);
  for (;;) {
    result.push(idx.map((i) => items[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === items.length - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return result;
}

/** SplitMix64-free simple seeded RNG (mulberry32) for reproducible tests; Math.random otherwise. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
