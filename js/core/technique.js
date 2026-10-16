// Technique catalogue, in solving order (easiest to spot first). Mirrors SudokuCore/Technique.swift.
export const DIFFICULTIES = [
  { id: 1, title: "Easy" }, { id: 2, title: "Medium" }, { id: 3, title: "Hard" },
  { id: 4, title: "Expert" }, { id: 5, title: "Master" },
];
export const difficultyTitle = (d) => DIFFICULTIES[d - 1].title;
const KEY_BY_TITLE = { easy: 1, medium: 2, hard: 3, expert: 4, master: 5 };
export const difficultyFromKey = (k) => KEY_BY_TITLE[k] ?? (typeof k === "number" ? k : null);

export const TECHNIQUES = [
  ["fullHouse", "Full House", 1], ["hiddenSingle", "Hidden Single", 1], ["nakedSingle", "Naked Single", 1],
  ["pointing", "Pointing", 2], ["claiming", "Claiming", 2], ["nakedPair", "Naked Pair", 2], ["hiddenPair", "Hidden Pair", 2],
  ["nakedTriple", "Naked Triple", 3], ["hiddenTriple", "Hidden Triple", 3], ["xWing", "X-Wing", 3],
  ["skyscraper", "Skyscraper", 3], ["twoStringKite", "2-String Kite", 3], ["emptyRectangle", "Empty Rectangle", 3],
  ["nakedQuad", "Naked Quad", 3], ["hiddenQuad", "Hidden Quad", 3],
  ["xyWing", "XY-Wing", 4], ["xyzWing", "XYZ-Wing", 4], ["wWing", "W-Wing", 4], ["swordfish", "Swordfish", 4],
  ["simpleColoring", "Simple Coloring", 4], ["uniqueRectangle", "Unique Rectangle", 5], ["bugPlusOne", "BUG+1", 5],
  ["jellyfish", "Jellyfish", 4], ["xChain", "X-Chain", 5], ["xyChain", "XY-Chain", 5],
].map(([id, name, difficulty], rank) => ({ id, name, difficulty, rank }));

export const T = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));
export const placesDigits = (id) => ["fullHouse", "hiddenSingle", "nakedSingle", "bugPlusOne"].includes(id);

export function makeStep(technique) {
  return { technique, placements: [], eliminations: [], digits: [], units: [], cells: [],
    keyCandidates: [], secondaryCandidates: [], links: [], explanation: "" };
}
