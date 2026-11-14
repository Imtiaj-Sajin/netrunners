// "Session completed": the whole life of a world, replayable without calling any model.
import { api, fmt, groupOf, h, svg, worldClock } from "./lib.js";
import { createMap } from "./map.js";
import { portrait, veilPortrait } from "./portrait.js";

const short = (wm) => worldClock(wm).replace("Day ", "D");

export async function renderReport(root, op, name) {
  root.replaceChildren(h("div", { class: "report" }, h("p", { class: "empty", style: { marginLeft: 0 } }, "Opening the records…")));
  const base = `/api/session/${op}/${encodeURIComponent(name)}`;
  const [meta, summary, ops, events, frames, snapshot, usage] = await Promise.all([
    api(`${base}/meta`), api(`${base}/summary`), api(`${base}/operator`), api(`${base}/events`),
    api(`${base}/frames`), api(`${base}/snapshot`), api(`${base}/usage`),
  ]);
  if (!meta) { root.replaceChildren(h("div", { class: "report" }, h("p", { class: "empty" }, "No such world."))); return; }
  const people = snapshot ? Object.values(snapshot.netrunners) : [];
  const byId = Object.fromEntries(people.map((n) => [n.id, n]));
  const nameOf = (id) => byId[id]?.name ?? id;
  const mpt = summary?.worldTime?.minutesPerTick ?? 10;
  const num = /^session_(\d+)/.exec(meta.name)?.[1] ?? "";
  const ended = meta.status === "terminated";
  const page = h("div", { class: "report" });
  root.replaceChildren(page);

  page.append(
    h("div", { class: "r-head" },
      h("div", {},
        h("p", { class: "eyebrow" }, ended ? "a world, ended" : `a world, ${meta.status === "running" ? "alive" : "frozen"}`),
        h("h1", {}, "World ", h("em", {}, num)),
        h("div", { class: "path" }, `${meta.operator}/${meta.name} · ${meta.worldName} · minds ${meta.models.routine} / ${meta.models.deep} · seed ${meta.seed}`),
      ),
      h("a", { class: "link", href: "#/archive" }, "← the archive"),
    ),
  );
  if (!ended) page.append(h("p", { class: "warnline" }, "This world was never ended. It is frozen exactly where it stopped and can be resumed from the archive."));

  const real = summary?.realTime, world = summary?.worldTime;
  page.append(h("div", { class: "r-clocks" },
    h("div", { class: "r-clock" }, h("p", { class: "eyebrow" }, "our time"),
      h("div", { class: "big mono" }, real ? real.active : fmt.dur(meta.realActiveMs)),
      h("div", { class: "line" }, `of time running · frozen ${real?.pausedTimes ?? "?"}×`),
      h("div", { class: "line" }, `from ${fmt.time(meta.createdAt)}`),
      h("div", { class: "line" }, `to ${meta.endedAt ? fmt.time(meta.endedAt) : "—"}`)),
    h("div", { class: "r-clock" }, h("p", { class: "eyebrow" }, "their time"),
      h("div", { class: "big mono" }, world ? world.span : fmt.hours(meta.lastWorldMinutes)),
      h("div", { class: "line" }, `lived, until ${short(meta.lastWorldMinutes)}`),
      h("div", { class: "line" }, `${meta.lastTick} ticks of ${mpt} minutes`),
      world?.speedup ? h("div", { class: "line" }, `${world.speedup}× faster than ours`) : null),
    h("div", { class: "r-clock truth" }, h("p", { class: "eyebrow" }, "the truth"),
      meta.truth
        ? [h("div", { class: "big" }, meta.truth.name), h("div", { class: "line" }, `opened the door at ${short(meta.truth.worldMinutes)}`), h("div", { class: "line" }, `our time ${fmt.time(meta.truth.realTime)}`)]
        : [h("div", { class: "big", style: { color: "var(--fog)" } }, "still buried"), summary ? h("div", { class: "line" }, `the words were ${summary.truth.words.join(" · ")}`) : null],
      summary?.truth.shardsUploaded.length ? h("div", { class: "line" }, `shards beyond the door: ${summary.truth.shardsUploaded.join(", ")}`) : null),
    h("div", { class: "r-clock" }, h("p", { class: "eyebrow" }, "cost"),
      h("div", { class: "big mono" }, fmt.usd(usage?.total?.costUsd ?? 0)),
      h("div", { class: "line" }, `${fmt.int(usage?.total?.calls)} thoughts paid for`),
      h("div", { class: "line" }, `${fmt.int(usage?.total?.input)} in · ${fmt.int(usage?.total?.output)} out`),
      h("div", { class: "line" }, `${fmt.int(usage?.total?.cacheRead)} read from cache`)),
  ));

  // the cast, as faces
  const story = h("div", { class: "story", hidden: true });
  const grid = h("div", { class: "cast-grid" });
  const list = (summary?.netrunners ?? people.map((n) => ({ id: n.id, name: n.name, alive: n.alive, causeOfDeath: n.causeOfDeath, lived: null, knowsTruth: n.knowsTruth, transcended: n.transcended, selfView: n.selfView, goals: n.goals, enjoys: n.enjoys, stats: n.stats, bonds: [] })));
  for (const s of list) {
    const n = byId[s.id] ?? s;
    const card = h("div", { class: `life ${s.alive ? "" : "dead"}`, tabindex: 0 },
      portrait(n, { size: 120, alive: s.alive, truth: s.knowsTruth }),
      h("div", { class: "nm" }, s.name),
      h("div", { class: "lf" }, s.alive ? `alive · lived ${s.lived ?? "?"}` : `${s.causeOfDeath}${s.killedBy ? ` by ${s.killedBy}` : ""} · ${s.died ?? ""}`),
      h("div", { class: "tags" }, s.knowsTruth ? h("span", {}, "knew the truth") : null, s.transcended ? h("span", {}, "transcended") : null),
    );
    const open = () => {
      const same = story.dataset.id === s.id && !story.hidden;
      story.hidden = same;
      if (same) return;
      story.dataset.id = s.id;
      story.replaceChildren(lifeStory(s, n, events, nameOf));
      card.after(story);
      story.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    grid.append(card);
  }
  page.append(h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, `the minds · ${list.length}`), h("h2", {}, "Who lived here."), grid));

  page.append(h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, "timeline"), h("h2", {}, "Life, mood, death and every touch from outside."), timeline(frames, ops, events, mpt)));
  if (snapshot && frames.length) page.append(replay(snapshot, frames, events, nameOf));

  page.append(h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, `operator · ${ops.length}`), h("h2", {}, "Every time someone reached in."),
    h("table", { class: "t" },
      h("thead", {}, h("tr", {}, ["our time", "their time", "tick", "what", "by", "phase", "thinking", "held", "detail"].map((x) => h("th", {}, x)))),
      h("tbody", {}, ops.map((o) => h("tr", {}, h("td", {}, fmt.time(o.rt)), h("td", {}, short(o.wm)), h("td", {}, o.tick), h("td", {}, o.kind), h("td", {}, o.by), h("td", {}, o.phase), h("td", {}, o.inflight), h("td", {}, o.held), h("td", {}, o.detail ?? "")))))));

  page.append(record(events, nameOf));
  if (summary) page.append(h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, "counted"), h("h2", {}, "Everything that happened."),
    h("div", { class: "counts" }, Object.entries(summary.eventCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => h("div", {}, h("span", {}, k), h("b", {}, v))))));
  page.append(h("p", { class: "mono mute small" }, `raw records in ${meta.path}/ · events.jsonl · operator.jsonl · llm.jsonl · frames.jsonl · snapshot.json · summary.json`));
}

