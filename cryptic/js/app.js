// Cryptic: one clue a day, hints that teach how the clue works, and practice by clue type.
// It is one of the games behind the Sudoku app's Games screen (served from its cryptic/ folder).
// Everything is kept on this device; the clues are data files (data/clues.json, data/generated.json).
import { TYPES, parseClue, problems, dailyIndex } from "./clues.js";

const app = document.getElementById("app");
const SAVE = "cryptic.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(SAVE)) ?? {}; } catch { return {}; } };
const store = { solved: {}, daily: {}, work: {}, ...load() };
const persist = () => { try { localStorage.setItem(SAVE, JSON.stringify(store)); } catch { /* ignore */ } };

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const mount = (...kids) => app.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// ---------------------------------------------------------------- dates
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dateKey(new Date());
const parseDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseDate(k); d.setDate(d.getDate() + n); return dateKey(d); };
const niceDate = (k) => parseDate(k).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

// ---------------------------------------------------------------- clues
let CLUES = [];
const byId = (id) => CLUES.find((c) => c.id === id);

async function loadClues() {
  const get = async (f) => { try { const r = await fetch(f, { cache: "no-cache" }); return r.ok ? (await r.json()).clues ?? [] : []; } catch { return []; } };
  const [mine, made] = await Promise.all([get("data/clues.json"), get("data/generated.json")]);
  const seen = new Set();
  // Machine-written clues are checked again here: only ones whose wordplay really works are shown.
  CLUES = [...mine, ...made].filter((c) => problems(c).length === 0 && !seen.has(c.answer) && seen.add(c.answer));
}

/** The clue for a date. Fixed the first time that day is opened, so it stays put when clues are added. */
function dailyClue(date) {
  let c = byId(store.daily[date]);
  if (!c && CLUES.length) {
    // Prefer one that hasn't been a daily clue yet.
    const used = new Set(Object.values(store.daily));
    const start = dailyIndex(date, CLUES.length);
    for (let k = 0; k < CLUES.length && !c; k++) { const x = CLUES[(start + k) % CLUES.length]; if (!used.has(x.id)) c = x; }
    c ??= CLUES[start];
    store.daily[date] = c.id; persist();
  }
  return c;
}
const solvedOn = (date) => { const s = store.solved[store.daily[date]]; return s && s.daily === date && !s.gaveUp ? s : null; };
function streak() {
  let k = solvedOn(today()) ? today() : addDays(today(), -1), n = 0;
  while (solvedOn(k)) { n++; k = addDays(k, -1); }
  return n;
}

/** The clue text as elements, with the parts a hint has uncovered switched on. */
function clueEl(c, show = {}) {
  const { text, spans } = parseClue(c.clue);
  const out = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) out.push(text.slice(at, s.start));
    out.push(h("span", { class: s.kind + (show[s.kind] ? " on" : "") }, text.slice(s.start, s.end)));
    at = s.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return h("p", { class: "clue" }, out, " ", h("span", { class: "len" }, `(${c.answer.length})`));
}
const legend = () => h("div", { class: "legend" },
  h("span", {}, h("i", { class: "d" }), "definition"), h("span", {}, h("i", { class: "i" }), "indicator"), h("span", {}, h("i", { class: "f" }), "fodder"));
const scoreText = (s) => (s.gaveUp ? "Answer shown" : s.hints === 0 ? "Solved with no hints" : `Solved with ${s.hints} hint${s.hints === 1 ? "" : "s"}`);

