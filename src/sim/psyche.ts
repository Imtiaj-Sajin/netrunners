// Emotions, needs, memory and impressions: the inner life of a netrunner.
import { EMOTIONS, NEEDS, NEGATIVE_EMOTIONS, POSITIVE_EMOTIONS, type EmotionKey, type NeedKey } from "./catalog.js";
import { similarity } from "./genome.js";
import type { Impression, Memory, Netrunner } from "./types.js";
import { clamp, hash32 } from "../util/rng.js";

export const T = (n: Netrunner, key: string) => n.genome.traits[key] ?? 0.5;

// ───────────────────────────── Emotions ─────────────────────────────

/** Where each emotion drifts back to when nothing is happening (personality-driven). */
export function emotionBaseline(n: Netrunner, e: EmotionKey): number {
  const t = (k: string) => T(n, k);
  switch (e) {
    case "joy": return 0.15 + 0.3 * t("happiness_setpoint");
    case "calm": return 0.2 + 0.3 * (1 - t("neuroticism"));
    case "anxiety": return 0.05 + 0.25 * t("anxiety_proneness");
    case "sadness": return 0.03 + 0.15 * t("melancholy");
    case "hope": return 0.1 + 0.25 * t("optimism");
    case "trust": return 0.1 + 0.25 * t("trust_propensity");
    case "curiosity": return 0.1 + 0.3 * t("curiosity");
    case "anger": return 0.02 + 0.1 * t("anger_proneness");
    case "loneliness": return 0.02 + 0.1 * t("loneliness_proneness");
    case "anticipation": return 0.1;
    default: return 0.02;
  }
}

export function decayEmotions(n: Netrunner, hours: number) {
  const rate = clamp(0.12 + 0.25 * T(n, "resilience") - 0.1 * T(n, "neuroticism"), 0.04, 0.5);
  const k = 1 - Math.pow(1 - rate, hours);
  for (const e of EMOTIONS) {
    const base = emotionBaseline(n, e);
    n.emotions[e] = round3(n.emotions[e] + (base - n.emotions[e]) * k);
  }
}

/** Push an emotion. Reactivity scales with emotionality/sensitivity. */
export function feel(n: Netrunner, e: EmotionKey, delta: number) {
  const react = 0.6 + 0.5 * T(n, "sensitivity") + 0.3 * T(n, "neuroticism") - 0.2 * T(n, "stress_tolerance");
  n.emotions[e] = round3(clamp(n.emotions[e] + delta * react));
}

export function valence(n: Netrunner): number {
  const pos = POSITIVE_EMOTIONS.reduce((s, e) => s + n.emotions[e], 0) / POSITIVE_EMOTIONS.length;
  const neg = NEGATIVE_EMOTIONS.reduce((s, e) => s + n.emotions[e], 0) / NEGATIVE_EMOTIONS.length;
  return round3(clamp((pos - neg) * 2.2, -1, 1));
}

export function topEmotions(n: Netrunner, k = 4): { e: EmotionKey; v: number }[] {
  return EMOTIONS.map((e) => ({ e, v: n.emotions[e] }))
    .filter((x) => x.v > 0.18)
    .sort((a, b) => b.v - a.v)
    .slice(0, k);
}

export function emotionWord(v: number) {
  return v > 0.75 ? "overwhelming" : v > 0.55 ? "strong" : v > 0.35 ? "noticeable" : "faint";
}

// ───────────────────────────── Needs ─────────────────────────────

/** Satisfaction drains every tick at a personality-driven rate (points per world hour). */
export function decayNeeds(n: Netrunner, hours: number, ctx: { danger: number; alone: boolean }) {
  const t = (k: string) => T(n, k);
  const rate: Record<NeedKey, number> = {
    survival: 0, // derived from Pulse below
    rest: 0, // derived from energy below
    safety: 0,
    social: 1.2 + 3 * t("sociability") + 1.5 * t("connection_drive") - (ctx.alone ? 0 : 2.5),
    intimacy: 0.4 + 1.5 * t("romanticism") + 1 * t("connection_drive"),
    esteem: 0.5 + 1.5 * t("approval_need") + 1 * t("narcissism"),
    autonomy: 0.3 + 1.5 * t("self_direction") + 1 * t("freedom_drive"),
    competence: 0.4 + 1.5 * t("achievement") + 1 * t("ambition"),
    curiosity: 0.6 + 2.5 * t("curiosity") + 1 * t("boredom_proneness"),
    play: 0.5 + 2 * t("play_drive") + 1 * t("hedonism"),
    meaning: 0.2 + 1.2 * t("meaning_drive"),
  };
  for (const k of NEEDS) n.needs[k] = round1(clamp(n.needs[k] - rate[k] * hours, 0, 100));
  n.needs.survival = round1(clamp((n.pulse / 60 / 36) * 100, 0, 100)); // 36h+ of Pulse = fully secure
  n.needs.rest = round1(n.energy);
  n.needs.safety = round1(clamp(n.integrity - ctx.danger * 120 - n.emotions.fear * 30, 0, 100));
}

