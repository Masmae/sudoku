// Board rendering. Gliding selection frame, unit pulse and conflict shake are
// adapted from SudoSodoku (MIT, © 2026 Kai T. Chen).
import { h, svg } from "./dom.js";
import { UNITS, sees, has, ck, ROW, COL, BOX } from "../core/index.js";

/** What to draw for a hint step. level 2 = pattern, 3 = pattern + result. */
export function highlightsFor(step, level) {
  const hl = { flagged: new Set(), units: new Set(), cells: new Set(), roles: new Map(), elims: new Set(), links: [], directed: false, ghost: new Map() };
  if (!step || level < 2) return hl;
  step.units.forEach((u) => hl.units.add(u));
  step.cells.forEach((c) => hl.cells.add(c));
  for (const c of step.keyCandidates) hl.roles.set(ck(c.cell, c.digit), "key");
  for (const c of step.secondaryCandidates) hl.roles.set(ck(c.cell, c.digit), "sec");
  hl.links = step.links;
  hl.directed = step.technique === "xChain" || step.technique === "xyChain";
  if (level >= 3) {
    for (const e of step.eliminations) hl.elims.add(ck(e.cell, e.digit));
    for (const p of step.placements) { hl.roles.set(ck(p.cell, p.digit), "place"); hl.ghost.set(p.cell, p.digit); }
  }
  return hl;
}
export const emptyHighlights = () => highlightsFor(null, 0);

const CELL = 100, PAD = 4, INNER = (CELL - 2 * PAD) / 3;
const candPoint = (c, d) => [COL[c] * CELL + PAD + ((d - 1) % 3 + 0.5) * INNER, ROW[c] * CELL + PAD + (Math.floor((d - 1) / 3) + 0.5) * INNER];

