// Builds web/data/variant-bank.json: ready-made variant puzzles at every level.
//
//   node tools/build-variant-bank.mjs [--per 3,3,10,6,6] [--combo-per 1,1,3,2,2]
//        [--minutes-per-key 3] [--total-minutes 55] [--workers 2]
//        [--shard 3/12] [--new-out shard.json]     one slice of the work; write only what's new
//        [--only killer+thermo --level 4 --want 2] one mix and level (an order from the app)
//
// What gets built first, and how many: data/wanted.json (written by the app, when it is
// connected to GitHub) lists the mixes and levels you start, the ones that weren't ready, and
// your ratings. Those come first and get extra stock; mixes you rated dull get none extra.
//
// --per / --combo-per: how many puzzles to keep for each level (Easy..Master) of each
// single variant / mix (all 151 pairs + 48 fixed three-way mixes). Hard and above matter most
// (that's what gets played), so they get more puzzles and are built first.
// --minutes-per-key caps the search for one combination; --total-minutes stops the
// whole run (it saves and can be resumed). Runs in GitHub Actions; locally it is gentle
// by default (2 workers, lowest CPU priority). Stop any time with Ctrl+C.
//
// Every puzzle is generated and verified by the app's own engine (unique solution,
// solvable by the hint engine, exact level).
import { Worker } from "node:worker_threads";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { setPriority } from "node:os";
import { VARIANTS, GOOD_COMBOS, BANK_COMBOS, comboKey } from "../js/core/index.js";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : Number(args[i + 1]); };
const list = (n, d) => { const i = args.indexOf(n); return (i < 0 ? d : args[i + 1]).split(",").map(Number); };
const PER = list("--per", "3,3,10,6,6"), COMBO_PER = list("--combo-per", "1,1,3,2,2");
const MIN_PER_KEY = opt("--minutes-per-key", 3), TOTAL_MIN = opt("--total-minutes", 55), WORKERS = opt("--workers", 2);
const str = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const [SHARD, SHARDS] = str("--shard", "0/1").split("/").map(Number);
const NEW_OUT = str("--new-out", null);          // write only this run's finds here (the main file stays untouched)
const ONLY = str("--only", null), ONLY_LEVEL = opt("--level", 0), ONLY_WANT = opt("--want", 2);
const DEADLINE = Date.now() + TOTAL_MIN * 60_000;
const OUT = new URL("../data/variant-bank.json", import.meta.url);
try { setPriority(19); } catch { /* lowest priority where allowed */ }

// Resume: keep what's already built, and only ask for what's still missing.
const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const results = prior.puzzles ?? [];
// Searches that used their whole budget and still came up short. Some mixes almost never
// produce an Expert/Master puzzle; after GIVE_UP misses they're skipped (the phone can still try).
const misses = prior.misses ?? {};
const GIVE_UP = 2;
const have = (ids, level) => results.filter((p) => comboKey(p.variants ?? [p.variant]) === comboKey(ids) && p.difficulty === level).length;
const found = [], newMisses = {};
const save = () => (NEW_OUT
  ? writeFileSync(NEW_OUT, JSON.stringify({ misses: newMisses, puzzles: found }))
  : writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), misses, puzzles: results })));

// What you play (from the app). Missing or malformed: nothing special.
const WANTED = new URL("../data/wanted.json", import.meta.url);
let wanted = {};
try { if (existsSync(WANTED)) wanted = JSON.parse(readFileSync(WANTED, "utf8")); } catch { wanted = {}; }
const num = (x) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1000) : 0);
const demandOf = (ids, level) => { const k = `${comboKey(ids)}|${level}`; return num(wanted.played?.[k]) + 3 * num(wanted.missed?.[k]); };
const likedOf = (ids) => { const r = wanted.ratings?.[comboKey(ids)] ?? {}; return num(r.fun) - num(r.dull); };
/** How many to keep in stock: the base number, plus what you've used, plus a bonus for mixes you like. */
const target = (ids, level, base) => {
  const k = `${comboKey(ids)}|${level}`, liked = likedOf(ids);
  if (liked < -1) return Math.min(base, 1);                              // rated dull: just a token one
  return base + Math.min(12, num(wanted.played?.[k]) + 2 * num(wanted.missed?.[k])) + (liked > 0 && level >= 3 ? 2 : 0);
};

