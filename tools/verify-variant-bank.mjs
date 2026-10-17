// Re-verifies data/variant-bank.json with the current engine and drops anything that
// fails (not unique, not hint-solvable, or not at its stated level). Run before the
// builder in CI, so engine changes can never ship a bad puzzle.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { verifyVariant, gradeVariant, compile, parsePuzzle, comboKey } from "../js/core/index.js";

const OUT = new URL("../data/variant-bank.json", import.meta.url);
if (!existsSync(OUT)) { console.log("no dataset yet"); process.exit(0); }
const bank = JSON.parse(readFileSync(OUT, "utf8"));
const seen = new Set();
const kept = bank.puzzles.filter((p) => {
  const key = comboKey(p.variants ?? [p.variant]) + p.puzzle;
  if (seen.has(key)) return false;
  seen.add(key);
  return verifyVariant(p) && gradeVariant(compile(p.features), parsePuzzle(p.puzzle))?.level === p.difficulty;
});
writeFileSync(OUT, JSON.stringify({ ...bank, puzzles: kept }));
console.log(`verified: kept ${kept.length} of ${bank.puzzles.length}`);
