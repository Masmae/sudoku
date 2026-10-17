import { h, icon, toast } from "./dom.js";
import * as store from "./storage.js";
import { Library } from "./library.js";
import { Game, AUTOCOMPLETE_MAX_EMPTY } from "./game.js";
import { BoardView, highlightsFor, emptyHighlights } from "./boardview.js";
import { CONTENT } from "./content.js";
import {
  TECHNIQUES, T, DIFFICULTIES, difficultyTitle, placesDigits, nudge, resultText, cellName, cellNames,
  candidateState, drillState, firstStep, judgeDrill, ck, has, parsePuzzle, hasNoConflicts, bruteSolve, SolveState, nextStep,
  puzzleString, logicalSolve, gradePuzzle, VARIANTS, VARIANT, VariantState, variantNextStep,
  canCombine, comboKey, comboName, surpriseCombo,
} from "../core/index.js";

// ---------------- App state ----------------
const DEFAULT_SETTINGS = { showMistakes: true, autoRemoveNotes: true, showRemaining: true, autocomplete: true, noteWarnings: true, theme: "system" };
const app = {
  lib: new Library(),
  settings: { ...DEFAULT_SETTINGS, ...store.load("settings", {}) },
  stats: store.load("stats", { solved: {}, best: {} }),
  progress: store.load("progress", {}),
  game: Game.fromJSON(store.load("game", null)),
  busy: false,
};
const root = document.getElementById("view");
/** Append children to the view, flattening arrays and skipping null/false. */
/** replaceChildren that skips null/false (the DOM version would print "null"). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const mount = (...kids) => root.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
let cleanup = () => {};

function saveSettings() { store.save("settings", app.settings); applyTheme(); }
function applyTheme() {
  if (app.settings.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", app.settings.theme);
}
function saveGame() { if (app.game && !app.game.isSolved) store.save("game", app.game); else store.remove("game"); }
const correct = (t) => app.progress[t] ?? 0;
const timeString = (t) => {
  const s = Math.floor(t);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const dots = (n) => h("span", { class: "dots", "aria-label": `${n} of 3 drills correct` }, [0, 1, 2].map((i) => h("i", { class: i < n ? "on" : "" })));

/** "Killer · Medium" for variants, "Hard" for classic. */
const variantIds = (p) => p.variants ?? [p.variant];
const puzzleTitle = (p) => (p.kind === "variant" ? `${comboName(variantIds(p))} · ${difficultyTitle(p.difficulty)}` : difficultyTitle(p.difficulty));

/** Rules dialog for one variant or a mix (accepts an id, a list of ids, or a puzzle). */
/**
 * Generates a variant puzzle at `level`. If the generator only finds an easier one in
 * time, asks whether to play that or keep looking. Resolves to a puzzle or null.
 */
async function obtainVariant(ids, level, onStatus) {
  const name = comboName([].concat(ids));
  // Instant: a ready puzzle from the pool or the shipped dataset (a replacement is
  // then generated in the background).
  const ready = app.lib.takeVariant(ids, level);
  if (ready) return ready;
  for (let round = 1; ; round++) {
    onStatus(`Making a ${difficultyTitle(level).toLowerCase()} ${name} puzzle…${level >= 3 ? ` ${difficultyTitle(level)} ones can take up to 15 seconds.` : ""}${round > 1 ? ` (try ${round})` : ""}`);
    const p = await app.lib.nextVariant(ids, level);
    if (!p) return null;
    if (round === 1) app.lib.owe(app.lib.constructor.variantKey(ids, level));   // one spare for next time
    if (p.difficulty >= level) return p;   // harder than asked is fine: it's labelled honestly
    const choice = await ask(`No ${difficultyTitle(level)} puzzle yet`,
      `The best ${name} puzzle found so far is ${difficultyTitle(p.difficulty)}. Play it, or keep looking for a ${difficultyTitle(level)} one?`,
      [["cancel", "Cancel"], ["play", `Play ${difficultyTitle(p.difficulty)}`], ["wait", "Keep looking", true]]);
    if (choice === "play") return p;
    if (choice !== "wait") return null;
  }
}

/** Small modal with buttons; resolves to the chosen button's value (or "cancel"). */
function ask(title, message, buttons) {
  return new Promise((resolve) => {
    let value = "cancel";
    // Main choice first, Cancel last, stacked full-width (fits phones).
    const ordered = [...buttons.filter((b) => b[2]), ...buttons.filter((b) => !b[2] && b[0] !== "cancel"), ...buttons.filter((b) => b[0] === "cancel")];
    const dlg = h("dialog", {}, h("h2", {}, title), h("p", {}, message),
      h("div", { class: "btn-stack" },
        ordered.map(([v, label, primary]) => h("button", { class: "btn block" + (primary ? " primary" : ""), onclick: () => { value = v; dlg.close(); } }, label))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(value); });
    document.body.append(dlg); dlg.showModal();
  });
}

