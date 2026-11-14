import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./util/fsx.js";
import { DEFAULT_TRUTH } from "./sim/world-data.js";
import type { MindModel, SessionConfig } from "./sim/types.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SESSIONS_DIR = process.env.NETRUNNERS_SESSIONS_DIR ? path.resolve(process.env.NETRUNNERS_SESSIONS_DIR) : path.join(ROOT, "sessions");
export const LOCAL_DIR = path.join(ROOT, ".netrunners"); // git-ignored: YOUR key lives here, never in a session
export const SETTINGS_FILE = path.join(LOCAL_DIR, "settings.json");
export const WEB_DIR = path.join(ROOT, "web");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* no .env: fine */
}

export const MODELS: { id: MindModel; label: string }[] = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast, cheapest)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (deeper minds)" },
  { id: "offline", label: "Offline rule-based minds (free, for testing)" },
  { id: "claude-code", label: "Claude Code bridge (one agent per mind, no API key)" },
];

export interface LocalSettings {
  apiKey?: string;
  operator: string;
  defaults: Partial<SessionConfig>;
}

export function sanitizeOperator(name: string) {
  return (name || "operator").replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 40) || "operator";
}

export function loadSettings(): LocalSettings {
  const s = readJson<Partial<LocalSettings>>(SETTINGS_FILE, {});
  return {
    apiKey: s.apiKey || undefined,
    operator: sanitizeOperator(s.operator || process.env.NETRUNNERS_OPERATOR || os.hostname()),
    defaults: s.defaults ?? {},
  };
}

export function saveSettings(s: LocalSettings) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  writeJson(SETTINGS_FILE, s);
}

/** The key the minds will use: Settings panel first, then ANTHROPIC_API_KEY, then the SDK's own credential chain. */
export function effectiveApiKey(s: LocalSettings): string | undefined {
  return s.apiKey || process.env.ANTHROPIC_API_KEY || undefined;
}

export function keyStatus(s: LocalSettings) {
  if (s.apiKey) return { source: "settings", hint: `…${s.apiKey.slice(-4)}` };
  if (process.env.ANTHROPIC_API_KEY) return { source: "environment", hint: `…${process.env.ANTHROPIC_API_KEY.slice(-4)}` };
  return { source: "none", hint: "" };
}

export function defaultConfig(s: LocalSettings): SessionConfig {
  return {
    worldName: "the Lattice",
    operator: s.operator,
    seed: Math.floor(Math.random() * 2 ** 31),
    netrunnerCount: 6,
    minutesPerTick: 10,
    tickIntervalMs: 3000,
    routineModel: "claude-haiku-5-5",
    deepModel: "claude-sonnet-5-5",
    deepNet: false,
    deepNetMaxSearches: 20,
    budgetUsd: 2,
    spawnEveryWorldHours: 0,
    reflectEveryWorldHours: 8,
    autoPauseOnTruth: false,
    rewritePower: false,
    maxConcurrency: 4,
    importShards: [],
    truthText: DEFAULT_TRUTH,
    ...s.defaults,
  };
}

export function modelTag(m: MindModel) {
  if (m === "offline" || m === "claude-code") return m;
  return m.replace(/^claude-/, "");
}
