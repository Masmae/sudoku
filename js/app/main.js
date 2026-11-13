import { h, icon, toast } from "./dom.js";
import * as store from "./storage.js";
import { Library } from "./library.js";
import { Game, AUTOCOMPLETE_MAX_EMPTY } from "./game.js";
import { BoardView, highlightsFor, emptyHighlights, miniBoard } from "./boardview.js";
import { today, addDays, niceDate, parseDate, dateKey, streak, bestStreak, encodeShare, decodeShare, variantIcon, solveChart } from "./extras.js";
import { CONTENT } from "./content.js";
import {
  TECHNIQUES, T, DIFFICULTIES, difficultyTitle, placesDigits, nudge, resultText, cellName, cellNames,
  candidateState, drillState, firstStep, judgeDrill, ck, has, parsePuzzle, hasNoConflicts, bruteSolve, SolveState, nextStep,
  puzzleString, logicalSolve, gradePuzzle, VARIANTS, VARIANT, VariantState, variantNextStep,
  canCombine, comboKey, comboName, surpriseCombo,
} from "../core/index.js";

// ---------------- App state ----------------
const DEFAULT_SETTINGS = { showMistakes: true, autoRemoveNotes: true, showRemaining: true, autocomplete: true, noteWarnings: true, theme: "system",
  zen: false, accent: "blue", lastLevel: 3, lastVariantLevel: 3 };
const ACCENTS = [["blue", "Blue"], ["teal", "Teal"], ["violet", "Violet"], ["amber", "Amber"], ["rose", "Rose"]];
const COLOR_NAMES = ["", "Yellow", "Green", "Blue", "Pink", "Orange", "Purple"];
const app = {
  lib: new Library(),
  settings: { ...DEFAULT_SETTINGS, ...store.load("settings", {}) },
  stats: store.load("stats", { solved: {}, best: {} }),
  progress: store.load("progress", {}),
  game: Game.fromJSON(store.load("game", null)),
  busy: false,
};
app.stats.solved ??= {}; app.stats.best ??= {}; app.stats.history ??= []; app.stats.hintTech ??= {}; app.stats.daily ??= {};
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
  if (ACCENTS.some(([id]) => id === app.settings.accent) && app.settings.accent !== "blue") document.documentElement.setAttribute("data-accent", app.settings.accent);
  else document.documentElement.removeAttribute("data-accent");
}
function saveGame() { if (app.game && !app.game.isSolved) store.save("game", app.game); else store.remove("game"); }
const correct = (t) => app.progress[t] ?? 0;
const timeString = (t) => {
  const s = Math.floor(t);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const dots = (n) => h("span", { class: "dots", "aria-label": `${n} of 3 drills correct` }, [0, 1, 2].map((i) => h("i", { class: i < n ? "on" : "" })),
  h("span", { class: "dots-n" }, `${n}/3`));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const openDialog = (dlg) => { dlg.addEventListener("close", () => dlg.remove()); document.body.append(dlg); dlg.showModal(); return dlg; };

/**
 * Runs a job that makes or fetches a puzzle. If it takes more than a moment, shows what is
 * happening, how long it has taken, and a Cancel button. Resolves to the job's result (null if cancelled).
 */
async function making(label, job) {
  if (app.busy) return null;
  app.busy = true;
  let dlg = null, tick = 0;
  const started = Date.now();
  const cancel = () => app.lib.cancelForeground();
  const show = setTimeout(() => {
    const clock = h("span", { class: "tabular" }, "0:00");
    dlg = h("dialog", { class: "making" }, h("h2", {}, label), h("p", { class: "muted" }, h("span", { class: "spinner" }), " ", clock),
      h("button", { class: "btn block", onclick: cancel }, "Cancel"));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); cancel(); });
    document.body.append(dlg); dlg.showModal();
    tick = setInterval(() => { clock.textContent = timeString((Date.now() - started) / 1000); }, 500);
  }, 350);
  try { return await job(); }
  catch (e) { toast("Something went wrong: " + e.message); return null; }
  finally { clearTimeout(show); clearInterval(tick); dlg?.close(); dlg?.remove(); app.busy = false; }
}
async function newClassic(level) {
  const p = await making(`Making ${/^[AEIOU]/.test(difficultyTitle(level)) ? "an" : "a"} ${difficultyTitle(level)} puzzle…`, () => app.lib.next(level));
  if (!p) return;
  app.settings.lastLevel = level; saveSettings();
  startGame(p);
}
async function startDaily(date) {
  if (app.game && app.game.daily === date && !app.game.isSolved) { location.hash = "#/game"; return; }
  const p = await making("Getting the daily puzzle…", () => app.lib.daily(date));
  if (p) startGame(p);
}

/** Checks an 81-character classic puzzle from outside the app. Returns { puzzle } or { error }. */
function gradeImported(cleaned) {
  if (cleaned.length !== 81) return { error: `Found ${cleaned.length} digits — need exactly 81.` };
  const values = parsePuzzle(cleaned);
  if (!values || !hasNoConflicts(values)) return { error: "A digit repeats in a row, column or box." };
  const b = bruteSolve(values, 2);
  if (b.count !== 1) return { error: b.count === 0 ? "This puzzle has no solution." : "This puzzle has more than one solution." };
  const g = gradePuzzle(cleaned);
  if (g) return { puzzle: g };
  const r = logicalSolve(values);
  const used = new Set(r.steps.map((st) => st.technique));
  return { beyond: true, puzzle: { puzzle: puzzleString(values), solution: puzzleString(b.solution), difficulty: 5, hardest: "xyChain",
    techniques: TECHNIQUES.filter((t) => used.has(t.id)).map((t) => t.id), beyond: true } };
}