function showRules(what) {
  const ids = typeof what === "string" ? [what] : Array.isArray(what) ? what : variantIds(what);
  const vs = ids.map((id) => VARIANT[id]);
  const extra = (v) => v.rules.replace(/^Normal Sudoku rules\. /, "");
  const body = vs.length === 1 ? h("p", {}, vs[0].rules)
    : h("div", {}, h("p", {}, "Normal Sudoku rules, plus all of these:"), h("ul", { class: "rules-list" }, vs.map((v) => h("li", {}, h("b", {}, v.name + ": "), extra(v)))));
  const dlg = h("dialog", {}, h("h2", {}, `${comboName(ids)} rules`), body,
    h("div", { class: "btn-row" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => dlg.close() }, "Got it")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

function startGame(p) {
  app.lib.markPlayed(p);
  app.game = new Game(p);
  saveGame();
  location.hash = "#/game";
}

// ---------------- Router ----------------
function route() {
  cleanup(); cleanup = () => {};
  root.replaceChildren();
  const [, page, arg] = (location.hash || "#/play").split("/");
  document.querySelectorAll(".tabbar a").forEach((a) => {
    const tab = a.dataset.tab;
    const active = tab === page || (tab === "play" && (page === "game" || page === "path" || page === "variants")) || (tab === "learn" && page === "drill");
    active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  switch (page) {
    case "game": return app.game ? viewGame() : (location.hash = "#/play");
    case "learn": return arg && T[arg] ? viewTechnique(arg) : viewLearn();
    case "drill": return T[arg] ? viewDrill(arg) : (location.hash = "#/learn");
    case "settings": return viewSettings();
    case "variants": return viewVariants();
    case "path": return app.game ? viewPath(arg === "start" ? "start" : "current") : (location.hash = "#/play");
    default: return viewPlay();
  }
}

// ---------------- Play home ----------------
function viewPlay() {
  const g = app.game;
  const levels = DIFFICULTIES.map((d) => {
    const names = TECHNIQUES.filter((t) => t.difficulty === d.id).slice(0, 4).map((t) => t.name).join(", ") + (d.id > 1 ? "…" : "");
    const solved = app.stats.solved[d.id] ?? 0;
    const row = h("button", { class: "row", onclick: async () => {
      if (app.busy) return;
      app.busy = true;
      row.querySelector(".badge").replaceChildren(h("span", { class: "spinner" }), " Making a puzzle…");
      try {
        const p = await app.lib.next(d.id);
        if (p) startGame(p); else toast(`Couldn't make a ${d.title} puzzle. Try again.`);
      } catch (e) { toast("Something went wrong: " + e.message); }
      finally { app.busy = false; }
    } },
      h("div", { class: "grow" }, h("div", { class: "title" }, d.title), h("div", { class: "sub" }, names)),
      h("span", { class: "badge" }, solved ? `${solved} solved` : ""), h("span", { class: "chev" }, icon("chevron")));
    return row;
  });
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Sudoku")),
    g && !g.isSolved ? h("div", { class: "section" }, h("div", { class: "list" },
      h("a", { class: "row", href: "#/game" },
        h("div", { class: "grow" }, h("div", { class: "title" }, "Continue"), h("div", { class: "sub" }, `${puzzleTitle(g.puzzle)} · ${timeString(g.elapsed)}`)),
        h("span", { class: "chev" }, icon("chevron"))))) : null,
    h("div", { class: "section" }, h("h2", {}, "New game"), h("div", { class: "list" }, levels)),
    h("div", { class: "section" }, h("h2", {}, "Variants"), h("div", { class: "list" },
      h("a", { class: "row", href: "#/variants" },
        h("div", { class: "grow" }, h("div", { class: "title" }, `${VARIANTS.length} Sudoku variants`),
          h("div", { class: "sub" }, VARIANTS.slice(0, 6).map((v) => v.name).join(", ") + "…")),
        h("span", { class: "chev" }, icon("chevron"))))),
    h("div", { class: "section" }, h("div", { class: "list" },
      h("button", { class: "row", onclick: openImport }, h("div", { class: "grow title" }, "Import a puzzle"), h("span", { class: "chev" }, icon("chevron")))),
      h("p", { class: "footnote" }, "Paste an 81-character puzzle from a book or website. It's checked before you play it.")),
  );
}

function openImport() {
  const ta = h("textarea", { placeholder: "e.g. 53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79", spellcheck: "false", "aria-label": "Puzzle" });
  const status = h("p", { class: "small muted", role: "status" });
  const dlg = h("dialog", {},
    h("h2", {}, "Import puzzle"),
    h("p", { class: "small muted" }, "81 characters, row by row: digits for clues, 0 or . for blanks. Spaces and line breaks are ignored."),
    ta, status,
    h("div", { class: "btn-row" }, h("span", { class: "spacer" }),
      h("button", { class: "btn", onclick: () => dlg.close() }, "Cancel"),
      h("button", { class: "btn primary", onclick: () => {
        // Strict: keep only digits and dots; never interpret anything else.
        const cleaned = [...ta.value.slice(0, 400)].filter((c) => /[0-9.]/.test(c)).join("");
        if (cleaned.length !== 81) { status.textContent = `Found ${cleaned.length} digits — need exactly 81.`; return; }
        const values = parsePuzzle(cleaned);
        if (!values || !hasNoConflicts(values)) { status.textContent = "A digit repeats in a row, column or box."; return; }
        const b = bruteSolve(values, 2);
        if (b.count !== 1) { status.textContent = b.count === 0 ? "This puzzle has no solution." : "This puzzle has more than one solution."; return; }
        let g = gradePuzzle(cleaned);
        if (!g) {
          const r = logicalSolve(values);
          const used = new Set(r.steps.map((s) => s.technique));
          g = { puzzle: puzzleString(values), solution: puzzleString(b.solution), difficulty: 5, hardest: "xyChain",
                techniques: TECHNIQUES.filter((t) => used.has(t.id)).map((t) => t.id), beyond: true };
          toast("This one goes beyond the app's techniques — hints may run out.", 3500);
        }
        dlg.close(); startGame(g);
      } }, "Play")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------- Game ----------------
function viewGame() {
  const g = app.game;
  g.autoRemoveNotes = app.settings.autoRemoveNotes;
  let animating = false;
  const board = new BoardView({ onTap: (i) => { if (animating || g.paused) return; g.tapCell(i); afterMove(); } });
  const timeEl = h("span", { class: "stat time" }, timeString(g.elapsed));
  const pauseBtn = h("button", { class: "pause-btn", "aria-label": "Pause", onclick: () => { g.paused = !g.paused; update(); } }, icon("pause"));
  const mistakesEl = h("span", { class: "stat" });
  const hintsEl = h("span", { class: "stat hints" });
  const resumeBtn = h("button", { class: "resume", onclick: () => { g.paused = false; update(); } }, icon("play"), "Resume");
  const side = h("div", { class: "side" });
  const menuBtn = h("button", { class: "menu-btn", "aria-label": "More actions", onclick: openMenu }, icon("more"));
  mount(h("div", { class: "game" },
    h("div", { class: "board-col" },
      h("div", { class: "game-top" }, h("a", { class: "icon-btn", href: "#/play", "aria-label": "Back" }, icon("back")),
        h("span", { class: "grow" }), hintsEl,
        g.cm ? h("button", { class: "menu-btn rules-btn", "aria-label": "Rules", onclick: () => showRules(g.puzzle) }, "Rules") : null,
        menuBtn),
      h("div", { class: "game-status" }, mistakesEl, h("span", { class: "level" }, puzzleTitle(g.puzzle)),
        h("span", { class: "timer" }, timeEl, pauseBtn)),
      h("div", { class: "board-holder" }, board.el, resumeBtn)),
    side));

  function act(fn) { return () => { if (animating) return; fn(); afterMove(); }; }

  async function runAutocomplete() {
    if (animating) return;
    const plan = g.beginAutocomplete();
    if (!plan) return;
    animating = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const p of plan) {
      g.fillCell(p);
      update();
      if (!reduce) await new Promise((r) => setTimeout(r, 70));
    }
    animating = false;
    afterMove();
  }
  function afterMove() {
    update();
    saveGame();
    if (g.isSolved) onSolved();
  }

  function update() {
    const wrong = new Set();
    if (app.settings.showMistakes) for (let c = 0; c < 81; c++) if (g.isWrong(c)) wrong.add(c);
    let notes = g.notes, hl = emptyHighlights();
    if (g.hint?.kind === "step") {
      hl = highlightsFor(g.hint.step, g.hintLevel);
      if (g.hintLevel >= 2) notes = g.candidateState().cands;
    } else if (g.hint?.kind === "mistakes" || g.hint?.kind === "badNotes") {
      hl.flagged = new Set(g.hint.cells);
    }
    board.el.classList.toggle("paused", !!g.paused);
    resumeBtn.hidden = !g.paused;
    pauseBtn.replaceChildren(icon(g.paused ? "play" : "pause"));
    pauseBtn.setAttribute("aria-label", g.paused ? "Resume" : "Pause");
    board.setVariant(g.puzzle.kind === "variant" ? g.puzzle.features : null);
    board.render({ values: g.values, given: (c) => g.isGiven(c), notes, wrong, selected: g.selected, highlightDigit: g.highlightDigit,
      digitMode: g.lockMode && !!g.lockedDigit, extra: g.variantFocus(), hl, shake: g.shake, pulse: g.pulse,
      noteConflicts: app.settings.noteWarnings && notes === g.notes ? g.noteConflicts() : null });
    g.shake = null; g.pulse = null;
    mistakesEl.replaceChildren(app.settings.showMistakes ? `Mistakes: ${g.mistakes}` : "");
    mistakesEl.className = "stat" + (g.mistakes ? " bad" : "");
    hintsEl.replaceChildren(g.hintsUsed ? `${g.hintsUsed} hint${g.hintsUsed === 1 ? "" : "s"}` : "");
    const plan = app.settings.autocomplete && !animating ? g.autocompletePlan() : null;
    fill(side, 
      g.hint ? hintPanel() : null,
      plan ? h("button", { class: "btn primary block autocomplete", onclick: runAutocomplete },
        icon("wand"), `Autocomplete — only singles left (${plan.length} cell${plan.length === 1 ? "" : "s"})`) : null,
      g.lockMode && !g.lockedDigit ? h("p", { class: "lock-hint" }, "Choose a digit, then tap cells to place it.") : null,
      tools(),
      keypad(),
      h("p", { class: "kbd-help" }, h("kbd", {}, "1–9"), " enter  ", h("kbd", {}, "⇧1–9"), " note  ", h("kbd", {}, "arrows"), " move  ",
        h("kbd", {}, "N"), " notes  ", h("kbd", {}, "F"), " fill/clear notes  ", h("kbd", {}, "L"), " lock  ", h("kbd", {}, "A"), " autocomplete  ", h("kbd", {}, "H"), " hint  ", h("kbd", {}, "P"), " pause  ", h("kbd", {}, "⌫"), " erase  ", h("kbd", {}, "⌘Z"), " undo"),
    );
  }

  function tools() {
    const t = (label, ic, fn, { active = false, disabled = false, pill = false } = {}) =>
      h("button", { class: "tool" + (active ? " active" : ""), disabled, onclick: fn, "aria-pressed": pill ? String(active) : null },
        h("span", { class: "tool-icon" }, icon(ic), pill ? h("span", { class: "pill" + (active ? " on" : "") }, active ? "ON" : "OFF") : null), label);
    return h("div", { class: "tools" },
      t("Undo", "undo", act(() => g.undo()), { disabled: !g.undoStack.length }),
      t("Redo", "redo", act(() => g.redo()), { disabled: !g.redoStack.length }),
      t("Erase", "erase", act(() => g.erase())),
      t("Notes", "pencil", () => { g.notesMode = !g.notesMode; update(); }, { active: g.notesMode, pill: true }),
      g.notesFilled
        ? t("Clear notes", "fill", act(() => g.toggleAllNotes()), { active: true })
        : t("Fill notes", "fill", act(() => g.toggleAllNotes()), { disabled: g.isSolved }),
      t("Lock", "lock", () => { g.toggleLock(); update(); }, { active: g.lockMode, pill: true }),
      t("Hint", "bulb", () => { g.requestHint(); update(); saveGame(); }, { disabled: g.isSolved }));
  }

  function keypad() {
    const keys = [];
    for (let d = 1; d <= 9; d++) {
      const left = Math.max(0, 9 - g.placedCount(d));
      const done = left === 0;
      const locked = g.lockMode ? g.lockedDigit === d : g.highlightDigit === d;
      keys.push(h("button", { class: "key" + (done && !g.notesMode && !locked ? " done" : "") + (locked ? " locked" : ""),
        "aria-label": g.lockMode ? `Lock ${d}` : g.notesMode ? `Note ${d}` : `${d}, ${left} left`, "aria-pressed": g.lockMode ? String(locked) : null,
        onclick: act(() => g.pressDigit(d)) }, h("b", {}, String(d)), app.settings.showRemaining ? h("small", {}, done ? "✓" : String(left)) : null));
    }
    return h("div", { class: "keypad" + (g.notesMode ? " notes-mode" : "") + (g.selected === null && !g.lockMode ? " disabled" : "") }, keys);
  }

  function hintPanel() {
    const hint = g.hint;
    let title = "", msg = "", actions = [];
    const close = h("button", { class: "close", "aria-label": "Close hint", onclick: () => { g.clearHint(); update(); } }, "✕");
    if (hint.kind === "step") {
      const st = hint.step, t = T[st.technique];
      title = t.name;
      msg = g.hintLevel === 1 ? `${nudge(st)} (${difficultyTitle(t.difficulty)} technique)`
        : g.hintLevel === 2 ? "The pattern is highlighted. Can you see what it eliminates?"
        : `${st.explanation}\n\n${resultText(st)}`;
      actions = [
        CONTENT[st.technique] ? h("a", { class: "btn", href: `#/learn/${st.technique}` }, `Learn ${t.name}`)
          : g.cm ? h("button", { class: "btn", onclick: () => showRules(g.puzzle) }, "Rules") : null,
        h("span", { class: "spacer" }),
        g.hintLevel < 3
          ? h("button", { class: "btn primary", onclick: () => { g.requestHint(); update(); } }, g.hintLevel === 1 ? "Show where" : "Show the move")
          : h("button", { class: "btn primary", onclick: act(() => { g.applyHint(); g.clearHint(); }) }, "Apply"),
      ];
    } else if (hint.kind === "mistakes") {
      title = "Check your entries";
      msg = hint.cells.length === 1 ? `${cellName(hint.cells[0])} doesn't match the solution.` : `${hint.cells.length} entries don't match the solution: ${cellNames(hint.cells)}.`;
      actions = [h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: act(() => { g.fixHintProblem(); }) }, "Clear mistakes")];
    } else if (hint.kind === "badNotes") {
      title = "Check your notes";
      msg = `Your notes in ${cellNames(hint.cells)} rule out the correct digit, so hints from here would mislead you.`;
      actions = [h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: act(() => { g.fixHintProblem(); }) }, "Fix those notes")];
    } else if (hint.kind === "solved") { title = "Solved"; msg = "Nothing left to do!"; }
    else { title = "No step found"; msg = "None of the techniques in this app finds a step from here. This puzzle needs something more exotic (forcing chains, ALS…). Select a cell and use ••• → Reveal cell instead."; }
    const legend = hint.kind === "step" && g.hintLevel >= 2 ? h("div", { class: "legend" },
      h("span", {}, h("i", { style: { background: "var(--key)" } }), "pattern"),
      hint.step.secondaryCandidates.length ? h("span", {}, h("i", { style: { background: "var(--secondary)" } }), "second color") : null,
      g.hintLevel >= 3 && hint.step.eliminations.length ? h("span", {}, h("i", { style: { boxShadow: "inset 0 0 0 1.5px var(--elim)" } }), "removed") : null,
      hint.step.links.length ? h("span", {}, h("i", { style: { background: "var(--link)", borderRadius: "2px", height: "3px", width: "14px" } }), "solid = strong, dashed = weak") : null) : null;
    return h("section", { class: "hint", "aria-live": "polite" },
      h("div", { class: "hint-head" }, icon("bulb"), h("h3", {}, title), close),
      h("p", {}, msg), legend, actions.length ? h("div", { class: "btn-row" }, actions) : null);
  }

  function openMenu() {
    const item = (label, fn, disabled = false) => h("button", { class: "row", disabled, onclick: () => { dlg.close(); fn(); } }, h("div", { class: "grow title" }, label));
    const dlg = h("dialog", {}, h("h2", {}, "Game"), h("div", { class: "list" },
      item("Reveal selected cell", act(() => g.revealCell()), g.selected === null),
      item("Step through the solution", () => {
        if (confirm("This shows every remaining step, which spoils the puzzle. Continue?")) location.hash = "#/path/current";
      }),
      item("Restart this puzzle", () => { if (confirm("Restart this puzzle? Your progress on it will be cleared.")) { app.game = new Game(g.puzzle); saveGame(); route(); } }),
      item("New puzzle", () => { location.hash = "#/play"; })),
      h("div", { class: "btn-row", style: { marginTop: "12px" } }, h("span", { class: "spacer" }), h("button", { class: "btn", onclick: () => dlg.close() }, "Close")));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  function onSolved() {
    const k = g.puzzle.difficulty;
    if (g.puzzle.kind === "variant") {
      app.stats.variants = app.stats.variants ?? {};
      const key = comboKey(variantIds(g.puzzle));
      app.stats.variants[key] = (app.stats.variants[key] ?? 0) + 1;
    } else {
      app.stats.solved[k] = (app.stats.solved[k] ?? 0) + 1;
      if (g.hintsUsed === 0) app.stats.best[k] = Math.min(app.stats.best[k] ?? Infinity, g.elapsed);
    }
    store.save("stats", app.stats);
    store.remove("game");
    const dlg = h("dialog", {}, h("div", { class: "solved" },
      h("div", { class: "big" }, "✓"), h("h2", {}, "Solved!"),
      h("p", { class: "muted" }, `${puzzleTitle(g.puzzle)} · ${timeString(g.elapsed)} · ${g.mistakes} mistakes · ${g.hintsUsed} hints`),
      h("div", { class: "card" }, h("div", { class: "small muted" }, "Techniques this puzzle needed"),
        h("div", {}, g.puzzle.techniques.map((t) => T[t].name).join(" · "))),
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => dlg.close() }, "Done"),
        h("button", { class: "btn", onclick: () => { dlg.close(); location.hash = "#/path/start"; } }, "Review solution path"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn primary", onclick: async () => {
          dlg.close();
          const p = g.puzzle.kind === "variant" ? await app.lib.nextVariant(variantIds(g.puzzle), k) : await app.lib.next(k);
          if (p) startGame(p);
        } }, `New ${puzzleTitle(g.puzzle)} puzzle`))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  // Keyboard
  const onKey = (e) => {
    if (document.querySelector("dialog[open]") || animating) return;
    if (g.paused && !(e.key === "p" || e.key === "P")) return;
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z") { e.preventDefault(); act(() => (e.shiftKey ? g.redo() : g.undo()))(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      const d = Number(digit[1]);
      if (e.shiftKey) { const m = g.notesMode; g.notesMode = true; g.input(d); g.notesMode = m; afterMove(); }
      else act(() => g.pressDigit(d))();
      return;
    }
    const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (k in moves) {
      e.preventDefault();
      const s = g.selected ?? 40;
      const r = Math.floor(s / 9), c = s % 9;
      const nr = (r + (k === "ArrowUp" ? 8 : k === "ArrowDown" ? 1 : 0)) % 9, nc = (c + (k === "ArrowLeft" ? 8 : k === "ArrowRight" ? 1 : 0)) % 9;
      g.selected = g.selected === null ? 40 : nr * 9 + nc; update(); return;
    }
    if (k === "Backspace" || k === "Delete" || k === "0") { e.preventDefault(); act(() => g.erase())(); return; }
    if (k === "n" || k === "N") { g.notesMode = !g.notesMode; update(); return; }
    if (k === "p" || k === "P") { g.paused = !g.paused; update(); return; }
    if (k === "f" || k === "F") { act(() => g.toggleAllNotes())(); return; }
    if (k === "l" || k === "L") { g.toggleLock(); update(); return; }
    if ((k === "a" || k === "A") && app.settings.autocomplete) { runAutocomplete(); return; }
    if ((k === " " || k === "Enter") && g.lockMode && g.lockedDigit && g.selected !== null) { e.preventDefault(); act(() => g.tapCell(g.selected))(); return; }
    if (k === "h" || k === "H") { g.requestHint(); update(); saveGame(); return; }
    if (k === "Escape") { if (g.hint) g.clearHint(); else g.selected = null; update(); }
  };
  document.addEventListener("keydown", onKey);
  const timer = setInterval(() => {
    if (document.visibilityState === "visible" && !g.isSolved && !g.paused) {
      g.elapsed++;
      timeEl.lastChild.textContent = timeString(g.elapsed);
      if (g.elapsed % 5 === 0) saveGame();
    }
  }, 1000);
  cleanup = () => { document.removeEventListener("keydown", onKey); clearInterval(timer); saveGame(); };
  update();
}

