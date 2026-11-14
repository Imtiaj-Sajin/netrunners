// The only place that talks to Claude. Official Anthropic SDK, structured outputs, prompt caching.
import Anthropic from "@anthropic-ai/sdk";
import { DECISION_SCHEMA, REFLECTION_SCHEMA } from "./schema.js";
import { DEEPNET_SYSTEM } from "./prompts.js";
import type { CallUsage } from "./usage.js";
import type { ModelId } from "../sim/types.js";

export interface RawCall {
  ok: boolean;
  json?: unknown;
  text?: string;
  model: string; // the model that actually served the call
  usage: CallUsage;
  stopReason?: string | null;
  refusal?: string;
  error?: string;
  fatal?: boolean; // auth / permission / bad model: the operator must fix something
}

const zero = (): CallUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 });

export class ClaudeMinds {
  private client: Anthropic;

  constructor(apiKey?: string) {
    // With no key passed, the SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 4 }) : new Anthropic({ maxRetries: 4 });
  }

  /** Sonnet 5.5 gets Anthropic's server-side refusal fallback; Haiku 5.5 has none, so we handle refusals ourselves. */
  private extras(model: ModelId): Record<string, unknown> {
    return model === "claude-sonnet-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
  }

  async structured(model: ModelId, kind: "decide" | "reflect", system: string, user: string, effort: "low" | "medium" | "high"): Promise<RawCall> {
    const params: any = {
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort, format: { type: "json_schema", schema: kind === "decide" ? DECISION_SCHEMA : REFLECTION_SCHEMA } },
      ...this.extras(model),
    };
    return this.run(params);
  }

  async deepNet(model: ModelId, query: string): Promise<RawCall> {
    const params: any = {
      model,
      max_tokens: 8000,
      system: DEEPNET_SYSTEM,
      messages: [{ role: "user", content: `Query from the Lattice: ${query}` }],
      tools: [{ type: model === "claude-sonnet-5-5" ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 2 }],
      output_config: { effort: "low" },
      ...this.extras(model),
    };
    return this.run(params, true);
  }

  private async run(params: any, plainText = false): Promise<RawCall> {
    try {
      const res: any = await this.client.beta.messages.create(params);
      const u = res.usage ?? {};
      const usage: CallUsage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        webSearches: u.server_tool_use?.web_search_requests ?? 0,
      };
      const served = res.model ?? params.model;
      if (res.stop_reason === "refusal") {
        return { ok: false, model: served, usage, stopReason: res.stop_reason, refusal: res.stop_details?.category ?? "unspecified", error: "refusal" };
      }
      const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (res.stop_reason === "max_tokens") return { ok: false, model: served, usage, stopReason: res.stop_reason, error: "hit max_tokens", text };
      if (plainText) return { ok: true, text, model: served, usage, stopReason: res.stop_reason };
      try {
        return { ok: true, json: JSON.parse(text), text, model: served, usage, stopReason: res.stop_reason };
      } catch {
        return { ok: false, text, model: served, usage, stopReason: res.stop_reason, error: "invalid JSON from model" };
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, model: params.model, usage: zero(), error: "Authentication failed: check your API key in Settings.", fatal: true };
      if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, model: params.model, usage: zero(), error: "Permission denied for this model/key.", fatal: true };
      if (err instanceof Anthropic.NotFoundError) return { ok: false, model: params.model, usage: zero(), error: `Model not found: ${params.model}`, fatal: true };
      if (err instanceof Anthropic.BadRequestError) return { ok: false, model: params.model, usage: zero(), error: `Bad request: ${err.message}` };
      if (err instanceof Anthropic.RateLimitError) return { ok: false, model: params.model, usage: zero(), error: "Rate limited (after retries)." };
      if (err instanceof Anthropic.APIError) return { ok: false, model: params.model, usage: zero(), error: `API error ${err.status}: ${err.message}` };
      return { ok: false, model: params.model, usage: zero(), error: `Network error: ${(err as Error).message}` };
    }
  }
}
