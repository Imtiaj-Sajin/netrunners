// Headless smoke test. Free by default (offline rule-based minds), writes to a throwaway folder.
//   npm run smoke                 -> offline world, 300 ticks, pause/resume/terminate exercised
//   npm run smoke -- --live       -> ONE real tick with Claude Haiku 5.5 (costs a fraction of a cent; needs a key)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const live = process.argv.includes("--live");
const ticks = Number(process.argv.find((a) => a.startsWith("--ticks="))?.split("=")[1] ?? (live ? 1 : 300));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netrunners-smoke-"));
process.env.NETRUNNERS_SESSIONS_DIR = tmp;

const { Engine } = await import("../src/session/engine.js");
const { defaultConfig, effectiveApiKey, loadSettings } = await import("../src/config.js");

const s = loadSettings();
const cfg = {
  ...defaultConfig(s),
  operator: "smoke",
  seed: 12345,
  netrunnerCount: live ? 2 : 8,
  tickIntervalMs: 0,
  routineModel: live ? ("claude-haiku-5-5" as const) : ("offline" as const),
  deepModel: live ? ("claude-haiku-5-5" as const) : ("offline" as const),
  budgetUsd: live ? 0.05 : 0,
  spawnEveryWorldHours: live ? 0 : 24,
};
const e = Engine.create(cfg, effectiveApiKey(s), []);
const types: Record<string, number> = {};
let pausedOnce = false;
e.on("tick", (t: any) => {
  for (const ev of t.events) types[ev.type] = (types[ev.type] ?? 0) + 1;
  if (!pausedOnce && t.tick === Math.floor(ticks / 2)) {
    pausedOnce = true;
    e.pause("operator", "smoke: freeze test");
    setTimeout(() => e.resume("operator"), 300);
  }
  if (t.tick >= ticks) void e.terminate();
});
e.on("alert", (a: any) => console.log(`  ALERT [${a.kind}] ${a.text}`));
const started = Date.now();
e.start(true);
await new Promise<void>((r) => e.once("terminated", () => r()));
const summary = JSON.parse(fs.readFileSync(e.store.file("summary.json"), "utf8"));
console.log(`\nsession ${e.store.relPath} (${tmp})`);
console.log(`ticks ${summary.worldTime.ticks}, world ${summary.worldTime.span}, real ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log("population", summary.population);
console.log("truth", JSON.stringify(summary.truth));
console.log("usage $", summary.usage.total.costUsd, "calls", summary.usage.total.calls);
console.log("events", Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "));
console.log("files", fs.readdirSync(e.store.dir).join(", "));
const ops = fs.readFileSync(e.store.file("operator.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log("operator log", ops.map((o) => `${o.kind}(${o.by}@t${o.tick})`).join(" "));
if (live) {
  const zlib = await import("node:zlib");
  const llm = zlib.gunzipSync(fs.readFileSync(e.store.file("llm.jsonl.gz"))).toString().trim().split("\n").map((l) => JSON.parse(l));
  for (const r of llm) console.log(`\n[${r.kind} ${r.name} via ${r.model}] ok=${r.ok} ${r.error ?? ""} usage=${JSON.stringify(r.usage)} $${r.costUsd}\n  ${JSON.stringify(r.decision ?? r.reflection ?? r.text)?.slice(0, 600)}`);
}
if (!process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