async function sharePuzzle(g, withTime) {
  const url = `${location.origin}${location.pathname}#/p/${encodeShare(g.puzzle)}${withTime ? `/t${Math.floor(g.elapsed)}` : ""}`;
  const text = withTime ? `I solved this ${puzzleTitle(g.puzzle)} Sudoku in ${timeString(g.elapsed)}. Can you beat it?` : `Try this ${puzzleTitle(g.puzzle)} Sudoku.`;
  try {
    if (navigator.share) { await navigator.share({ title: "Sudoku", text, url }); return; }
    await navigator.clipboard.writeText(url); toast("Link copied.");
  } catch (e) {
    if (e?.name === "AbortError") return;
    const ta = h("textarea", { readonly: true, "aria-label": "Link" }, url);
    const dlg = openDialog(h("dialog", {}, h("h2", {}, "Share this puzzle"), h("p", { class: "small muted" }, "Copy this link:"), ta,
      h("div", { class: "btn-row dialog-actions" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: () => dlg.close() }, "Done"))));
    ta.select();
  }
}

/** Opens a puzzle from a share link (#/p/…): verified first, then offered to play. */
async function openShared(payload, extra) {
  const beat = /^t\d{1,6}$/.test(extra ?? "") ? Number(extra.slice(1)) : null;
  const d = decodeShare(payload);
  let puzzle = null;
  if (d?.classic) puzzle = gradeImported(d.classic.replace(/0/g, ".")).puzzle ?? null;
  else if (d?.variant) puzzle = (await making("Checking the shared puzzle…", () => app.lib.verifyVariant(d.variant))) === true ? d.variant : null;
  history.replaceState(null, "", "#/play");
  if (!puzzle) { toast("That link doesn't hold a valid puzzle.", 3200); return; }
  const choice = await ask("Shared puzzle", `${puzzleTitle(puzzle)}.${beat ? ` Time to beat: ${timeString(beat)}.` : ""}${app.game && !app.game.isSolved ? " Playing it replaces your game in progress." : ""}`,
    [["cancel", "Not now"], ["play", "Play it", true]]);
  if (choice === "play") startGame(beat ? { ...puzzle, beat } : puzzle);
}

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
  const [, page, arg, arg2] = (location.hash || "#/play").split("/");
  document.body.classList.toggle("in-game", page === "game");
  document.querySelectorAll(".tabbar a").forEach((a) => {
    const tab = a.dataset.tab;
    const active = tab === page || (tab === "play" && ["game", "path", "variants", "daily", "review", "p"].includes(page)) || (tab === "learn" && page === "drill");
    active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  switch (page) {
    case "game": return app.game ? viewGame() : (location.hash = "#/play");
    case "learn": return arg && T[arg] ? viewTechnique(arg) : viewLearn();
    case "drill": return T[arg] ? viewDrill(arg) : (location.hash = "#/learn");
    case "settings": return viewSettings();
    case "variants": return viewVariants();
    case "stats": return viewStats();
    case "daily": return viewDaily();
    case "review": return app.game?.isSolved ? viewReview() : (location.hash = "#/play");
    case "p": viewPlay(); return openShared(arg, arg2);
    case "path": return app.game ? viewPath(arg === "start" ? "start" : "current") : (location.hash = "#/play");
    default: return viewPlay();
  }
}

// ---------------- Play home ----------------
function viewPlay() {
  const g = app.game;
  const levels = DIFFICULTIES.map((d) => {
    const names = TECHNIQUES.filter((t) => t.difficulty === d.id).slice(0, 4).map((t) => t.name).join(", ") + (d.id > 1 ? "…" : "");
    const solved = app.stats.solved[d.id] ?? 0, best = app.stats.best[d.id];
    return h("button", { class: "row", onclick: () => newClassic(d.id) },
      h("div", { class: "grow" }, h("div", { class: "title" }, d.title), h("div", { class: "sub" }, names)),
      h("span", { class: "badge" }, solved ? `${solved} solved` : "", best ? h("span", { class: "badge-2" }, `best ${timeString(best)}`) : null),
      h("span", { class: "chev" }, icon("chevron")));
  });
  const filled = g ? g.values.filter((v, c) => v && !g.isGiven(c)).length : 0, toFill = g ? g.givens.filter((v) => !v).length : 1;
  const now = today(), done = app.stats.daily[now], run = streak(app.stats.daily);
  const last = DIFFICULTIES.find((d) => d.id === app.settings.lastLevel) ?? DIFFICULTIES[2];
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Sudoku")),
    g && !g.isSolved ? h("div", { class: "section" }, h("a", { class: "card continue", href: "#/game" },
      miniBoard(g.values, g.givens),
      h("div", { class: "grow" }, h("div", { class: "eyebrow" }, "CONTINUE"), h("div", { class: "title" }, g.daily ? `Daily · ${puzzleTitle(g.puzzle)}` : puzzleTitle(g.puzzle)),
        h("div", { class: "sub" }, `${Math.round((100 * filled) / toFill)}% filled${app.settings.zen ? "" : ` · ${timeString(g.elapsed)}`}`),
        h("div", { class: "bar" }, h("i", { style: { width: `${(100 * filled) / toFill}%` } }))),
      h("span", { class: "chev" }, icon("chevron")))) : null,
    h("div", { class: "section" }, h("div", { class: "list" },
      h("div", { class: "row split" },
        h("button", { class: "grow plain", onclick: () => (done ? (location.hash = "#/daily") : startDaily(now)) },
          h("div", { class: "title" }, "Daily puzzle"),
          h("div", { class: "sub" }, done ? `Solved in ${timeString(done.time)} · ${niceDate(now)}` : `${niceDate(now)} · Hard or above`)),
        h("a", { class: "btn small", href: "#/daily", "aria-label": `Calendar, ${run}-day streak` }, icon("calendar"), run ? `${run}-day streak` : "Calendar")))),
    h("div", { class: "section" }, h("button", { class: "btn primary block big", onclick: () => newClassic(last.id) }, `New ${last.title} puzzle`)),
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
        const r = gradeImported(cleaned);
        if (r.error) { status.textContent = r.error; return; }
        if (r.beyond) toast("This one goes beyond the app's techniques — hints may run out.", 3500);
        const g = r.puzzle;
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
  const board = new BoardView({
    onTap: (i, e) => {
      if (animating || g.paused) return;
      if ((e?.shiftKey || e?.metaKey || e?.ctrlKey) && !g.lockMode && !g.colorMode) g.extendSelection(i); else g.tapCell(i);
      afterMove();
    },
    // Dragging across cells selects them all (or paints them, with the color tool on cells).
    onDrag: (i, first) => {
      if (animating || g.paused || g.lockMode) return;
      if (g.colorMode && g.colorTarget === "cells") { if (g.colors[i] !== g.colorPick) g.paint([i], g.colorPick); g.selected = i; }
      else { if (first !== null) { g.multi = new Set([first]); g.selected = first; } g.extendSelection(i); }
      afterMove();
    },
  });
  const timeEl = h("span", { class: "stat time", hidden: app.settings.zen }, timeString(g.elapsed));
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
    if (g.isSolved && !g.celebrated) onSolved();
  }
  function askHint() {
    const had = !!g.hint;
    g.requestHint();
    if (!had && g.hint?.kind === "step") {   // remembered so Stats can point you at the right drills
      const t = g.hint.step.technique;
      app.stats.hintTech[t] = (app.stats.hintTech[t] ?? 0) + 1;
      store.save("stats", app.stats);
    }
    update(); saveGame();
  }

  function update() {
    g.sync();
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
      digitMode: g.lockMode && !!g.lockedDigit, extra: g.variantFocus(), hl, shake: g.shake, pulse: g.pulse, pulseFrom: g.pulseFrom, wave: g.wave, pop: g.pop,
      multi: g.multi.size > 1 ? g.multi : null, colors: g.colors, candColors: g.candColors, corner: notes === g.notes ? g.corner : null,
      noteConflicts: app.settings.noteWarnings && notes === g.notes ? g.noteConflicts() : null });
    g.shake = null; g.pulse = null; g.pop = null; g.wave = false;
    mistakesEl.replaceChildren(app.settings.showMistakes && !app.settings.zen ? `Mistakes: ${g.mistakes}` : "");
    mistakesEl.className = "stat" + (g.mistakes ? " bad" : "");
    hintsEl.replaceChildren(g.hintsUsed ? `${g.hintsUsed} hint${g.hintsUsed === 1 ? "" : "s"}` : "");
    const plan = app.settings.autocomplete && !animating ? g.autocompletePlan() : null;
    fill(side, 
      g.hint ? hintPanel() : null,
      plan ? h("button", { class: "btn primary block autocomplete", onclick: runAutocomplete },
        icon("wand"), `Autocomplete — only singles left (${plan.length} cell${plan.length === 1 ? "" : "s"})`) : null,
      g.lockMode && !g.lockedDigit ? h("p", { class: "lock-hint" }, "Choose a digit, then tap cells to place it.") : null,
      g.multi.size > 1 && !g.colorMode ? h("p", { class: "lock-hint" }, `${g.multi.size} cells selected: digits go in as notes.`) : null,
      g.colorMode ? palette() : null,
      g.notesMode && !g.colorMode ? seg("Kind of note", [["grid", "Candidates"], ["corner", "Corner marks"]], g.noteKind, (v) => { g.noteKind = v; update(); }) : null,
      tools(),
      keypad(),
      h("p", { class: "kbd-help" }, h("kbd", {}, "1–9"), " enter  ", h("kbd", {}, "⇧1–9"), " note  ", h("kbd", {}, "arrows"), " move  ",
        h("kbd", {}, "⇧click"), " or drag: select several  ", h("kbd", {}, "N"), " notes  ", h("kbd", {}, "C"), " colors  ", h("kbd", {}, "F"), " fill/clear notes  ", h("kbd", {}, "L"), " lock  ", h("kbd", {}, "A"), " autocomplete  ", h("kbd", {}, "H"), " hint  ", h("kbd", {}, "P"), " pause  ", h("kbd", {}, "⌫"), " erase  ", h("kbd", {}, "⌘Z"), " undo"),
    );
  }

  function seg(label, options, value, onPick) {
    return h("div", { class: "segmented", role: "group", "aria-label": label },
      options.map(([v, text]) => h("button", { "aria-pressed": String(v === value), onclick: () => onPick(v) }, text)));
  }

  /** Color tool: pick a color, then tap cells (or, for notes, select a cell and press its digit). */
  function palette() {
    return h("div", { class: "palette" },
      h("div", { class: "swatches", role: "group", "aria-label": "Color" },
        [1, 2, 3, 4, 5, 6].map((n) => h("button", { class: `swatch t${n}`, "aria-label": COLOR_NAMES[n], "aria-pressed": String(g.colorPick === n),
          onclick: () => { g.colorPick = n; if (g.colorTarget === "cells" && g.multi.size > 1) { g.paint([...g.multi], n); afterMove(); } else update(); } })),
        h("button", { class: "btn small", disabled: !g.hasColors, onclick: act(() => g.clearColors()) }, "Clear colors")),
      seg("What to color", [["cells", "Cells"], ["notes", "Notes"]], g.colorTarget, (v) => { g.colorTarget = v; update(); }),
      h("p", { class: "lock-hint" }, g.colorTarget === "cells" ? "Tap or drag over cells to color them. Tap again to remove." : "Select a cell, then press a digit to color that note."));
  }

  function tools() {
    const t = (label, ic, fn, { active = false, disabled = false, toggle = false } = {}) =>
      h("button", { class: "tool" + (active ? " active" : ""), disabled, onclick: fn, "aria-pressed": toggle ? String(active) : null },
        h("span", { class: "tool-icon" }, icon(ic)), label);
    return h("div", { class: "tools" },
      t("Undo", "undo", act(() => g.undo()), { disabled: !g.undoStack.length }),
      t("Redo", "redo", act(() => g.redo()), { disabled: !g.redoStack.length }),
      t("Erase", "erase", act(() => g.erase())),
      t("Notes", "pencil", () => { g.notesMode = !g.notesMode; update(); }, { active: g.notesMode, toggle: true }),
      g.notesFilled
        ? t("Clear notes", "fill", act(() => g.toggleAllNotes()))
        : t("Fill notes", "fill", act(() => g.toggleAllNotes()), { disabled: g.isSolved }),
      t("Lock", "lock", () => { g.colorMode = false; g.toggleLock(); update(); }, { active: g.lockMode, toggle: true }),
      t("Color", "drop", () => { g.colorMode = !g.colorMode; if (g.colorMode && g.lockMode) g.toggleLock(); update(); }, { active: g.colorMode, toggle: true }),
      t("Hint", "bulb", askHint, { disabled: g.isSolved }));
  }

  function keypad() {
    const keys = [];
    for (let d = 1; d <= 9; d++) {
      const left = Math.max(0, 9 - g.placedCount(d));
      const done = left === 0;
      const locked = g.lockMode ? g.lockedDigit === d : g.highlightDigit === d;
      keys.push(h("button", { class: "key" + (done && !g.notesMode && !locked ? " done" : "") + (locked ? " locked" : ""),
        "aria-label": g.colorMode && g.colorTarget === "notes" ? `Color note ${d}` : g.lockMode ? `Lock ${d}` : g.notesMode ? `Note ${d}` : `${d}, ${left} left`, "aria-pressed": g.lockMode ? String(locked) : null,
        onclick: act(() => g.pressDigit(d)) }, h("b", {}, String(d)), app.settings.showRemaining ? h("small", {}, done ? "✓" : String(left)) : null));
    }
    return h("div", { class: "keypad" + (g.notesMode || g.multi.size > 1 ? " notes-mode" : "") + (g.selected === null && !g.lockMode ? " disabled" : "") }, keys);
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
    const item = (label, fn, disabled = false, why = null) => h("button", { class: "row", disabled, onclick: () => { dlg.close(); fn(); } },
      h("div", { class: "grow" }, h("div", { class: "title" }, label), disabled && why ? h("div", { class: "sub" }, why) : null));
    const c = g.selected;
    const dlg = openDialog(h("dialog", { class: "sheet" }, h("h2", {}, "Game"), h("div", { class: "list" },
      item("Reveal selected cell", act(() => g.revealCell()), c === null || g.values[c] === g.solution[c],
        c === null ? "Select an empty cell on the board first." : "That cell is already right."),
      item("Step through the solution", () => {
        if (confirm("This shows every remaining step, which spoils the puzzle. Continue?")) location.hash = "#/path/current";
      }),
      item("Share this puzzle", () => sharePuzzle(g, false)),
      item("Restart this puzzle", () => { if (confirm("Restart this puzzle? Your progress on it will be cleared.")) { app.game = new Game(g.puzzle); saveGame(); route(); } }),
      item("New puzzle", () => { location.hash = "#/play"; })),
      h("div", { class: "btn-row dialog-actions" }, h("span", { class: "spacer" }), h("button", { class: "btn", onclick: () => dlg.close() }, "Close"))));
  }

  function onSolved() {
    g.celebrated = true;
    const k = g.puzzle.difficulty;
    const variant = g.puzzle.kind === "variant";
    const oldBest = variant ? null : app.stats.best[k] ?? null;
    if (variant) {
      app.stats.variants = app.stats.variants ?? {};
      const key = comboKey(variantIds(g.puzzle));
      app.stats.variants[key] = (app.stats.variants[key] ?? 0) + 1;
    } else {
      app.stats.solved[k] = (app.stats.solved[k] ?? 0) + 1;
      if (g.hintsUsed === 0) app.stats.best[k] = Math.min(app.stats.best[k] ?? Infinity, g.elapsed);
    }
    app.stats.history.push({ at: Date.now(), d: k, v: variant ? 1 : 0, name: puzzleTitle(g.puzzle), time: g.elapsed, mistakes: g.mistakes, hints: g.hintsUsed });
    if (app.stats.history.length > 300) app.stats.history.splice(0, app.stats.history.length - 300);
    if (g.daily && !app.stats.daily[g.daily]) app.stats.daily[g.daily] = { time: g.elapsed, mistakes: g.mistakes, hints: g.hintsUsed, late: g.daily !== today() };
    store.save("stats", app.stats);
    store.remove("game");
    const newBest = !variant && g.hintsUsed === 0 && (oldBest === null || g.elapsed < oldBest);
    const hardest = g.puzzle.hardest && T[g.puzzle.hardest] ? T[g.puzzle.hardest].name : g.puzzle.techniques?.length ? T[g.puzzle.techniques[g.puzzle.techniques.length - 1]]?.name : null;
    const tile = (value, label, cls = "") => h("div", { class: "tile " + cls }, h("b", {}, value), h("span", {}, label));
    const beat = g.puzzle.beat;
    const show = () => {
      const dlg = openDialog(h("dialog", {}, h("div", { class: "solved" },
        h("div", { class: "big" }, "✓"), h("h2", {}, "Solved!"),
        h("p", { class: "muted" }, g.daily ? `Daily puzzle · ${niceDate(g.daily)} · ${puzzleTitle(g.puzzle)}` : puzzleTitle(g.puzzle)),
        h("div", { class: "tiles" },
          tile(timeString(g.elapsed), newBest ? "time · new best" : "time", newBest ? "good" : ""),
          tile(String(g.mistakes), g.mistakes === 1 ? "mistake" : "mistakes"),
          tile(String(g.hintsUsed), g.hintsUsed === 1 ? "hint" : "hints"),
          !variant && app.stats.best[k] ? tile(timeString(app.stats.best[k]), `best ${difficultyTitle(k)}, no hints`) : null,
          g.daily ? tile(String(streak(app.stats.daily)), "day streak") : null),
        beat ? h("p", { class: g.elapsed < beat ? "feedback ok" : "feedback" }, g.elapsed < beat ? `You beat the shared time of ${timeString(beat)}.` : `The shared time to beat was ${timeString(beat)}.`) : null,
        h("div", { class: "card" }, h("div", { class: "small muted" }, hardest ? `Hardest technique: ${hardest}` : "Techniques this puzzle needed"),
          h("div", { class: "small" }, g.puzzle.techniques.map((t) => T[t].name).join(" · "))),
        h("div", { class: "btn-stack" },
          h("button", { class: "btn primary block", onclick: async () => {
            dlg.close();
            if (!variant) return newClassic(k);
            const p = await making(`Making a ${puzzleTitle(g.puzzle)} puzzle…`, () => obtainVariant(variantIds(g.puzzle), k, () => {}));
            if (p) startGame(p);
          } }, g.daily ? `New ${difficultyTitle(k)} puzzle` : `New ${puzzleTitle(g.puzzle)} puzzle`),
          h("div", { class: "btn-row even" },
            h("button", { class: "btn", onclick: () => { dlg.close(); location.hash = "#/review"; } }, "Review my solve"),
            h("button", { class: "btn", onclick: () => { dlg.close(); location.hash = "#/path/start"; } }, "Solution path")),
          h("div", { class: "btn-row even" },
            h("button", { class: "btn", onclick: () => sharePuzzle(g, true) }, "Share my time"),
            h("button", { class: "btn", onclick: () => dlg.close() }, "Done"))))));
    };
    // A wave across the finished board, then the summary.
    if (reducedMotion()) return show();
    animating = true;
    g.pulse = Array.from({ length: 81 }, (_, i) => i); g.wave = true; g.selected = null; g.multi.clear();
    update();
    setTimeout(() => { animating = false; if (app.game === g) show(); }, 1000);
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
      const to = g.selected === null ? 40 : nr * 9 + nc;
      if (e.shiftKey && !g.lockMode) g.extendSelection(to); else { g.multi.clear(); g.selected = to; }
      update(); return;
    }
    if (k === "Backspace" || k === "Delete" || k === "0") { e.preventDefault(); act(() => g.erase())(); return; }
    if (k === "n" || k === "N") { g.notesMode = !g.notesMode; update(); return; }
    if (k === "c" || k === "C") { g.colorMode = !g.colorMode; if (g.colorMode && g.lockMode) g.toggleLock(); update(); return; }
    if (k === "p" || k === "P") { g.paused = !g.paused; update(); return; }
    if (k === "f" || k === "F") { act(() => g.toggleAllNotes())(); return; }
    if (k === "l" || k === "L") { g.toggleLock(); update(); return; }
    if ((k === "a" || k === "A") && app.settings.autocomplete) { runAutocomplete(); return; }
    if ((k === " " || k === "Enter") && g.lockMode && g.lockedDigit && g.selected !== null) { e.preventDefault(); act(() => g.tapCell(g.selected))(); return; }
    if (k === "h" || k === "H") { askHint(); return; }
    if (k === "Escape") { if (g.hint) g.clearHint(); else if (g.colorMode) g.colorMode = false; else { g.selected = null; g.multi.clear(); } update(); }
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
    h("p", { class: "muted lead" }, "Classic Sudoku plus extra rules. Every puzzle is generated on this device, has exactly one solution, and can be solved with hints."),
    mixCard(),
    VARIANT_GROUPS.map(([title, ids]) => h("div", { class: "section" }, h("h2", {}, title), h("div", { class: "list" },
      ids.map((id) => VARIANT[id]).map((v) => h("button", { class: "row", onclick: () => chooseVariant(v) },
        variantIcon(v.id),
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
  const step2 = h("div", { class: "step-label" }, h("b", {}, "2"), "Pick a level");
  let rulesLink = null;
  const draw = () => {
    chips.replaceChildren(...VARIANTS.map((v) => {
      const on = chosen.includes(v.id);
      const blocked = !on && (chosen.length >= 3 || !canCombine([...chosen, v.id]));
      return h("button", { class: "chip" + (on ? " on" : ""), disabled: blocked, "aria-pressed": String(on),
        onclick: () => { on ? chosen.splice(chosen.indexOf(v.id), 1) : chosen.push(v.id); draw(); } }, variantIcon(v.id), v.name);
    }));
    summary.textContent = chosen.length >= 2 ? comboName(chosen) : chosen.length === 1 ? `${VARIANT[chosen[0]].name} + … (pick one or two more)` : "";
    summary.hidden = chosen.length === 0;
    step2.hidden = levelRow.hidden = chosen.length < 2;
    if (rulesLink) rulesLink.hidden = chosen.length < 2;
    // ⏳ = no ready-made puzzle for this mix and level on this device: it would be generated now.
    const stocked = (lvl) => app.lib.stockCount(Library.variantKey(chosen, lvl)) > 0;
    levelRow.replaceChildren(...VARIANT_LEVEL_LIST.map(([lvl, title]) =>
      h("button", { class: "btn" + (lvl === app.settings.lastVariantLevel ? " primary" : ""), onclick: () => start(chosen.slice(), lvl, title) },
        title, chosen.length >= 2 && !stocked(lvl) ? " ⏳" : "")));
    if (chosen.length >= 2 && VARIANT_LEVEL_LIST.some(([lvl]) => !stocked(lvl)))
      summary.append(h("br"), "⏳ = not ready-made yet; that level is generated when you start it.");
  };
  async function start(ids, lvl, title) {
    if (ids.length < 2) return;
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const p = await obtainVariant(ids, lvl, (msg) => status.replaceChildren(h("span", { class: "spinner" }), " " + msg));
      if (p) { app.settings.lastVariantLevel = lvl; saveSettings(); startGame(p); }
      else { status.textContent = "No puzzle started. That mix may be too restrictive — try again or pick another."; draw(); }
    } catch (err) { status.textContent = "Something went wrong: " + err.message; draw(); }
  }
  const card = h("div", { class: "section" }, h("h2", {}, "Mix variants"), h("div", { class: "card mix" },
    h("div", { class: "step-label" }, h("b", {}, "1"), "Pick 2 or 3 variants", h("span", { class: "spacer" }),
      h("button", { class: "btn small", onclick: () => {
        // Avoid the current selection and the last 40 surprises.
        const recent = store.load("surpriseRecent", []);
        const avoid = new Set([...recent, ...(chosen.length ? [comboKey(chosen)] : [])]);
        // Only mixes with ready-made Hard and Expert puzzles (the levels that get played), so starting one is instant.
        const ready = (ids) => [3, 4].every((lvl) => app.lib.stockCount(Library.variantKey(ids, lvl)) > 0);
        const c = surpriseCombo(Math.random, avoid, ready);
        store.save("surpriseRecent", [comboKey(c), ...recent].slice(0, 40));
        chosen.splice(0, chosen.length, ...c); draw();
      } }, "Surprise me")),
    chips, summary,
    step2, levelRow,
    h("button", { class: "btn small rules-link", onclick: () => chosen.length >= 2 && showRules(chosen.slice()) }, "Rules for this mix"),
    status));
  rulesLink = card.querySelector(".rules-link");
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
  const pick = (level, title) => h("button", { class: "btn" + (level === app.settings.lastVariantLevel ? " primary" : ""), onclick: async () => {
    dlg.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const p = await obtainVariant(v.id, level, (msg) => status.replaceChildren(h("span", { class: "spinner" }), " " + msg));
      dlg.close();
      if (p) { app.settings.lastVariantLevel = level; saveSettings(); startGame(p); }
    } catch (err) { status.textContent = "Something went wrong: " + err.message; dlg.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  } }, title);
  const dlg = h("dialog", { class: "sheet" }, h("h2", { class: "with-icon" }, variantIcon(v.id), v.name), h("p", {}, v.rules), status,
    h("div", { class: "level-row" }, VARIANT_LEVEL_LIST.map(([lvl, title]) => pick(lvl, title))),
    h("div", { class: "btn-row dialog-actions" }, h("span", { class: "spacer" }), h("button", { class: "btn", onclick: () => dlg.close() }, "Cancel")));
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
    h("p", { class: "muted lead" },
      "Each technique has an explanation, a worked example, and drills: positions where that technique is the easiest move. Get 3 drills right to master it."),
    (() => {
      const mastered = TECHNIQUES.filter((t) => correct(t.id) >= 3).length;
      return h("div", { class: "section" }, h("div", { class: "card progress-card" },
        h("div", {}, h("b", {}, `${mastered} of ${TECHNIQUES.length}`), " techniques mastered"),
        h("div", { class: "bar" }, h("i", { style: { width: `${(100 * mastered) / TECHNIQUES.length}%` } }))));
    })(),
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
  const toggle = (key, label, note = null) => h("label", { class: "toggle-row" }, h("span", {}, label, note ? h("span", { class: "sub" }, note) : null),
    h("input", { type: "checkbox", class: "switch", role: "switch", checked: app.settings[key], onchange: (e) => { app.settings[key] = e.target.checked; saveSettings(); } }));
  const theme = h("div", { class: "segmented", role: "group", "aria-label": "Appearance" });
  const drawTheme = () => theme.replaceChildren(...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) =>
    h("button", { "aria-pressed": String(app.settings.theme === v), onclick: () => { app.settings.theme = v; saveSettings(); drawTheme(); } }, l)));
  drawTheme();
  const accent = h("div", { class: "swatches", role: "group", "aria-label": "Accent color" });
  const drawAccent = () => accent.replaceChildren(...ACCENTS.map(([id, name]) =>
    h("button", { class: `swatch accent-${id}`, "aria-label": name, "aria-pressed": String(app.settings.accent === id), onclick: () => { app.settings.accent = id; saveSettings(); drawAccent(); } })));
  drawAccent();
  const mastered = TECHNIQUES.filter((t) => correct(t.id) >= 3).length;
  const classic = Object.values(app.stats.solved).reduce((a, b) => a + b, 0), variants = Object.values(app.stats.variants ?? {}).reduce((a, b) => a + b, 0);
  const tile = (value, label) => h("div", { class: "tile" }, h("b", {}, String(value)), h("span", {}, label));
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Settings")),
    h("div", { class: "section" }, h("h2", {}, "Playing"), h("div", { class: "list" },
      toggle("showMistakes", "Show mistakes"),
      toggle("autoRemoveNotes", "Remove notes when placing a digit"),
      toggle("noteWarnings", "Show notes that clash with a placed digit in orange"),
      toggle("showRemaining", "Show digits remaining on keypad"),
      toggle("autocomplete", `Offer autocomplete when only singles remain (≤ ${AUTOCOMPLETE_MAX_EMPTY} cells)`),
      toggle("zen", "Zen mode", "Hides the timer and the mistake count while you play."))),
    h("div", { class: "section" }, h("h2", {}, "Look"), h("div", { class: "list" },
      h("div", { class: "toggle-row" }, h("span", {}, "Appearance"), theme),
      h("div", { class: "toggle-row" }, h("span", {}, "Accent color"), accent))),
    h("div", { class: "section" }, h("h2", {}, "Progress"),
      h("div", { class: "tiles four" }, tile(classic, "classic solved"), tile(variants, "variants solved"), tile(`${mastered}/${TECHNIQUES.length}`, "techniques mastered"), tile(streak(app.stats.daily), "day streak")),
      h("a", { class: "btn block", href: "#/stats" }, "See all stats")),
    h("div", { class: "section" }, h("h2", {}, "Puzzles"), h("div", { class: "list" },
      h("div", { class: "toggle-row" }, h("span", {}, "Built-in puzzles"), h("span", { class: "muted" }, String(app.lib.bundled.length))),
      h("div", { class: "toggle-row" }, h("span", {}, "Ready-to-play variant puzzles"), h("span", { class: "muted", id: "ready-count" }, String(app.lib.readyCount()))),
      h("div", { class: "toggle-row" }, h("span", {}, "New puzzles on demand"), h("span", { class: "muted" }, "Generated on this device"))),
      h("p", { class: "footnote" }, "When you start a puzzle, a replacement for the same variant and level is generated in the background, so the next one starts instantly. Everything runs locally.")),
    h("div", { class: "section" }, h("div", { class: "list" },
      h("button", { class: "row", onclick: () => {
        if (!confirm("Erase all progress, stats and the current game?")) return;
        store.clearAll(); location.reload();
      } }, h("div", { class: "grow title danger" }, "Reset all data")))),
    h("div", { class: "section" }, h("h2", {}, "About"), h("div", { class: "card small muted" },
      h("p", {}, "Board interactions adapted from SudoSodoku (MIT, © 2026 Kai T. Chen). 1,000 bundled puzzles from the public-domain Sudoku Exchange Puzzle Bank, each re-verified by this app."),
      h("p", {}, "Technique articles: ", h("a", { href: "https://www.sudokuwiki.org/Strategy_Families", target: "_blank", rel: "noopener noreferrer" }, "SudokuWiki"),
        " · ", h("a", { href: "https://hodoku.sourceforge.net/en/tech_intro.php", target: "_blank", rel: "noopener noreferrer" }, "HoDoKu")))),
  );
}