function lifeStory(s, n, events, nameOf) {
  const mine = events.filter((e) => e.who?.includes(s.id));
  const key = mine.filter((e) => ["death", "truth.discovered", "clue.found", "bond.formed", "bond.broken", "attack", "steal", "contract.completed", "shard.uploaded", "reflection", "dues.unpaid", "give", "netrunner.woke"].includes(e.type));
  const thoughts = mine.filter((e) => e.type === "thought" && e.who[0] === s.id);
  const words = mine.filter((e) => (e.type === "speech" || e.type === "speech.whisper") && e.who[0] === s.id);
  return h("div", {},
    h("div", { style: { display: "grid", gridTemplateColumns: "200px 1fr", gap: "28px", alignItems: "start" } },
      veilPortrait(n, { size: 200, alive: s.alive, truth: s.knowsTruth }),
      h("div", {},
        h("p", { class: "eyebrow" }, s.alive ? "alive at the end" : `${s.causeOfDeath} · ${s.died ?? ""}`),
        s.selfView ? h("blockquote", {}, `“${s.selfView}”`) : h("blockquote", { style: { color: "var(--mute)" } }, "They never put themselves into words."),
        s.enjoys ? h("p", { class: "fog" }, `Found joy in: ${s.enjoys}`) : null,
        s.goals?.length ? h("p", { class: "fog" }, `Last wanted: ${s.goals.join(" · ")}`) : null,
        s.bonds?.length ? h("p", { class: "fog small" }, `Bonds: ${s.bonds.map((b) => `${b.with} (${b.bond})`).join(", ")}`) : null,
        s.salientTraits?.length ? h("p", { class: "mute small mono" }, s.salientTraits.map((t) => `${t.trait} ${t.value}`).join(" · ")) : null,
      )),
    h("div", { class: "cols" },
      h("div", {}, h("h4", {}, "what happened"), key.slice(-30).map((e) => h("div", { class: "ln2" }, h("span", { class: "mt" }, short(e.wm)), e.text))),
      h("div", {},
        h("h4", {}, `the inner voice · last ${Math.min(10, thoughts.length)} of ${thoughts.length}`),
        thoughts.slice(-10).map((e) => h("div", { class: "ln2" }, h("span", { class: "mt" }, short(e.wm)), h("i", {}, e.text))),
        h("h4", {}, `said out loud · last ${Math.min(6, words.length)} of ${words.length}`),
        words.slice(-6).map((e) => h("div", { class: "ln2" }, h("span", { class: "mt" }, short(e.wm)), h("i", {}, `“${e.data?.message ?? e.text}”`), ` to ${e.who.slice(1).map(nameOf).join(", ") || "everyone"}`)),
      ),
    ),
  );
}

