import { SolveState } from "./state.js";
import { has } from "./geo.js";
import { nextStep } from "./solver.js";

/** Candidates implied by placed digits, narrowed by the player's notes where they have any. */
export function candidateState(values, notes) {
  const s = new SolveState(values);
  for (let c = 0; c < 81; c++) {
    if (values[c] === 0 && notes[c] && (s.cands[c] & notes[c])) s.cands[c] &= notes[c];
  }
  return s;
}

/** Same order as the Swift HintEngine: mistakes, then bad notes, then the easiest step. */
export function getHint(values, notes, solution) {
  const wrong = [];
  for (let c = 0; c < 81; c++) if (values[c] && values[c] !== solution[c]) wrong.push(c);
  if (wrong.length) return { kind: "mistakes", cells: wrong };
  if (!values.includes(0)) return { kind: "solved" };
  const s = new SolveState(values);
  const bad = [];
  for (let c = 0; c < 81; c++) {
    if (values[c] === 0 && notes[c]) {
      if (!has(notes[c], solution[c])) bad.push(c); else s.cands[c] &= notes[c];
    }
  }
  if (bad.length) return { kind: "badNotes", cells: bad };
  const st = nextStep(s);
  return st ? { kind: "step", step: st } : { kind: "stuck" };
}
