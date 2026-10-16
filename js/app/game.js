import { parsePuzzle, PEERS, UNITS, UNITS_OF, bit, getHint, candidateState, SolveState, nextStep, T,
  compile, VariantState, variantCandidates, variantHint, variantSingleStep, ck, pairOk, groupOk, has } from "../core/index.js";

/** Autocomplete is offered only near the end, so it never solves most of a puzzle for you. */
export const AUTOCOMPLETE_MAX_EMPTY = 9;

/** One game in progress (port of Game.swift). Call `onChange` after mutations. */
export class Game {
  constructor(puzzle, saved = null) {
    this.puzzle = puzzle;
    // Variant puzzles carry their clues; classic ones don't.
    this.cm = puzzle.kind === "variant" && puzzle.features ? compile(puzzle.features) : null;
    this.givens = parsePuzzle(puzzle.puzzle);
    this.solution = parsePuzzle(puzzle.solution);
    this.values = saved?.values?.slice() ?? this.givens.slice();
    this.notes = saved?.notes?.slice() ?? new Array(81).fill(0);
    this.elapsed = saved?.elapsed ?? 0;
    this.mistakes = saved?.mistakes ?? 0;
    this.hintsUsed = saved?.hintsUsed ?? 0;
    this.selected = null;
    this.notesMode = false;
    this.lockMode = false;   // number lock: pick a digit, then tap cells
    this.lockedDigit = null;
    this.paused = false;
    this.undoStack = [];
    this.redoStack = [];
    this.hint = null;
    this.hintLevel = 0;
    this.shake = null;     // cell to shake on next render
    this.pulse = null;     // cells to pulse on next render
    this.autoRemoveNotes = true;
  }

  toJSON() {
    return { puzzle: this.puzzle, values: this.values, notes: this.notes, elapsed: this.elapsed, mistakes: this.mistakes, hintsUsed: this.hintsUsed };
  }
  static fromJSON(j) {
    if (!j || !j.puzzle || !parsePuzzle(j.puzzle.puzzle) || !parsePuzzle(j.puzzle.solution)) return null;
    if (!Array.isArray(j.values) || j.values.length !== 81 || !Array.isArray(j.notes) || j.notes.length !== 81) return null;
    return new Game(j.puzzle, j);
  }

  /** Candidates implied by the board (and the player's notes, if given). */
  candidateState(withNotes = true) {
    if (this.cm) return variantCandidates(this.cm, this.values, withNotes ? this.notes : null);
    return withNotes ? candidateState(this.values, this.notes) : new SolveState(this.values);
  }

  /**
   * Variant-specific highlights for the selected cell: its mirror on a palindrome
   * line, and the cells a knight's / king's move away in Anti-Knight / Anti-King.
   */
  variantFocus() {
    const out = new Map();
    const c = this.selected, f = this.puzzle.features;
    if (c === null || !f) return out;
    for (const line of f.palindromes ?? []) {
      const i = line.cells.indexOf(c);
      if (i < 0) continue;
      const m = line.cells[line.cells.length - 1 - i];
      if (m !== c) out.set(m, "mirror");
    }
    const r = Math.floor(c / 9), k = c % 9;
    const mark = (offs, cls) => {
      for (const [dr, dc] of offs) {
        const rr = r + dr, cc = k + dc;
        if (rr >= 0 && rr < 9 && cc >= 0 && cc < 9 && !out.has(rr * 9 + cc)) out.set(rr * 9 + cc, cls);
      }
    };
    if (f.rules?.antiKnight) mark([[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]], "knight");
    if (f.rules?.antiKing) mark([[-1, -1], [-1, 1], [1, -1], [1, 1]], "knight");
    return out;
  }

  /**
   * Pencil marks that break a rule given the digits already placed: the digit is in a
   * peer cell, or (variants) it breaks shading, a pair clue or a group clue outright.
   * Returns a Set of ck(cell, digit).
   */
  noteConflicts() {
    const out = new Set();
    const v = this.values;
    for (let c = 0; c < 81; c++) {
      if (v[c] || !this.notes[c]) continue;
      for (let d = 1; d <= 9; d++) {
        if (!has(this.notes[c], d)) continue;
        if (this.isNoteBlocked(c, d)) out.add(ck(c, d));
      }
    }
    return out;
  }

