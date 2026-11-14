// The heart: runs ticks, owns the pause switch, buffers minds' answers, records everything.
//
// A tick:  A) the world moves (deterministic)  B) minds are asked (in parallel)
//          C) FREEZE GATE: if the operator paused, nothing is applied; answers that arrive are held on disk
//          D) choices are applied in initiative order, then the tick is committed to disk.
// While paused, no new mind calls are started. Calls already in flight finish and are kept, never lost.
import { EventEmitter } from "node:events";
import { Mind, type Job, type JobResult } from "../mind/mind.js";
import { DEEPNET_SYSTEM, perception, reflectionPrompt, systemPrompt } from "../mind/prompts.js";
import { record, type Ledger } from "../mind/usage.js";
import { applyDecision } from "../sim/actions.js";
import { alive, byName, type SimCtx } from "../sim/ctx.js";
import { adjust, remember, T } from "../sim/psyche.js";
import { makeShard, type ShardFile } from "../sim/spawn.js";
import { archiveFor, frameOf, genesis, migrateState, needsDecision, wantsReflection, worldUpdate } from "../sim/world.js";
import type { ArchiveDoc } from "../sim/world-data.js";
import type { MindModel, Netrunner, SessionConfig, WorldEvent, WorldState } from "../sim/types.js";
import { Rng } from "../util/rng.js";
import { worldClock } from "../util/time.js";
import { SessionStore, type OperatorRecord, type SessionMeta } from "./store.js";
import { buildSummary } from "./summary.js";

export type EngineStatus = "running" | "paused" | "terminating" | "terminated";
export type Phase = "idle" | "world" | "minds" | "apply";

export interface Alert { kind: string; text: string; who: string[]; tick: number; wm: number; rt: string }

export class Engine extends EventEmitter {
  status: EngineStatus = "paused";
  phase: Phase = "idle";
  archive: ArchiveDoc[];
  ledger: Ledger;
  inflight = new Map<string, { netrunnerId: string; kind: string; model: string; since: number }>();
  held = new Set<string>();
  lastError?: string;
  private pending: Record<string, JobResult>;
  private background = new Map<string, Promise<JobResult>>();
  private waiters: (() => void)[] = [];
  private sleepCancel?: () => void;
  private runningSince?: number;
  private errorStreak = 0;
  private loopPromise?: Promise<void>;
  private mind: Mind;
  meta: SessionMeta;

  private constructor(public state: WorldState, public cfg: SessionConfig, public store: SessionStore, apiKey?: string) {
    super();
    this.archive = archiveFor(state);
    this.ledger = store.loadUsage();
    this.pending = store.loadPending();
    for (const id of Object.keys(this.pending)) this.held.add(id);
    this.mind = new Mind(apiKey);
    this.meta = store.readMeta() ?? this.freshMeta();
  }

  static create(cfg: SessionConfig, apiKey: string | undefined, shards: ShardFile[]): Engine {
    const store = SessionStore.create(cfg);
    const state = genesis(cfg, shards);
    store.writeConfig(cfg);
    store.writeGenesis(state);
    store.saveSnapshot(state);
    const e = new Engine(state, cfg, store, apiKey);
    e.meta = e.freshMeta();
    store.writeMeta(e.meta);
    const first: WorldEvent[] = Object.values(state.netrunners).map((n, i) => ({
      seq: ++state.seq, tick: 0, wm: 0, rt: new Date().toISOString(), type: "netrunner.woke", who: [n.id], loc: n.location,
      text: `${n.name} wakes up in ${state.locations[n.location].name}${n.pastLife ? `, carrying a Shard from ${n.pastLife.from}` : ""}.`,
      data: { index: i },
    }));
    store.appendEvents(first);
    store.saveSnapshot(state);
    e.operator("session.created", "operator", `${Object.keys(state.netrunners).length} netrunners, seed ${cfg.seed}`);
    return e;
  }