export function satisfy(n: Netrunner, k: NeedKey, amount: number) {
  n.needs[k] = round1(clamp(n.needs[k] + amount, 0, 100));
}

export function urgentNeeds(n: Netrunner) {
  return NEEDS.map((k) => ({ k, v: n.needs[k] }))
    .filter((x) => x.v < 45)
    .sort((a, b) => a.v - b.v);
}

// ───────────────────────────── Memory ─────────────────────────────

const MEMORY_CAP = 360;

export function remember(
  n: Netrunner, tick: number, kind: Memory["kind"], text: string, importance: number,
  people: string[] = [], loc?: string,
) {
  n.memorySeq += 1;
  n.memories.push({ id: n.memorySeq, tick, kind, text: text.slice(0, 600), importance: clamp(Math.round(importance), 1, 10), people, loc: loc ?? n.location });
  n.importanceSinceReflection += importance;
  if (n.memories.length > MEMORY_CAP) forget(n, tick);
}

/** Forgetting: the least important, oldest everyday memories fade first. Reflections and big moments stay. */
function forget(n: Netrunner, tick: number) {
  const strength = T(n, "memory_strength");
  const scored = n.memories.map((m, i) => ({
    i,
    keep: m.kind === "reflection" || m.kind === "past-life" || m.importance >= 8
      ? Infinity
      : m.importance * (0.5 + strength) - (tick - m.tick) * 0.01,
  }));
  scored.sort((a, b) => a.keep - b.keep);
  const drop = new Set(scored.slice(0, n.memories.length - MEMORY_CAP + 40).map((x) => x.i));
  n.memories = n.memories.filter((_, i) => !drop.has(i));
}

/** Retrieve what comes to mind: recency + importance + relevance (Generative-Agents style, keyword relevance). */
export function recall(n: Netrunner, tick: number, minutesPerTick: number, cues: string[], k = 10): Memory[] {
  const halfLifeHours = 10 + 50 * T(n, "memory_strength");
  const cueSet = new Set(cues.map((c) => c.toLowerCase()));
  const recentIds = new Set(n.memories.slice(-6).map((m) => m.id));
  const scored = n.memories
    .filter((m) => !recentIds.has(m.id))
    .map((m) => {
      const ageH = ((tick - m.tick) * minutesPerTick) / 60;
      const recency = Math.pow(0.5, ageH / halfLifeHours);
      let rel = 0;
      for (const p of m.people) if (cueSet.has(p.toLowerCase())) rel += 0.6;
      if (m.loc && cueSet.has(m.loc.toLowerCase())) rel += 0.2;
      const lower = m.text.toLowerCase();
      for (const c of cueSet) if (c.length > 3 && lower.includes(c)) rel += 0.25;
      return { m, s: recency + (m.importance / 10) * 1.1 + Math.min(1.2, rel) };
    });
  scored.sort((a, b) => b.s - a.s);
  const picked = scored.slice(0, k).map((x) => x.m);
  picked.sort((a, b) => a.tick - b.tick);
  return picked;
}

export function recentMemories(n: Netrunner, k = 6) {
  return n.memories.slice(-k);
}

// ───────────────────────────── Impressions ─────────────────────────────

/** First contact: how much A instinctively likes/trusts/is drawn to B. */
export function meet(a: Netrunner, b: Netrunner, tick: number): Impression {
  const existing = a.impressions[b.id];
  if (existing) return existing;
  const chem = (hash32([a.id, b.id].sort().join("|")) % 1000) / 1000; // shared chemistry per pair
  const sim = similarity(a.genome, b.genome);
  const imp: Impression = {
    familiarity: 0.05,
    trust: round3(clamp((T(a, "trust_propensity") - 0.5) * 0.6 - T(a, "paranoia") * 0.2, -1, 1)),
    liking: round3(clamp(sim * 0.25 + (chem - 0.5) * 0.3 + (T(b, "charisma") - 0.5) * 0.2, -1, 1)),
    respect: 0,
    fear: round3(clamp((T(b, "dominance") - 0.5) * 0.3 * T(a, "anxiety_proneness"), 0, 1)),
    attraction: round3(clamp(chem * T(a, "romanticism") * 0.6 + (T(b, "charisma") - 0.5) * 0.2, 0, 1)),
    perceived: { warmth: 0, competence: 0, honesty: 0, aggression: 0, reliability: 0 },
    notes: [],
    firstMetTick: tick,
    lastSeenTick: tick,
    interactions: 0,
  };
  a.impressions[b.id] = imp;
  return imp;
}

