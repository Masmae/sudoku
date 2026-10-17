// Worker: generates variant puzzles at an exact level.
import { parentPort } from "node:worker_threads";
import { setPriority } from "node:os";
try { setPriority(19); } catch { /* lowest priority where allowed */ }
import { generateVariant, verifyVariant } from "../js/core/index.js";

parentPort.on("message", ({ ids, level, want, budgetMs }) => {
  const found = [];
  const until = Date.now() + budgetMs;
  while (found.length < want && Date.now() < until) {
    const p = generateVariant(ids, level, Math.random, Math.min(15000, until - Date.now()));
    if (p && p.difficulty === level && verifyVariant(p) && !found.some((q) => q.puzzle === p.puzzle)) found.push(p);
  }
  parentPort.postMessage({ ids, level, want, found });
});