function timeline(frames, ops, events, mpt) {
  if (!frames.length) return h("p", { class: "fog" }, "No frames were recorded.");
  const W = 1200, H = 260, P = 24;
  const maxT = frames[frames.length - 1].t || 1;
  const x = (t) => P + ((W - 2 * P) * t) / maxT;
  const maxAlive = Math.max(1, ...frames.map((f) => f.n.length));
  const yA = (v) => H - P - ((H - 2 * P) * v) / maxAlive;
  const yM = (v) => H / 2 - (v * (H - 2 * P)) / 2.2;
  const alive = frames.map((f) => `${x(f.t).toFixed(1)},${yA(f.n.filter((n) => n.alive).length).toFixed(1)}`).join(" ");
  const mood = frames.map((f) => { const a = f.n.filter((n) => n.alive); return `${x(f.t).toFixed(1)},${yM(a.length ? a.reduce((s, n) => s + n.v, 0) / a.length : 0).toFixed(1)}`; }).join(" ");
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "timeline" },
    svg("line", { x1: P, y1: H / 2, x2: W - P, y2: H / 2, class: "axis" }),
    svg("polyline", { points: mood, class: "mood" }),
    svg("polyline", { points: alive, class: "alive" }),
  );
  let pauseAt = null;
  for (const o of ops) {
    if (o.kind === "pause") pauseAt = o;
    if (o.kind === "resume" && pauseAt) {
      chart.append(svg("line", { x1: x(pauseAt.tick), x2: x(o.tick) + 1, y1: 8, y2: 8, class: "pause" }, svg("title", {}, `frozen ${fmt.time(pauseAt.rt)} → ${fmt.time(o.rt)} (${pauseAt.by})`)));
      pauseAt = null;
    }
    if (o.kind === "note") chart.append(svg("circle", { cx: x(o.tick), cy: H - 8, r: 3, class: "note" }, svg("title", {}, o.detail)));
  }
  for (const e of events) {
    if (e.type === "death") chart.append(svg("line", { x1: x(e.tick), x2: x(e.tick), y1: P, y2: H - P, class: "death" }, svg("title", {}, `${short(e.wm)} · ${e.text}`)));
    if (e.type === "truth.discovered" || e.type === "shard.uploaded") chart.append(svg("line", { x1: x(e.tick), x2: x(e.tick), y1: P, y2: H - P, class: "truthm" }, svg("title", {}, `${short(e.wm)} · ${e.text}`)));
  }
  return h("div", {}, chart, h("div", { class: "legend" },
    h("span", {}, h("i", { style: { background: "var(--paper)" } }), "alive"),
    h("span", {}, h("i", { style: { background: "var(--mute)" } }), "average mood"),
    h("span", {}, h("i", { style: { background: "var(--blood)" } }), "a death"),
    h("span", {}, h("i", { style: { background: "var(--lilac)" } }), "the truth · a shard · frozen by the operator"),
    h("span", {}, `D1 06:00 → ${short(maxT * mpt)}`)));
}

