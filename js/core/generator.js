import { randomSolution, hasUniqueSolution, bruteSolve } from "./brute.js";
import { shuffle } from "./geo.js";
import { puzzleString } from "./board.js";
import { gradePuzzle } from "./solver.js";

/** Random unique puzzle, clues removed in symmetric pairs until none can go. */
export function randomPuzzle(rand = Math.random) {
  const grid = randomSolution(rand);
  const order = shuffle(Array.from({ length: 41 }, (_, i) => i), rand);
  for (const c of order) {
    const m = 80 - c;
    const a = grid[c], b = grid[m];
    grid[c] = 0; grid[m] = 0;
    if (!hasUniqueSolution(grid)) { grid[c] = a; grid[m] = b; }
  }
  return grid;
}

export function generate(difficulty, rand = Math.random, maxAttempts = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    const values = randomPuzzle(rand);
    if (difficulty === 1) {
      const solved = bruteSolve(values).solution;
      const empties = shuffle(values.map((v, c) => (v ? -1 : c)).filter((c) => c >= 0), rand);
      const add = Math.max(0, 34 - (81 - empties.length));
      for (const c of empties.slice(0, add)) values[c] = solved[c];
    }
    const g = gradePuzzle(puzzleString(values));
    if (g && g.difficulty === difficulty) return g;
  }
  return null;
}