export class BoardView {
  constructor({ onTap, label = "Sudoku board" }) {
    this.onTap = onTap;
    this.cells = [];
    this.board = h("div", { class: "board", role: "grid", "aria-label": label, tabindex: "0" });
    for (let i = 0; i < 81; i++) {
      const el = h("div", { class: "cell", role: "gridcell", "data-i": i });
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); this.board.focus({ preventScroll: true }); this.onTap?.(i); });
      this.cells.push(el);
      this.board.append(el);
    }
    const lines = svg("svg", { class: "gridlines", viewBox: "0 0 900 900", preserveAspectRatio: "none", "aria-hidden": "true" });
    for (let i = 1; i < 9; i++) {
      const cls = i % 3 === 0 ? "thick" : "thin";
      lines.append(svg("line", { class: cls, x1: i * 100, y1: 0, x2: i * 100, y2: 900 }));
      lines.append(svg("line", { class: cls, x1: 0, y1: i * 100, x2: 900, y2: i * 100 }));
    }
    this.links = svg("svg", { class: "links", viewBox: "0 0 900 900", preserveAspectRatio: "none", "aria-hidden": "true" });
    this.frame = h("div", { class: "sel-frame", "aria-hidden": "true" });
    this.frame.style.display = "none";
    this.board.append(lines, this.links, this.frame);
    this.el = h("div", { class: "board-wrap" }, this.board);
  }

  /**
   * @param m {{values:number[], given:(c:number)=>boolean, notes:number[], wrong?:Set<number>, selected?:number|null,
   *            highlightDigit?:number|null, hl?:object, shake?:number|null, pulse?:number[]|null}}
   */
  render(m) {
    const hl = m.hl ?? emptyHighlights();
    const wrong = m.wrong ?? new Set();
    const sel = m.selected ?? null;
    const hd = m.highlightDigit ?? null;
    // Digit mode (number lock): grey out boxes that already contain the digit.
    const doneBoxes = new Set();
    if (m.digitMode && hd) for (let c = 0; c < 81; c++) if (m.values[c] === hd) doneBoxes.add(BOX[c]);
    for (let i = 0; i < 81; i++) {
      const el = this.cells[i];
      const v = m.values[i];
      let bg = "";
      if ([...hl.units].some((u) => UNITS[u].includes(i))) bg = hl.cells.has(i) ? "hint-cell" : "hint-unit";
      else if (hl.flagged.has(i)) bg = "hint-cell";
      else if (hd && v === hd) bg = "same";
      else if (i === sel) bg = "selected";
      else if (m.digitMode ? doneBoxes.has(BOX[i]) : sel !== null && sees(sel, i)) bg = "related";
      el.className = "cell" + (bg ? " " + bg : "");
      el.replaceChildren();
      const r = ROW[i] + 1, c = COL[i] + 1;
      if (v) {
        const cls = "v" + (m.given(i) ? " given" : "") + (wrong.has(i) ? " wrong" : "");
        el.append(h("span", { class: cls }, String(v)));
        el.setAttribute("aria-label", `Row ${r}, column ${c}, ${m.given(i) ? "given" : "entered"} ${v}${wrong.has(i) ? ", incorrect" : ""}`);
      } else if (hl.ghost.has(i)) {
        el.append(h("span", { class: "v ghost" }, String(hl.ghost.get(i))));
        el.setAttribute("aria-label", `Row ${r}, column ${c}, hint: place ${hl.ghost.get(i)}`);
      } else if (m.notes[i]) {
        const grid = h("div", { class: "notes" });
        const list = [];
        for (let d = 1; d <= 9; d++) {
          if (!has(m.notes[i], d)) { grid.append(h("span")); continue; }
          list.push(d);
          const k = ck(i, d);
          const role = hl.roles.get(k);
          const struck = hl.elims.has(k) || role === "marked" || role === "wrongmark";
          let cls = role === "key" ? "key" : role === "sec" ? "sec" : role === "place" ? "place" : "";
          if (struck) cls += " struck";
          if (!cls && m.highlightDigit === d) cls = "focus";
          grid.append(h("span", { class: cls.trim() || null }, String(d)));
        }
        el.append(grid);
        el.setAttribute("aria-label", `Row ${r}, column ${c}, empty, notes ${list.join(" ")}`);
      } else {
        el.setAttribute("aria-label", `Row ${r}, column ${c}, empty`);
      }
    }
    // Selection frame glides between cells.
    if (sel === null) this.frame.style.display = "none";
    else {
      this.frame.style.display = "";
      this.frame.style.transform = `translate(${COL[sel] * 100}%, ${ROW[sel] * 100}%)`;
    }
    this.drawLinks(hl);
    if (m.shake !== null && m.shake !== undefined) {
      const el = this.cells[m.shake];
      el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
    }
    if (m.pulse?.length) {
      for (const c of m.pulse) {
        const p = h("div", { class: "pulse" });
        p.style.left = `${(COL[c] * 100) / 9}%`; p.style.top = `${(ROW[c] * 100) / 9}%`;
        this.board.append(p);
        setTimeout(() => p.remove(), 650);
      }
    }
  }

  drawLinks(hl) {
    this.links.replaceChildren();
    if (!hl.links.length) return;
    // Marker size is in board units (900 per side).
    const defs = svg("defs", {}, svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 16, markerHeight: 16,
      orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" }, svg("path", { d: "M0,0 L10,5 L0,10 z", class: "arrowhead" })));
    this.links.append(defs);
    const r = 16;
    for (const l of hl.links) {
      const [ax0, ay0] = candPoint(l.from.cell, l.from.digit), [bx0, by0] = candPoint(l.to.cell, l.to.digit);
      const ux = bx0 - ax0, uy = by0 - ay0, ul = Math.max(1, Math.hypot(ux, uy));
      if (ul <= 2 * r) continue;
      const ax = ax0 + (ux / ul) * r, ay = ay0 + (uy / ul) * r, bx = bx0 - (ux / ul) * r, by = by0 - (uy / ul) * r;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, bow = Math.min(35, ul * 0.12);
      const cx = mx - (uy / ul) * bow, cy = my + (ux / ul) * bow;
      const p = svg("path", { d: `M${ax},${ay} Q${cx},${cy} ${bx},${by}`, class: l.strong ? "strong" : "weak" });
      if (hl.directed) p.setAttribute("marker-end", "url(#arrow)");
      this.links.append(p);
    }
  }
}