// ---------------------------------------------------------------- home
function viewHome() {
  const now = today();
  const c = dailyClue(now);
  const done = c && store.solved[c.id];
  const solved = Object.values(store.solved).filter((s) => !s.gaveUp);
  const clean = solved.filter((s) => s.hints === 0).length;
  const past = Array.from({ length: 7 }, (_, i) => addDays(now, -(i + 1)));
  mount(
    h("div", { class: "top" }, h("a", { class: "back", href: "../#/games" }, "‹ Games")),
    h("h1", {}, "Cryptic"),
    c ? h("a", { class: "card today", href: `#/clue/${c.id}/${now}` },
      h("div", { class: "label" }, `Today · ${niceDate(now)}`),
      clueEl(c, done ? { d: 1, i: 1, f: 1 } : {}),
      done ? h("div", { class: "status done" }, `${scoreText(done)} · ${c.answer}`) : h("div", { class: "btn primary block" }, store.work[c.id] ? "Continue" : "Solve today's clue"))
      : h("div", { class: "card" }, "No clues could be loaded. Check the connection and reopen the app."),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("b", {}, String(streak())), h("span", {}, "day streak")),
      h("div", { class: "tile" }, h("b", {}, String(solved.length)), h("span", {}, "clues solved")),
      h("div", { class: "tile" }, h("b", {}, String(clean)), h("span", {}, "with no hints"))),
    h("h2", {}, "Learn and practise"),
    h("div", { class: "list" }, Object.entries(TYPES).map(([id, t]) => {
      const mine = CLUES.filter((x) => x.type === id), n = mine.filter((x) => store.solved[x.id] && !store.solved[x.id].gaveUp).length;
      return h("a", { class: "row", href: `#/learn/${id}` },
        h("div", { class: "grow" }, h("div", { class: "title" }, t.name), h("div", { class: "sub" }, t.short)),
        h("span", { class: "end" + (mine.length && n === mine.length ? " done" : "") }, `${n}/${mine.length}`));
    })),
    h("h2", {}, "Past days"),
    h("div", { class: "list" }, past.map((d) => {
      const pc = dailyClue(d), s = pc && store.solved[pc.id];
      return h("a", { class: "row", href: `#/clue/${pc?.id}/${d}` },
        h("div", { class: "grow" }, h("div", { class: "title" }, niceDate(d)), h("div", { class: "sub" }, s ? pc.answer : pc ? `${pc.answer.length} letters` : "")),
        h("span", { class: "end" + (s && !s.gaveUp ? " done" : "") }, s ? scoreText(s) : "Not solved"));
    })),
    h("p", { class: "small muted" }, `${CLUES.length} clues, all written for this app and checked by machine. Past days don't count for the streak.`),
  );
}

// ---------------------------------------------------------------- learn
const LESSONS = {
  anagram: "The answer's letters are in the clue, jumbled. An indicator word suggests movement, damage or change (mixed, broken, wild, out). The fodder is the word or words whose letters you rearrange, and it has exactly as many letters as the answer.",
  hidden: "The answer is written out in the clue, running across the middle of a word or from the end of one word into the next. The indicator suggests being inside or being part of something.",
  reversal: "Read a word backwards. The indicator suggests going back, returning or being turned over. Sometimes the word to reverse is in the clue; often you first find a synonym and reverse that.",
  container: "One piece goes inside another. Find the two pieces (usually synonyms or abbreviations), and the indicator tells you which holds which: 'in', 'inside' and 'held by' put the first inside the second; 'holding', 'around' and 'eats' do the opposite.",
  charade: "The answer is built from pieces set side by side, like the party game. Each piece is a synonym or abbreviation. There is often no indicator at all, just small joining words like 'and', 'with' or 'gets'.",
  letters: "Pick particular letters from the fodder: first letters (starts, heads, leaders), last letters (ends, finally, tails), or every other letter (oddly, evenly, regularly).",
  deletion: "Take a word and remove something: its first letter (headless, loses head), its last (endless, without tail), its middle (heartless), or a named letter. What's left is the answer.",
  double: "Two definitions of the same word, side by side, with no wordplay. These clues are usually very short. If a two- or three-word clue makes no sense as wordplay, try this.",
  homophone: "The answer sounds like another word. The indicator is about hearing or speaking (we hear, reportedly, they say, on the radio). Find the word that is described, then spell what it sounds like.",
};
function viewLearn(type) {
  const t = TYPES[type];
  if (!t) return (location.hash = "#/");
  const mine = CLUES.filter((c) => c.type === type);
  const example = mine.find((c) => store.solved[c.id]) ?? mine[0];
  const rest = mine.filter((c) => c !== example || store.solved[c.id]);
  const next = mine.find((c) => !store.solved[c.id] && c !== example) ?? mine.find((c) => !store.solved[c.id]);
  mount(
    h("div", { class: "top" }, h("a", { class: "back", href: "#/" }, "‹ Home")),
    h("div", {}, h("div", { class: "label" }, "Clue type"), h("h1", {}, t.name)),
    h("p", {}, LESSONS[type]),
    h("div", { class: "card" }, h("h2", {}, "Words that signal it"), h("div", { class: "chips" }, t.indicators.map((w) => h("span", { class: "chip" }, w)))),
    example ? h("div", { class: "card" }, h("h2", {}, "Worked example"),
      h("div", { class: "example" }, clueEl(example, { d: 1, i: 1, f: 1 }), h("p", { class: "explain" }, h("b", {}, example.answer), ". ", example.explain)), legend()) : null,
    next ? h("a", { class: "btn primary block", href: `#/clue/${next.id}/practice` }, "Practise this type") : h("p", { class: "result" }, "You've solved every clue of this type."),
    h("h2", {}, "Clues of this type"),
    h("div", { class: "list" }, rest.map((c) => {
      const s = store.solved[c.id];
      return h("a", { class: "row", href: `#/clue/${c.id}/practice` },
        h("div", { class: "grow" }, h("div", { class: "title q" }, parseClue(c.clue).text), h("div", { class: "sub" }, s ? c.answer : `${c.answer.length} letters · ${["", "gentle", "medium", "tricky"][c.level ?? 2]}`)),
        h("span", { class: "end" + (s && !s.gaveUp ? " done" : "") }, s ? (s.gaveUp ? "shown" : s.hints ? `${s.hints} hint${s.hints === 1 ? "" : "s"}` : "✓ no hints") : "›"));
    })),
  );
}

