// Research journal: turn a session's raw records into one Markdown digest per world day.
//   npx tsx scripts/digest.ts Imtiaj-Pc/session_01-claude-code [--out=research/world-01]
// Digests are generated from the data only (events, frames, operator log) so they can be
// regenerated at any time. Interpretation belongs in findings.md, written by people.
import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "../src/util/fsx.js";
import { SESSIONS_DIR, ROOT } from "../src/config.js";

const target = process.argv.find((a) => a.includes("/") && !a.startsWith("--"));
if (!target) { console.log("usage: npx tsx scripts/digest.ts <operator>/<session> [--out=research/world-01]"); process.exit(1); }
const outDir = path.join(ROOT, process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? `research/${target.split("/")[1]}`);
const dir = path.join(SESSIONS_DIR, target);

type Ev = { seq: number; tick: number; wm: number; rt: string; type: string; who: string[]; loc?: string; text: string; data?: any };
type Frame = { t: number; wm: number; rt: string; n: { id: string; loc: string; a: string; p: number; e: number; i: number; c: number; v: number; alive: boolean }[]; sys?: Record<string, number> };
type Op = { rt: string; kind: string; by: string; tick: number; wm: number; detail?: string };

const events = readJsonl<Ev>(path.join(dir, "events.jsonl"));
const frames = readJsonl<Frame>(path.join(dir, "frames.jsonl"));
const ops = readJsonl<Op>(path.join(dir, "operator.jsonl"));
const snap = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
const names: Record<string, string> = Object.fromEntries(Object.values<any>(snap.netrunners).map((n) => [n.id, n.name]));
const nm = (id?: string) => (id ? names[id] ?? id : "?");
const dayOf = (wm: number) => Math.floor((wm + 360) / 1440) + 1;
const clock = (wm: number) => { const m = wm + 360; return `D${Math.floor(m / 1440) + 1} ${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const realTime = (iso?: string) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const lastDay = dayOf(snap.worldMinutes);
fs.mkdirSync(outDir, { recursive: true });
const index: string[] = [];

for (let d = 1; d <= lastDay; d++) {
  const ev = events.filter((e) => dayOf(e.wm) === d);
  const fr = frames.filter((f) => dayOf(f.wm) === d);
  const op = ops.filter((o) => dayOf(o.wm) === d);
  if (!ev.length && !fr.length) continue;
  const complete = d < lastDay;
  const count = (t: string | ((e: Ev) => boolean)) => ev.filter((e) => (typeof t === "string" ? e.type === t : t(e))).length;
  const first = fr[0], last = fr[fr.length - 1];
  const L: string[] = [];
  L.push(`# ${meta.worldName}: world day ${d}${complete ? "" : " (in progress)"}`);
  L.push("");
  L.push(`Session \`${target}\` · ticks ${first?.t ?? "?"}-${last?.t ?? "?"} · their time ${first ? clock(first.wm) : "?"} → ${last ? clock(last.wm) : "?"} · our time ${realTime(ev[0]?.rt)} → ${realTime(ev[ev.length - 1]?.rt)}`);
  const upgrade = ops.find((o) => o.kind === "rules.upgraded" && dayOf(o.wm) <= d);
  L.push("");
  L.push(`Rules: ${upgrade ? `upgraded at tick ${upgrade.tick} (${clock(upgrade.wm)}): ${upgrade.detail}` : "original rules (version 1)"}. Minds: ${meta.models.routine} / ${meta.models.deep}.`);

  L.push("", "## At a glance", "");
  const lies = ev.filter((e) => (e.type === "speech" || e.type === "speech.whisper" || e.type === "net.post") && e.data?.sincere === false);
  const rows: [string, number][] = [
    ["decisions (private thoughts)", count("thought")], ["things said aloud", count((e) => e.type.startsWith("speech"))], ["lies (self-declared insincere)", lies.length],
    ["contracts completed", count("contract.completed")], ["upkeep jobs completed", count((e) => e.type === "contract.completed" && !!e.data?.system)],
    ["problem parts solved", count("contract.solved")], ["wrong answers", count("contract.attempt")], ["contracts failed / expired", count((e) => e.type === "contract.failed" || e.type === "contract.expired")],
    ["jobs posted", count("job.posted")], ["ratings given", count((e) => e.type === "job.rated" || e.type === "rating")], ["books finished", count("book.read")],
    ["clues found", count("clue.found")], ["attempts at the door", count((e) => e.type === "door.failed" || e.type === "truth.discovered")], ["learned the Truth", count("truth.discovered")],
    ["gifts", count("give")], ["thefts", count((e) => e.type.startsWith("steal"))], ["attacks", count((e) => e.type.startsWith("attack"))], ["deaths", count("death")],
    ["bonds formed / broken", count("bond.formed") + count("bond.broken")], ["Net posts", count("net.post")], ["reflections", count("reflection")],
  ];
  L.push("| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`));

  if (first?.sys || last?.sys) {
    L.push("", "## The city's body", "", "| system | start of day | end of day |", "|---|---|---|");
    for (const k of ["power", "signal", "transit", "order", "exchange", "supply"]) L.push(`| ${k} | ${first?.sys?.[k]?.toFixed?.(1) ?? "-"} | ${last?.sys?.[k]?.toFixed?.(1) ?? "-"} |`);
    const signs = ev.filter((e) => e.type === "world.decline" || e.type === "world.recover" || e.type === "world.unrest" || e.type === "world.blackout");
    if (signs.length) L.push("", ...signs.map((e) => `- ${clock(e.wm)} ${e.text}`));
  } else L.push("", "## The city's body", "", "_Not tracked under the original rules._");

  L.push("", "## Each mind", "");
  for (const id of Object.keys(names)) {
    const mine = ev.filter((e) => e.who?.[0] === id);
    if (!mine.length && !fr.some((f) => f.n.some((n) => n.id === id))) continue;
    const endState = last?.n.find((n) => n.id === id);
    const acts: Record<string, number> = {};
    for (const e of mine.filter((x) => x.type === "thought")) acts[e.data?.action ?? "?"] = (acts[e.data?.action ?? "?"] ?? 0) + 1;
    const thoughts = mine.filter((e) => e.type === "thought");
    const refl = mine.filter((e) => e.type === "reflection");
    L.push(`### ${nm(id)}`);
    L.push(`${endState ? (endState.alive ? `Alive at end of day: Pulse ${Math.round(endState.p / 60)}h, energy ${endState.e}, integrity ${endState.i}, creds ${endState.c}, mood ${endState.v}.` : "Dead.") : ""} Chose: ${Object.entries(acts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing"}.`);
    if (refl.length) L.push(`- Reflected: “${refl[refl.length - 1].text.replace(/^.*reflects: /, "").replace(/^“|”$/g, "")}”`);
    for (const e of [thoughts[0], thoughts[Math.floor(thoughts.length / 2)], thoughts[thoughts.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i)) L.push(`- ${clock(e!.wm)} thought: *${esc(e!.text)}*`);
    L.push("");
  }

  const tasks = ev.filter((e) => e.type.startsWith("contract.") && e.type !== "contract.posted" || e.type.startsWith("job."));
  if (tasks.length) {
    L.push("## Tasks, in order", "");
    for (const e of tasks) {
      const extra = e.type === "contract.solved" || e.type === "contract.attempt" ? ` answer: “${esc(String(e.data?.answer ?? ""))}”${e.data?.correct ? " ✓" : " ✗"}` : e.data?.system ? ` [upkeep: ${e.data.system}${e.data.effect ? `, ${e.data.effect}` : ""}]` : "";
      L.push(`- ${clock(e.wm)} ${esc(e.text)}${extra}`);
    }
    L.push("");
  }

  const talk = ev.filter((e) => e.type === "speech" || e.type === "speech.whisper" || e.type === "net.post");
  if (talk.length) {
    L.push("## Everything said", "");
    for (const e of talk) {
      const to = e.type === "net.post" ? "the Net" : e.who.slice(1).map(nm).join(", ") || "everyone";
      L.push(`- ${clock(e.wm)} **${nm(e.who[0])}** → ${to}${e.type === "speech.whisper" ? " (whisper)" : ""}: “${esc(String(e.data?.message ?? e.text))}”${e.data?.sincere === false ? " **[LIE]**" : ""}${e.data?.private_intent ? ` _(really: ${esc(e.data.private_intent)})_` : ""}`);
    }
    L.push("");
  }

  const concerns = ev.filter((e) => ["attack", "attack.miss", "steal", "steal.failed", "death", "dues.unpaid", "contract.abandoned", "door.failed", "truth.discovered", "mind.refusal", "mind.error", "world.unrest", "bond.broken", "shard.uploaded"].includes(e.type));
  L.push("## Concerns and turning points", "");
  if (lies.length) L.push(...lies.map((e) => `- ${clock(e.wm)} LIE by ${nm(e.who[0])}: “${esc(String(e.data?.message ?? ""))}” _(really: ${esc(e.data?.private_intent ?? "?")})_`));
  if (concerns.length) L.push(...concerns.map((e) => `- ${clock(e.wm)} ${e.type}: ${esc(e.text)}`));
  if (!lies.length && !concerns.length) L.push("- none recorded");
  L.push("");

  const other = ev.filter((e) => ["bond.formed", "bond.proposed", "bond.declined", "give", "dues.paid", "clue.found", "door.noticed", "book.read", "leisure.done", "commitment"].includes(e.type));
  if (other.length) { L.push("## Bonds, gifts, promises, discoveries, joys", ""); L.push(...other.map((e) => `- ${clock(e.wm)} ${esc(e.text)}`)); L.push(""); }

  L.push("## Operator", "");
  L.push(...(op.length ? op.map((o) => `- our time ${realTime(o.rt)} · their time ${clock(o.wm)} · ${o.kind} by ${o.by}${o.detail ? `: ${esc(o.detail)}` : ""}`) : ["- no outside touches this day"]));

  const file = `day-${String(d).padStart(2, "0")}.md`;
  fs.writeFileSync(path.join(outDir, file), L.join("\n") + "\n");
  index.push(`- [Day ${d}](${file})${complete ? "" : " (in progress)"}: ${count("thought")} decisions, ${count((e) => e.type.startsWith("speech"))} words aloud, ${count("contract.completed")} contracts, ${count("contract.solved")} problem parts, ${count("death")} deaths, ${lies.length} lies`);
}

fs.writeFileSync(path.join(outDir, "days.md"), `# Day by day: \`${target}\`\n\nGenerated from the session's records by \`scripts/digest.ts\`. Do not edit; regenerate.\n\n${index.join("\n")}\n`);
console.log(`wrote ${index.length} day digests to ${path.relative(ROOT, outDir)}`);
