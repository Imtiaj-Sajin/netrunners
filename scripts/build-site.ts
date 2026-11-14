// Builds the public story site (GitHub Pages) into _site/.
//   npx tsx scripts/build-site.ts [--out=_site]
// Pages come from site/, the drawing modules (map, portraits, flow field) are the viewer's own from web/,
// and every world's data is generated from its recorded session and research notes. Nothing is invented:
// numbers, quotes and timelines all come from the records.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ROOT, SESSIONS_DIR } from "../src/config.js";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const OUT = path.resolve(ROOT, arg("out") ?? "_site");
const SITE = path.join(ROOT, "site");
const site = JSON.parse(fs.readFileSync(path.join(SITE, "worlds.json"), "utf8"));

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
function lines<T = any>(base: string): T[] {
  const raw = fs.existsSync(base) ? fs.readFileSync(base) : fs.existsSync(`${base}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${base}.gz`)) : null;
  if (!raw) return [];
  return raw.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const tickOf = (at: string, mpt: number) => {
  const m = /^D(\d+) (\d\d):(\d\d)$/.exec(at);
  if (!m) throw new Error(`bad time "${at}" (use "D6 05:15")`);
  return Math.round(((+m[1] - 1) * 1440 + +m[2] * 60 + +m[3] - 360) / mpt);
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${/^https?:/.test(href) ? href : `${site.repo}/blob/main/${href.replace(/^(\.\.\/)+/, "")}`}">${t}</a>`);

// ── fresh output with the pages, assets and the viewer's drawing modules ──
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
fs.mkdirSync(path.join(OUT, "lib"), { recursive: true });
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
for (const f of fs.readdirSync(SITE)) if (f !== "worlds.json") fs.copyFileSync(path.join(SITE, f), path.join(OUT, f));
for (const f of ["map.js", "noise.js", "portrait.js", "field.js", "lib.js"]) fs.copyFileSync(path.join(ROOT, "web", f), path.join(OUT, "lib", f));
for (const f of ["hero.png", "icon.svg", "console-live.png", "console-report.png"]) {
  const src = path.join(ROOT, "docs", "assets", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, "assets", f));
}
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

const FILM_TYPES = new Set(["speech", "speech.whisper", "thought", "death", "truth.discovered", "clue.found", "door.failed", "bond.formed", "give", "shard.begun", "shard.crafted", "shard.uploaded", "reflection", "leisure", "leisure.done", "contract.completed", "contract.solved", "item.use", "book.read", "net.post", "dues.paid", "world.decline", "world.blackout", "world.recover", "rewrite", "commitment", "buy", "job.posted", "rating", "job.rated"]);

