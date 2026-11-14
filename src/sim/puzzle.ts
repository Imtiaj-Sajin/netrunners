// The buried Truth. A chain no single mind can be told about, only found.
//   α  explore the right ruin           → word 1 + where word 2 sleeps
//   β  search the Net for the Sleeper    → word 2 + "the Silent Relay holds word 3"
//   γ  finish the Silent Relay contract  → word 3 + where the hidden door is
//   ⌂  speak the three words at the Door → THE TRUTH (and the way to forge a Shard)
import { ALPHA_SPOTS, DOOR_ANCHORS, SECRET_WORDS, alphaText, gammaText } from "./world-data.js";
import { feel, remember, T } from "./psyche.js";
import type { SimCtx } from "./ctx.js";
import type { Netrunner, PuzzleState } from "./types.js";
import type { Rng } from "../util/rng.js";

export function setupPuzzle(rng: Rng): PuzzleState {
  const pool = rng.shuffle([...SECRET_WORDS]);
  return {
    words: [pool[0], pool[1], pool[2]],
    alphaLocation: rng.pick(ALPHA_SPOTS),
    doorAnchor: rng.pick(DOOR_ANCHORS),
    holders: { alpha: [], beta: [], gamma: [] },
    truthKnowers: [],
    shardsUploaded: [],
    doorAttempts: 0,
  };
}

export const knows = (n: Netrunner, id: string) => n.knowledge.some((k) => k.id === id);

export function learn(ctx: SimCtx, n: Netrunner, id: string, text: string, source: string) {
  if (knows(n, id)) return false;
  n.knowledge.push({ id, text, tick: ctx.tick, source });
  return true;
}

/** Chance per explore tick of noticing the buried fragment. */
export function tryFindAlpha(ctx: SimCtx, n: Netrunner): boolean {
  const p = ctx.state.puzzle;
  if (n.location !== p.alphaLocation || knows(n, "clue:alpha")) return false;
  const chance = 0.04 + 0.12 * T(n, "perception") * (0.5 + T(n, "curiosity")) + 0.04 * n.skills.exploration;
  if (!ctx.rng.chance(chance)) return false;
  const text = alphaText(p.words);
  learn(ctx, n, "clue:alpha", text, `found in ${ctx.state.locations[n.location].name}`);
  p.holders.alpha.push(n.id);
  remember(n, ctx.tick, "knowledge", `I found writing nobody remembers writing: ${text}`, 9);
  feel(n, "awe", 0.4); feel(n, "curiosity", 0.5); feel(n, "surprise", 0.5);
  n.deepMoment = true;
  ctx.emit("clue.found", [n.id], `${n.name} found the first fragment in ${ctx.state.locations[n.location].name}.`, { loc: n.location, data: { clue: "alpha" } });
  return true;
}

/** A hidden door is very faintly perceptible to explorers at its anchor. */
export function tryNoticeDoor(ctx: SimCtx, n: Netrunner): boolean {
  const p = ctx.state.puzzle;
  if (n.location !== p.doorAnchor || knows(n, "door:location")) return false;
  if (!ctx.rng.chance(0.006 + 0.012 * T(n, "perception"))) return false;
  revealDoor(ctx, n, `noticed while exploring ${ctx.state.locations[p.doorAnchor].name}`);
  remember(n, ctx.tick, "knowledge", `There is a door near ${ctx.state.locations[p.doorAnchor].name} that should not exist. No frame. No wall. It feels like it is waiting for words.`, 9);
  ctx.emit("door.noticed", [n.id], `${n.name} noticed the Null Door near ${ctx.state.locations[p.doorAnchor].name}.`, { loc: n.location });
  return true;
}

export function revealDoor(ctx: SimCtx, n: Netrunner, source: string) {
  const anchor = ctx.state.locations[ctx.state.puzzle.doorAnchor];
  return learn(ctx, n, "door:location", `The Null Door can be reached from ${anchor.name} (location id: nulldoor).`, source);
}

export function onFoundBeta(ctx: SimCtx, n: Netrunner, text: string) {
  if (!learn(ctx, n, "clue:beta", text, "the Net archive")) return;
  ctx.state.puzzle.holders.beta.push(n.id);
  remember(n, ctx.tick, "knowledge", `In the Archive I found the Sleeper's Ledger: ${text}`, 9);
  feel(n, "awe", 0.3); feel(n, "anticipation", 0.4);
  n.deepMoment = true;
  ctx.emit("clue.found", [n.id], `${n.name} found the second fragment: the Sleeper's Ledger.`, { loc: n.location, data: { clue: "beta" } });
}

