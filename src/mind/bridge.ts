// The Claude Code bridge. Instead of calling the API, a moment that needs a mind is written to
// .netrunners/bridge/inbox/<name>/<jobId>.json. A Claude Code agent that plays only that netrunner
// picks it up (scripts/bridge.ts), and writes its answer to .netrunners/bridge/outbox/<jobId>.json.
// Each mind has its own agent, so no mind can see another's thoughts.
import fs from "node:fs";
import path from "node:path";
import { LOCAL_DIR } from "../config.js";
import { ensureDir, writeJson } from "../util/fsx.js";

export const BRIDGE_DIR = path.join(LOCAL_DIR, "bridge");
export const bridgeName = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, "_");
export const outboxFile = (jobId: string) => path.join(BRIDGE_DIR, "outbox", `${jobId}.json`);

export function resetBridge() {
  fs.rmSync(BRIDGE_DIR, { recursive: true, force: true });
  ensureDir(path.join(BRIDGE_DIR, "inbox"));
  ensureDir(path.join(BRIDGE_DIR, "outbox"));
}

export function stopBridge() {
  ensureDir(BRIDGE_DIR);
  fs.writeFileSync(path.join(BRIDGE_DIR, "STOP"), new Date().toISOString());
}

export interface BridgeAnswer { ok: boolean; json?: unknown; text?: string; error?: string }

/** Post a moment and wait (as long as it takes) for the netrunner's own agent to answer it. */
export async function askBridge(job: { id: string; kind: string; system?: string; user?: string }, name: string): Promise<BridgeAnswer> {
  const inbox = path.join(BRIDGE_DIR, "inbox", bridgeName(name));
  ensureDir(inbox);
  ensureDir(path.join(BRIDGE_DIR, "outbox"));
  const inFile = path.join(inbox, `${job.id}.json`);
  const out = outboxFile(job.id);
  if (!fs.existsSync(out)) writeJson(inFile, { id: job.id, kind: job.kind, name, system: job.system, user: job.user, answerTo: out, postedAt: new Date().toISOString() });
  while (!fs.existsSync(out)) {
    if (fs.existsSync(path.join(BRIDGE_DIR, "STOP"))) return { ok: false, error: "bridge stopped" };
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 150)); // let the writer finish
  const text = fs.readFileSync(out, "utf8");
  fs.rmSync(out, { force: true });
  fs.rmSync(inFile, { force: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return { ok: true, json: JSON.parse(cleaned), text };
  } catch {
    return { ok: false, text, error: "the agent's answer was not valid JSON" };
  }
}

// ── heartbeat: each agent leaves a timestamp every time it checks for its next moment ──
export const BEAT_DIR = path.join(BRIDGE_DIR, "beat");

export function beat(name: string) {
  ensureDir(BEAT_DIR);
  fs.writeFileSync(path.join(BEAT_DIR, bridgeName(name)), String(Date.now()));
}

/** Which minds have an agent connected (a beat in the last `maxAgeMs`). */
export function bridgeMinds(names: string[], maxAgeMs = 300_000): Record<string, { lastBeat: number | null; connected: boolean }> {
  const out: Record<string, { lastBeat: number | null; connected: boolean }> = {};
  for (const n of names) {
    let last: number | null = null;
    try { last = Number(fs.readFileSync(path.join(BEAT_DIR, bridgeName(n)), "utf8")) || null; } catch { /* never beat */ }
    out[n] = { lastBeat: last, connected: last !== null && Date.now() - last < maxAgeMs };
  }
  return out;
}
