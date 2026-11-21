// Cryptic clues: how a clue is written down, and a checker for its wordplay.
//
// A clue's text marks its parts:
//   [d|…] the definition   [i|…] the indicator (the word that tells you what to do)
//   [f|…] the fodder (the letters or words the wordplay works on)
// e.g. "[f|Night] [i|out] for [d|an object]"  →  "Night out for an object" (THING).
//
// `recipe` says how the answer is built, as nested lists, so it can be checked by machine:
//   "CAR"                       those letters (a synonym or abbreviation named in the clue)
//   ["cat", a, b, …]            one after another
//   ["ana", "NIGHT"]            an anagram of these letters
//   ["hid", "sly recital"]      hidden inside these words
//   ["rev", x]                  x backwards
//   ["in", x, y]                x inside y
//   ["odd", "antler"] / ["even", …]     alternate letters
//   ["first", "see every…"] / ["last", …]   first / last letters of the words
//   ["del", "PLANET", "T"]      the first word without those letters (a head, tail, heart or a word)
//   ["hom", "PEAR"]             sounds like (can't be checked by machine)
//   ["dd"]                      two definitions (can't be checked by machine)

export const TYPES = {
  anagram: { name: "Anagram", short: "Rearrange the letters", indicators: ["mixed", "broken", "out", "wild", "arranged", "upset", "badly", "new"] },
  hidden: { name: "Hidden word", short: "The answer is hiding in the clue", indicators: ["in", "some of", "part of", "held by", "found in", "inside"] },
  reversal: { name: "Reversal", short: "Read it backwards", indicators: ["back", "returned", "reversed", "going west", "retreating", "knocked over"] },
  container: { name: "Container", short: "One piece goes inside another", indicators: ["in", "inside", "holding", "around", "eats", "takes in"] },
  charade: { name: "Charade", short: "Pieces joined end to end", indicators: ["and", "with", "gets", "by", "(often none)"] },
  letters: { name: "Letter picking", short: "First, last or alternate letters", indicators: ["starts to", "heads of", "ends of", "oddly", "regularly", "finally"] },
  deletion: { name: "Deletion", short: "Take letters away", indicators: ["headless", "endless", "without", "loses", "missing", "cut"] },
  double: { name: "Double definition", short: "Two meanings, one word", indicators: ["(none: two definitions side by side)"] },
  homophone: { name: "Homophone", short: "Sounds like another word", indicators: ["we hear", "reportedly", "they say", "on the radio", "aloud"] },
};

export const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, "");
const sorted = (s) => [...s].sort().join("");
const reverse = (s) => [...s].reverse().join("");

/** "[f|Night] [i|out] for [d|an object]" → { text, spans: [{ kind, start, end }] } */
export function parseClue(marked) {
  let text = "";
  const spans = [];
  const re = /\[([dif])\|([^\]]+)\]/g;
  let last = 0, m;
  while ((m = re.exec(marked))) {
    text += marked.slice(last, m.index);
    spans.push({ kind: m[1], start: text.length, end: text.length + m[2].length });
    text += m[2];
    last = re.lastIndex;
  }
  text += marked.slice(last);
  return { text, spans };
}

/** Does `recipe` produce `target`? Unverifiable parts (sounds-like, double definitions) count as true. */
export function matches(recipe, target) {
  if (typeof recipe === "string") return letters(recipe) === target;
  const [op, ...args] = recipe;
  switch (op) {
    case "cat": {
      const go = (i, rest) => (i === args.length ? rest === "" : Array.from({ length: rest.length + 1 }, (_, k) => k)
        .some((k) => (i === args.length - 1 ? k === rest.length : true) && matches(args[i], rest.slice(0, k)) && go(i + 1, rest.slice(k))));
      return go(0, target);
    }
    case "ana": return sorted(letters(args[0])) === sorted(target) && letters(args[0]) !== target;
    case "hid": { const s = letters(args[0]); const at = s.indexOf(target); return at > 0 && at + target.length < s.length; }
    case "rev": return matches(args[0], reverse(target));
    case "in":
      for (let i = 1; i < target.length; i++) for (let j = i + 1; j < target.length; j++)
        if (matches(args[0], target.slice(i, j)) && matches(args[1], target.slice(0, i) + target.slice(j))) return true;
      return false;
    case "odd": return [...letters(args[0])].filter((_, i) => i % 2 === 0).join("") === target;
    case "even": return [...letters(args[0])].filter((_, i) => i % 2 === 1).join("") === target;
    case "first": return String(args[0]).split(/[\s-]+/).map((w) => letters(w)[0] ?? "").join("") === target;
    case "last": return String(args[0]).split(/[\s-]+/).map((w) => letters(w).at(-1) ?? "").join("") === target;
    case "del": {
      const whole = letters(args[0]), cut = letters(args[1]);
      for (let i = 0; i + cut.length <= whole.length; i++) if (whole.slice(i, i + cut.length) === cut && whole.slice(0, i) + whole.slice(i + cut.length) === target) return true;
      return false;
    }
    case "hom": case "dd": return true;
    default: return false;
  }
}
const checkable = (recipe) => (typeof recipe === "string" ? true : !["hom", "dd"].includes(recipe[0]) && recipe.slice(1).every((a) => typeof a !== "object" || checkable(a)));