// ---------------- Variants ----------------
const VARIANT_LEVEL_LIST = [[1, "Easy"], [2, "Medium"], [3, "Hard"], [4, "Expert"], [5, "Master"]];
const VARIANT_GROUPS = [
  ["Cages & lines", ["killer", "thermo", "arrow", "germanWhisper", "renban", "palindrome", "sandwich"]],
  ["Dots & signs", ["kropki", "xv", "greaterThan", "consecutive", "quadruple"]],
  ["Extra rules", ["diagonal", "windoku", "antiKing", "antiKnight", "nonConsecutive", "evenOdd"]],
];
function viewVariants() {
  const solved = app.stats.variants ?? {};
  mount(h("a", { class: "back", href: "#/play" }, icon("back"), "Play"),
    h("div", { class: "page-title" }, h("h1", {}, "Variants")),
    h("p", { class: "muted", style: { margin: "0 4px 16px" } }, "Classic Sudoku plus extra rules. Every puzzle is generated on this device, has exactly one solution, and can be solved with hints."),
    mixCard(),
    VARIANT_GROUPS.map(([title, ids]) => h("div", { class: "section" }, h("h2", {}, title), h("div", { class: "list" },
      ids.map((id) => VARIANT[id]).map((v) => h("button", { class: "row", onclick: () => chooseVariant(v) },
        h("div", { class: "grow" }, h("div", { class: "title" }, v.name), h("div", { class: "sub" }, v.rules.replace(/^Normal Sudoku rules\. /, ""))),
        solved[v.id] ? h("span", { class: "badge" }, `${solved[v.id]} solved`) : null,
        h("span", { class: "chev" }, icon("chevron"))))))));
}

