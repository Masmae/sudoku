// Folds freshly built puzzles into data/variant-bank.json.
//   node tools/merge-variant-bank.mjs new1.json [new2.json …]
// Each input is { puzzles: [...], misses: {...} } as written by build-variant-bank.mjs --new-out.
// Safe to run again on a newer copy of the dataset (used when a push has to be retried).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { comboKey } from "../js/core/index.js";

const OUT = new URL("../data/variant-bank.json", import.meta.url);
const bank = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const puzzles = bank.puzzles ?? [], misses = bank.misses ?? {};
const seen = new Set(puzzles.map((p) => comboKey(p.variants ?? [p.variant]) + p.puzzle));
let added = 0;
for (const file of process.argv.slice(2)) {
  let part;
  try { part = JSON.parse(readFileSync(file, "utf8")); } catch { console.log(`skipping ${file} (not readable)`); continue; }
  for (const p of part.puzzles ?? []) {
    const key = comboKey(p.variants ?? [p.variant]) + p.puzzle;
    if (seen.has(key)) continue;
    seen.add(key); puzzles.push(p); added++;
  }
  for (const [k, n] of Object.entries(part.misses ?? {})) misses[k] = (misses[k] ?? 0) + n;
}
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), misses, puzzles }));
console.log(`merged: ${added} new, ${puzzles.length} in all`);