// ---------------------------------------------------------------- play
let cleanup = () => {};
function viewClue(id, ctx) {
  const c = byId(id);
  if (!c) return (location.hash = "#/");
  const daily = /^\d{4}-\d{2}-\d{2}$/.test(ctx ?? "") ? ctx : null;
  const n = c.answer.length;
  const done = store.solved[c.id];
  // Work in progress on this clue: letters typed, hints taken, letters given.
  const w = store.work[c.id] ?? { entry: Array(n).fill(""), given: [], show: {}, hints: 0 };
  if (done) { w.entry = [...c.answer]; w.show = { d: 1, i: 1, f: 1 }; }
  let cur = Math.max(0, w.entry.findIndex((x, i) => !x && !w.given.includes(i)));
  let say = done ? null : { text: "Type your answer. Stuck? Take a hint: each one shows a little more." };
  let wrong = false;
  const save = () => { if (!store.solved[c.id]) { store.work[c.id] = w; persist(); } };
  const t = TYPES[c.type];

  const move = (dir) => { for (let k = 1; k <= n; k++) { const i = (cur + dir * k + n) % n; if (!w.given.includes(i)) { cur = i; return; } } };
  const type = (ch) => {
    if (store.solved[c.id]) return;
    if (w.given.includes(cur)) move(1);
    w.entry[cur] = ch; wrong = false;
    const nextEmpty = w.entry.findIndex((x, i) => !x && !w.given.includes(i) && i > cur);
    if (nextEmpty >= 0) cur = nextEmpty; else if (w.entry.some((x) => !x)) cur = w.entry.findIndex((x) => !x);
    save(); draw();
  };
  const erase = () => {
    if (store.solved[c.id]) return;
    // Backspace on an empty box steps back to the previous one (never wrapping round to the end).
    if (!w.entry[cur] || w.given.includes(cur)) { for (let i = cur - 1; i >= 0; i--) if (!w.given.includes(i)) { cur = i; break; } }
    if (!w.given.includes(cur)) w.entry[cur] = "";
    wrong = false; save(); draw();
  };
  const finish = (gaveUp) => {
    store.solved[c.id] = { hints: w.hints, gaveUp, at: Date.now(), daily: daily === today() ? daily : null };
    delete store.work[c.id];
    w.entry = [...c.answer]; w.show = { d: 1, i: 1, f: 1 };
    persist(); draw();
  };
  const check = () => {
    if (store.solved[c.id]) return;
    if (w.entry.some((x) => !x)) { say = { text: "Fill in every letter first." }; return draw(); }
    if (w.entry.join("") === c.answer) return finish(false);
    wrong = true; say = { text: "Not that. Check it against the definition.", bad: true };
    draw();
  };
  const hint = (kind) => {
    if (store.solved[c.id]) return;
    if (kind === "letter") {
      const open = w.entry.map((x, i) => i).filter((i) => !w.given.includes(i) && w.entry[i] !== c.answer[i]);
      if (!open.length) return;
      const i = open.includes(cur) ? cur : open[0];
      w.entry[i] = c.answer[i]; w.given.push(i); w.hints++;
      say = { text: `Letter ${i + 1} is ${c.answer[i]}.` };
      if (w.given.length === n) { save(); return finish(true); }
      move(1);
    } else if (!w.show[kind]) {
      w.show[kind] = 1; w.hints++;
    }
    if (kind === "d") say = { parts: c.type === "double" ? ["Both halves are ", h("b", {}, "definitions"), " of the same word."] : ["The ", h("b", {}, "definition"), " is underlined: the answer means that. The rest is wordplay."] };
    if (kind === "i") say = { parts: [h("b", {}, t.name), ". ", t.short, "." + (parseClue(c.clue).spans.some((s) => s.kind === "i") ? " The indicator is in orange." : " There's no indicator word here.")] };
    if (kind === "f") say = { parts: c.type === "double" ? ["No fodder in this one: just the two definitions."] : ["The ", h("b", {}, "fodder"), " is in green: ", ["anagram", "hidden", "letters"].includes(c.type) ? "the letters you need are right there." : "find a short word or abbreviation for each green piece."] };
    save(); draw();
  };

  function draw() {
    const s = store.solved[c.id];
    const used = (k) => (w.show[k] ? " used" : "");
    const others = CLUES.filter((x) => x.type === c.type && !store.solved[x.id] && x.id !== c.id);
    mount(
      h("div", { class: "top" }, h("a", { class: "back", href: daily ? "#/" : `#/learn/${c.type}` }, daily ? "‹ Home" : `‹ ${t.name}`),
        h("span", { class: "grow" }), h("span", { class: "label" }, daily ? niceDate(daily) : "Practice")),
      h("div", { class: "play" },
        clueEl(c, w.show),
        h("div", { class: "boxes" + (s && !s.gaveUp ? " solved" : "") + (wrong ? " wrong" : ""), role: "group", "aria-label": `Answer, ${n} letters` },
          w.entry.map((ch, i) => h("button", { class: "box" + (i === cur && !s ? " cur" : "") + (w.given.includes(i) ? " given" : ""), "aria-label": `Letter ${i + 1}${ch ? `, ${ch}` : ", empty"}`,
            onclick: () => { if (!s) { cur = i; draw(); } } }, ch))),
        s ? [
          h("p", { class: "result" }, scoreText(s)),
          h("div", { class: "card" }, h("h2", {}, t.name), h("p", { class: "explain" }, c.explain), legend()),
          h("div", { class: "btns" },
            h("a", { class: "btn", href: `#/learn/${c.type}` }, `About ${t.name.toLowerCase()} clues`),
            others.length ? h("a", { class: "btn primary", href: `#/clue/${others[0].id}/practice` }, "Another like this") : h("a", { class: "btn primary", href: "#/" }, "Home")),
        ] : [
          h("p", { class: "say" + (say?.bad ? " bad" : "") }, say?.parts ?? say?.text ?? ""),
          w.show.d || w.show.i || w.show.f ? legend() : null,
          h("div", { class: "hints" },
            h("button", { class: "hint d" + used("d"), onclick: () => hint("d") }, "Definition", h("small", {}, w.show.d ? "shown" : "which part?")),
            h("button", { class: "hint i" + used("i"), onclick: () => hint("i") }, "Clue type", h("small", {}, w.show.i ? "shown" : "and indicator")),
            h("button", { class: "hint f" + used("f"), onclick: () => hint("f") }, "Fodder", h("small", {}, w.show.f ? "shown" : "the pieces")),
            h("button", { class: "hint", onclick: () => hint("letter") }, "Letter", h("small", {}, "reveal one"))),
          h("div", { class: "spacer" }),
          keyboard(),
          h("button", { class: "link", onclick: () => { if (confirm("Show the answer and the explanation?")) finish(true); } }, "Show the answer"),
        ]),
    );
    wrong = false;
  }
  function keyboard() {
    const key = (ch) => h("button", { class: "key", onclick: () => type(ch), "aria-label": ch }, ch);
    return h("div", { class: "keys" },
      h("div", { class: "kr" }, [..."QWERTYUIOP"].map(key)),
      h("div", { class: "kr" }, [..."ASDFGHJKL"].map(key)),
      h("div", { class: "kr" }, h("button", { class: "key wide go", onclick: check }, "Check"), [..."ZXCVBNM"].map(key), h("button", { class: "key wide", onclick: erase, "aria-label": "Delete" }, "⌫")));
  }
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toUpperCase()); }
    else if (e.key === "Backspace") { e.preventDefault(); erase(); }
    else if (e.key === "Enter") { e.preventDefault(); check(); }
    else if (e.key === "ArrowLeft") { move(-1); draw(); }
    else if (e.key === "ArrowRight") { move(1); draw(); }
  };
  document.addEventListener("keydown", onKey);
  cleanup = () => document.removeEventListener("keydown", onKey);
  draw();
}

// ---------------------------------------------------------------- router
function route() {
  cleanup(); cleanup = () => {};
  const [, page, a, b] = (location.hash || "#/").split("/");
  window.scrollTo(0, 0);
  if (page === "clue") return viewClue(a, b);
  if (page === "learn") return viewLearn(a);
  return viewHome();
}
window.addEventListener("hashchange", route);
loadClues().then(route);
