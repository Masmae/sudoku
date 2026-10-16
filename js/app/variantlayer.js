// Draws a variant's clues (cages, lines, dots, ...) as an SVG layer over the board.
// Board coordinates: 900 x 900, 100 per cell.
import { svg } from "./dom.js";
import { ROW, COL } from "../core/index.js";
import { DIAGONALS, WINDOWS } from "../core/variants.js";

const cx = (c) => COL[c] * 100 + 50, cy = (c) => ROW[c] * 100 + 50;
const mid = (a, b) => [(cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2];
const pts = (cells) => cells.map((c) => `${cx(c)},${cy(c)}`).join(" ");

export function drawVariant(features) {
  const g = svg("g", { class: "variant" });
  if (!features) return g;
  const add = (el) => { g.append(el); return el; };
  const r = features.rules ?? {};

  if (r.windoku) for (const w of WINDOWS) add(svg("rect", { class: "v-window", x: COL[w[0]] * 100, y: ROW[w[0]] * 100, width: 300, height: 300 }));
  if (r.diagonal) for (const d of DIAGONALS) add(svg("line", { class: "v-diag", x1: cx(d[0]) - 50 * Math.sign(cx(d[8]) - cx(d[0])), y1: 0, x2: cx(d[8]) + 50 * Math.sign(cx(d[8]) - cx(d[0])), y2: 900 }));

  for (const p of features.parity ?? []) {
    if (p.even) add(svg("rect", { class: "v-parity", x: cx(p.cell) - 36, y: cy(p.cell) - 36, width: 72, height: 72, rx: 6 }));
    else add(svg("circle", { class: "v-parity", cx: cx(p.cell), cy: cy(p.cell), r: 38 }));
  }

  for (const t of features.thermos ?? []) {
    add(svg("polyline", { class: "v-thermo", points: pts(t.cells) }));
    add(svg("circle", { class: "v-thermo-bulb", cx: cx(t.cells[0]), cy: cy(t.cells[0]), r: 34 }));
  }
  for (const [list, cls] of [[features.whispers, "v-whisper"], [features.renbans, "v-renban"], [features.palindromes, "v-palindrome"]]) {
    for (const l of list ?? []) add(svg("polyline", { class: cls, points: pts(l.cells) }));
  }
  for (const a of features.arrows ?? []) {
    const [x0, y0] = [cx(a.circle), cy(a.circle)], [x1, y1] = [cx(a.cells[0]), cy(a.cells[0])];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const start = `${x0 + ((x1 - x0) / len) * 38},${y0 + ((y1 - y0) / len) * 38}`;
    add(svg("polyline", { class: "v-arrow", points: `${start} ${pts(a.cells)}`, "marker-end": "url(#v-arrowhead)" }));
    add(svg("circle", { class: "v-arrow-circle", cx: x0, cy: y0, r: 38 }));
  }

  for (const cage of features.cages ?? []) drawCage(add, cage);

  for (const d of features.dots ?? []) {
    const [x, y] = mid(d.a, d.b);
    add(svg("circle", { class: d.color === "black" ? "v-dot black" : "v-dot", cx: x, cy: y, r: 11 }));
  }
  for (const b of features.bars ?? []) {
    const [x, y] = mid(b.a, b.b);
    const horiz = ROW[b.a] === ROW[b.b];
    add(svg("rect", { class: "v-bar", x: x - (horiz ? 6 : 22), y: y - (horiz ? 22 : 6), width: horiz ? 12 : 44, height: horiz ? 44 : 12, rx: 3 }));
  }
  for (const x of features.xv ?? []) {
    const [mx, my] = mid(x.a, x.b);
    add(svg("rect", { class: "v-label-bg", x: mx - 13, y: my - 15, width: 26, height: 30, rx: 5 }));
    add(svg("text", { class: "v-xv", x: mx, y: my + 10 }, document.createTextNode(x.sum === 5 ? "V" : "X")));
  }
  for (const s of features.gt ?? []) {
    const [mx, my] = mid(s.a, s.b);
    const dx = Math.sign(cx(s.b) - cx(s.a)), dy = Math.sign(cy(s.b) - cy(s.a));   // towards the smaller cell
    const tip = [mx + dx * 9, my + dy * 9], back = [mx - dx * 9, my - dy * 9];
    add(svg("polyline", { class: "v-gt", points: `${back[0] - dy * 13},${back[1] - dx * 13} ${tip[0]},${tip[1]} ${back[0] + dy * 13},${back[1] + dx * 13}` }));
  }
  for (const q of features.quads ?? []) {
    const x = COL[q.cells[0]] * 100 + 100, y = ROW[q.cells[0]] * 100 + 100;
    add(svg("circle", { class: "v-quad", cx: x, cy: y, r: 30 }));
    const ds = q.digits;
    const pos = ds.length <= 2 ? ds.map((_, i) => [x - 9 + i * 18 - (ds.length === 1 ? -9 : 0), y + 7]) : ds.map((_, i) => [x - 9 + (i % 2) * 18, y - 3 + Math.floor(i / 2) * 19]);
    ds.forEach((d, i) => add(svg("text", { class: "v-quad-digit", x: pos[i][0], y: pos[i][1] }, document.createTextNode(String(d)))));
  }
  return g;
}

/** Dashed outline just inside a cage's border, plus its sum in the top-left cell. */
function drawCage(add, cage) {
  const inCage = new Set(cage.cells);
  const I = 7;
  const has = (r, c) => r >= 0 && r < 9 && c >= 0 && c < 9 && inCage.has(r * 9 + c);
  let d = "";
  for (const c of cage.cells) {
    const r = ROW[c], k = COL[c], x0 = k * 100, y0 = r * 100, x1 = x0 + 100, y1 = y0 + 100;
    const L = has(r, k - 1), R = has(r, k + 1), U = has(r - 1, k), D = has(r + 1, k);
    if (!U) d += `M${L ? x0 : x0 + I},${y0 + I}H${R ? x1 : x1 - I}`;
    if (!D) d += `M${L ? x0 : x0 + I},${y1 - I}H${R ? x1 : x1 - I}`;
    if (!L) d += `M${x0 + I},${U ? y0 : y0 + I}V${D ? y1 : y1 - I}`;
    if (!R) d += `M${x1 - I},${U ? y0 : y0 + I}V${D ? y1 : y1 - I}`;
  }
  add(svg("path", { class: "v-cage", d }));
  const tl = Math.min(...cage.cells);
  const label = String(cage.sum);
  add(svg("rect", { class: "v-label-bg", x: COL[tl] * 100 + 3, y: ROW[tl] * 100 + 3, width: 12 + 12 * label.length, height: 26, rx: 4 }));
  add(svg("text", { class: "v-cage-sum", x: COL[tl] * 100 + 9, y: ROW[tl] * 100 + 23 }, document.createTextNode(label)));
}

export function variantDefs() {
  return svg("defs", {}, svg("marker", { id: "v-arrowhead", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 22, markerHeight: 22, orient: "auto", markerUnits: "userSpaceOnUse" },
    svg("path", { d: "M0,0 L10,5 L0,10", class: "v-arrowhead" })));
}