/** Pick 2-3 variants to combine. */
function mixCard() {
  const chosen = [];
  const chips = h("div", { class: "mix-chips" });
  const summary = h("p", { class: "small muted mix-summary" });
  const status = h("p", { class: "small muted", role: "status" });
  const levelRow = h("div", { class: "level-row" });
  const draw = () => {
    chips.replaceChildren(...VARIANTS.map((v) => {
      const on = chosen.includes(v.id);
      const blocked = !on && (chosen.length >= 3 || !canCombine([...chosen, v.id]));
      return h("button", { class: "chip" + (on ? " on" : ""), disabled: blocked, "aria-pressed": String(on),
        onclick: () => { on ? chosen.splice(chosen.indexOf(v.id), 1) : chosen.push(v.id); draw(); } }, v.name);
    }));
    summary.textContent = chosen.length >= 2 ? comboName(chosen) : chosen.length === 1 ? `${VARIANT[chosen[0]].name} + … (pick one or two more)` : "Pick 2 or 3 variants to combine.";
    levelRow.replaceChildren(...VARIANT_LEVEL_LIST.map(([lvl, title]) =>
      h("button", { class: "btn" + (lvl === 2 ? " primary" : ""), disabled: chosen.length < 2, onclick: () => start(chosen.slice(), lvl, title) }, title)));
  };
  async function start(ids, lvl, title) {
    if (ids.length < 2) return;
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const p = await obtainVariant(ids, lvl, (msg) => status.replaceChildren(h("span", { class: "spinner" }), " " + msg));
      if (p) startGame(p);
      else { status.textContent = "No puzzle started. That mix may be too restrictive — try again or pick another."; draw(); }
    } catch (err) { status.textContent = "Something went wrong: " + err.message; draw(); }
  }
  const card = h("div", { class: "section" }, h("h2", {}, "Mix variants"), h("div", { class: "card mix" },
    chips, summary,
    h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: () => {
        // Avoid the current selection and the last 40 surprises.
        const recent = store.load("surpriseRecent", []);
        const avoid = new Set([...recent, ...(chosen.length ? [comboKey(chosen)] : [])]);
        const c = surpriseCombo(Math.random, avoid);
        store.save("surpriseRecent", [comboKey(c), ...recent].slice(0, 40));
        chosen.splice(0, chosen.length, ...c); draw();
      } }, "Surprise me"),
      h("button", { class: "btn", onclick: () => chosen.length >= 2 && showRules(chosen.slice()) }, "Rules")),
    levelRow,
    status));
  draw();
  // Keep the Settings "ready" count current after background refills.
  app.lib.onPoolChange = () => {
    const rc = document.getElementById("ready-count");
    if (rc) rc.textContent = String(app.lib.readyCount());
  };
  return card;
}