// ---------------- Daily puzzle ----------------
function viewDaily() {
  const now = today();
  const daily = app.stats.daily;
  let month = parseDate(now); month.setDate(1);
  const cal = h("div", { class: "card calendar" });
  const tile = (value, label) => h("div", { class: "tile" }, h("b", {}, String(value)), h("span", {}, label));
  const draw = () => {
    const first = new Date(month), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("span", {}));
    for (let d = 1; d <= days; d++) {
      const key = dateKey(new Date(month.getFullYear(), month.getMonth(), d));
      const rec = daily[key], future = key > now;
      cells.push(h("button", { class: "day" + (rec ? (rec.late ? " late" : " done") : "") + (key === now ? " today" : ""), disabled: future,
        "aria-label": `${niceDate(key)}${rec ? `, solved in ${timeString(rec.time)}${rec.late ? " (on a later day)" : ""}` : future ? "" : ", not solved"}`,
        onclick: () => (rec ? toast(`${niceDate(key)}: solved in ${timeString(rec.time)}, ${rec.mistakes} mistakes, ${rec.hints} hints.`, 3200) : startDaily(key)) }, String(d)));
    }
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    fill(cal,
      h("div", { class: "cal-head" },
        h("button", { class: "icon-btn plain", "aria-label": "Previous month", onclick: () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); draw(); } }, icon("back")),
        h("b", {}, month.toLocaleDateString(undefined, { month: "long", year: "numeric" })),
        h("button", { class: "icon-btn plain", "aria-label": "Next month", disabled: dateKey(nextMonth) > now, onclick: () => { month = nextMonth; draw(); } }, icon("chevron"))),
      h("div", { class: "cal-grid head" }, ["M", "T", "W", "T", "F", "S", "S"].map((d) => h("span", {}, d))),
      h("div", { class: "cal-grid" }, cells),
      h("p", { class: "small muted" }, "Filled: solved on the day. Outlined: solved later (doesn't count for the streak). Tap an open day to play it."));
  };
  draw();
  mount(h("a", { class: "back", href: "#/play" }, icon("back"), "Play"),
    h("div", { class: "page-title" }, h("h1", {}, "Daily puzzle")),
    h("p", { class: "muted lead" }, "One puzzle a day, Hard or above, the same for everyone on that date."),
    h("div", { class: "section" }, h("div", { class: "tiles" }, tile(streak(daily), "day streak"), tile(bestStreak(daily), "best streak"), tile(Object.keys(daily).length, "days solved"))),
    h("div", { class: "section" }, daily[now]
      ? h("div", { class: "card" }, `Today's puzzle is done: ${timeString(daily[now].time)}. The next one arrives at midnight.`)
      : h("button", { class: "btn primary block big", onclick: () => startDaily(now) }, app.game?.daily === now && !app.game.isSolved ? "Continue today's puzzle" : "Play today's puzzle")),
    h("div", { class: "section" }, cal));
}

