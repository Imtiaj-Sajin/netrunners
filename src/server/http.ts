// A tiny local server (127.0.0.1 only): serves the viewer, streams the live world over SSE,
// and exposes the controls. Your API key never leaves this machine except to Anthropic.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { MODELS, ROOT, WEB_DIR, defaultConfig, effectiveApiKey, keyStatus, loadSettings, sanitizeOperator, saveSettings } from "../config.js";
import { Engine } from "../session/engine.js";
import { SessionStore, listSessions, listShards, readShard } from "../session/store.js";
import { mergeLedgers, PRICES, WEB_SEARCH_USD, type Ledger } from "../mind/usage.js";
import { bridgeMinds, resetBridge, stopBridge } from "../mind/bridge.js";
import { readJson, readJsonl } from "../util/fsx.js";
import { TRAITS, TRAIT_GROUP_LABELS, EMOTIONS, NEEDS, SKILLS } from "../sim/catalog.js";
import type { ShardFile } from "../sim/spawn.js";
import type { Netrunner, SessionConfig } from "../sim/types.js";

let engine: Engine | null = null;
const clients = new Set<http.ServerResponse>();

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(payload);
}

function attach(e: Engine) {
  engine = e;
  e.on("tick", (d) => broadcast("tick", d));
  e.on("status", (d) => broadcast("status", d));
  e.on("thinking", (d) => broadcast("thinking", d));
  e.on("usage", (d) => broadcast("usage", d));
  e.on("alert", (d) => broadcast("alert", d));
  e.on("operator", (d) => broadcast("operator", d));
  e.on("terminated", (d) => broadcast("terminated", d));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".webp": "image/webp",
};

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function lightNetrunner(n: Netrunner) {
  const { memories, inbox, genome, ...rest } = n;
  const t = genome.traits;
  const look = { openness: t.openness, extraversion: t.extraversion, emotionality: t.emotionality, neuroticism: t.neuroticism, psychopathy: t.psychopathy };
  return { ...rest, look, memoryCount: memories.length, voice: genome.voice, attachment: genome.attachment, desire: genome.coreDesire, fear: genome.coreFear };
}

const liveInfo = () => (engine && engine.status !== "terminated" ? engine.statusInfo() : null);

function liveState() {
  if (!engine) return null;
  const s = engine.state;
  return {
    info: engine.statusInfo(),
    config: { ...engine.cfg, truthText: undefined },
    netrunners: Object.values(s.netrunners).map(lightNetrunner),
    locations: s.locations,
    contracts: Object.values(s.contracts).filter((c) => c.status === "open" || c.status === "active" || s.tick - c.postedTick < 300),
    forum: s.forum.slice(-40),
    puzzle: s.puzzle,
    events: s.events,
    systems: s.systems,
    minds: engine.cfg.routineModel === "claude-code" || engine.cfg.deepModel === "claude-code" ? bridgeMinds(Object.values(s.netrunners).filter((n) => n.alive).map((n) => n.name)) : null,
    library: (s.library ?? []).map((b) => ({ id: b.id, title: b.title, category: b.category, hours: b.hours, price: b.price })),
    usage: engine.ledger,
  };
}

function usageReport() {
  const settings = loadSettings();
  const metas = listSessions();
  const ledgers: { op: string; l: Ledger }[] = metas.map((m) => ({ op: m.operator, l: readJson<Ledger>(path.join(ROOT, m.path, "usage.json"), null as any) })).filter((x) => x.l);
  return {
    session: engine?.ledger ?? null,
    sessionName: engine?.store.relPath ?? null,
    pc: mergeLedgers(ledgers.filter((x) => x.op === settings.operator).map((x) => x.l)),
    project: mergeLedgers(ledgers.map((x) => x.l)),
    operator: settings.operator,
    sessions: metas.length,
    prices: PRICES,
    webSearchUsd: WEB_SEARCH_USD,
  };
}

