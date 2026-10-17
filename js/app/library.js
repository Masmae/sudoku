import * as store from "./storage.js";
import { randomTransform, transformDrill, transformPuzzle, comboKey } from "../core/index.js";

// Every (variant or mix, level) has a stock of ready puzzles: the ones shipped in
// data/variant-bank.json plus ones generated on this device. Using one queues exactly
// one replacement in the background.
const POOL_MAX_KEYS = 60;     // combinations remembered for refills (mixes you've played, etc.)

/** Puzzle sources: bundled (shipped with the app, re-graded before play) and generated in a worker. */
export class Library {
  constructor() {
    this.bundled = [];
    this.bundledDrills = [];
    this.bankDrills = [];      // technique bank (web/data/technique-bank.json), optional
    this.bankPractice = [];
    this.played = new Set(store.load("played", []));
    this.extraDrills = store.load("drills", []);
    this.pending = new Map();
    this.nextId = 1;
    const listen = (w) => (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    };
    // Foreground worker for things you're waiting on; a second one refills the
    // ready-puzzle pool in the background so it never delays the foreground.
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = listen(this.worker);
    this.bgWorker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.bgWorker.onmessage = listen(this.bgWorker);
    this.variantBank = [];
    this.pool = store.load("pool", {});          // key -> [puzzle, ...]
    this.poolKeys = store.load("poolKeys", []);  // recently used keys, newest first
    this.refillQueue = [];
    this.owed = store.load("owed", {});         // key -> replacements still to make (one per puzzle used)
    this.refilling = false;
    this.onPoolChange = () => {};
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
    try {
      const vb = await (await fetch("data/variant-bank.json", { cache: "no-cache" })).json();
      this.variantBank = Array.isArray(vb.puzzles) ? vb.puzzles : [];
    } catch { /* optional */ }
    // Finish any replacements that were still owed when the app last closed.
    for (const key of Object.keys(this.owed)) this.scheduleRefill(key);
  }

  run(type, args, worker = this.worker) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, args });
    });
  }

  // ---------------------------------------------------------------- ready-puzzle pool

  static variantKey(ids, level) { return `v|${comboKey([].concat(ids))}|${level}`; }
  static classicKey(level) { return `c|${level}`; }

  savePool() {
    store.save("pool", this.pool);
    store.save("poolKeys", this.poolKeys);
    this.onPoolChange();
  }

  /** How many puzzles are ready to start instantly. */
  readyCount() {
    const pooled = Object.values(this.pool).reduce((n, list) => n + list.length, 0);
    return pooled + this.variantBank.filter((p) => !this.played.has(p.puzzle)).length;
  }

  /** Unplayed shipped puzzles for a key. */
  bankFor(key) {
    const [kind, a, b] = key.split("|");
    if (kind === "c") return this.bundled.filter((p) => p.difficulty === Number(a) && !this.played.has(p.puzzle));
    return this.variantBank.filter((p) => comboKey(p.variants ?? [p.variant]) === a && p.difficulty === Number(b) && !this.played.has(p.puzzle));
  }

  /** Ready puzzles for a key: shipped (unplayed) + generated on this device. */
  stockCount(key) { return this.bankFor(key).length + (this.pool[key]?.length ?? 0); }

  /** Exactly one replacement for each puzzle used. */
  owe(key) {
    this.owed[key] = (this.owed[key] ?? 0) + 1;
    store.save("owed", this.owed);
    this.scheduleRefill(key);
  }

  /** Remember a key as "in use" and queue it for a background top-up. */
  scheduleRefill(key) {
    this.poolKeys = [key, ...this.poolKeys.filter((k) => k !== key)].slice(0, POOL_MAX_KEYS);
    for (const k of Object.keys(this.pool)) if (!this.poolKeys.includes(k)) delete this.pool[k];
    store.save("poolKeys", this.poolKeys);
    if (!this.refillQueue.includes(key)) this.refillQueue.push(key);
    this.processRefills();
  }

  async processRefills() {
    if (this.refilling) return;
    this.refilling = true;
    try {
      while (this.refillQueue.length) {
        const key = this.refillQueue.shift();
        // Gentle on the phone: one try of at most 15 s (one CPU core) per replacement.
        // If it misses, give up on it; the weekly cloud build fills the stock instead.
        let misses = 0;
        while ((this.owed[key] ?? 0) > 0 && misses < 1) {
          const [kind, a, b] = key.split("|");
          const p = kind === "v"
            ? await this.run("generateVariantExact", { variant: a.split("+"), level: Number(b), budgetMs: 15000 }, this.bgWorker)
            : await this.run("generate", { difficulty: Number(a) }, this.bgWorker);
          if (!p) {
            misses++;
            delete this.owed[key];
            store.save("owed", this.owed);
            continue;
          }
          (this.pool[key] ??= []).push(p);
          this.owed[key]--;
          if (!this.owed[key]) delete this.owed[key];
          store.save("owed", this.owed);
          this.savePool();
        }
      }
    } catch { /* background work is best-effort */ }
    finally { this.refilling = false; }
  }

  /**
   * A ready variant puzzle at exactly `level`, instantly, or null if none is ready.
   * Taking one queues a replacement for the same variant/mix and level.
   */
  takeVariant(ids, level) {
    const key = Library.variantKey(ids, level);
    // Shipped puzzles first (they're already on the device), then generated ones.
    let p = this.bankFor(key)[0] ?? null;
    if (p) this.played.add(p.puzzle);              // counts as taken right away, so the stock drops
    else { p = this.pool[key]?.shift() ?? null; if (p) this.savePool(); }
    if (p) this.owe(key);                          // one replacement for the one you took
    return p;
  }

  markPlayed(p) {
    this.played.add(p.puzzle);
    store.save("played", [...this.played]);
  }

  unplayed(d) { return this.bundled.filter((p) => p.difficulty === d && !this.played.has(p.puzzle)).length; }

  /** Next puzzle: an unplayed bundled one (re-verified), else generated on the spot. */
  async next(d) {
    const key = Library.classicKey(d);
    for (const p of this.bundled) {
      if (p.difficulty !== d || this.played.has(p.puzzle)) continue;
      const g = await this.run("grade", { puzzle: p.puzzle });
      if (g && g.difficulty === d) return g;
    }
    const ready = this.pool[key]?.shift();
    if (ready) { this.savePool(); this.owe(key); return ready; }
    // Bundled ones used up and nothing in stock: make this one now, and one spare.
    this.owe(key);
    return this.run("generate", { difficulty: d });
  }

  /** A full puzzle whose hardest step is `t`, shown in a fresh disguise (same logic, new look). */
  /** A freshly generated variant puzzle (unique, and solvable by the hint engine). */
  nextVariant(variant, level) { return this.run("generateVariant", { variant, level }); }

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
