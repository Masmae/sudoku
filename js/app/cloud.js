// The link to GitHub, where puzzles are built. Optional: without it the app works as before.
//
// With a token (pasted once in Settings, kept only in this browser) the app can:
//  - save data/wanted.json in the repo: which mixes and levels you start, which weren't ready,
//    and your ratings. The nightly build makes those first, and more of them.
//  - order a mix and level, built in the cloud within a few minutes (the "Order a puzzle" workflow).
import * as store from "./storage.js";

const REPO = "Masmae/sudoku";
const API = `https://api.github.com/repos/${REPO}`;
const FILE = "data/wanted.json";
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

export const getToken = () => store.load("ghToken", "");
export const connected = () => !!getToken();
let status = { ok: true, message: "" };
export const getStatus = () => status;

/** Checks a token (it must be able to write to the repo) and keeps it. Empty string disconnects. */
export async function setToken(token) {
  token = String(token ?? "").trim();
  if (!token) { store.remove("ghToken"); status = { ok: true, message: "" }; return true; }
  try {
    const res = await fetch(API, { headers: headers(token), cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 401 ? "GitHub didn't accept the token" : res.status === 404 ? "the token can't see the sudoku repository" : `GitHub said ${res.status}`);
    const j = await res.json();
    if (j.permissions && !j.permissions.push) throw new Error("the token can read the repository but not write to it");
    store.save("ghToken", token); status = { ok: true, message: "" };
    dirty = true; sync();
    return true;
  } catch (e) { status = { ok: false, message: e.message }; return false; }
}

// ---------------------------------------------------------------- what you play
const blank = () => ({ version: 1, played: {}, missed: {}, ratings: {} });
let wanted = { ...blank(), ...store.load("wanted", {}) };
let dirty = false, timer = 0;
export const getWanted = () => wanted;
const bump = (obj, key, n = 1) => { obj[key] = Math.min(999, (obj[key] ?? 0) + n); };
const changed = () => { store.save("wanted", wanted); dirty = true; clearTimeout(timer); timer = setTimeout(sync, 90000); };

/** A puzzle of this mix and level was started (`ready` = it was in stock; otherwise it had to be made). */
export function notePlayed(key, ready) { bump(wanted.played, key); if (!ready) bump(wanted.missed, key); changed(); }
/** "More at this level, please" (used when a level was rated too easy or too hard). */
export function nudge(key) { bump(wanted.played, key); changed(); }
/** A rating for a mix: one of fun, dull, easy, ok, hard. */
export function rate(mix, what) {
  const r = (wanted.ratings[mix] ??= {});
  bump(r, what);
  changed();
}
export const ratingOf = (mix) => wanted.ratings[mix] ?? {};

/** Saves wanted.json to the repo (merged with what's there: per entry, the larger count wins). */
export async function sync() {
  clearTimeout(timer);
  const token = getToken();
  if (!token || !dirty) return;
  dirty = false;
  try {
    const res = await fetch(`${API}/contents/${FILE}?ref=main&t=${Date.now()}`, { headers: headers(token), cache: "no-store" });
    let sha = null, remote = blank();
    if (res.ok) { const j = await res.json(); sha = j.sha; try { remote = { ...blank(), ...JSON.parse(b64decode(j.content)) }; } catch { /* start over */ } }
    else if (res.status !== 404) throw new Error(`GitHub said ${res.status}`);
    const max = (a = {}, b = {}) => { const out = { ...b }; for (const [k, v] of Object.entries(a)) out[k] = Math.max(v, out[k] ?? 0); return out; };
    const ratings = { ...remote.ratings };
    for (const [m, r] of Object.entries(wanted.ratings)) ratings[m] = max(r, ratings[m]);
    wanted = { version: 1, played: max(wanted.played, remote.played), missed: max(wanted.missed, remote.missed), ratings };
    store.save("wanted", wanted);
    const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
    const core = ({ played, missed, ratings }) => canon({ played, missed, ratings });
    if (res.ok && core(wanted) === core(remote)) return;                    // nothing new to save
    const body = JSON.stringify({ ...wanted, updated: new Date().toISOString().slice(0, 10) }, null, 1) + "\n";
    const put = await fetch(`${API}/contents/${FILE}`, { method: "PUT", headers: headers(token),
      body: JSON.stringify({ message: "What to build next (from the app)", content: b64encode(body), branch: "main", ...(sha ? { sha } : {}) }) });
    if (!put.ok) throw new Error(`couldn't save (${put.status})`);
    status = { ok: true, message: "" };
  } catch (e) { dirty = true; status = { ok: false, message: e.message }; }
}
// Leaving the app: save what's pending.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sync(); });

// ---------------------------------------------------------------- orders
/** Asks the cloud to make this mix and level now. Throws with a readable message if it can't. */
export async function order(mix, level, { quiet = false } = {}) {
  const token = getToken();
  if (!token) throw new Error("Connect to GitHub in Settings first.");
  const res = await fetch(`${API}/dispatches`, { method: "POST", headers: headers(token), body: JSON.stringify({ event_type: "order", client_payload: { mix, level } }) });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "GitHub refused the order: check the token in Settings." : `GitHub said ${res.status}.`);
  const orders = pending().filter((o) => !(o.mix === mix && o.level === level));
  orders.push({ mix, level, at: Date.now(), quiet });      // quiet: made ahead of time, no notice when it lands
  store.save("orders", orders);
}
/** Orders still on their way: [{ mix, level, at }] */
export const pending = () => store.load("orders", []).filter((o) => o && typeof o.mix === "string" && Number.isInteger(o.level));
export const settle = (o) => store.save("orders", pending().filter((x) => !(x.mix === o.mix && x.level === o.level)));