function sessionStore(op: string, name: string) {
  return SessionStore.open(op, name);
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  const m = req.method ?? "GET";

  if (p === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`event: hello\ndata: ${JSON.stringify({ live: liveInfo() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (p === "/api/bootstrap" && m === "GET") {
    const s = loadSettings();
    return send(res, 200, {
      settings: { operator: s.operator, key: keyStatus(s), defaults: s.defaults },
      defaults: defaultConfig(s),
      models: MODELS,
      live: liveInfo(),
      sessions: listSessions(),
      shards: listShards(),
      catalog: { traits: TRAITS, groups: TRAIT_GROUP_LABELS, emotions: EMOTIONS, needs: NEEDS, skills: SKILLS },
    });
  }

  if (p === "/api/settings" && m === "POST") {
    const b = await body(req);
    const s = loadSettings();
    if (typeof b.apiKey === "string" && b.apiKey.trim()) s.apiKey = b.apiKey.trim();
    if (b.clearKey) s.apiKey = undefined;
    if (typeof b.operator === "string") s.operator = sanitizeOperator(b.operator);
    if (b.defaults && typeof b.defaults === "object") s.defaults = { ...s.defaults, ...b.defaults };
    saveSettings(s);
    return send(res, 200, { operator: s.operator, key: keyStatus(s), defaults: s.defaults });
  }

  if (p === "/api/usage" && m === "GET") return send(res, 200, usageReport());
  if (p === "/api/sessions" && m === "GET") return send(res, 200, { sessions: listSessions(), shards: listShards() });

  if (p === "/api/sessions/new" && m === "POST") {
    if (engine && engine.status !== "terminated") return send(res, 409, { error: "A world is already live. Terminate or close it first." });
    const b = await body(req);
    const s = loadSettings();
    const cfg: SessionConfig = { ...defaultConfig(s), ...(b.config ?? {}), operator: s.operator };
    cfg.netrunnerCount = Math.max(1, Math.min(40, Math.round(cfg.netrunnerCount)));
    cfg.minutesPerTick = Math.max(1, Math.min(60, Math.round(cfg.minutesPerTick)));
    cfg.maxConcurrency = Math.max(1, Math.min(16, Math.round(cfg.maxConcurrency)));
    cfg.rewritePower = cfg.rewritePower === true;
    const allowed = MODELS.map((x) => x.id);
    if (!allowed.includes(cfg.routineModel) || !allowed.includes(cfg.deepModel)) return send(res, 400, { error: "unknown model" });
    const apiModel = (m: string) => m !== "offline" && m !== "claude-code";
    const usesApi = apiModel(cfg.routineModel) || apiModel(cfg.deepModel);
    const usesBridge = cfg.routineModel === "claude-code" || cfg.deepModel === "claude-code";
    if (usesBridge) { resetBridge(); cfg.maxConcurrency = Math.max(cfg.maxConcurrency, 12); }
    if (usesApi && !effectiveApiKey(s)) return send(res, 400, { error: "No API key. Add yours in Settings (or set ANTHROPIC_API_KEY), or choose offline minds." });
    const shards = (cfg.importShards ?? []).map(readShard).filter((x): x is ShardFile => !!x);
    const e = Engine.create(cfg, effectiveApiKey(s), shards);
    attach(e);
    e.start(!!b.start);
    return send(res, 200, { live: e.statusInfo() });
  }

  if (p === "/api/sessions/resume" && m === "POST") {
    if (engine && engine.status !== "terminated") return send(res, 409, { error: "A world is already live." });
    const b = await body(req);
    const store = sessionStore(String(b.operator), String(b.name));
    const s = loadSettings();
    const e = Engine.load(store, effectiveApiKey(s));
    if (e.status === "terminated") return send(res, 400, { error: "That session has ended. Open its report instead." });
    // fresh agents must be shown who they are again: clear the bridge's old markers and mail
    if (e.cfg.routineModel === "claude-code" || e.cfg.deepModel === "claude-code") resetBridge();
    attach(e);
    e.start(false);
    return send(res, 200, { live: e.statusInfo() });
  }

  if (p === "/api/sessions/close" && m === "POST") {
    if (!engine) return send(res, 200, { ok: true });
    if (engine.status === "running") return send(res, 409, { error: "Pause the world before closing it." });
    engine.removeAllListeners();
    engine = null;
    broadcast("status", null);
    return send(res, 200, { ok: true });
  }

  if (p === "/api/live" && m === "GET") return send(res, 200, liveState());

  if (p.startsWith("/api/live/netrunner/") && m === "GET") {
    const id = decodeURIComponent(p.split("/").pop() ?? "");
    const n = engine?.state.netrunners[id];
    if (!n) return send(res, 404, { error: "no such netrunner" });
    return send(res, 200, n);
  }

  if (p === "/api/control" && m === "POST") {
    if (!engine) return send(res, 400, { error: "no live world" });
    const b = await body(req);
    switch (b.action) {
      case "pause": engine.pause("operator", b.reason); break;
      case "resume": engine.resume("operator"); break;
      case "toggle": engine.status === "running" ? engine.pause("operator") : engine.resume("operator"); break;
      case "speed": engine.setSpeed(Number(b.value)); break;
      case "budget": engine.setBudget(Number(b.value)); break;
      case "note": engine.note(String(b.value ?? "")); break;
      default: return send(res, 400, { error: "unknown action" });
    }
    return send(res, 200, engine.statusInfo());
  }

  if (p === "/api/terminate" && m === "POST") {
    if (!engine) return send(res, 400, { error: "no live world" });
    const b = await body(req);
    if (b.confirm !== engine.store.name) return send(res, 400, { error: `Type the session name exactly (${engine.store.name}) to terminate.` });
    const e = engine;
    // bridge minds wait for their agent forever; release them first so the world can end cleanly
    if (e.cfg.routineModel === "claude-code" || e.cfg.deepModel === "claude-code") stopBridge();
    await e.terminate();
    const summary = readJson(e.store.file("summary.json"), null);
    return send(res, 200, { session: e.store.relPath, operator: e.store.operator, name: e.store.name, summary });
  }

  const sm = /^\/api\/session\/([A-Za-z0-9_-]+)\/([A-Za-z0-9.+_-]+)\/([a-z]+)$/.exec(p);
  if (sm && m === "GET") {
    const [, op, name, what] = sm;
    let store: SessionStore;
    try { store = sessionStore(op, decodeURIComponent(name)); } catch { return send(res, 404, { error: "session not found" }); }
    switch (what) {
      case "meta": return send(res, 200, store.readMeta());
      case "summary": return send(res, 200, readJson(store.file("summary.json"), null));
      case "config": { const c = store.readConfig(); return send(res, 200, c ? { ...c } : null); }
      case "usage": return send(res, 200, store.loadUsage());
      case "operator": return send(res, 200, readJsonl(store.file("operator.jsonl")));
      case "frames": return send(res, 200, readJsonl(store.file("frames.jsonl")));
      case "events": {
        const all = readJsonl<any>(store.file("events.jsonl"));
        const who = url.searchParams.get("who");
        const type = url.searchParams.get("type");
        let list = all;
        if (who) list = list.filter((e) => e.who?.includes(who));
        if (type) list = list.filter((e) => String(e.type).startsWith(type));
        return send(res, 200, list);
      }
      case "llm": {
        const who = url.searchParams.get("who");
        const all = readJsonl<any>(store.file("llm.jsonl"));
        return send(res, 200, who ? all.filter((r) => r.netrunner === who) : all.slice(-500));
      }
      case "snapshot": {
        const s = store.loadSnapshot();
        return send(res, 200, s ? { ...s, rng: undefined } : null);
      }
      case "genesis": return send(res, 200, readJson(store.file("genesis.json"), null));
      default: return send(res, 404, { error: "unknown" });
    }
  }

  // static files
  if (m === "GET") {
    let rel = p === "/" ? "index.html" : decodeURIComponent(p.slice(1));
    let base = WEB_DIR;
    if (rel.startsWith("docs/assets/")) { base = ROOT; }
    const file = path.resolve(base, rel);
    if (!file.startsWith(path.resolve(base))) return send(res, 403, { error: "forbidden" });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  send(res, 404, { error: "not found" });
}

export function startServer(port: number) {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: (err as Error).message });
    });
  });
  server.listen(port, "127.0.0.1");
  return {
    server,
    get engine() { return engine; },
  };
}