const jobs = [];
for (const v of VARIANTS) for (let level = 1; level <= 5; level++) jobs.push({ ids: [v.id], level, want: target([v.id], level, PER[level - 1]) - have([v.id], level) });
// Curated pairs first, then the other pairs, then the three-way mixes.
const curated = new Set(GOOD_COMBOS.map(comboKey));
const mixes = [...GOOD_COMBOS, ...BANK_COMBOS.filter((c) => !curated.has(comboKey(c)))];
for (const c of mixes) for (let level = 1; level <= 5; level++) {
  // A mix that keeps coming up empty is skipped, unless you've asked for it.
  if ((misses[`${comboKey(c)}|${level}`] ?? 0) >= GIVE_UP && !demandOf(c, level)) continue;
  jobs.push({ ids: c, level, want: target(c, level, COMBO_PER[level - 1]) - have(c, level) });
}
// Build order by level: Hard, Expert, Master, then Easy and Medium (played least).
// The sort is stable, so within a level the order above holds (curated pairs first).
const LEVEL_ORDER = [3, 4, 5, 2, 1];
let todo = jobs.filter((j) => j.want > 0)
  .sort((a, b) => demandOf(b.ids, b.level) - demandOf(a.ids, a.level) || LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
if (ONLY) {
  // An order from the app: exactly this mix and level, whatever is already in stock.
  const ids = ONLY.split("+").filter((id) => VARIANTS.some((v) => v.id === id));
  if (!ids.length || ids.length !== ONLY.split("+").length || !(ONLY_LEVEL >= 1 && ONLY_LEVEL <= 5)) { console.error("bad --only / --level"); process.exit(1); }
  todo = [{ ids, level: ONLY_LEVEL, want: Math.max(1, Math.min(6, ONLY_WANT)) }];
}
// One slice of the list, so several machines can share the work without overlapping.
todo = todo.filter((_, i) => i % SHARDS === SHARD);
// Easier puzzles of the same mix that might stretch to this level (tried before starting from scratch).
for (const j of todo) {
  const same = results.filter((p) => comboKey(p.variants ?? [p.variant]) === comboKey(j.ids));
  j.taken = same.filter((p) => p.difficulty === j.level).map((p) => p.solution);
  j.seeds = j.level >= 3 ? same.filter((p) => p.difficulty < j.level && p.difficulty >= j.level - 2).sort((a, b) => b.difficulty - a.difficulty).slice(0, 12)
    .map(({ variants, variant, features, puzzle, solution, difficulty }) => ({ variants, variant, features, puzzle, solution, difficulty })) : [];
}
console.log(`${results.length} puzzles already built; ${todo.length} combinations to go${SHARDS > 1 ? ` in slice ${SHARD + 1} of ${SHARDS}` : ""}, ${WORKERS} workers`);
jobs.length = 0; jobs.push(...todo);

const start = Date.now();
let done = 0, derivedTotal = 0;
const workers = Array.from({ length: Math.max(1, WORKERS) }, () => new Worker(new URL("./variant-bank-worker.mjs", import.meta.url)));
await new Promise((resolve) => {
  let next = 0, active = 0;
  const feed = (w) => {
    const timeLeft = DEADLINE - Date.now();
    if (next >= jobs.length || timeLeft < 30_000) { if (active === 0) resolve(); return; }
    const job = jobs[next++]; active++;
    const budgetMs = Math.min(MIN_PER_KEY * 60_000, timeLeft);
    w.postMessage({ ...job, budgetMs, fullBudget: budgetMs >= MIN_PER_KEY * 60_000 });
  };
  for (const w of workers) {
    w.on("message", (m) => {
      active--; done++;
      const fresh = m.found.filter((p) => !results.some((q) => q.puzzle === p.puzzle));
      results.push(...fresh); found.push(...fresh);
      derivedTotal += m.derived ?? 0;
      const mk = `${comboKey(m.ids)}|${m.level}`;
      if (m.found.length < m.want && m.fullBudget) { misses[mk] = (misses[mk] ?? 0) + 1; newMisses[mk] = (newMisses[mk] ?? 0) + 1; }
      save();   // after every combination, so stopping loses at most the current ones
      if (done % 10 === 0 || m.found.length < m.want) {
        console.log(`[${done}/${jobs.length}] ${((Date.now() - start) / 60000).toFixed(1)} min — ${comboKey(m.ids)} L${m.level}: ${m.found.length}`);
      }
      feed(w);
    });
    feed(w);
  }
});
for (const w of workers) w.terminate();

save();
const bank = { puzzles: results };
const byLevel = [1, 2, 3, 4, 5].map((l) => results.filter((p) => p.difficulty === l).length);
console.log(`${found.length} new this run (${derivedTotal} stretched from easier ones); ${results.length} puzzles in all (by level ${byLevel.join("/")}), ${(JSON.stringify(bank).length / 1024).toFixed(0)} KB`);