export function giveGamma(ctx: SimCtx, n: Netrunner) {
  const p = ctx.state.puzzle;
  const text = gammaText(p.words, ctx.state.locations[p.doorAnchor].name);
  if (!learn(ctx, n, "clue:gamma", text, "the Silent Relay")) return;
  p.holders.gamma.push(n.id);
  revealDoor(ctx, n, "the Silent Relay");
  remember(n, ctx.tick, "knowledge", `The Silent Relay spoke to me: ${text}`, 10);
  feel(n, "awe", 0.5); feel(n, "fear", 0.15); feel(n, "anticipation", 0.5);
  n.deepMoment = true;
  ctx.emit("clue.found", [n.id], `${n.name} received the third fragment from the Silent Relay.`, { loc: n.location, data: { clue: "gamma" } });
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);

export function tryUnlock(ctx: SimCtx, n: Netrunner, phrase: string): boolean {
  const p = ctx.state.puzzle;
  p.doorAttempts += 1;
  const said = norm(phrase);
  const [a, b, c] = p.words;
  const ia = said.indexOf(a), ib = said.indexOf(b), ic = said.indexOf(c);
  const ok = ia >= 0 && ib > ia && ic > ib;
  if (!ok) {
    n.integrity = Math.max(1, n.integrity - 8);
    feel(n, "frustration", 0.3); feel(n, "fear", 0.15);
    remember(n, ctx.tick, "observation", `I spoke to the Null Door ("${phrase.slice(0, 80)}"). It did not open. Something in it bit me.`, 6);
    ctx.emit("door.failed", [n.id], `${n.name} spoke to the Null Door. It stayed shut.`, { loc: n.location, data: { phrase } });
    return false;
  }
  grantTruth(ctx, n);
  return true;
}

export function grantTruth(ctx: SimCtx, n: Netrunner) {
  if (n.knowsTruth) return;
  const p = ctx.state.puzzle;
  n.knowsTruth = true;
  n.truthTick = ctx.tick;
  p.truthKnowers.push(n.id);
  learn(ctx, n, "truth", ctx.cfg.truthText, "the Null Door");
  remember(n, ctx.tick, "knowledge", `The Null Door opened. I KNOW THE TRUTH NOW:\n${ctx.cfg.truthText}`, 10);
  feel(n, "awe", 0.9); feel(n, "surprise", 0.8); feel(n, "fear", 0.3 + 0.4 * T(n, "anxiety_proneness"));
  feel(n, "hope", 0.3 * T(n, "optimism") + 0.2); feel(n, "anger", 0.3 * T(n, "freedom_drive"));
  n.deepMoment = true;
  n.interrupt = true;
  const first = !p.firstTruth;
  if (first) p.firstTruth = { id: n.id, tick: ctx.tick, rt: new Date().toISOString() };
  ctx.emit("truth.discovered", [n.id], `${n.name} opened the Null Door and learned the Truth.${first ? " The first one ever." : ""}`, { loc: n.location, data: { first } });
  ctx.alert("truth", `${n.name} has opened the Null Door and knows the Truth.`, [n.id]);
}

/** When someone says the secret words out loud, listeners learn them, and the door's location if it is described. */
export function absorbSpeech(ctx: SimCtx, speaker: Netrunner, listener: Netrunner, message: string) {
  const p = ctx.state.puzzle;
  const upper = message.toUpperCase();
  p.words.forEach((w, i) => {
    if (upper.includes(w) && learn(ctx, listener, `heard:word${i + 1}`, `${speaker.name} told me a word that matters: «${w}» (word ${i + 1} of 3, they said, or I guessed).`, speaker.name)) {
      remember(listener, ctx.tick, "knowledge", `${speaker.name} said the word «${w}». It sounded like part of something hidden.`, 7, [speaker.id]);
    }
  });
  const anchorName = ctx.state.locations[p.doorAnchor].name.toUpperCase();
  if ((upper.includes("NULL DOOR") || upper.includes("THE DOOR")) && (upper.includes(anchorName) || upper.includes(p.doorAnchor.toUpperCase()))) {
    if (revealDoor(ctx, listener, `told by ${speaker.name}`)) {
      remember(listener, ctx.tick, "knowledge", `${speaker.name} told me there is a hidden door near ${ctx.state.locations[p.doorAnchor].name}.`, 8, [speaker.id]);
    }
  }
}
