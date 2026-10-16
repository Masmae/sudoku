// Heavy work (generation, grading, drill search) runs here so the UI stays smooth.
import { generate, gradePuzzle, findDrills, isValidDrill, randomPuzzle, puzzleString, T } from "../core/index.js";

self.onmessage = (e) => {
  const { id, type, args } = e.data;
  let result = null;
  try {
    switch (type) {
      case "generate": result = generate(args.difficulty); break;
      case "grade": result = gradePuzzle(args.puzzle); break;
      case "validateDrills": result = args.drills.filter(isValidDrill); break;
      case "findDrills": result = findDrills(args.technique, args.count); break;
      case "practice": {
        let fallback = null;
        for (let i = 0; i < 6000; i++) {
          const g = gradePuzzle(puzzleString(randomPuzzle()));
          if (!g) continue;
          if (g.hardest === args.technique) { result = g; break; }
          if (!fallback && g.techniques.includes(args.technique)) fallback = g;
        }
        result = result ?? fallback;
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
    return;
  }
  self.postMessage({ id, result });
};