export interface ImpressionDelta {
  trust?: number; liking?: number; respect?: number; fear?: number; attraction?: number; familiarity?: number;
  warmth?: number; competence?: number; honesty?: number; aggression?: number; reliability?: number;
  note?: string;
}

/** Update A's private model of B. Paranoid minds weigh betrayals harder; forgiving minds soften them. */
export function adjust(a: Netrunner, b: Netrunner, tick: number, d: ImpressionDelta) {
  const imp = meet(a, b, tick);
  const neg = (x: number) => x * (0.8 + 0.6 * T(a, "paranoia") + 0.4 * T(a, "vengefulness") - 0.4 * T(a, "forgiveness"));
  const pos = (x: number) => x * (0.8 + 0.4 * T(a, "trust_propensity"));
  const s = (x?: number) => (x === undefined ? 0 : x < 0 ? neg(x) : pos(x));
  imp.trust = round3(clamp(imp.trust + s(d.trust), -1, 1));
  imp.liking = round3(clamp(imp.liking + s(d.liking), -1, 1));
  imp.respect = round3(clamp(imp.respect + (d.respect ?? 0), -1, 1));
  imp.fear = round3(clamp(imp.fear + (d.fear ?? 0), 0, 1));
  imp.attraction = round3(clamp(imp.attraction + (d.attraction ?? 0) * T(a, "romanticism"), 0, 1));
  imp.familiarity = round3(clamp(imp.familiarity + (d.familiarity ?? 0.02), 0, 1));
  const p = imp.perceived;
  p.warmth = round3(clamp(p.warmth + (d.warmth ?? 0), -1, 1));
  p.competence = round3(clamp(p.competence + (d.competence ?? 0), -1, 1));
  p.honesty = round3(clamp(p.honesty + (d.honesty ?? 0), -1, 1));
  p.aggression = round3(clamp(p.aggression + (d.aggression ?? 0), -1, 1));
  p.reliability = round3(clamp(p.reliability + (d.reliability ?? 0), -1, 1));
  if (d.note) {
    imp.notes.push(d.note.slice(0, 160));
    if (imp.notes.length > 6) imp.notes.shift();
  }
  imp.lastSeenTick = tick;
  imp.interactions += 1;
}

export function describeImpression(imp: Impression): string {
  const w = (v: number, pos: string, neg: string) =>
    v > 0.5 ? `deeply ${pos}` : v > 0.2 ? pos : v < -0.5 ? `deeply ${neg}` : v < -0.2 ? neg : "";
  const parts = [
    w(imp.trust, "trusted", "distrusted"),
    w(imp.liking, "liked", "disliked"),
    w(imp.respect, "respected", "looked down on"),
    imp.fear > 0.35 ? "feared" : "",
    imp.attraction > 0.45 ? "attractive to you" : "",
  ].filter(Boolean);
  const fam = imp.familiarity > 0.6 ? "know well" : imp.familiarity > 0.25 ? "know somewhat" : "barely know";
  const p = imp.perceived;
  const seems = [
    p.warmth > 0.25 ? "warm" : p.warmth < -0.25 ? "cold" : "",
    p.competence > 0.25 ? "capable" : p.competence < -0.25 ? "incompetent" : "",
    p.honesty > 0.25 ? "honest" : p.honesty < -0.25 ? "dishonest" : "",
    p.aggression > 0.25 ? "dangerous" : "",
    p.reliability > 0.25 ? "reliable" : p.reliability < -0.25 ? "unreliable" : "",
  ].filter(Boolean);
  let s = `you ${fam} them`;
  if (parts.length) s += `; ${parts.join(", ")}`;
  if (seems.length) s += `; they seem ${seems.join(", ")}`;
  if (imp.notes.length) s += `; your notes: "${imp.notes.slice(-2).join('" / "')}"`;
  return s;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