/**
 * Everything wrong with a clue, as a list of messages (empty = fine). Used by the tests and to
 * filter machine-written clues before they reach the app.
 */
export function problems(c) {
  const out = [];
  const bad = (m) => out.push(m);
  if (!c || typeof c !== "object") return ["not a clue"];
  if (typeof c.clue !== "string" || c.clue.length < 8 || c.clue.length > 160) bad("clue text missing or too long");
  if (typeof c.answer !== "string" || !/^[A-Z]{3,12}$/.test(c.answer)) bad("answer must be 3–12 capital letters");
  if (!TYPES[c.type]) bad(`unknown type ${c.type}`);
  if (typeof c.explain !== "string" || c.explain.length < 10 || c.explain.length > 400) bad("explanation missing or too long");
  if (out.length) return out;
  if (/[<>]/.test(c.clue + c.explain)) bad("no markup allowed");
  const { text, spans } = parseClue(c.clue);
  const kinds = spans.map((s) => s.kind);
  const defs = spans.filter((s) => s.kind === "d");
  if (c.type === "double" ? defs.length !== 2 : defs.length !== 1) bad("needs one definition (two for a double definition)");
  if (defs.length && c.type !== "double" && defs[0].start !== 0 && defs[0].end !== text.replace(/[\s.?!]+$/, "").length) bad("the definition must be at the start or the end");
  if (!["double", "charade"].includes(c.type) && !kinds.includes("i")) bad("needs an indicator");
  if (c.type !== "double" && !kinds.includes("f")) bad("needs fodder");
  if (letters(text).includes(c.answer) && c.type !== "hidden") bad("the answer appears in the clue");
  if (!matches(c.recipe ?? ["?"], c.answer)) bad("the recipe doesn't make the answer");
  // Where the letters are spelled out in the clue itself, they must really be there.
  const fodder = spans.filter((s) => s.kind === "f").map((s) => text.slice(s.start, s.end)).join(" ");
  const literal = (r) => (typeof r === "string" ? [] : ["ana", "hid", "odd", "even", "first", "last"].includes(r[0]) ? [r[1]] : r.slice(1).flatMap((a) => (typeof a === "object" ? literal(a) : [])));
  for (const l of literal(c.recipe ?? [])) if (!letters(fodder).includes(letters(l))) bad(`"${l}" isn't in the clue's fodder`);
  const want = { anagram: "ana", hidden: "hid", reversal: "rev", container: "in", double: "dd", homophone: "hom", deletion: "del", charade: "cat" }[c.type];
  const uses = (r, op) => typeof r === "object" && (r[0] === op || r.slice(1).some((a) => uses(a, op)));
  if (want && !uses(c.recipe, want)) bad(`a ${c.type} clue needs "${want}" in its recipe`);
  if (c.type === "letters" && !["odd", "even", "first", "last"].some((op) => uses(c.recipe, op))) bad("a letter-picking clue needs odd/even/first/last");
  return out;
}
export const isCheckable = (c) => checkable(c.recipe);

/** A date ("2026-11-20") → which clue of `n` is that day's. The order looks random but never changes. */
export function dailyIndex(date, n) {
  const day = Math.floor(Date.parse(date + "T00:00:00Z") / 86400000);
  // Walk the clues with a step that shares no factor with n, so every clue comes up once per cycle.
  let step = 1 + ((n * 0.618) | 0);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  while (gcd(step, n) !== 1) step++;
  return (((day * step) % n) + n) % n;
}
