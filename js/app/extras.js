// Small self-contained pieces: dates and streaks for the daily puzzle, share links,
// the variant icons, and the solve-time chart.
import { h, svg } from "./dom.js";
import { VARIANT, T } from "../core/index.js";

// ---------------- Dates ----------------
const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dateKey(new Date());
export const parseDate = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (key, n) => { const d = parseDate(key); d.setDate(d.getDate() + n); return dateKey(d); };
export const niceDate = (key) => parseDate(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Days in a row with the daily puzzle solved on its own day, ending today (or yesterday, if today's is still open). */
export function streak(daily, now = today()) {
  const ok = (k) => daily[k] && !daily[k].late;
  let k = ok(now) ? now : addDays(now, -1), n = 0;
  while (ok(k)) { n++; k = addDays(k, -1); }
  return n;
}
export function bestStreak(daily) {
  let best = 0;
  for (const k of Object.keys(daily)) {
    if (daily[k].late || (daily[addDays(k, -1)] && !daily[addDays(k, -1)].late)) continue;   // only count from the start of a run
    let n = 0, d = k;
    while (daily[d] && !daily[d].late) { n++; d = addDays(d, 1); }
    best = Math.max(best, n);
  }
  return best;
}

// ---------------- Share links ----------------
const b64 = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

/** The part of a share link after "#/p/". Classic: the 81 digits. Variants: the clues too. */
export function encodeShare(p) {
  if (p.kind !== "variant") return p.puzzle.replace(/\./g, "0");
  return "v" + b64(JSON.stringify({ p: p.puzzle, s: p.solution, f: p.features, v: p.variants ?? [p.variant], d: p.difficulty, t: p.techniques }));
}

/**
 * Reads a share link's payload. Nothing in it is trusted: shapes are checked here, and the
 * puzzle itself is verified (one solution, solvable) before it is played.
 * Returns { classic: "81 chars" } or { variant: puzzle } or null.
 */
export function decodeShare(payload) {
  if (typeof payload !== "string" || payload.length > 30000) return null;
  if (/^[0-9.]{81}$/.test(payload)) return { classic: payload };
  if (payload[0] !== "v") return null;
  try {
    const j = JSON.parse(unb64(payload.slice(1)));
    const grid = (x) => typeof x === "string" && /^[0-9.]{81}$/.test(x);
    if (!grid(j.p) || !grid(j.s) || !j.f || typeof j.f !== "object" || Array.isArray(j.f)) return null;
    const variants = (Array.isArray(j.v) ? j.v : []).filter((id) => typeof id === "string" && VARIANT[id]).slice(0, 3);
    if (!variants.length) return null;
    const difficulty = Number.isInteger(j.d) && j.d >= 1 && j.d <= 5 ? j.d : 3;
    const techniques = (Array.isArray(j.t) ? j.t : []).filter((t) => typeof t === "string" && T[t]).slice(0, 40);
    return { variant: { kind: "variant", puzzle: j.p, solution: j.s, features: j.f, variants, variant: variants[0], difficulty, techniques, hardest: techniques[techniques.length - 1] ?? null } };
  } catch { return null; }
}

// ---------------- Variant icons ----------------
const ICONS = {
  killer: [["rect", { x: 4.5, y: 4.5, width: 15, height: 15, rx: 1.5, "stroke-dasharray": "3 2.4" }]],
  thermo: [["circle", { cx: 7, cy: 17, r: 3.2, fill: "currentColor" }], ["path", { d: "M8.5 15.5 19 5", "stroke-width": 3.4 }]],
  arrow: [["circle", { cx: 7, cy: 17, r: 3.4 }], ["path", { d: "M9.6 14.4 19 5M13 5h6v6" }]],
  kropki: [["circle", { cx: 7.5, cy: 12, r: 3.4 }], ["circle", { cx: 16.5, cy: 12, r: 3.4, fill: "currentColor" }]],
  xv: [["path", { d: "M3.5 7l6 10M9.5 7l-6 10M13.5 7l3.5 10 3.5-10" }]],
  greaterThan: [["path", { d: "M8 5.5l9 6.5-9 6.5" }]],
  consecutive: [["rect", { x: 3.5, y: 6, width: 17, height: 12, rx: 1.5 }], ["rect", { x: 10.4, y: 9, width: 3.2, height: 6, rx: 1, fill: "currentColor" }]],
  germanWhisper: [["path", { d: "M3 13c3-9 6 9 9 0s6-9 9 0", "stroke-width": 2.6, class: "vi-whisper" }]],
  renban: [["path", { d: "M4 18l5.5-9 5 5L20 6", "stroke-width": 2.6, class: "vi-renban" }]],
  palindrome: [["path", { d: "M4 12h16M7.5 8.5 4 12l3.5 3.5M16.5 8.5 20 12l-3.5 3.5" }]],
  quadruple: [["path", { d: "M12 3v18M3 12h18", opacity: 0.45 }], ["circle", { cx: 12, cy: 12, r: 4.6, class: "vi-fill" }]],
  sandwich: [["path", { d: "M5 7.5h14M5 16.5h14", "stroke-width": 2.6 }], ["path", { d: "M7 12h10", opacity: 0.6 }]],
  evenOdd: [["rect", { x: 3.5, y: 8, width: 8, height: 8, rx: 1, fill: "currentColor", opacity: 0.55 }], ["circle", { cx: 16.5, cy: 12, r: 4, fill: "currentColor", opacity: 0.55 }]],
  diagonal: [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }], ["path", { d: "M4 4l16 16M20 4 4 20", opacity: 0.7 }]],
  windoku: [["rect", { x: 4.5, y: 4.5, width: 6, height: 6, rx: 1 }], ["rect", { x: 13.5, y: 4.5, width: 6, height: 6, rx: 1 }], ["rect", { x: 4.5, y: 13.5, width: 6, height: 6, rx: 1 }], ["rect", { x: 13.5, y: 13.5, width: 6, height: 6, rx: 1 }]],
  antiKing: [["path", { d: "M5 18h14l1.2-9.5-4.4 3.5L12 6l-3.8 6-4.4-3.5z" }]],
  antiKnight: [["path", { d: "M8 5v11h9" }], ["circle", { cx: 8, cy: 5, r: 1.8, fill: "currentColor" }], ["circle", { cx: 17, cy: 16, r: 1.8, fill: "currentColor" }]],
  nonConsecutive: [["path", { d: "M6 9h12M6 15h12M15.5 5l-7 14" }]],
};
export function variantIcon(id) {
  return svg("svg", { class: "vicon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    (ICONS[id] ?? []).map(([tag, attrs]) => svg(tag, attrs)));
}

// ---------------- Solve-time chart ----------------
/**
 * Bars for recent solves, oldest on the left. One series, so no legend: the level is
 * the letter under each bar, and hovering or focusing a bar shows the details.
 * items: [{ time (seconds), label (letter), text (tooltip) }]
 */
export function solveChart(items, timeString) {
  const W = 400, H = 180, left = 40, bottom = 26, top = 12;
  const max = Math.max(60, ...items.map((x) => x.time));
  const niceMax = Math.ceil(max / 60) * 60;
  const slot = (W - left) / Math.max(items.length, 8), bw = Math.max(4, Math.min(20, slot - 2));
  const y = (t) => top + (H - top - bottom) * (1 - t / niceMax);
  const tip = h("div", { class: "chart-tip", role: "status" });
  const g = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Time taken for your recent solves" });
  for (const t of [0, niceMax / 2, niceMax]) {
    g.append(svg("line", { class: "chart-grid", x1: left, x2: W, y1: y(t), y2: y(t) }));
    const label = svg("text", { class: "chart-axis", x: left - 8, y: y(t) + 4, "text-anchor": "end" });
    label.textContent = timeString(t);
    g.append(label);
  }
  items.forEach((it, i) => {
    const x = left + slot * i + (slot - bw) / 2, yy = Math.min(y(it.time), y(0) - 2), hh = y(0) - yy, r = Math.min(4, hh);
    // Rounded top, square on the baseline.
    const bar = svg("path", { class: "chart-bar", tabindex: 0, d: `M${x},${y(0)}V${yy + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y(0)}z` });
    const hit = svg("rect", { class: "chart-hit", x: left + slot * i, y: top, width: slot, height: H - top - bottom });
    const show = () => { tip.textContent = it.text; bar.classList.add("on"); };
    const hide = () => { bar.classList.remove("on"); };
    for (const el of [bar, hit]) { el.addEventListener("pointerenter", show); el.addEventListener("pointerleave", hide); }
    bar.addEventListener("focus", show); bar.addEventListener("blur", hide);
    const label = svg("text", { class: "chart-axis", x: x + bw / 2, y: H - 8, "text-anchor": "middle" });
    label.textContent = it.label;
    g.append(hit, bar, label);
  });
  tip.textContent = items.length ? "Tap or hover a bar for details." : "";
  return h("div", { class: "chart-wrap" }, g, tip);
}