  static load(store: SessionStore, apiKey: string | undefined): Engine {
    const cfg = store.readConfig();
    const state = store.loadSnapshot();
    if (!cfg || !state) throw new Error("session files are missing or damaged");
    const upgraded = migrateState(state, cfg);
    const e = new Engine(state, cfg, store, apiKey);
    if (e.meta.status === "terminated") e.status = "terminated";
    else {
      // a world saved by an older version: record exactly when its rules changed, for anyone reading the data
      if (upgraded.length) e.operator("rules.upgraded", "operator", `from tick ${state.tick} this world runs on newer rules: ${upgraded.join("; ")}`);
      e.operator("session.reloaded", "operator", `resumed from tick ${state.tick}; ${Object.keys(e.pending).length} held answers`);
    }
    return e;
  }

  private freshMeta(): SessionMeta {
    return {
      format: "netrunners-session/1", name: this.store.name, operator: this.store.operator, path: this.store.relPath,
      worldName: this.cfg.worldName, models: { routine: this.cfg.routineModel, deep: this.cfg.deepModel },
      seed: this.cfg.seed, netrunnerCount: Object.keys(this.state.netrunners).length, status: "paused",
      createdAt: new Date().toISOString(), realActiveMs: 0, lastTick: this.state.tick, lastWorldMinutes: this.state.worldMinutes,
      alive: alive(this.state).length, costUsd: this.ledger.total.costUsd,
    };
  }

  // ───────────── operator controls ─────────────

  start(running: boolean) {
    if (this.status === "terminated") return;
    this.status = running ? "running" : "paused";
    if (running) this.runningSince = Date.now();
    this.loopPromise ??= this.loop();
    this.syncMeta();
    this.emit("status", this.statusInfo());
  }

  pause(by = "operator", detail?: string) {
    if (this.status !== "running") return false;
    this.accrue();
    this.status = "paused";
    this.sleepCancel?.();
    this.operator("pause", by, detail);
    this.syncMeta();
    this.emit("status", this.statusInfo());
    return true;
  }

  resume(by = "operator") {
    if (this.status !== "paused") return false;
    this.status = "running";
    this.runningSince = Date.now();
    this.errorStreak = 0;
    this.operator("resume", by);
    this.loopPromise ??= this.loop();
    this.wake();
    this.syncMeta();
    this.emit("status", this.statusInfo());
    return true;
  }

  setSpeed(ms: number) {
    this.cfg.tickIntervalMs = Math.max(0, Math.min(60000, Math.round(ms)));
    this.store.writeConfig(this.cfg);
    this.operator("speed", "operator", `${this.cfg.tickIntervalMs} ms per tick`);
    this.sleepCancel?.();
    this.emit("status", this.statusInfo());
  }

  setBudget(usd: number) {
    this.cfg.budgetUsd = Math.max(0, usd);
    this.store.writeConfig(this.cfg);
    this.operator("budget", "operator", `$${this.cfg.budgetUsd}`);
    this.emit("status", this.statusInfo());
  }

  note(text: string) {
    this.operator("note", "operator", text.slice(0, 2000));
  }

  async terminate(): Promise<unknown> {
    if (this.status === "terminated" || this.status === "terminating") return null;
    this.accrue();
    this.status = "terminating";
    this.operator("terminate", "operator", `at tick ${this.state.tick}; ${this.inflight.size} minds still thinking (their answers will be recorded)`);
    this.sleepCancel?.();
    this.wake();
    if (this.loopPromise) await this.loopPromise;
    else await this.finish();
    return this.store.file("summary.json");
  }

  statusInfo() {
    return {
      status: this.status,
      phase: this.phase,
      tick: this.state.tick,
      worldMinutes: this.state.worldMinutes,
      clock: worldClock(this.state.worldMinutes).label,
      inflight: [...this.inflight.values()],
      held: this.held.size,
      realActiveMs: this.meta.realActiveMs + (this.status === "running" && this.runningSince ? Date.now() - this.runningSince : 0),
      tickIntervalMs: this.cfg.tickIntervalMs,
      budgetUsd: this.cfg.budgetUsd,
      costUsd: this.ledger.total.costUsd,
      session: this.store.relPath,
      name: this.store.name,
      lastError: this.lastError,
    };
  }