// ---------------- Stats ----------------
function viewStats() {
  const st = app.stats;
  const mastered = TECHNIQUES.filter((t) => correct(t.id) >= 3).length;
  const classic = Object.values(st.solved).reduce((a, b) => a + b, 0), variants = Object.values(st.variants ?? {}).reduce((a, b) => a + b, 0);
  const tile = (value, label) => h("div", { class: "tile" }, h("b", {}, String(value)), h("span", {}, label));
  const avg = (d) => { const list = st.history.filter((x) => !x.v && x.d === d); return list.length ? list.reduce((a, x) => a + x.time, 0) / list.length : null; };
  const recent = st.history.slice(-20);
  const letter = (x) => (x.v ? "V" : "EMHXA"[x.d - 1]);
  const when = (x) => new Date(x.at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const asked = Object.entries(st.hintTech).filter(([t]) => T[t]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  mount(
    h("div", { class: "page-title" }, h("h1", {}, "Stats")),
    h("div", { class: "section" }, h("div", { class: "tiles four" }, tile(classic + variants, "puzzles solved"), tile(streak(st.daily), "day streak"), tile(`${mastered}/${TECHNIQUES.length}`, "techniques mastered"), tile(variants, "variants solved"))),
    h("div", { class: "section" }, h("h2", {}, "By level"), h("div", { class: "card table-card" },
      h("table", { class: "stats-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Level"), h("th", {}, "Solved"), h("th", {}, "Best, no hints"), h("th", {}, "Average"))),
        h("tbody", {}, DIFFICULTIES.map((d) => h("tr", {}, h("th", {}, d.title), h("td", {}, String(st.solved[d.id] ?? 0)),
          h("td", {}, st.best[d.id] ? timeString(st.best[d.id]) : "–"), h("td", {}, avg(d.id) === null ? "–" : timeString(avg(d.id))))))))),
    h("div", { class: "section" }, h("h2", {}, "Recent solves"),
      recent.length ? h("div", { class: "card" },
        solveChart(recent.map((x) => ({ time: x.time, label: letter(x), text: `${when(x)} · ${x.name} · ${timeString(x.time)} · ${x.mistakes} mistakes · ${x.hints} hints` })), timeString),
        h("p", { class: "small muted" }, "Oldest on the left. E, M, H, X, A = Easy, Medium, Hard, Expert, Master; V = a variant."),
        h("details", {}, h("summary", { class: "small" }, "Show as a table"),
          h("table", { class: "stats-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Puzzle"), h("th", {}, "Time"), h("th", {}, "Mistakes"), h("th", {}, "Hints"))),
            h("tbody", {}, recent.slice().reverse().map((x) => h("tr", {}, h("th", {}, when(x)), h("td", {}, x.name), h("td", {}, timeString(x.time)), h("td", {}, String(x.mistakes)), h("td", {}, String(x.hints))))))))
        : h("div", { class: "card muted" }, "Solve a puzzle and its time shows up here.")),
    h("div", { class: "section" }, h("h2", {}, "Techniques you asked hints for"),
      asked.length ? h("div", { class: "list" }, asked.map(([t, n]) => h("a", { class: "row", href: CONTENT[t] ? `#/drill/${t}` : "#/learn" },
        h("div", { class: "grow" }, h("div", { class: "title" }, T[t].name), h("div", { class: "sub" }, `${n} hint${n === 1 ? "" : "s"} · ${CONTENT[t] ? "practise it with drills" : "a variant rule"}`)),
        CONTENT[t] ? dots(Math.min(3, correct(t))) : null, h("span", { class: "chev" }, icon("chevron")))))
        : h("div", { class: "card muted" }, "When you ask for a hint, the technique it used is counted here, with a shortcut to its drills.")),
  );
}

