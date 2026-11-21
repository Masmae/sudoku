// Writes new cryptic clues with a model from the OpenCode Go plan and keeps only the ones whose
// wordplay passes the checker (js/clues.js). Runs on GitHub Actions; the key is the
// OPENCODE_API_KEY repository secret and is never stored in the repo.
//   node tools/cryptic-generate.mjs [how many to add, default 12]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { TYPES, problems, isCheckable, parseClue } from "../cryptic/js/clues.js";

const ROOT = new URL("../", import.meta.url);
const OPENCODE_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const MODELS = ["qwen3.8-flash", "kimi-k3"];
// Thinking models can spend the whole budget "thinking" and never answer: ask for thinking off
// first; if the API rejects those fields, send a plain request.
const VARIANTS = [
  { label: "thinking off", extra: { thinking: { type: "disabled" }, enable_thinking: false, reasoning_effort: "none" } },
  { label: "plain", extra: {} },
];
const WANT = Math.max(1, Math.min(40, Number(process.argv[2]) || 12));
// Only types a machine can check: no double definitions or homophones from the model.
const MACHINE_TYPES = ["anagram", "hidden", "reversal", "container", "charade", "letters", "deletion"];

const read = (f) => JSON.parse(readFileSync(new URL(f, ROOT), "utf8"));
const mine = read("cryptic/data/clues.json").clues;
const MADE = "cryptic/data/generated.json";
const made = existsSync(new URL(MADE, ROOT)) ? read(MADE) : { clues: [] };
const taken = new Set([...mine, ...made.clues].map((c) => c.answer));

async function complete(model, content, key, extra = {}) {
  const res = await fetch(OPENCODE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "cryptic-clues/1.0", "x-opencode-session": "cryptic-clues" },
    body: JSON.stringify({ model, max_tokens: 8000, stream: true, ...extra, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`${res.status} ${e.error?.message ?? ""}`); }
  let text = "", buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try { text += JSON.parse(data).choices?.[0]?.delta?.content ?? ""; } catch { /* partial line */ }
    }
  }
  return text;
}

const examples = MACHINE_TYPES.map((t) => mine.find((c) => c.type === t)).map(({ type, clue, answer, recipe, explain, level }) => JSON.stringify({ type, level, clue, answer, recipe, explain })).join("\n");
const prompt = (type, n) => `You write cryptic crossword clues for a teaching app, in plain British-style cryptic conventions.

Write ${n} new clues of type "${type}" (${TYPES[type].name}: ${TYPES[type].short}).

Rules, all checked by a program:
- The clue text marks its parts: [d|definition] [i|indicator] [f|fodder]. Unmarked words are only small joining words (for, in, to, is, and, with, gets).
- Exactly one [d|…], at the very start or the very end. It must be a fair, ordinary definition of the answer.
- "answer": one English word, 3 to 10 CAPITAL letters, common enough for a general solver. It must not appear in the clue.
- "recipe" shows how the wordplay builds the answer, as nested JSON lists. Operations:
  "CAR" (letters from a synonym or abbreviation named in the clue), ["cat", a, b, …] (joined), ["ana", "LETTERS"] (anagram of these exact letters),
  ["hid", "the words"] (hidden inside these words, not touching either end), ["rev", x] (backwards), ["in", x, y] (x inside y),
  ["odd", "words"] / ["even", "words"] (alternate letters), ["first", "words"] / ["last", "words"] (first/last letter of each word), ["del", "WORD", "X"] (WORD without X).
- For ana / hid / odd / even / first / last the letters must be written out in the clue's [f|…] part, exactly.
- The surface must read as a natural phrase or sentence.
- "explain": 1 or 2 plain sentences that walk through the wordplay, naming the pieces in CAPITALS.
- "level": 1 (gentle), 2 (medium) or 3 (tricky).
- Don't use these answers: ${[...taken].slice(-150).join(", ")}.

Examples of the format:
${examples}

Answer with JSON only: {"clues": [ … ]}`;

const key = process.env.OPENCODE_API_KEY;
if (!key) { console.error("OPENCODE_API_KEY not set"); process.exit(1); }
const skip = new Set();
const added = [];
let nextId = made.clues.length + 1;
for (let round = 0; round < 6 && added.length < WANT; round++) {
  const type = MACHINE_TYPES[(made.clues.length + round) % MACHINE_TYPES.length];
  let out = null;
  for (const model of MODELS) {
    for (const v of VARIANTS) {
      if (out || skip.has(`${model}|${v.label}`)) continue;
      try {
        const text = await complete(model, prompt(type, 8), key, v.extra);
        out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).clues;
        console.log(`${type}: ${model} (${v.label}) wrote ${out?.length ?? 0}`);
      } catch (e) {
        console.warn(`${type}: ${model} (${v.label}) failed: ${e.message}`);
        if (/^400\b/.test(e.message)) skip.add(`${model}|${v.label}`);
      }
    }
  }
  for (const c of Array.isArray(out) ? out : []) {
    const clue = { id: `g${String(nextId).padStart(4, "0")}`, type: c?.type, level: [1, 2, 3].includes(c?.level) ? c.level : 2, clue: c?.clue, answer: c?.answer, recipe: c?.recipe, explain: c?.explain };
    const why = problems(clue);
    if (!why.length && !isCheckable(clue)) why.push("can't be checked by machine");
    if (!why.length && taken.has(clue.answer)) why.push("answer already used");
    if (why.length) { console.log(`  rejected ${c?.answer ?? "?"}: ${why[0]}`); continue; }
    console.log(`  kept ${clue.answer}: ${parseClue(clue.clue).text}`);
    taken.add(clue.answer); added.push(clue); nextId++;
    if (added.length >= WANT) break;
  }
}
if (added.length) {
  made.clues.push(...added);
  writeFileSync(new URL(MADE, ROOT), JSON.stringify(made, null, 1) + "\n");
}
console.log(`Added ${added.length} clue${added.length === 1 ? "" : "s"} (${made.clues.length} machine-written in total).`);
