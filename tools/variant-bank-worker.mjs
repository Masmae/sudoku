// Worker: makes variant puzzles at an exact level. For Expert and Master it first tries to
// stretch easier puzzles of the same mix (`seeds`), which is much quicker than starting from an
// empty grid; whatever is still missing is generated from scratch.
import { parentPort } from "node:worker_threads";
import { setPriority } from "node:os";
try { setPriority(19); } catch { /* lowest priority where allowed */ }
import { generateVariant, deriveVariant, verifyVariant } from "../js/core/index.js";

parentPort.on("message", ({ ids, level, want, budgetMs, fullBudget, seeds = [], taken = [] }) => {
  const found = [];
  const until = Date.now() + budgetMs;
  const used = new Set(taken);            // solution grids this mix already has at this level
  const fresh = (p) => p && p.difficulty === level && !found.some((q) => q.puzzle === p.puzzle) && verifyVariant(p);
  let derived = 0;
  for (const seed of seeds) {
    if (found.length >= want || Date.now() > until - budgetMs / 2) break;     // at most half the time on this
    if (used.has(seed.solution)) continue;
    const p = deriveVariant(seed, level, Math.random, Math.min(8000, until - Date.now()));
    if (fresh(p)) { found.push(p); used.add(p.solution); derived++; }
  }
  while (found.length < want && Date.now() < until) {
    const p = generateVariant(ids, level, Math.random, Math.min(15000, until - Date.now()));
    if (fresh(p)) found.push(p);
  }
  parentPort.postMessage({ ids, level, want, found, fullBudget, derived });
});
