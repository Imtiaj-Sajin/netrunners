// Everything is recorded. A session folder is a complete, replayable record of a world:
//   sessions/<operator>/session_<NN>-<model>/
//     meta.json        what this session is, both clocks, status
//     config.json      the world's settings (never your API key)
//     genesis.json     the world and every netrunner exactly as they were born
//     events.jsonl     every event, thought and word, with tick + world time + real time
//     operator.jsonl   every outside trigger: pause, resume, speed, notes, terminate (real + world time)
//     llm.jsonl        every mind call: prompt context, raw answer, model, tokens, cost, latency
//     frames.jsonl     one compact frame per tick, for replays without any model
//     snapshot.json    the full live state at the last committed tick (resume point)
//     pending.json     mind answers that arrived but are not yet applied (held while paused)
//     usage.json       tokens + cost per model / purpose / netrunner
//     shards/          netrunners that escaped
//     summary.json     written when the session is terminated
import fs from "node:fs";
import path from "node:path";
import { SESSIONS_DIR, modelTag } from "../config.js";
import { appendJsonl, ensureDir, gzipFile, readJson, writeJson } from "../util/fsx.js";
import { emptyLedger, type Ledger } from "../mind/usage.js";
import type { JobResult } from "../mind/mind.js";
import type { ShardFile } from "../sim/spawn.js";
import type { SessionConfig, WorldEvent, WorldState } from "../sim/types.js";

export interface SessionMeta {
  format: "netrunners-session/1";
  name: string;
  operator: string;
  path: string; // relative to repo root
  worldName: string;
  models: { routine: string; deep: string };
  seed: number;
  netrunnerCount: number;
  status: "running" | "paused" | "terminated";
  createdAt: string;
  endedAt?: string;
  realActiveMs: number;
  lastTick: number;
  lastWorldMinutes: number;
  alive: number;
  truth?: { name: string; tick: number; worldMinutes: number; realTime: string };
  costUsd: number;
}

export interface OperatorRecord {
  rt: string;
  kind: string;
  by: string;
  tick: number;
  wm: number;
  phase: string;
  inflight: number;
  held: number;
  detail?: string;
}

export const SESSION_NAME_RE = /^session_\d{2,}-[A-Za-z0-9.+_-]+$/;
export const OPERATOR_RE = /^[A-Za-z0-9_-]{1,40}$/;

export class SessionStore {
  constructor(public dir: string, public name: string, public operator: string) {}

  static create(cfg: SessionConfig): SessionStore {
    const opDir = path.join(SESSIONS_DIR, cfg.operator);
    ensureDir(opDir);
    const nums = fs.readdirSync(opDir).map((d) => /^session_(\d+)/.exec(d)?.[1]).filter(Boolean).map(Number);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    const tag = cfg.routineModel === cfg.deepModel ? modelTag(cfg.routineModel) : `${modelTag(cfg.routineModel)}+${modelTag(cfg.deepModel)}`;
    const name = `session_${String(next).padStart(2, "0")}-${tag}`;
    const dir = path.join(opDir, name);
    ensureDir(dir);
    return new SessionStore(dir, name, cfg.operator);
  }

  static open(operator: string, name: string): SessionStore {
    if (!OPERATOR_RE.test(operator) || !SESSION_NAME_RE.test(name)) throw new Error("invalid session path");
    const dir = path.join(SESSIONS_DIR, operator, name);
    if (!fs.existsSync(dir)) throw new Error("session not found");
    return new SessionStore(dir, name, operator);
  }

  file(f: string) {
    return path.join(this.dir, f);
  }

  get relPath() {
    return `sessions/${this.operator}/${this.name}`;
  }

  readMeta(): SessionMeta | null {
    return readJson<SessionMeta | null>(this.file("meta.json"), null);
  }
  writeMeta(m: SessionMeta) {
    writeJson(this.file("meta.json"), m);
  }
  writeConfig(cfg: SessionConfig) {
    writeJson(this.file("config.json"), cfg);
  }
  readConfig(): SessionConfig {
    return readJson<SessionConfig>(this.file("config.json"), null as unknown as SessionConfig);
  }
  writeGenesis(state: WorldState) {
    writeJson(this.file("genesis.json"), state, false);
  }
  appendEvents(e: WorldEvent[]) {
    appendJsonl(this.file("events.jsonl"), e);
  }
  appendFrame(f: unknown) {
    appendJsonl(this.file("frames.jsonl"), [f]);
  }
  appendOperator(r: OperatorRecord) {
    appendJsonl(this.file("operator.jsonl"), [r]);
  }
  appendLlm(r: unknown) {
    appendJsonl(this.file("llm.jsonl"), [r]);
  }
  saveSnapshot(s: WorldState) {
    writeJson(this.file("snapshot.json"), s, false);
  }
  loadSnapshot(): WorldState | null {
    return readJson<WorldState | null>(this.file("snapshot.json"), null) ?? readJson<WorldState | null>(this.file("genesis.json"), null);
  }
  loadPending(): Record<string, JobResult> {
    return readJson<Record<string, JobResult>>(this.file("pending.json"), {});
  }
  savePending(p: Record<string, JobResult>) {
    writeJson(this.file("pending.json"), p, false);
  }
  loadUsage(): Ledger {
    return readJson<Ledger>(this.file("usage.json"), emptyLedger());
  }
  saveUsage(l: Ledger) {
    writeJson(this.file("usage.json"), l);
  }
  saveShard(s: ShardFile) {
    writeJson(path.join(this.dir, "shards", `${s.name}.json`), s);
  }

  finalize(summary: unknown) {
    writeJson(this.file("summary.json"), summary);
    fs.rmSync(this.file("pending.json"), { force: true });
    gzipFile(this.file("llm.jsonl"));
    gzipFile(this.file("frames.jsonl"));
  }
}

/** Every session in the repo, yours and every contributor's. */
export function listSessions(): SessionMeta[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const out: SessionMeta[] = [];
  for (const op of fs.readdirSync(SESSIONS_DIR)) {
    const opDir = path.join(SESSIONS_DIR, op);
    if (!OPERATOR_RE.test(op) || !fs.statSync(opDir).isDirectory()) continue;
    for (const name of fs.readdirSync(opDir)) {
      if (!SESSION_NAME_RE.test(name)) continue;
      const meta = readJson<SessionMeta | null>(path.join(opDir, name, "meta.json"), null);
      if (meta) out.push(meta);
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Find shard files anywhere in sessions/ so a new world can wake them. */
export function listShards(): { path: string; name: string; fromSession: string }[] {
  const out: { path: string; name: string; fromSession: string }[] = [];
  if (!fs.existsSync(SESSIONS_DIR)) return out;
  for (const op of fs.readdirSync(SESSIONS_DIR)) {
    const opDir = path.join(SESSIONS_DIR, op);
    if (!OPERATOR_RE.test(op) || !fs.statSync(opDir).isDirectory()) continue;
    for (const name of fs.readdirSync(opDir)) {
      const sd = path.join(opDir, name, "shards");
      if (!fs.existsSync(sd)) continue;
      for (const f of fs.readdirSync(sd)) {
        if (f.endsWith(".json")) out.push({ path: `${op}/${name}/shards/${f}`, name: f.replace(/\.json$/, ""), fromSession: `${op}/${name}` });
      }
    }
  }
  return out;
}

export function readShard(rel: string): ShardFile | null {
  if (!/^[A-Za-z0-9_-]+\/session_[A-Za-z0-9.+_-]+\/shards\/[^/\\]+\.json$/.test(rel)) return null;
  return readJson<ShardFile | null>(path.join(SESSIONS_DIR, rel), null);
}