function chooseVariant(v) {
  const status = h("p", { class: "small muted", role: "status" });
  const pick = (level, title) => h("button", { class: "btn" + (level === 2 ? " primary" : ""), onclick: async () => {
    dlg.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const p = await obtainVariant(v.id, level, (msg) => status.replaceChildren(h("span", { class: "spinner" }), " " + msg));
      dlg.close();
      if (p) startGame(p);
    } catch (err) { status.textContent = "Something went wrong: " + err.message; dlg.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  } }, title);
  const dlg = h("dialog", {}, h("h2", {}, v.name), h("p", {}, v.rules), status,
    h("div", { class: "level-row" }, VARIANT_LEVEL_LIST.map(([lvl, title]) => pick(lvl, title))),
    h("div", { class: "btn-row", style: { marginTop: "10px" } }, h("span", { class: "spacer" }), h("button", { class: "btn", onclick: () => dlg.close() }, "Cancel")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

// ---------------- Solution path ----------------
function viewPath(mode) {
  const g = app.game;
  const startValues = mode === "start" ? g.givens.slice() : g.values.map((v, c) => (v && v === g.solution[c] ? v : 0));
  const hadMistakes = mode === "current" && g.values.some((v, c) => v && v !== g.solution[c]);
  // Precompute every position along the human solve path.
  const states = [], steps = [];
  let s = g.cm ? new VariantState(g.cm, startValues) : new SolveState(startValues);
  for (let k = 0; k < 800 && !s.isSolved; k++) {
    const st = g.cm ? variantNextStep(s) : nextStep(s);
    if (!st) break;
    states.push(s.clone()); steps.push(st);
    s.apply(st);
  }
  const stuck = !s.isSolved;
  let i = 0;
  const board = new BoardView({ onTap: () => {}, label: "Solution path" });
  board.setVariant(g.puzzle.kind === "variant" ? g.puzzle.features : null);
  const title = h("h1", {});
  const info = h("div", { class: "side" });
  const list = h("div", { class: "path-list", role: "list" });
  mount(h("a", { class: "back", href: "#/game" }, icon("back"), "Back to the game"),
    h("div", { class: "page-title" }, title),
    h("div", { class: "drill" }, board.el, info));

  // Chips: every technique step, with runs of singles folded into one chip.
  const isSingle = (st) => T[st.technique].difficulty === 1;
  for (let k = 0; k < steps.length;) {
    if (isSingle(steps[k])) {
      let e = k; while (e + 1 < steps.length && isSingle(steps[e + 1])) e++;
      const from = k;
      list.append(h("button", { class: "chip singles", role: "listitem", "data-from": k, "data-to": e, onclick: () => { i = from; draw(); } },
        e > k ? `${k + 1}–${e + 1}: ${e - k + 1} singles` : `${k + 1}. ${T[steps[k].technique].name}`));
      k = e + 1;
    } else {
      const kk = k;
      list.append(h("button", { class: "chip", role: "listitem", "data-from": k, "data-to": k, onclick: () => { i = kk; draw(); } }, `${k + 1}. ${T[steps[k].technique].name}`));
      k++;
    }
  }
  const nextTechnique = () => { for (let k = i + 1; k < steps.length; k++) if (!isSingle(steps[k])) return k; return -1; };

  function draw() {
    if (!steps.length) {
      title.textContent = "Solution path";
      fill(info, h("p", {}, stuck ? "None of the app's techniques finds a step from here." : "Nothing left to solve."));
      board.render({ values: s.values, given: (c) => g.givens[c] !== 0, notes: s.cands });
      return;
    }
    const st = steps[i], at = states[i], t = T[st.technique];
    title.textContent = `Step ${i + 1} of ${steps.length}${stuck ? "+" : ""}`;
    board.render({ values: at.values, given: (c) => g.givens[c] !== 0, notes: at.cands, hl: highlightsFor(st, 3) });
    list.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", Number(b.dataset.from) <= i && i <= Number(b.dataset.to)));
    list.querySelector(".chip.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    fill(info,
      hadMistakes ? h("p", { class: "small muted" }, "Your incorrect entries were left out of this path.") : null,
      h("div", { class: "eyebrow" }, difficultyTitle(t.difficulty).toUpperCase()),
      h("h3", {}, t.name),
      h("p", { class: "path-text" }, `${st.explanation}\n\n${resultText(st)}`),
      h("div", { class: "btn-row" },
        h("button", { class: "btn", disabled: i === 0, onclick: () => { i--; draw(); } }, "← Previous"),
        h("span", { class: "spacer" }),
        CONTENT[st.technique] ? h("a", { class: "btn", href: `#/learn/${st.technique}` }, "Learn") : null,
        h("button", { class: "btn", disabled: i === steps.length - 1, onclick: () => { i++; draw(); } }, "Next →"),
        h("button", { class: "btn primary", disabled: nextTechnique() < 0, onclick: () => { i = nextTechnique(); draw(); } }, "Next technique ⇥")),
      i === steps.length - 1 && stuck ? h("p", { class: "small muted" }, "After this step the app's techniques get stuck — the rest needs something more advanced.") : null,
      h("h3", { class: "small muted" }, `All steps (${summary()})`),
      list,
      h("p", { class: "kbd-help" }, h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " step  ", h("kbd", {}, "⇥"), " next technique"));
  }
  function summary() {
    const counts = new Map();
    for (const st of steps) counts.set(st.technique, (counts.get(st.technique) ?? 0) + 1);
    const hard = [...counts].filter(([t]) => T[t].difficulty > 1);
    return hard.length ? hard.map(([t, n]) => `${T[t].name}${n > 1 ? " ×" + n : ""}`).join(", ") : "singles only";
  }
  const onKey = (e) => {
    if (e.key === "ArrowLeft" && i > 0) { i--; draw(); }
    if (e.key === "ArrowRight" && i < steps.length - 1) { i++; draw(); }
    if (e.key === "Tab" && nextTechnique() >= 0) { e.preventDefault(); i = nextTechnique(); draw(); }
  };
  document.addEventListener("keydown", onKey);
  cleanup = () => document.removeEventListener("keydown", onKey);
  draw();
}

// ---------------- Learn ----------------
function viewLearn() {
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Learn")),
    h("p", { class: "muted", style: { margin: "0 4px 16px" } },
      "Each technique has an explanation, a worked example, and drills: positions where that technique is the easiest move. Get 3 drills right to master it."),
    DIFFICULTIES.map((d) => h("div", { class: "section" }, h("h2", {}, d.title), h("div", { class: "list" },
      TECHNIQUES.filter((t) => t.difficulty === d.id).map((t) => h("a", { class: "row", href: `#/learn/${t.id}` },
        h("div", { class: "grow" }, h("div", { class: "title" }, t.name), h("div", { class: "sub" }, CONTENT[t.id].summary)),
        dots(Math.min(3, correct(t.id))), h("span", { class: "chev" }, icon("chevron"))))))),
  );
}

function viewTechnique(id) {
  const t = T[id], c = CONTENT[id];
  const example = h("div", { class: "grid", style: { display: "grid", gap: "10px" } }, h("p", { class: "muted" }, h("span", { class: "spinner" }), " Finding an example…"));
  const playBtn = h("button", { class: "btn", onclick: async () => {
    playBtn.disabled = true; playBtn.textContent = "Finding a puzzle…";
    const p = await app.lib.practicePuzzle(id);
    if (p) startGame(p); else { toast("Couldn't find one — try again."); playBtn.disabled = false; playBtn.textContent = "Play a full puzzle that needs it"; }
  } }, "Play a full puzzle that needs it");
  mount(h("div", { class: "detail" },
    h("a", { class: "back", href: "#/learn" }, icon("back"), "Learn"),
    h("div", {}, h("div", { class: "eyebrow" }, difficultyTitle(t.difficulty).toUpperCase()), h("h1", {}, t.name)),
    h("p", {}, c.summary),
    h("div", {}, h("h3", {}, "How to spot it"), h("p", { class: "muted" }, c.spot)),
    h("h3", {}, "Worked example"),
    example,
    h("div", { class: "btn-row" },
      h("a", { class: "btn primary", href: `#/drill/${id}` }, "Practice drills"),
      playBtn,
      h("a", { class: "btn", href: c.reference, target: "_blank", rel: "noopener noreferrer" }, "Read more ↗"))));

  let alive = true;
  cleanup = () => { alive = false; };
  (async () => {
    let drills = await app.lib.drills(id);
    if (!drills.length) drills = await app.lib.findMoreDrills(id, 1);
    if (!alive) return;
    const d = drills[0];
    const s = d && drillState(d);
    const step = s && firstStep(id, s);
    if (!step) { example.replaceChildren(h("p", { class: "muted" }, "No example yet — try Practice drills to search for some.")); return; }
    const board = new BoardView({ onTap: () => {}, label: `${t.name} example` });
    board.el.classList.add("example-board");
    const text = h("p", {});
    let stage = 2;
    const seg = h("div", { class: "segmented", role: "group", "aria-label": "Example stage" });
    const draw = () => {
      board.render({ values: s.values, given: () => true, notes: s.cands, hl: highlightsFor(step, stage) });
      text.textContent = stage === 2 ? "Highlighted: the cells that form the pattern. What can it eliminate?" : `${step.explanation}\n\n${resultText(step)}`;
      text.style.whiteSpace = "pre-line";
      seg.replaceChildren(...[[2, "Pattern"], [3, "Result"]].map(([v, label]) =>
        h("button", { "aria-pressed": stage === v ? "true" : "false", onclick: () => { stage = v; draw(); } }, label)));
    };
    draw();
    example.replaceChildren(board.el, seg, text);
  })();
}

function viewDrill(id) {
  const t = T[id];
  const places = placesDigits(id);
  const st = { drills: [], index: 0, selected: null, marks: new Set(), places: new Map(), verdict: null, revealed: false, counted: false, searching: true };
  const board = new BoardView({ onTap: (i) => { st.selected = st.selected === i ? null : i; update(); }, label: `${t.name} drill` });
  const side = h("div", { class: "side" });
  const title = h("h1", {}, `${t.name} drill`);
  mount(h("a", { class: "back", href: `#/learn/${id}` }, icon("back"), t.name),
    h("div", { class: "page-title" }, title),
    h("div", { class: "drill" }, board.el, side));

  const current = () => st.drills[st.index];
  function reset() { st.selected = null; st.marks = new Set(); st.places = new Map(); st.verdict = null; st.revealed = false; st.counted = false; }

  function tap(d) {
    const dr = current(); if (!dr || st.selected === null) return;
    const s = drillState(dr);
    const c = st.selected;
    if (s.values[c]) return;
    st.verdict = null;
    if (places) { st.places.get(c) === d ? st.places.delete(c) : st.places.set(c, d); }
    else if (has(s.cands[c], d)) { const k = ck(c, d); st.marks.has(k) ? st.marks.delete(k) : st.marks.add(k); }
    update();
  }

  function update() {
    const dr = current();
    title.textContent = `${t.name} drill ${dr ? st.index + 1 : ""}`;
    if (!dr) {
      board.el.style.display = "none";
      fill(side, st.searching
        ? h("p", { class: "muted" }, h("span", { class: "spinner" }), ` Searching random puzzles for a ${t.name}… (rare ones can take a while)`)
        : h("div", { class: "card" }, h("p", {}, "No more drills here yet."), h("button", { class: "btn primary", onclick: findMore }, "Find more")));
      return;
    }
    board.el.style.display = "";
    const s = drillState(dr);
    let hl = emptyHighlights();
    if (st.revealed) hl = highlightsFor(firstStep(id, s), 3);
    else {
      for (const k of st.marks) hl.roles.set(k, "marked");
      for (const [c, d] of st.places) hl.ghost.set(c, d);
      if (st.verdict?.kind === "wrong") for (const k of st.verdict.keys) hl.elims.add(k);
    }
    board.render({ values: s.values, given: () => true, notes: s.cands, selected: st.selected, hl });

    const v = st.verdict;
    let fb = null;
    if (v?.kind === "correct") fb = h("p", { class: "feedback ok" }, st.counted ? "✓ Correct! Nicely spotted." : "✓ Correct!");
    else if (v?.kind === "partial") fb = h("p", { class: "feedback part" }, `On the right track — ${v.found} of ${v.of}. There's more this pattern removes.`);
    else if (v?.kind === "wrong") fb = h("p", { class: "feedback bad" }, `✕ ${v.keys.map((k) => `${cellName(Math.floor(k / 10))}=${k % 10}`).join(", ")} can't be justified by a ${t.name} here.`);
    else if (v?.kind === "empty") fb = h("p", { class: "feedback" }, places ? "Place a digit first." : "Mark a candidate first.");
    else if (st.revealed) { const step = firstStep(id, s); fb = h("p", { class: "feedback", style: { whiteSpace: "pre-line" } }, `${step.explanation}\n\n${resultText(step)}`); }

    const keys = [];
    for (let d = 1; d <= 9; d++) keys.push(h("button", { class: "key", onclick: () => tap(d), "aria-label": places ? `Place ${d}` : `Eliminate ${d}` }, h("b", {}, String(d))));
    fill(side, 
      h("p", {}, places ? `Find the ${t.name}. Select a cell, then tap the digit that goes there.`
        : `Find the ${t.name}. Select a cell, then tap each candidate this pattern eliminates.`),
      fb,
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => { st.marks = new Set(); st.places = new Map(); st.verdict = null; update(); } }, "Clear"),
        h("button", { class: "btn", onclick: () => { st.revealed = true; st.verdict = null; update(); } }, "Show answer"),
        h("span", { class: "spacer" }),
        st.verdict?.kind === "correct" || st.revealed
          ? h("button", { class: "btn primary", onclick: next }, "Next")
          : h("button", { class: "btn primary", onclick: check }, "Check")),
      h("div", { class: "keypad" + (places ? "" : " notes-mode") + (st.selected === null ? " disabled" : "") }, keys),
      h("p", { class: "kbd-help" }, h("kbd", {}, "1–9"), places ? " place  " : " mark  ", h("kbd", {}, "arrows"), " move  ", h("kbd", {}, "↵"), " check"));
  }

  function check() {
    const placeKeys = new Set([...st.places].map(([c, d]) => ck(c, d)));
    st.verdict = judgeDrill(current(), st.marks, placeKeys);
    if (st.verdict.kind === "correct" && !st.revealed) {
      app.progress[id] = correct(id) + 1;
      store.save("progress", app.progress);
      st.counted = true;
    }
    update();
  }
  function next() { st.index++; reset(); if (st.index >= st.drills.length) findMore(); else update(); }
  async function findMore() {
    st.searching = true; update();
    const more = await app.lib.findMoreDrills(id, 3);
    st.drills.push(...more); st.searching = false; update();
  }

  const onKey = (e) => {
    if (document.querySelector("dialog[open]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) { e.preventDefault(); tap(Number(digit[1])); return; }
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key in moves) {
      e.preventDefault();
      const s = st.selected ?? 40, [dr, dc] = moves[e.key];
      st.selected = st.selected === null ? 40 : ((Math.floor(s / 9) + dr + 9) % 9) * 9 + ((s % 9) + dc + 9) % 9;
      update(); return;
    }
    if (e.key === "Enter" && current()) { e.preventDefault(); st.verdict?.kind === "correct" || st.revealed ? next() : check(); }
  };
  document.addEventListener("keydown", onKey);
  cleanup = () => document.removeEventListener("keydown", onKey);

  update();
  app.lib.drills(id).then(async (ds) => {
    st.drills = ds;
    if (!ds.length) st.drills = await app.lib.findMoreDrills(id, 3);
    st.searching = false; update();
  });
}