  isNoteBlocked(c, d) {
    const v = this.values;
    for (const p of this.peersOf(c)) if (v[p] === d) return true;
    const cm = this.cm;
    if (!cm) return false;
    if (!(cm.cellMask[c] & bit(d))) return true;
    for (const p of cm.pairsOf[c]) {
      const other = p.a === c ? p.b : p.a;
      if (!v[other]) continue;
      if (!(p.a === c ? pairOk(p, d, v[other]) : pairOk(p, v[other], d))) return true;
    }
    for (const g of cm.groupsOf[c]) {
      const vals = g.cells.map((x) => (x === c ? d : v[x]));
      if (!groupOk(g, vals)) return true;
    }
    return false;
  }

  /** Every cell that can't share a digit with `c` (variant rules included). */
  peersOf(c) { return this.cm ? this.cm.peers[c] : PEERS[c]; }

  get isSolved() { return this.values.every((v, i) => v === this.solution[i]); }
  isGiven(c) { return this.givens[c] !== 0; }
  isWrong(c) { return this.values[c] !== 0 && this.values[c] !== this.solution[c]; }
  placedCount(d) { return this.values.filter((v) => v === d).length; }
  get highlightDigit() {
    if (this.lockMode && this.lockedDigit) return this.lockedDigit;
    return this.selected !== null && this.values[this.selected] ? this.values[this.selected] : null;
  }

  // ---- Number lock ----
  toggleLock() {
    this.lockMode = !this.lockMode;
    if (this.lockMode && !this.lockedDigit && this.selected !== null && this.values[this.selected]) this.lockedDigit = this.values[this.selected];
    if (this.lockMode) this.selected = null;
    else this.lockedDigit = null;
  }

  /** Keypad press: in lock mode it chooses the digit (press again to release it); otherwise it enters it. */
  pressDigit(d) {
    if (this.lockMode) {
      // No focused cell in lock mode: the digit's highlight is the focus.
      this.lockedDigit = this.lockedDigit === d ? null : d;
      this.selected = null;
      return;
    }
    this.input(d);
  }

  /** Once all nine of the locked digit are placed, move on to the next digit that isn't finished. */
  advanceLockIfDone() {
    const d = this.lockedDigit;
    if (!d || this.placedCount(d) < 9) return;
    this.lockedDigit = null;
    for (let k = 1; k <= 8; k++) {
      const next = ((d - 1 + k) % 9) + 1;
      if (this.placedCount(next) < 9) { this.lockedDigit = next; return; }
    }
  }

  /** Board tap: in lock mode with a digit chosen, applies it to the tapped cell. */
  tapCell(c) {
    if (!this.lockMode) { this.selected = this.selected === c ? null : c; return; }
    const v = this.values[c];
    // Tapping a filled cell switches the lock to its digit (or locks it, if none is chosen yet).
    if (v && v !== this.lockedDigit) { this.lockedDigit = v; return; }
    if (!this.lockedDigit || this.isGiven(c)) return;
    // Apply to the tapped cell without leaving it selected (keyboard users keep their cursor).
    const cursor = this.selected;
    this.selected = c;
    if (!this.notesMode && v === this.lockedDigit) this.erase();
    else this.input(this.lockedDigit);
    this.selected = cursor;
    this.advanceLockIfDone();
  }

  // ---- Autocomplete ----
  /** Cells (in solving order) if the rest needs only singles and the board has no mistakes; else null. */
  autocompletePlan() {
    if (this.isSolved || this.values.some((v, c) => v && v !== this.solution[c])) return null;
    const empty = this.values.filter((v) => v === 0).length;
    if (empty === 0 || empty > AUTOCOMPLETE_MAX_EMPTY) return null;
    const s = this.cm ? new VariantState(this.cm, this.values) : new SolveState(this.values);
    const order = [];
    while (!s.isSolved) {
      const st = this.cm ? variantSingleStep(s) : nextStep(s, T.nakedSingle.rank);
      if (!st) return null;
      for (const p of st.placements) if (!s.values[p.cell]) order.push(p);
      s.apply(st);
    }
    return order.every((p) => p.digit === this.solution[p.cell]) ? order : null;
  }

  /** Starts autocomplete: one undo step for the whole fill. Call fillNext() until it returns false. */
  beginAutocomplete() {
    const plan = this.autocompletePlan();
    if (!plan) return null;
    this.checkpoint();
    this.lockMode = false; this.lockedDigit = null;
    return plan;
  }

  fillCell(p) {
    this.values[p.cell] = p.digit;
    this.notes[p.cell] = 0;
    for (const q of this.peersOf(p.cell)) this.notes[q] &= ~bit(p.digit);
    this.selected = p.cell;
    this.pulseAround(p.cell);
  }