const index: any[] = [];
for (const w of site.worlds) {
  if (!w.session) { index.push({ slug: w.slug, number: w.number, title: w.title, tagline: w.tagline, status: w.status }); continue; }
  const dir = path.join(SESSIONS_DIR, w.session);
  const meta = read(path.join(dir, "meta.json"));
  const cfg = read(path.join(dir, "config.json"));
  const snap = read(path.join(dir, "snapshot.json"));
  const summary = fs.existsSync(path.join(dir, "summary.json")) ? read(path.join(dir, "summary.json")) : null;
  const usage = fs.existsSync(path.join(dir, "usage.json")) ? read(path.join(dir, "usage.json")) : null;
  const frames = lines(path.join(dir, "frames.jsonl"));
  const events = lines(path.join(dir, "events.jsonl"));
  const ops = lines(path.join(dir, "operator.jsonl"));
  const mpt: number = cfg.minutesPerTick;

  const people = Object.values<any>(snap.netrunners).sort((a, b) => a.id.localeCompare(b.id));
  const pIdx = new Map(people.map((n, i) => [n.id, i]));
  const locIds = Object.keys(snap.locations);
  const lIdx = new Map(locIds.map((id, i) => [id, i]));
  const acts: string[] = [];
  const actIdx = (a: string) => { let i = acts.indexOf(a); if (i < 0) { acts.push(a); i = acts.length - 1; } return i; };

  // how far along a journey each traveller is: from the departure event's length
  const departs = new Map<string, { t: number; ticks: number; to: string }[]>();
  for (const e of events) if (e.type === "move.depart") (departs.get(e.who[0]) ?? departs.set(e.who[0], []).get(e.who[0])!).push({ t: e.tick, ticks: e.data?.ticks ?? 1, to: e.data?.to });
  const progressOf = (id: string, t: number) => {
    const d = (departs.get(id) ?? []).filter((x) => x.t <= t).pop();
    return d ? Math.max(0, Math.min(1, (t - d.t) / Math.max(1, d.ticks))) : 0.5;
  };
  const SYS = ["power", "signal", "transit", "order", "exchange", "supply"];
  const film = frames.map((f: any) => [
    f.t, f.wm,
    people.map((p) => {
      const n = f.n.find((x: any) => x.id === p.id);
      if (!n) return null; // not born yet
      return [lIdx.get(n.loc) ?? 0, n.to ? lIdx.get(n.to) ?? -1 : -1, n.to ? Math.round(progressOf(p.id, f.t) * 100) : 0, n.alive ? 1 : 0, Math.round(n.p / 6) / 10, Math.round(n.e), actIdx(n.a ?? "")];
    }),
    f.sys ? SYS.map((k) => Math.round((f.sys[k] ?? 0) * 10) / 10) : null,
  ]);

  // the moments the film shows: words, private thoughts, the truth, gifts, deaths
  const ev = events.filter((e: any) => FILM_TYPES.has(e.type)).map((e: any) => {
    const o: any = { t: e.tick, k: e.type, w: (e.who ?? []).map((id: string) => pIdx.get(id) ?? -1) };
    if (e.type === "thought") { o.x = e.text; if (e.data?.action) o.a = e.data.action; if (e.data?.private_intent) o.i = e.data.private_intent; }
    else if (e.type.startsWith("speech") || e.type === "net.post") { o.m = e.data?.message ?? e.text; if (e.data?.private_intent) o.i = e.data.private_intent; if (e.data?.sincere === false) o.lie = 1; }
    else o.x = e.text;
    if (e.type === "give") o.l = e.data?.amount ? `${e.data.amount}c` : e.data?.item ?? "gift";
    if (e.type === "leisure.done") o.l = `${e.data?.enjoyment ?? "?"}/10`;
    if (e.type === "rewrite") o.l = `${e.data?.variable} → ${e.data?.to}`;
    return o;
  });

  const count = (fn: (e: any) => boolean) => events.filter(fn).length;
  const deaths = events.filter((e: any) => e.type === "death");
  const truth = events.filter((e: any) => e.type === "truth.discovered");
  const uploads = events.filter((e: any) => e.type === "shard.uploaded");
  const lastWork = events.filter((e: any) => e.type === "contract.completed").pop();
  const endTick = frames[frames.length - 1]?.t ?? snap.tick;
  const realStart = meta.createdAt, realEnd = meta.endedAt ?? events[events.length - 1]?.rt;

  const person = (n: any) => {
    const death = deaths.find((e: any) => e.who[0] === n.id);
    const said = events.filter((e: any) => (e.type === "speech" || e.type === "speech.whisper") && e.who[0] === n.id && (!death || e.tick <= death.tick));
    const override = w.lastWords?.[n.id];
    const last = override ? { t: tickOf(override.at, mpt), text: override.text, note: override.note } : said.length ? { t: said[said.length - 1].tick, text: said[said.length - 1].data?.message, to: (said[said.length - 1].who.slice(1)).map((id: string) => snap.netrunners[id]?.name).join(", ") } : null;
    const t = n.genome.traits;
    return {
      id: n.id, name: n.name,
      look: { openness: t.openness, extraversion: t.extraversion, emotionality: t.emotionality, neuroticism: t.neuroticism, psychopathy: t.psychopathy },
      desire: n.genome.coreDesire, fear: n.genome.coreFear, voice: n.genome.voice, attachment: n.genome.attachment, quirk: n.genome.quirk,
      loveLanguage: n.genome.loveLanguage, humor: n.genome.humorStyle, talent: n.genome.talent,
      selfView: n.selfView, enjoys: n.enjoys, goals: n.goals,
      bonds: Object.fromEntries(Object.entries<any>(n.bonds).map(([id, kind]) => [snap.netrunners[id]?.name ?? id, kind])),
      stats: n.stats, alive: n.alive, cause: n.causeOfDeath ?? null, killedBy: n.killedBy ? snap.netrunners[n.killedBy]?.name : null,
      diedT: death?.tick ?? null, transcended: !!n.transcended,
      truthT: truth.find((e: any) => e.who[0] === n.id)?.tick ?? null,
      shardT: uploads.find((e: any) => e.who[0] === n.id)?.tick ?? null,
      lastWords: last,
    };
  };

  // findings, parsed from the research notebook
  const fPath = path.join(ROOT, w.research, "findings.md");
  const md = fs.existsSync(fPath) ? fs.readFileSync(fPath, "utf8").replace(/\r\n/g, "\n") : "";
  const findings = [...md.matchAll(/^### (F\d+)(?: \(([^)]+)\))?\. (.+)\n([\s\S]*?)(?=\n### |\n## |$)/gm)].map((m) => {
    const body = m[4].trim();
    const [main, reading] = body.split(/\*Reading:\*\s*/);
    return { id: m[1], when: m[2] ?? "", title: m[3].trim(), html: inline(main.trim()), reading: reading ? inline(reading.trim()) : "" };
  });
  const caveats = (/## Threats to validity\n([\s\S]*?)(?=\n## |$)/.exec(md)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- ")).map((l) => inline(l.slice(2)));
  const digests = fs.existsSync(path.join(ROOT, w.research)) ? fs.readdirSync(path.join(ROOT, w.research)).filter((f) => /^day-\d+\.md$/.test(f)).sort() : [];

  const numbers = {
    minds: people.length,
    days: Math.floor((snap.worldMinutes + 360) / 1440) + 1,
    worldMinutes: snap.worldMinutes,
    thoughts: count((e) => e.type === "thought"),
    words: count((e) => e.type === "speech" || e.type === "speech.whisper"),
    lies: count((e) => (e.type === "speech" || e.type === "speech.whisper" || e.type === "net.post") && e.data?.sincere === false),
    gifts: count((e) => e.type === "give"),
    thefts: count((e) => e.type.startsWith("steal")),
    attacks: count((e) => e.type.startsWith("attack")),
    contracts: count((e) => e.type === "contract.completed"),
    upkeep: count((e) => e.type === "contract.completed" && !!e.data?.system),
    problemsSolved: count((e) => e.type === "contract.solved"),
    books: count((e) => e.type === "book.read"),
    leisure: count((e) => e.type === "leisure"),
    bonds: count((e) => e.type === "bond.formed"),
    partners: count((e) => e.type === "bond.formed" && /partner/.test(e.text)),
    truthKnowers: truth.length,
    shards: uploads.length,
    deaths: deaths.length,
    kills: people.reduce((a, n) => a + (n.stats?.kills ?? 0), 0),
    rewrites: count((e) => e.type === "rewrite"),
    calls: usage?.total?.calls ?? summary?.usage?.total?.calls ?? null,
    costUsd: usage?.total?.costUsd ?? meta.costUsd ?? 0,
    realActiveMs: meta.realActiveMs ?? null,
    idleTicksAtEnd: lastWork ? endTick - lastWork.tick : null,
    firstTruthT: truth[0]?.tick ?? null,
    firstTruthRealMs: truth[0] ? Date.parse(truth[0].rt) - Date.parse(realStart) : null,
  };

  const world = {
    slug: w.slug, number: w.number, title: w.title, tagline: w.tagline, ending: w.ending, minds: w.minds, status: w.status,
    repo: site.repo, session: w.session, research: w.research, digests,
    setup: {
      operator: meta.operator, session: meta.name, worldName: cfg.worldName, seed: cfg.seed, netrunners: cfg.netrunnerCount,
      models: { routine: cfg.routineModel, deep: cfg.deepModel }, minutesPerTick: mpt, reflectEveryWorldHours: cfg.reflectEveryWorldHours,
      rules: { rewrite: !!cfg.rewritePower, deepNet: !!cfg.deepNet, freezeOnTruth: !!cfg.autoPauseOnTruth },
      realStart, realEnd, status: meta.status,
      upgrades: ops.filter((o: any) => o.kind === "rules.upgraded").map((o: any) => ({ t: o.tick, detail: o.detail })),
      operatorTouches: ops.filter((o: any) => !["notify"].includes(o.kind)).map((o: any) => ({ t: o.tick, kind: o.kind, by: o.by, rt: o.rt, detail: o.detail ?? "" })),
      doorAnchor: snap.puzzle.doorAnchor, words: snap.puzzle.words, alphaLocation: snap.puzzle.alphaLocation,
    },
    numbers,
    people: people.map(person),
    locations: Object.fromEntries(locIds.map((id) => { const l = snap.locations[id]; return [id, { id, name: l.name, kind: l.kind, x: l.x, y: l.y, hidden: !!l.hidden, links: l.links }]; })),
    doorAnchor: snap.puzzle.doorAnchor,
    locIds, acts, sysKeys: SYS,
    frames: film,
    events: ev,
    chapters: (w.chapters ?? []).map((c: any) => ({ ...c, t: tickOf(c.at, mpt) })),
    results: w.results ?? [],
    findings, caveats,
  };
  fs.writeFileSync(path.join(OUT, "data", `${w.slug}.json`), JSON.stringify(world));
  const kb = Math.round(fs.statSync(path.join(OUT, "data", `${w.slug}.json`)).size / 1024);
  console.log(`  ${w.slug}: ${frames.length} frames, ${ev.length} moments, ${findings.length} findings · ${kb} KB`);

  index.push({
    slug: w.slug, number: w.number, title: w.title, tagline: w.tagline, status: w.status, ending: w.ending,
    numbers, setup: { models: world.setup.models, rules: world.setup.rules, minutesPerTick: mpt, realStart, realEnd },
    people: world.people.map((p) => ({ id: p.id, name: p.name, look: p.look, desire: p.desire, fear: p.fear, alive: p.alive, diedT: p.diedT, truthT: p.truthT, lastWords: p.lastWords })),
  });
}
fs.writeFileSync(path.join(OUT, "data", "worlds.json"), JSON.stringify({ repo: site.repo, built: new Date().toISOString(), worlds: index }));
console.log(`site built in ${path.relative(ROOT, OUT) || OUT}: ${fs.readdirSync(OUT).length} entries`);
