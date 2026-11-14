import { ClaudeMinds } from "./claude.js";
import { offlineDecide, offlineReflect } from "./offline.js";
import { sanitizeDecision, sanitizeReflection } from "./schema.js";
import { costOf, type CallUsage } from "./usage.js";
import type { Decision, MindModel, Netrunner, Reflection, WorldState } from "../sim/types.js";

export type JobKind = "decide" | "reflect" | "deepnet";

export interface Job {
  id: string;
  kind: JobKind;
  netrunnerId: string;
  tick: number;
  model: MindModel;
  effort: "low" | "medium" | "high";
  system?: string;
  user?: string;
  query?: string;
}

export interface JobResult {
  id: string;
  kind: JobKind;
  netrunnerId: string;
  tick: number;
  ok: boolean;
  decision?: Decision;
  reflection?: Reflection;
  text?: string;
  raw?: string;
  error?: string;
  refusal?: string;
  fatal?: boolean;
  requestedModel: MindModel;
  model: string;
  usage: CallUsage;
  costUsd: number;
  latencyMs: number;
  receivedAt: string;
  receivedWhilePaused?: boolean;
}

const ZERO: CallUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 };

export class Mind {
  private claude?: ClaudeMinds;

  constructor(private apiKey?: string) {}

  private api() {
    return (this.claude ??= new ClaudeMinds(this.apiKey));
  }

  async run(job: Job, ctx: { state: WorldState; n: Netrunner }): Promise<JobResult> {
    const t0 = Date.now();
    const done = (r: Partial<JobResult>): JobResult => ({
      id: job.id, kind: job.kind, netrunnerId: job.netrunnerId, tick: job.tick, ok: false,
      requestedModel: job.model, model: job.model, usage: ZERO, costUsd: 0,
      latencyMs: Date.now() - t0, receivedAt: new Date().toISOString(), ...r,
    });

    if (job.model === "offline") {
      await new Promise((r) => setTimeout(r, 15));
      if (job.kind === "decide") return done({ ok: true, decision: offlineDecide(ctx.n, ctx.state, job.id) });
      if (job.kind === "reflect") return done({ ok: true, reflection: offlineReflect(ctx.n) });
      return done({ ok: true, text: "Static. Endless static, and under it, something like voices in a language you almost know." });
    }

    const api = this.api();
    const raw = job.kind === "deepnet"
      ? await api.deepNet(job.model, job.query ?? "")
      : await api.structured(job.model, job.kind, job.system ?? "", job.user ?? "", job.effort);
    const cost = costOf(raw.model, raw.usage);
    const base = { model: raw.model, usage: raw.usage, costUsd: cost, raw: raw.text?.slice(0, 4000), error: raw.error, refusal: raw.refusal, fatal: raw.fatal };
    if (!raw.ok) return done(base);
    if (job.kind === "decide") return done({ ...base, ok: true, decision: sanitizeDecision(raw.json) });
    if (job.kind === "reflect") return done({ ...base, ok: true, reflection: sanitizeReflection(raw.json) });
    return done({ ...base, ok: true, text: raw.text ?? "" });
  }
}