  checkpoint() {
    this.undoStack.push({ values: this.values.slice(), notes: this.notes.slice() });
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
    this.clearHint();
  }

  input(d) {
    const c = this.selected;
    if (c === null || this.isGiven(c) || this.isSolved) return;
    if (this.notesMode) {
      if (this.values[c]) return;
      this.checkpoint();
      this.notes[c] ^= bit(d);
    } else {
      if (this.values[c] === d) return;
      this.checkpoint();
      this.values[c] = d;
      this.notes[c] = 0;
      if (d !== this.solution[c]) { this.mistakes++; this.shake = c; }
      else {
        if (this.autoRemoveNotes) for (const p of this.peersOf(c)) this.notes[p] &= ~bit(d);
        this.pulseAround(c);
      }
    }
  }

  erase() {
    const c = this.selected;
    if (c === null || this.isGiven(c) || (!this.values[c] && !this.notes[c])) return;
    this.checkpoint();
    this.values[c] = 0; this.notes[c] = 0;
  }

  undo() {
    const s = this.undoStack.pop(); if (!s) return;
    this.redoStack.push({ values: this.values.slice(), notes: this.notes.slice() });
    this.values = s.values; this.notes = s.notes; this.clearHint();
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return;
    this.undoStack.push({ values: this.values.slice(), notes: this.notes.slice() });
    this.values = s.values; this.notes = s.notes; this.clearHint();
  }

  /** True when every empty cell has pencil marks (so the button offers to clear them). */
  get notesFilled() {
    let any = false;
    for (let c = 0; c < 81; c++) if (!this.values[c]) { if (!this.notes[c]) return false; any = true; }
    return any;
  }

  fillAllNotes() {
    this.checkpoint();
    const s = this.candidateState(false);
    for (let c = 0; c < 81; c++) if (!this.values[c]) this.notes[c] = s.cands[c];
  }

  clearAllNotes() {
    this.checkpoint();
    this.notes = new Array(81).fill(0);
  }

  /** Fill notes button: fills every cell's notes, or clears them if they're already filled. */
  toggleAllNotes() {
    if (this.notesFilled) this.clearAllNotes(); else this.fillAllNotes();
  }

  pulseAround(c) {
    const cells = new Set();
    for (const u of UNITS_OF[c]) if (UNITS[u].every((x) => this.values[x] === this.solution[x])) UNITS[u].forEach((x) => cells.add(x));
    if (cells.size) this.pulse = [...cells];
  }

  /** Each request goes one level deeper: 1 technique, 2 where, 3 the move. */
  requestHint() {
    if (!this.hint) {
      this.hint = this.cm ? variantHint(this.cm, this.values, this.notes, this.solution) : getHint(this.values, this.notes, this.solution);
      this.hintLevel = 1;
      this.hintsUsed++;
    } else if (this.hint.kind === "step" && this.hintLevel < 3) this.hintLevel++;
  }
  clearHint() { this.hint = null; this.hintLevel = 0; }

  applyHint() {
    if (this.hint?.kind !== "step") return;
    const st = this.hint.step;
    const state = this.candidateState();
    this.checkpoint();
    for (const e of st.eliminations) {
      if (this.values[e.cell]) continue;
      if (!this.notes[e.cell]) this.notes[e.cell] = state.cands[e.cell];
      this.notes[e.cell] &= ~bit(e.digit);
    }
    for (const p of st.placements) {
      this.values[p.cell] = p.digit; this.notes[p.cell] = 0;
      if (this.autoRemoveNotes) for (const q of this.peersOf(p.cell)) this.notes[q] &= ~bit(p.digit);
      this.selected = p.cell;
      this.pulseAround(p.cell);
    }
  }

  fixHintProblem() {
    const h = this.hint; if (!h) return;
    if (h.kind === "mistakes") { this.checkpoint(); for (const c of h.cells) this.values[c] = 0; }
    else if (h.kind === "badNotes") {
      const cells = h.cells;
      this.checkpoint();
      const s = this.candidateState(false);
      for (const c of cells) this.notes[c] = s.cands[c];
    }
  }

  revealCell() {
    const c = this.selected;
    if (c === null || this.values[c] === this.solution[c]) return;
    this.checkpoint();
    this.values[c] = this.solution[c]; this.notes[c] = 0; this.hintsUsed++;
    this.pulseAround(c);
  }
}