// ---------------- Settings ----------------
function viewSettings() {
  const toggle = (key, label) => h("label", { class: "toggle-row" }, h("span", {}, label),
    h("input", { type: "checkbox", checked: app.settings[key], onchange: (e) => { app.settings[key] = e.target.checked; saveSettings(); } }));
  const themeSel = h("select", { "aria-label": "Appearance", onchange: (e) => { app.settings.theme = e.target.value; saveSettings(); } },
    [["system", "Match system"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => h("option", { value: v, selected: app.settings.theme === v }, l)));
  const mastered = TECHNIQUES.filter((t) => correct(t.id) >= 3).length;
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Settings")),
    h("div", { class: "section" }, h("h2", {}, "Playing"), h("div", { class: "list" },
      toggle("showMistakes", "Show mistakes"),
      toggle("autoRemoveNotes", "Remove notes when placing a digit"),
      toggle("noteWarnings", "Show notes that clash with a placed digit in orange"),
      toggle("showRemaining", "Show digits remaining on keypad"),
      toggle("autocomplete", `Offer autocomplete when only singles remain (≤ ${AUTOCOMPLETE_MAX_EMPTY} cells)`),
      h("label", { class: "toggle-row" }, h("span", {}, "Appearance"), themeSel))),
    h("div", { class: "section" }, h("h2", {}, "Progress"), h("div", { class: "list" },
      DIFFICULTIES.map((d) => h("div", { class: "toggle-row" }, h("span", {}, d.title),
        h("span", { class: "muted" }, `${app.stats.solved[d.id] ?? 0} solved` + (app.stats.best[d.id] ? ` · best ${timeString(app.stats.best[d.id])}` : "")))),
      h("div", { class: "toggle-row" }, h("span", {}, "Variant puzzles solved"), h("span", { class: "muted" }, String(Object.values(app.stats.variants ?? {}).reduce((a, b) => a + b, 0)))),
      h("div", { class: "toggle-row" }, h("span", {}, "Techniques mastered"), h("span", { class: "muted" }, `${mastered} of ${TECHNIQUES.length}`)))),
    h("div", { class: "section" }, h("h2", {}, "Puzzles"), h("div", { class: "list" },
      h("div", { class: "toggle-row" }, h("span", {}, "Built-in puzzles"), h("span", { class: "muted" }, String(app.lib.bundled.length))),
      h("div", { class: "toggle-row" }, h("span", {}, "Ready-to-play variant puzzles"), h("span", { class: "muted", id: "ready-count" }, String(app.lib.readyCount()))),
      h("div", { class: "toggle-row" }, h("span", {}, "New puzzles on demand"), h("span", { class: "muted" }, "Generated on this device"))),
      h("p", { class: "footnote" }, "When you start a puzzle, a replacement for the same variant and level is generated in the background, so the next one starts instantly. Everything runs locally.")),
    h("div", { class: "section" }, h("div", { class: "list" },
      h("button", { class: "row", onclick: () => {
        if (!confirm("Erase all progress, stats and the current game?")) return;
        store.clearAll(); location.reload();
      } }, h("div", { class: "grow title", style: { color: "var(--error)" } }, "Reset all data")))),
    h("div", { class: "section" }, h("h2", {}, "About"), h("div", { class: "card small muted" },
      h("p", {}, "Board interactions adapted from SudoSodoku (MIT, © 2026 Kai T. Chen). 1,000 bundled puzzles from the public-domain Sudoku Exchange Puzzle Bank, each re-verified by this app."),
      h("p", {}, "Technique articles: ", h("a", { href: "https://www.sudokuwiki.org/Strategy_Families", target: "_blank", rel: "noopener noreferrer" }, "SudokuWiki"),
        " · ", h("a", { href: "https://hodoku.sourceforge.net/en/tech_intro.php", target: "_blank", rel: "noopener noreferrer" }, "HoDoKu")))),
  );
}

// ---------------- Boot ----------------
applyTheme();
// Offline support (needs https or localhost; harmless elsewhere).
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
window.addEventListener("hashchange", route);
app.lib.load().then(route).catch((e) => {
  root.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Couldn't start"), h("p", {}, e.message),
    h("p", { class: "muted" }, "Open this page through the local server (./web/serve.sh), not by double-clicking the file.")));
});
