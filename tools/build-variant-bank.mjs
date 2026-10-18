// Builds web/data/variant-bank.json: ready-made variant puzzles at every level.
//
//   node tools/build-variant-bank.mjs [--per 10,10,10,3,3] [--combo-per 2,2,2,1,1]
//        [--minutes-per-key 3] [--total-minutes 55] [--workers 2]
//
// --per / --combo-per: how many puzzles to keep for each level (Easy..Master) of each
// single variant / mix (all 151 pairs + 48 fixed three-way mixes). Expert and Master are slow to find, so fewer.
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
const PER = list("--per", "10,10,10,3,3"), COMBO_PER = list("--combo-per", "2,2,2,1,1");
const MIN_PER_KEY = opt("--minutes-per-key", 3), TOTAL_MIN = opt("--total-minutes", 55), WORKERS = opt("--workers", 2);
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
const save = () => writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), misses, puzzles: results }));

const jobs = [];
for (const v of VARIANTS) for (let level = 1; level <= 5; level++) jobs.push({ ids: [v.id], level, want: PER[level - 1] - have([v.id], level) });
// Curated pairs first, then the other pairs, then the three-way mixes.
const curated = new Set(GOOD_COMBOS.map(comboKey));
const mixes = [...GOOD_COMBOS, ...BANK_COMBOS.filter((c) => !curated.has(comboKey(c)))];
for (const c of mixes) for (let level = 1; level <= 5; level++) {
  if ((misses[`${comboKey(c)}|${level}`] ?? 0) >= GIVE_UP) continue;
  jobs.push({ ids: c, level, want: COMBO_PER[level - 1] - have(c, level) });
}
// Easy levels first: most of the useful stock arrives quickly; the slow Master
// searches come last.
const todo = jobs.filter((j) => j.want > 0).sort((a, b) => a.level - b.level);   // stable: keeps the order above within a level
console.log(`${results.length} puzzles already built; ${todo.length} combinations to go, ${WORKERS} workers`);
jobs.length = 0; jobs.push(...todo);

const start = Date.now();
let done = 0;
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
      results.push(...m.found.filter((p) => !results.some((q) => q.puzzle === p.puzzle)));
      const mk = `${comboKey(m.ids)}|${m.level}`;
      if (m.found.length < m.want && m.fullBudget) misses[mk] = (misses[mk] ?? 0) + 1;
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
console.log(`wrote ${results.length} puzzles (by level ${byLevel.join("/")}), ${(JSON.stringify(bank).length / 1024).toFixed(0)} KB`);