// ---------------- Review of your own solve ----------------
function viewReview() {
  const g = app.game;
  const moves = g.moves;
  // Thinking time before each move: the gap since the one before it.
  const think = moves.map((m, i) => m.t - (i ? moves[i - 1].t : 0));
  const frames = [g.givens.slice()];
  for (const m of moves) { const v = frames[frames.length - 1].slice(); v[m.c] = m.d; frames.push(v); }
  let i = moves.length, heat = true;
  const board = new BoardView({ onTap: (c) => { for (let k = moves.length - 1; k >= 0; k--) if (moves[k].c === c) { i = k + 1; draw(); return; } }, label: "Review of your solve" });
  board.setVariant(g.puzzle.kind === "variant" ? g.puzzle.features : null);
  const info = h("div", { class: "side" });
  const slider = h("input", { type: "range", class: "slider", min: 0, max: moves.length, step: 1, "aria-label": "Move", oninput: (e) => { i = Number(e.target.value); draw(); } });
  // Time spent before the last digit that went into each cell, in four steps of one color.
  const last = new Map();
  moves.forEach((m, k) => { if (m.d) last.set(m.c, think[k]); });
  const maxThink = Math.max(1, ...last.values());
  const heatMap = new Map([...last].map(([c, t]) => [c, `heat${Math.min(4, 1 + Math.floor((4 * t) / (maxThink + 1)))}`]));
  const longest = moves.map((m, k) => ({ k, t: think[k], m })).filter((x) => x.m.d && !x.m.a).sort((a, b) => b.t - a.t).slice(0, 5);
  mount(h("a", { class: "back", href: "#/play" }, icon("back"), "Play"),
    h("div", { class: "page-title" }, h("h1", {}, "Your solve")),
    h("div", { class: "drill" }, board.el, info));

  function draw() {
    const v = frames[i], m = i ? moves[i - 1] : null;
    const wrong = new Set(v.map((x, c) => (x && x !== g.solution[c] ? c : -1)).filter((c) => c >= 0));
    board.render({ values: v, given: (c) => g.isGiven(c), notes: new Array(81).fill(0), wrong, selected: m ? m.c : null, extra: heat ? heatMap : null });
    slider.value = String(i);
    fill(info,
      !moves.length ? h("p", {}, "No moves were recorded for this puzzle.") : null,
      h("div", { class: "eyebrow" }, `MOVE ${i} OF ${moves.length}`),
      h("h3", {}, m ? (m.d ? `${cellName(m.c)} = ${m.d}` : `${cellName(m.c)} cleared`) : "The starting position"),
      m ? h("p", { class: "muted" }, `At ${timeString(m.t)}, after ${timeString(think[i - 1])} of thinking.${m.a ? " Filled in by a hint, reveal or autocomplete." : ""}${m.d && m.d !== g.solution[m.c] ? " This one was a mistake." : ""}`) : null,
      slider,
      h("div", { class: "btn-row" },
        h("button", { class: "btn", disabled: i === 0, onclick: () => { i--; draw(); } }, "← Previous"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn", disabled: i === moves.length, onclick: () => { i++; draw(); } }, "Next →")),
      h("label", { class: "toggle-row tight" }, h("span", {}, "Shade cells by thinking time"),
        h("input", { type: "checkbox", class: "switch", role: "switch", checked: heat, onchange: (e) => { heat = e.target.checked; draw(); } })),
      heat ? h("div", { class: "legend" }, h("span", {}, "quick"), [1, 2, 3, 4].map((n) => h("i", { class: `heat-key heat${n}` })), h("span", {}, `slow (up to ${timeString(maxThink)})`)) : null,
      longest.length ? h("h3", { class: "small muted" }, "Where the time went") : null,
      longest.length ? h("div", { class: "list" }, longest.map((x) => h("button", { class: "row", onclick: () => { i = x.k + 1; draw(); } },
        h("div", { class: "grow" }, h("div", { class: "title" }, `${cellName(x.m.c)} = ${x.m.d}`), h("div", { class: "sub" }, `move ${x.k + 1}, at ${timeString(x.m.t)}`)),
        h("span", { class: "badge" }, timeString(x.t))))) : null,
      h("div", { class: "btn-row" }, h("a", { class: "btn", href: "#/path/start" }, "Compare with the solution path")),
      h("p", { class: "kbd-help" }, h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " step"));
  }
  const onKey = (e) => {
    if (e.target === slider) return;
    if (e.key === "ArrowLeft" && i > 0) { i--; draw(); }
    if (e.key === "ArrowRight" && i < moves.length) { i++; draw(); }
  };
  document.addEventListener("keydown", onKey);
  cleanup = () => document.removeEventListener("keydown", onKey);
  draw();
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