function replay(snapshot, frames, events, nameOf) {
  const mapEl = h("div", { class: "map" });
  const feed = h("div", { class: "feed" });
  const label = h("span", { class: "mono fog small" });
  const range = h("input", { type: "range", min: 0, max: frames.length - 1, value: 0, class: "scrub", "aria-label": "Scrub through time" });
  const map = createMap(mapEl, snapshot.locations, {});
  const byTick = new Map();
  for (const e of events) { if (!byTick.has(e.tick)) byTick.set(e.tick, []); byTick.get(e.tick).push(e); }
  let i = 0, timer = null, lastTraffic = -1;
  const peopleAt = (f) => f.n.map((n) => ({ id: n.id, name: nameOf(n.id), loc: n.loc, to: n.to, progress: 0.5, alive: n.alive }));
  const rebuildTraffic = (upto) => {
    map.resetTraffic();
    for (const e of events) { if (e.tick > upto) break; if (e.type === "move.depart" && e.data?.to) map.addTraffic(e.loc, e.data.to); }
    lastTraffic = upto;
  };
  const show = (k, jump) => {
    i = Math.max(0, Math.min(frames.length - 1, k));
    range.value = String(i);
    const f = frames[i];
    if (jump || f.t < lastTraffic) rebuildTraffic(f.t);
    else { for (let t = lastTraffic + 1; t <= f.t; t++) for (const e of byTick.get(t) ?? []) if (e.type === "move.depart" && e.data?.to) map.addTraffic(e.loc, e.data.to); lastTraffic = f.t; }
    label.textContent = `${worldClock(f.wm)} · tick ${f.t} · our time ${fmt.time(f.rt)}`;
    if (jump) map.snapTo(peopleAt(f)); else map.update(peopleAt(f), { storm: f.storm, doorAnchor: snapshot.puzzle.doorAnchor });
    const recent = [];
    for (let t = f.t; t >= 0 && recent.length < 30; t--) for (const e of (byTick.get(t) ?? []).slice().reverse()) if (recent.length < 30 && e.type !== "contract.posted") recent.push(e);
    feed.replaceChildren(...recent.map((e) => h("div", { class: `ev ${e.type === "thought" ? "thought" : e.type.startsWith("speech") ? "speech" : e.type === "death" ? "death" : groupOf(e.type)}` },
      h("span", { class: "tm" }, short(e.wm)),
      h("span", { class: "tx" }, e.type === "thought" ? [h("span", { class: "who-n" }, nameOf(e.who[0])), h("span", { class: "inner" }, e.text)]
        : e.type.startsWith("speech") ? [h("span", { class: "who-n" }, nameOf(e.who[0])), ` to ${e.who.slice(1).map(nameOf).join(", ") || "everyone"}`, h("span", { class: "said" }, `“${e.data?.message ?? e.text}”`)]
        : e.text))));
  };
  const play = h("button", { class: "btn ghost", onclick: () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = "play"; return; }
    play.textContent = "pause";
    timer = setInterval(() => { if (i >= frames.length - 1) { clearInterval(timer); timer = null; play.textContent = "play"; return; } show(i + 1); }, 140);
  } }, "play");
  range.addEventListener("input", () => show(Number(range.value), true));
  map.update(peopleAt(frames[0]), { doorAnchor: snapshot.puzzle.doorAnchor });
  show(0, true);
  return h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, "replay · no model is called"), h("h2", {}, "Watch it again."),
    h("div", { class: "replay" }, mapEl, feed), h("div", { class: "replay-ctl" }, play, range, label));
}

function record(events, nameOf) {
  const out = h("div", { class: "feed", style: { maxHeight: "640px", padding: 0 } });
  const input = h("input", { class: "search", placeholder: "search everything they did, said and thought…" });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const list = (q ? events.filter((e) => e.text.toLowerCase().includes(q) || e.type.includes(q) || (e.who ?? []).some((w) => nameOf(w).toLowerCase().includes(q))) : events).slice(-700);
    out.replaceChildren(...list.map((e) => h("div", { class: `ev ${e.type === "thought" ? "thought" : e.type === "death" ? "death" : groupOf(e.type)}` },
      h("span", { class: "tm", title: fmt.time(e.rt) }, short(e.wm)),
      h("span", { class: "tx" }, e.type === "thought" ? [h("span", { class: "who-n" }, nameOf(e.who[0])), h("span", { class: "inner" }, e.text)] : e.text))));
  };
  input.addEventListener("input", draw);
  draw();
  return h("section", { class: "r-sec" }, h("p", { class: "eyebrow" }, `the full record · ${events.length} moments`), h("h2", {}, "Everything, searchable."), input, out);
}
