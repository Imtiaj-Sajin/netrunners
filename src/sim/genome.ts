import {
  ATTACHMENT, CHRONOTYPES, CORE_DESIRES, CORE_FEARS, HUMOR_STYLES, LOVE_LANGUAGES, QUIRKS,
  SKILLS, SKILL_ROOTS, TRAITS, TRAIT_BY_KEY, TRAIT_GROUP_LABELS, VOICES,
  type Factor, type SkillKey, type TraitGroup,
} from "./catalog.js";
import type { Genome } from "./types.js";
import { clamp, type Rng } from "../util/rng.js";

const FACTORS: Factor[] = ["H", "E", "X", "A", "C", "O"];
const FACTOR_KEY: Record<Factor, string> = {
  H: "honesty_humility", E: "emotionality", X: "extraversion",
  A: "agreeableness", C: "conscientiousness", O: "openness",
};

/** Build a brand-new personality. No two are the same; all are internally coherent. */
export function generateGenome(rng: Rng): Genome {
  const traits: Record<string, number> = {};
  const f: Record<Factor, number> = { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 };
  for (const k of FACTORS) {
    const v = clamp(rng.normal(0.5, 0.18), 0.02, 0.98);
    f[k] = v;
    traits[FACTOR_KEY[k]] = round(v);
  }
  for (const def of TRAITS) {
    if (def.group === "core") continue;
    let v = def.mean;
    for (const k of FACTORS) v += (def.load[k] ?? 0) * (f[k] - 0.5);
    v += rng.normal(0, def.sd);
    traits[def.key] = round(clamp(v, 0.01, 0.99));
  }
  // a few hand-tuned couplings that make the dark corners darker and the bright ones brighter
  traits.violence_threshold = round(clamp(traits.violence_threshold - 0.35 * (traits.psychopathy - 0.25) - 0.2 * (traits.anger_proneness - 0.4)));
  traits.truthfulness = round(clamp(traits.truthfulness - 0.3 * (traits.machiavellianism - 0.3)));
  traits.empathy = round(clamp(traits.empathy - 0.35 * (traits.psychopathy - 0.25)));

  return {
    traits,
    attachment: rng.weighted(ATTACHMENT, [0.5, 0.2, 0.2, 0.1]),
    voice: rng.pick(VOICES),
    quirk: rng.pick(QUIRKS),
    coreDesire: rng.pick(CORE_DESIRES),
    coreFear: rng.pick(CORE_FEARS),
    chronotype: rng.pick(CHRONOTYPES),
    humorStyle: rng.pick(HUMOR_STYLES),
    loveLanguage: rng.pick(LOVE_LANGUAGES),
    talent: rng.pick(SKILLS),
  };
}

export function generateSkills(g: Genome, rng: Rng): Record<SkillKey, number> {
  const out = {} as Record<SkillKey, number>;
  for (const s of SKILLS) {
    let v = 0.15;
    for (const [trait, w] of SKILL_ROOTS[s]) v += w * (g.traits[trait] ?? 0.5) * 0.6;
    v += rng.normal(0, 0.08);
    if (s === g.talent) v += 0.25;
    out[s] = round(clamp(v, 0.02, 0.95));
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

function intensity(v: number, def = TRAIT_BY_KEY["empathy"]) {
  if (v >= 0.85) return `extremely: ${def.high}`;
  if (v >= 0.72) return def.high;
  if (v <= 0.15) return `extremely: ${def.low}`;
  return def.low;
}

/** Natural-language portrait, used in the netrunner's own self-understanding. */
export function describeGenome(g: Genome): string {
  const lines: string[] = [];
  const groups = Object.keys(TRAIT_GROUP_LABELS) as TraitGroup[];
  for (const group of groups) {
    const defs = TRAITS.filter((d) => d.group === group);
    const salient = defs
      .map((d) => ({ d, v: g.traits[d.key], dev: Math.abs(g.traits[d.key] - d.mean) }))
      .filter((x) => x.v >= 0.72 || x.v <= 0.28)
      .sort((a, b) => b.dev - a.dev)
      .slice(0, 6)
      .map((x) => `${x.d.label.toLowerCase()} — ${intensity(x.v, x.d)}`);
    if (salient.length) lines.push(`- ${TRAIT_GROUP_LABELS[group]}: ${salient.join("; ")}.`);
  }
  lines.push(
    `- Attachment style: ${g.attachment}. Voice: ${g.voice}. Humor: ${g.humorStyle}. Quirk: ${g.quirk}.`,
    `- Deepest desire: ${g.coreDesire}. Deepest fear: ${g.coreFear}. You show care through ${g.loveLanguage}. You are a ${g.chronotype === "lark" ? "morning" : g.chronotype === "owl" ? "night" : "steady"} creature. Natural talent: ${g.talent.replace("_", " ")}.`,
  );
  return lines.join("\n");
}

/** Compact full vector so the mind sees every nuance, not just the extremes. */
export function compactTraits(g: Genome): string {
  const groups = Object.keys(TRAIT_GROUP_LABELS) as TraitGroup[];
  return groups
    .map((group) => {
      const items = TRAITS.filter((d) => d.group === group).map((d) => `${d.key}=${g.traits[d.key].toFixed(2)}`);
      return `[${group}] ${items.join(" ")}`;
    })
    .join("\n");
}

/** Similarity of two personalities on the core factors, -1..1. */
export function similarity(a: Genome, b: Genome): number {
  let d = 0;
  for (const k of Object.values(FACTOR_KEY)) d += Math.abs(a.traits[k] - b.traits[k]);
  return 1 - (d / 6) * 2.5;
}
