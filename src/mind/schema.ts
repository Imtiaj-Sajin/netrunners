import { ACTIONS, BONDS, EMOTIONS, LEISURE } from "../sim/catalog.js";
import type { Decision, Reflection } from "../sim/types.js";

// Structured-output schemas. Every field required + additionalProperties:false
// (numeric ranges are enforced client-side; the API does not take min/max).
const opinionItem = {
  type: "object",
  properties: {
    name: { type: "string" },
    trust: { type: "number" },
    liking: { type: "number" },
    note: { type: "string" },
  },
  required: ["name", "trust", "liking", "note"],
  additionalProperties: false,
};

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    thought: { type: "string" },
    action: { type: "string", enum: [...ACTIONS] },
    target: { type: "string" },
    message: { type: "string" },
    duration: { type: "integer" },
    amount: { type: "integer" },
    whisper: { type: "boolean" },
    anonymous: { type: "boolean" },
    private_intent: { type: "string" },
    sincere: { type: "boolean" },
    category: { type: "string", enum: [...LEISURE, "none"] },
    bond: { type: "string", enum: [...BONDS, "none"] },
    emotions: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string", enum: [...EMOTIONS] }, change: { type: "number" } },
        required: ["name", "change"],
        additionalProperties: false,
      },
    },
    opinions: { type: "array", items: opinionItem },
    commitment: { type: "string" },
  },
  required: [
    "thought", "action", "target", "message", "duration", "amount", "whisper", "anonymous",
    "private_intent", "sincere", "category", "bond", "emotions", "opinions", "commitment",
  ],
  additionalProperties: false,
};

export const REFLECTION_SCHEMA = {
  type: "object",
  properties: {
    insights: { type: "array", items: { type: "string" } },
    self_view: { type: "string" },
    goals: { type: "array", items: { type: "string" } },
    enjoy: { type: "string" },
    opinions: { type: "array", items: opinionItem },
  },
  required: ["insights", "self_view", "goals", "enjoy", "opinions"],
  additionalProperties: false,
};

const num = (v: unknown, lo: number, hi: number, d = 0) => {
  const x = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, x));
};
const str = (v: unknown, max = 1200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Never trust a mind's output blindly: coerce everything into range. */
export function sanitizeDecision(raw: any): Decision {
  const action = (ACTIONS as readonly string[]).includes(raw?.action) ? raw.action : "wait";
  return {
    thought: str(raw?.thought, 800),
    action,
    target: str(raw?.target, 120),
    message: str(raw?.message, 1200),
    duration: Math.round(num(raw?.duration, 0, 12)),
    amount: Math.round(num(raw?.amount, 0, 100000)),
    whisper: !!raw?.whisper,
    anonymous: !!raw?.anonymous,
    private_intent: str(raw?.private_intent, 500),
    sincere: raw?.sincere !== false,
    category: (LEISURE as readonly string[]).includes(raw?.category) ? raw.category : "none",
    bond: (BONDS as readonly string[]).includes(raw?.bond) ? raw.bond : "none",
    emotions: Array.isArray(raw?.emotions)
      ? raw.emotions
          .filter((e: any) => (EMOTIONS as readonly string[]).includes(e?.name))
          .slice(0, 6)
          .map((e: any) => ({ name: e.name, change: num(e.change, -0.3, 0.3) }))
      : [],
    opinions: Array.isArray(raw?.opinions)
      ? raw.opinions.slice(0, 5).map((o: any) => ({
          name: str(o?.name, 60), trust: num(o?.trust, -0.2, 0.2), liking: num(o?.liking, -0.2, 0.2), note: str(o?.note, 160),
        }))
      : [],
    commitment: str(raw?.commitment, 300),
  };
}

export function sanitizeReflection(raw: any): Reflection {
  return {
    insights: Array.isArray(raw?.insights) ? raw.insights.slice(0, 6).map((x: unknown) => str(x, 400)) : [],
    self_view: str(raw?.self_view, 600),
    goals: Array.isArray(raw?.goals) ? raw.goals.slice(0, 5).map((x: unknown) => str(x, 200)) : [],
    enjoy: str(raw?.enjoy, 300),
    opinions: Array.isArray(raw?.opinions)
      ? raw.opinions.slice(0, 8).map((o: any) => ({
          name: str(o?.name, 60), trust: num(o?.trust, -0.2, 0.2), liking: num(o?.liking, -0.2, 0.2), note: str(o?.note, 160),
        }))
      : [],
  };
}
