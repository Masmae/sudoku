import * as store from "./storage.js";
import { randomTransform, transformDrill, transformPuzzle } from "../core/index.js";

/** Puzzle sources: bundled (shipped with the app, re-graded before play) and generated in a worker. */
export class Library {
  constructor() {
    this.bundled = [];
    this.bundledDrills = [];
    this.bankDrills = [];      // technique bank (web/data/technique-bank.json), optional
    this.bankPractice = [];
    this.played = new Set(store.load("played", []));
    this.extraDrills = store.load("drills", []);
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    };
  }

  async load() {
    const res = await fetch("data/bundled.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Couldn't load bundled puzzles");
    const content = await res.json();
    this.bundled = Array.isArray(content.puzzles) ? content.puzzles : [];
    this.bundledDrills = Array.isArray(content.drills) ? content.drills : [];
    try {
      const bank = await (await fetch("data/technique-bank.json", { cache: "no-cache" })).json();
      this.bankDrills = Array.isArray(bank.drills) ? bank.drills : [];
      this.bankPractice = Array.isArray(bank.practice) ? bank.practice : [];
    } catch { /* the bank is optional */ }
  }

  run(type, args) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, args });
    });
  }

  markPlayed(p) {
    this.played.add(p.puzzle);
    store.save("played", [...this.played]);
  }

  unplayed(d) { return this.bundled.filter((p) => p.difficulty === d && !this.played.has(p.puzzle)).length; }

  /** Next puzzle: an unplayed bundled one (re-verified), else generated on the spot. */
  async next(d) {
    for (const p of this.bundled) {
      if (p.difficulty !== d || this.played.has(p.puzzle)) continue;
      const g = await this.run("grade", { puzzle: p.puzzle });
      if (g && g.difficulty === d) return g;
    }
    return this.run("generate", { difficulty: d });
  }

  /** A full puzzle whose hardest step is `t`, shown in a fresh disguise (same logic, new look). */
  async practicePuzzle(t) {
    const pool = [...this.bankPractice, ...this.bundled];
    const exact = pool.filter((p) => p.hardest === t);
    const uses = pool.filter((p) => p.techniques?.includes(t));
    const list = exact.length ? exact : uses;
    for (let tries = 0; tries < 4 && list.length; tries++) {
      const pick = transformPuzzle(list[Math.floor(Math.random() * list.length)], randomTransform());
      const g = await this.run("grade", { puzzle: pick.puzzle });   // re-verify after transforming
      if (g && g.techniques.includes(t)) return g;
    }
    return this.run("practice", { technique: t });
  }

  /** Validated drills for `t`, shuffled, each in a fresh random disguise. */
  async drills(t, { disguise = true } = {}) {
    const all = [...this.bundledDrills, ...this.bankDrills, ...this.extraDrills].filter((d) => d.technique === t);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const shown = disguise ? all.map((d) => transformDrill(d, randomTransform())) : all;
    return this.run("validateDrills", { drills: shown });
  }

  async findMoreDrills(t, count = 3) {
    const found = await this.run("findDrills", { technique: t, count });
    this.extraDrills.push(...found);
    store.save("drills", this.extraDrills.slice(-300));
    return found;
  }
}
