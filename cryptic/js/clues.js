// Cryptic clues: how a clue is stored, and a checker for its wordplay.
//
// The clues are real newspaper clues from George Ho's dataset (https://cryptics.georgeho.org),
// chosen by tools/build-cryptic.mjs: only clues whose wordplay could be fully reconstructed.
// A clue has its plain text plus where its parts are (character positions in the text):
//   d  the definition [start, end]
//   i  the indicators [[start, end], …]: the words that tell you what to do
//   f  the pieces [[start, end, LETTERS], …]: the words the wordplay works on, and the letters they give
// `recipe` says how the answer is built, as nested lists, so it can be checked by machine:
//   "CAR"                       those letters
//   ["cat", a, b, …]            one after another
//   ["ana", "NIGHT"]            an anagram of these letters
//   ["hid", "sly recital"]      hidden inside these words
//   ["rev", x]                  x backwards
//   ["in", x, y]                x inside y
//   ["odd", "antler"] / ["even", …]     alternate letters

export const TYPES = {
  anagram: { name: "Anagram", short: "Rearrange the letters", indicators: ["mixed", "broken", "out", "wild", "arranged", "upset", "badly", "new"] },
  hidden: { name: "Hidden word", short: "The answer is hiding in the clue", indicators: ["in", "some of", "part of", "held by", "found in", "inside"] },
  charade: { name: "Charade", short: "Pieces joined end to end", indicators: ["(usually none: the pieces just sit side by side)"] },
  container: { name: "Container", short: "One piece goes inside another", indicators: ["in", "inside", "holding", "around", "eats", "takes in"] },
  reversal: { name: "Reversal", short: "Read it backwards", indicators: ["back", "returned", "reversed", "going west", "retreating", "up (in down clues)"] },
  letters: { name: "Alternate letters", short: "Take every other letter", indicators: ["oddly", "evenly", "regularly", "alternately", "odd bits of"] },
};

export const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, "");
const sorted = (s) => [...s].sort().join("");
const reverse = (s) => [...s].reverse().join("");

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
/** Everything wrong with a stored clue, as a list of messages (empty = fine). Used by the tests. */
export function check(c) {
  const out = [];
  const bad = (m) => out.push(m);
  if (!c || typeof c.clue !== "string" || !/^[A-Z]{4,10}$/.test(c.answer ?? "") || !TYPES[c.type]) return ["not a clue"];
  const inside = (sp) => Array.isArray(sp) && sp[0] >= 0 && sp[1] > sp[0] && sp[1] <= c.clue.length;
  if (!inside(c.d)) bad("definition out of range");
  else if (c.d[0] !== 0 && c.d[1] !== c.clue.replace(/[\s.?!…]+$/, "").length) bad("the definition must be at the start or the end");
  const spans = [c.d, ...(c.i ?? []), ...(c.f ?? [])];
  if (!spans.every(inside)) bad("a part is out of range");
  for (let x = 0; x < spans.length; x++) for (let y = x + 1; y < spans.length; y++) if (spans[x][0] < spans[y][1] && spans[y][0] < spans[x][1]) bad("parts overlap");
  if (!(c.f ?? []).length) bad("no pieces");
  if (c.type !== "charade" && !(c.i ?? []).length) bad("no indicator");
  if (!matches(c.recipe, c.answer)) bad("the recipe doesn't make the answer");
  // The pieces named in the clue must be the letters the recipe uses.
  const used = (r) => (typeof r === "string" ? [letters(r)] : r.slice(1).flatMap(used));
  if ([...used(c.recipe)].sort().join("|") !== (c.f ?? []).map((f) => (["hid", "odd", "even"].includes(c.recipe[0]) ? letters(c.clue.slice(f[0], f[1])) : f[2])).sort().join("|")) bad("pieces and recipe disagree");
  if (["anagram", "hidden", "letters"].includes(c.type) && c.f?.[0] && letters(c.clue.slice(c.f[0][0], c.f[0][1])) !== c.f[0][2]) bad("fodder isn't in the clue");
  if (typeof c.explain !== "string" || c.explain.length < 10 || /[<>]/.test(c.explain + c.clue)) bad("explanation missing");
  if (c.url && !/^https:\/\//.test(c.url)) bad("link must be https");
  return out;
}

/** A shuffle that always gives the same order for the same seed. */
export function seededShuffle(list, seed) {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** A date ("2026-11-20") → which clue of `n` is that day's. The order looks random but never changes. */
export function dailyIndex(date, n) {
  const day = Math.floor(Date.parse(date + "T00:00:00Z") / 86400000);
  // Walk the clues with a step that shares no factor with n, so every clue comes up once per cycle.
  let step = 1 + ((n * 0.618) | 0);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  while (gcd(step, n) !== 1) step++;
  return (((day * step) % n) + n) % n;
}