  /** status can change across awaits; read it through a getter so TypeScript does not over-narrow */
  private get ending() {
    return this.status === "terminating" || this.status === "terminated";
  }

  // ───────────── the loop ─────────────

  private async gate() {
    while (this.status === "paused") await new Promise<void>((r) => this.waiters.push(r));
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.sleepCancel = undefined; resolve(); }, ms);
      this.sleepCancel = () => { clearTimeout(t); this.sleepCancel = undefined; resolve(); };
    });
  }

  private async loop() {
    try {
      while (true) {
        await this.gate();
        if (this.status !== "running") break;
        const t0 = Date.now();
        await this.tick();
        if (this.ending) break;
        if (this.status === "running") await this.sleep(Math.max(0, this.cfg.tickIntervalMs - (Date.now() - t0)));
      }
    } catch (err) {
      this.lastError = `Engine error: ${(err as Error).stack ?? err}`;
      console.error(this.lastError);
      this.status = "paused";
      this.operator("pause", "auto-crash", (err as Error).message);
      this.emit("status", this.statusInfo());
      this.loopPromise = undefined;
      return;
    }
    await this.finish();
  }

  private async tick() {
    const tick = this.state.tick + 1;
    const rng = new Rng(this.state.rng);
    const events: WorldEvent[] = [];
    const alerts: Alert[] = [];
    const rt = () => new Date().toISOString();
    this.state.worldMinutes = tick * this.cfg.minutesPerTick;
    const ctx: SimCtx = {
      state: this.state, cfg: this.cfg, rng, tick, archive: this.archive, sessionName: this.store.relPath,
      emit: (type, who, text, opts) => {
        const ev: WorldEvent = { seq: ++this.state.seq, tick, wm: this.state.worldMinutes, rt: rt(), type, who, loc: opts?.loc, text, data: opts?.data };
        events.push(ev);
        return ev;
      },
      alert: (kind, text, who) => alerts.push({ kind, text, who, tick, wm: this.state.worldMinutes, rt: rt() }),
      saveShard: (n) => this.store.saveShard(makeShard(n, this.state, this.store.relPath)),
      queueDeepNet: (n, query, dueTick) => {
        const jobId = `t${dueTick}-${n.id}-deepnet`;
        this.state.deepnetQueue.push({ jobId, netrunnerId: n.id, query, dueTick });
        this.dispatchBackground({ id: jobId, kind: "deepnet", netrunnerId: n.id, tick: dueTick, model: this.deepNetModel(), effort: "low", query });
      },
    };

    // A ─ the world moves
    this.phase = "world";
    worldUpdate(ctx);

    // B ─ ask the minds (never start new calls while paused)
    this.phase = "minds";
    await this.gate();
    if (this.ending) return;
    const jobs: Job[] = [];
    const seenInbox: Record<string, number> = {};
    for (const n of alive(this.state)) {
      if (wantsReflection(n, this.cfg, tick)) {
        jobs.push({
          id: `t${tick}-${n.id}-reflect`, kind: "reflect", netrunnerId: n.id, tick, model: this.cfg.deepModel, effort: "medium",
          system: systemPrompt(n, this.state, this.cfg), user: reflectionPrompt(n, this.state, this.cfg, tick),
        });
      }
      if (needsDecision(n, tick)) {
        const deep = n.deepMoment;
        const model: MindModel = deep ? this.cfg.deepModel : this.cfg.routineModel;
        seenInbox[n.id] = n.inbox.length;
        jobs.push({
          id: `t${tick}-${n.id}-decide`, kind: "decide", netrunnerId: n.id, tick, model, effort: deep ? "medium" : "low",
          system: systemPrompt(n, this.state, this.cfg), user: perception(n, this.state, this.cfg, tick),
        });
      }
    }
    const results = await this.runJobs(jobs);
    // deep-net dives that are due now
    const due = this.state.deepnetQueue.filter((q) => q.dueTick <= tick);
    for (const q of due) {
      if (!this.pending[q.jobId] && !this.background.has(q.jobId)) {
        this.dispatchBackground({ id: q.jobId, kind: "deepnet", netrunnerId: q.netrunnerId, tick: q.dueTick, model: this.deepNetModel(), effort: "low", query: q.query });
      }
    }
    for (const q of due) {
      const r = this.pending[q.jobId] ?? (await this.background.get(q.jobId));
      if (r) results.set(q.jobId, r);
    }

    // C ─ the freeze gate
    await this.gate();
    if (this.ending) return;

    // D ─ apply, in order of initiative
    this.phase = "apply";
    for (const j of jobs.filter((x) => x.kind === "reflect")) {
      const r = results.get(j.id);
      const n = this.state.netrunners[j.netrunnerId];
      if (r?.ok && r.reflection && n?.alive) this.applyReflection(ctx, n, r.reflection);
    }
    for (const q of due) {
      const r = results.get(q.jobId);
      const n = this.state.netrunners[q.netrunnerId];
      this.state.deepnetQueue = this.state.deepnetQueue.filter((x) => x.jobId !== q.jobId);
      if (!n?.alive) continue;
      const text = r?.ok && r.text ? r.text : "Static. The Deep Net gave back nothing you could hold onto.";
      n.inbox.push({ tick, kind: "result", important: true, text: `From the Deep Net ("${q.query}"):\n${text}` });
      remember(n, tick, "knowledge", `I dove into the Deep Net looking for "${q.query}" and found: ${text}`, 6);
      n.interrupt = true;
      ctx.emit("deepnet.result", [n.id], `${n.name} surfaces from the Deep Net ("${q.query}").`, { loc: n.location, data: { query: q.query, text } });
    }
    const decisions = jobs.filter((x) => x.kind === "decide")
      .map((j) => ({ j, n: this.state.netrunners[j.netrunnerId], init: rng.next() + T(this.state.netrunners[j.netrunnerId], "reflexes") * 0.5 }))
      .sort((a, b) => b.init - a.init);
    for (const { j, n } of decisions) {
      if (!n.alive) continue;
      const r = results.get(j.id);
      const seen = seenInbox[n.id] ?? 0;
      const fresh = n.inbox.slice(seen);
      if (r?.ok && r.decision) {
        applyDecision(ctx, n, r.decision, r.model);
      } else {
        n.stats.refusals += r?.refusal ? 1 : 0;
        n.inbox = [];
        n.interrupt = false;
        n.deepMoment = false;
        n.activity = { kind: "wait", startedTick: tick, endsAtTick: tick + 1 };
        ctx.emit(r?.refusal ? "mind.refusal" : "mind.error", [n.id], `${n.name} hesitates, unable to decide${r?.refusal ? ` (declined: ${r.refusal})` : r?.error ? ` (${r.error})` : ""}.`, { loc: n.location, data: { error: r?.error, refusal: r?.refusal } });
      }
      // keep what arrived this phase before their choice landed: they haven't seen it yet
      n.inbox = [...fresh, ...n.inbox];
      if (n.inbox.some((i) => i.important)) n.interrupt = true;
    }

    // commit
    this.state.tick = tick;
    this.state.rng = rng.state();
    const now = rt();
    const frame = frameOf(this.state, now);
    this.store.appendEvents(events);
    this.store.appendFrame(frame);
    this.store.saveSnapshot(this.state);
    const used = [...jobs.map((j) => j.id), ...due.map((q) => q.jobId)];
    for (const id of used) { delete this.pending[id]; this.held.delete(id); this.background.delete(id); }
    this.store.savePending(this.pending);
    this.store.saveUsage(this.ledger);
    this.syncMeta();
    this.phase = "idle";
    this.emit("tick", { tick, wm: this.state.worldMinutes, clock: worldClock(this.state.worldMinutes).label, rt: now, events, frame });

    for (const a of alerts) {
      this.operator("notify", "world", `${a.kind}: ${a.text}`);
      this.emit("alert", a);
    }
    if (alerts.some((a) => a.kind === "truth") && this.cfg.autoPauseOnTruth) this.pause("auto-truth", "someone learned the Truth");
    if (!alive(this.state).length) {
      this.emit("alert", { kind: "extinction", text: "Every netrunner is gone.", who: [], tick, wm: this.state.worldMinutes, rt: now });
      this.pause("auto-extinction", "no netrunners left alive");
    }
  }

  private deepNetModel(): MindModel {
    return this.cfg.deepModel === "offline" ? "offline" : this.cfg.deepModel;
  }

  private applyReflection(ctx: SimCtx, n: Netrunner, r: NonNullable<JobResult["reflection"]>) {
    const tick = ctx.tick;
    if (r.self_view) n.selfView = r.self_view;
    if (r.goals.length) n.goals = r.goals;
    if (r.enjoy) n.enjoys = r.enjoy;
    for (const ins of r.insights) remember(n, tick, "reflection", ins, 7);
    for (const o of r.opinions) {
      const other = byName(this.state, o.name);
      if (other && other.id !== n.id && n.impressions[other.id]) adjust(n, other, tick, { trust: o.trust, liking: o.liking, note: o.note || undefined, familiarity: 0 });
    }
    n.lastReflectionTick = tick;
    n.importanceSinceReflection = 0;
    ctx.emit("reflection", [n.id], `${n.name} reflects: “${r.self_view}”`, { loc: n.location, data: { insights: r.insights, goals: r.goals, enjoy: r.enjoy } });
  }

  // ───────────── minds ─────────────

  private async runJobs(jobs: Job[]): Promise<Map<string, JobResult>> {
    const results = new Map<string, JobResult>();
    const queue: Job[] = [];
    for (const j of jobs) {
      if (this.pending[j.id]) results.set(j.id, this.pending[j.id]);
      else queue.push(j);
    }
    const workers = Array.from({ length: Math.max(1, Math.min(this.cfg.maxConcurrency, queue.length)) }, async () => {
      while (queue.length) {
        await this.gate(); // a pause stops NEW calls; in-flight ones keep going
        if (this.ending) return;
        const job = queue.shift();
        if (!job) return;
        const r = await this.call(job);
        results.set(job.id, r);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private dispatchBackground(job: Job) {
    if (this.background.has(job.id) || this.pending[job.id]) return;
    this.background.set(job.id, this.call(job));
  }

  private async call(job: Job): Promise<JobResult> {
    const n = this.state.netrunners[job.netrunnerId];
    this.inflight.set(job.id, { netrunnerId: job.netrunnerId, kind: job.kind, model: job.model, since: Date.now() });
    this.emit("thinking", { inflight: [...this.inflight.values()], held: this.held.size });
    const r = await this.mind.run(job, { state: this.state, n });
    this.inflight.delete(job.id);
    r.receivedWhilePaused = this.status === "paused";
    // persist FIRST: an answer that arrives during a pause is held on disk, never lost
    this.pending[job.id] = r;
    this.held.add(job.id);
    this.store.savePending(this.pending);
    this.store.appendLlm({
      id: job.id, kind: job.kind, netrunner: job.netrunnerId, name: n?.name, tick: job.tick,
      requestedModel: job.model, model: r.model, effort: job.effort, ok: r.ok, error: r.error, refusal: r.refusal,
      receivedAt: r.receivedAt, receivedWhilePaused: r.receivedWhilePaused, latencyMs: r.latencyMs,
      usage: r.usage, costUsd: r.costUsd,
      perception: job.user, query: job.query,
      decision: r.decision, reflection: r.reflection, text: r.text, raw: r.ok ? undefined : r.raw,
    });
    if (job.model !== "offline") {
      record(this.ledger, r.model, job.kind, job.netrunnerId, r.usage, r.costUsd, !r.ok);
      this.store.saveUsage(this.ledger);
    }
    this.emit("thinking", { inflight: [...this.inflight.values()], held: this.held.size, done: job.id });
    this.emit("usage", this.ledger);

    if (r.fatal) {
      this.lastError = r.error;
      this.pause("auto-error", r.error);
      this.emit("alert", { kind: "error", text: r.error ?? "API error", who: [], tick: this.state.tick, wm: this.state.worldMinutes, rt: new Date().toISOString() });
      // the call failed: forget it so it is retried after the operator fixes the problem
      delete this.pending[job.id];
      this.held.delete(job.id);
      this.store.savePending(this.pending);
      await this.gate();
      if (this.ending) return r;
      return this.call(job);
    }
    if (!r.ok && !r.refusal) {
      this.errorStreak += 1;
      if (this.errorStreak >= 6) { this.lastError = r.error; this.pause("auto-error", `6 failed mind calls in a row (last: ${r.error})`); }
    } else this.errorStreak = 0;
    if (this.cfg.budgetUsd > 0 && this.ledger.total.costUsd >= this.cfg.budgetUsd && this.status === "running") {
      this.pause("auto-budget", `session spend $${this.ledger.total.costUsd.toFixed(4)} reached the $${this.cfg.budgetUsd} budget`);
      this.emit("alert", { kind: "budget", text: `Budget of $${this.cfg.budgetUsd} reached. The world is frozen.`, who: [], tick: this.state.tick, wm: this.state.worldMinutes, rt: new Date().toISOString() });
    }
    return r;
  }

  // ───────────── bookkeeping ─────────────

  private accrue() {
    if (this.status === "running" && this.runningSince) {
      this.meta.realActiveMs += Date.now() - this.runningSince;
      this.runningSince = undefined;
    }
  }

  private syncMeta() {
    const m = this.meta;
    m.status = this.status === "terminated" ? "terminated" : this.status === "running" ? "running" : "paused";
    m.lastTick = this.state.tick;
    m.lastWorldMinutes = this.state.worldMinutes;
    m.alive = alive(this.state).length;
    m.netrunnerCount = Object.keys(this.state.netrunners).length;
    m.costUsd = this.ledger.total.costUsd;
    const ft = this.state.puzzle.firstTruth;
    if (ft) m.truth = { name: this.state.netrunners[ft.id]?.name ?? ft.id, tick: ft.tick, worldMinutes: ft.tick * this.cfg.minutesPerTick, realTime: ft.rt };
    const live = this.status === "running" && this.runningSince ? Date.now() - this.runningSince : 0;
    this.store.writeMeta({ ...m, realActiveMs: m.realActiveMs + live });
  }

  operator(kind: string, by: string, detail?: string) {
    const rec: OperatorRecord = {
      rt: new Date().toISOString(), kind, by, tick: this.state.tick, wm: this.state.worldMinutes,
      phase: this.phase, inflight: this.inflight.size, held: this.held.size, detail,
    };
    this.store.appendOperator(rec);
    this.emit("operator", rec);
  }

  private async finish() {
    if (this.status === "terminated") return;
    // let calls already in flight land so nothing they produced is lost
    const bg = [...this.background.values()];
    const deadline = Date.now() + 30000;
    while (this.inflight.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await Promise.race([Promise.allSettled(bg), new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
    // the in-memory world may be mid-tick; the committed truth is the last snapshot
    const committed = this.store.loadSnapshot() ?? this.state;
    this.state = committed;
    this.status = "terminated";
    this.meta.endedAt = new Date().toISOString();
    this.syncMeta();
    const summary = buildSummary(this.store, this.state, this.cfg, this.meta, this.ledger);
    this.store.saveUsage(this.ledger);
    this.store.finalize(summary);
    this.emit("status", this.statusInfo());
    this.emit("terminated", { session: this.store.relPath });
  }
}
