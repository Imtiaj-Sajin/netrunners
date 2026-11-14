import { $, $$, api, beep, colorOf, fmt, groupOf, h, meter, worldClock } from "./lib.js";
import { createMap } from "./map.js";
import { renderReport } from "./report.js";

const S = {
  boot: null,
  live: null, // /api/live payload
  info: null, // status info
  feed: [],
  filter: new Set(["speech", "life", "truth", "work", "world", "action", "operator", "thought"]),
  selected: null,
  detail: null,
  map: null,
  thinking: new Map(),
  lastLiveFetch: 0,
  follow: null,
};

// ───────────────────────── boot ─────────────────────────
async function boot() {
  S.boot = await api("/api/bootstrap");
  S.info = S.boot.live;
  if (!new URLSearchParams(location.search).has("snapshot")) connect(); // ?snapshot = static render (no live stream)
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", onKey);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-usage").addEventListener("click", openUsage);
  $("#btn-freeze").addEventListener("click", () => control("toggle"));
  $("#btn-note").addEventListener("click", addNote);
  $("#btn-terminate").addEventListener("click", startTerminate);
  $("#speed").addEventListener("change", (e) => control("speed", Number(e.target.value)));
  $("#btn-home").addEventListener("click", () => (location.hash = "#/"));
  renderTopbar();
  route();
  setInterval(tickClocks, 1000);
}

function route() {
  const hash = location.hash || "#/";
  const m = /^#\/report\/([^/]+)\/([^/]+)/.exec(hash);
  $$("main > section").forEach((s) => (s.hidden = true));
  if (m) {
    $("#view-report").hidden = false;
    renderReport($("#view-report"), decodeURIComponent(m[1]), decodeURIComponent(m[2]), S.boot).catch((err) => {
      console.error(err);
      $("#view-report").append(h("p", { class: "bad" }, `Could not render this report: ${err.message}`));
    });
  } else if (hash.startsWith("#/live") && S.info) {
    $("#view-live").hidden = false;
    enterLive();
  } else {
    $("#view-home").hidden = false;
    renderHome();
  }
  renderTopbar();
}

// ───────────────────────── live stream ─────────────────────────
function connect() {
  const es = new EventSource("/api/stream");
  es.addEventListener("hello", (e) => { const d = JSON.parse(e.data); if (d.live) S.info = d.live; renderTopbar(); });
  es.addEventListener("status", (e) => {
    S.info = JSON.parse(e.data);
    renderTopbar();
    if (S.info && !$("#view-live").hidden) renderFreezeBanner();
  });
  es.addEventListener("tick", (e) => onTick(JSON.parse(e.data)));
  es.addEventListener("thinking", (e) => {
    const d = JSON.parse(e.data);
    S.thinking = new Map(d.inflight.map((x) => [x.netrunnerId, x]));
    if (S.info) { S.info.inflight = d.inflight; S.info.held = d.held; }
    renderFreezeBanner();
    paintMap();
  });
  es.addEventListener("usage", (e) => { if (S.live) S.live.usage = JSON.parse(e.data); renderCostChip(); });
  es.addEventListener("operator", (e) => {
    const o = JSON.parse(e.data);
    pushFeed({ seq: `op-${o.rt}`, type: `operator.${o.kind}`, tick: o.tick, wm: o.wm, rt: o.rt, who: [], text: `OPERATOR ${o.kind.toUpperCase()}${o.by !== "operator" ? ` (${o.by})` : ""}${o.detail ? `: ${o.detail}` : ""}` });
  });
  es.addEventListener("alert", (e) => onAlert(JSON.parse(e.data)));
  es.addEventListener("terminated", (e) => {
    const d = JSON.parse(e.data);
    const [, op, name] = d.session.split("/");
    S.info = null; S.live = null;
    location.hash = `#/report/${op}/${encodeURIComponent(name)}`;
  });
  es.onerror = () => $("#conn").classList.add("down");
  es.onopen = () => $("#conn").classList.remove("down");
}

function onTick(t) {
  if (S.info) { S.info.tick = t.tick; S.info.worldMinutes = t.wm; S.info.clock = t.clock; }
  for (const ev of t.events) pushFeed(ev);
  if (S.live) {
    // move dots right away from the compact frame; fetch the rich state at most every 1.5s
    for (const f of t.frame.n) {
      const n = S.live.netrunners.find((x) => x.id === f.id);
      if (n) { n.location = f.loc; n.alive = f.alive; n.pulse = f.p; n.energy = f.e; n.integrity = f.i; n.creds = f.c; }
    }
    paintMap(t.frame);
  }
  renderTopbar();
  const now = Date.now();
  if (now - S.lastLiveFetch > 1500) { S.lastLiveFetch = now; refreshLive(); }
}

async function refreshLive() {
  if ($("#view-live").hidden) return;
  S.live = await api("/api/live").catch(() => null);
  if (!S.live) return;
  S.info = S.live.info;
  renderRoster();
  renderContracts();
  paintMap();
  renderCostChip();
  if (S.selected) loadDetail(S.selected, true);
}

// ───────────────────────── topbar ─────────────────────────
function renderTopbar() {
  const i = S.info;
  document.body.dataset.status = i?.status ?? "none";
  $("#live-controls").hidden = !i || i.status === "terminated";
  $("#session-name").textContent = i ? i.session : "no world running";
  $("#world-clock").textContent = i ? i.clock : "--";
  $("#tick").textContent = i ? `tick ${i.tick}` : "";
  const st = $("#status-pill");
  st.textContent = i ? (i.status === "running" ? "LIVE" : i.status === "paused" ? "FROZEN" : i.status.toUpperCase()) : "IDLE";
  st.className = `pill ${i?.status ?? "idle"}`;
  const fz = $("#btn-freeze");
  fz.setAttribute("aria-pressed", i?.status === "paused" ? "true" : "false");
  fz.querySelector(".lbl").textContent = i?.status === "paused" ? "RESUME WORLD" : "FREEZE WORLD";
  if (i) $("#speed").value = String(closestSpeed(i.tickIntervalMs));
  $("#nav-live").hidden = !i;
  renderCostChip();
}

function closestSpeed(ms) {
  const opts = [...$("#speed").options].map((o) => Number(o.value));
  return opts.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a), opts[0]);
}

function tickClocks() {
  $("#real-clock").textContent = new Date().toLocaleTimeString();
  if (S.info) {
    const ms = S.info.realActiveMs + (S.info.status === "running" ? 1000 : 0);
    S.info.realActiveMs = ms;
    $("#active-time").textContent = `active ${fmt.dur(ms)}`;
  } else $("#active-time").textContent = "";
}

function renderCostChip() {
  const cost = S.live?.usage?.total?.costUsd ?? S.info?.costUsd ?? 0;
  const budget = S.info?.budgetUsd ?? 0;
  $("#btn-usage .v").textContent = S.info ? `${fmt.usd(cost)}${budget ? ` / ${fmt.usd(budget)}` : ""}` : "usage";
}

async function control(action, value) {
  try {
    S.info = await api("/api/control", { body: { action, value } });
    renderTopbar();
    renderFreezeBanner();
  } catch (err) { toast(err.message, "bad"); }
}

function onKey(e) {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space" && S.info && S.info.status !== "terminated") { e.preventDefault(); control("toggle"); }
}

// ───────────────────────── home ─────────────────────────
async function renderHome() {
  const root = $("#view-home");
  const boot = (S.boot = await api("/api/bootstrap"));
  S.info = boot.live;
  const d = boot.defaults;
  root.innerHTML = "";
  const sessions = boot.sessions;
  const add = (...els) => root.append(...els.filter(Boolean));
  const yours = sessions.filter((s) => s.operator === boot.settings.operator);
  add(
    h("div", { class: "hero" },
      h("img", { src: "/docs/assets/banner.svg", alt: "Netrunners", class: "hero-banner", width: 1200, height: 360 }),
      h("p", { class: "lede" }, "Create a world. Wake minds with real personalities, feelings and morals. Bury a truth. Then watch."),
    ),
    boot.live && boot.live.status !== "terminated"
      ? h("div", { class: "card glow" }, h("h2", {}, "A world is live"), h("p", {}, `${boot.live.session} · ${boot.live.clock} · ${boot.live.status}`), h("button", { class: "btn primary", onclick: () => (location.hash = "#/live") }, "Enter the world"))
      : null,
    h("div", { class: "home-grid" },
      newWorldCard(d, boot),
      h("div", { class: "card" },
        h("h2", {}, "Sessions"),
        h("p", { class: "dim" }, `Every world ever run in this repo. Yours are saved as sessions/${boot.settings.operator}/session_XX-model.`),
        sessions.length ? h("div", { class: "session-list" }, sessions.map((s) => sessionRow(s, boot))) : h("p", { class: "dim" }, "No sessions yet. Wake the first world."),
      ),
    ),
    h("div", { class: "card" }, h("h2", {}, "Token usage"), h("div", { id: "home-usage" }, "loading...")),
  );
  const u = await api("/api/usage");
  $("#home-usage").replaceWith(usageTables(u));
  void yours;
}

function newWorldCard(d, boot) {
  const keyOk = boot.settings.key.source !== "none";
  const modelOpts = (sel) => boot.models.map((m) => h("option", { value: m.id, selected: m.id === sel }, m.label));
  const shardOpts = boot.shards.map((s) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "shard", value: s.path }), ` ${s.name} `, h("span", { class: "dim" }, `from ${s.fromSession}`)));
  const form = h("form", { class: "card form", onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const config = {
      worldName: f.get("worldName"),
      netrunnerCount: Number(f.get("netrunnerCount")),
      routineModel: f.get("routineModel"),
      deepModel: f.get("deepModel"),
      minutesPerTick: Number(f.get("minutesPerTick")),
      tickIntervalMs: Number(f.get("tickIntervalMs")),
      budgetUsd: Number(f.get("budgetUsd")),
      deepNet: f.get("deepNet") === "on",
      deepNetMaxSearches: Number(f.get("deepNetMaxSearches")),
      spawnEveryWorldHours: Number(f.get("spawnEveryWorldHours")),
      reflectEveryWorldHours: Number(f.get("reflectEveryWorldHours")),
      autoPauseOnTruth: f.get("autoPauseOnTruth") === "on",
      maxConcurrency: Number(f.get("maxConcurrency")),
      seed: f.get("seed") ? Number(f.get("seed")) : undefined,
      importShards: f.getAll("shard"),
    };
    if (!config.seed) delete config.seed;
    try {
      const r = await api("/api/sessions/new", { body: { config, start: f.get("startNow") === "on" } });
      S.info = r.live;
      location.hash = "#/live";
    } catch (err) { toast(err.message, "bad"); }
  } },
    h("h2", {}, "Wake a new world"),
    !keyOk ? h("p", { class: "warn" }, "No API key yet. Add yours in Settings (or set ANTHROPIC_API_KEY), or pick offline minds to try it for free.") : null,
    h("div", { class: "fields" },
      field("World name", h("input", { name: "worldName", value: d.worldName })),
      field("Netrunners", h("input", { name: "netrunnerCount", type: "number", min: 1, max: 40, value: d.netrunnerCount })),
      field("Everyday mind", h("select", { name: "routineModel" }, modelOpts(d.routineModel)), "Most decisions."),
      field("Deep mind", h("select", { name: "deepModel" }, modelOpts(d.deepModel)), "Reflection, dilemmas, near-death, the Truth."),
      field("World minutes / tick", h("input", { name: "minutesPerTick", type: "number", min: 1, max: 60, value: d.minutesPerTick })),
      field("Real ms between ticks", h("input", { name: "tickIntervalMs", type: "number", min: 0, step: 500, value: d.tickIntervalMs })),
      field("Budget (USD, auto-freeze)", h("input", { name: "budgetUsd", type: "number", min: 0, step: 0.5, value: d.budgetUsd }), "0 = no limit"),
      field("Reflect every (world h)", h("input", { name: "reflectEveryWorldHours", type: "number", min: 1, value: d.reflectEveryWorldHours })),
      field("New netrunner every (world h)", h("input", { name: "spawnEveryWorldHours", type: "number", min: 0, value: d.spawnEveryWorldHours }), "0 = off"),
      field("Parallel minds", h("input", { name: "maxConcurrency", type: "number", min: 1, max: 16, value: d.maxConcurrency })),
      field("Deep Net searches cap", h("input", { name: "deepNetMaxSearches", type: "number", min: 0, value: d.deepNetMaxSearches })),
      field("Seed (optional)", h("input", { name: "seed", type: "number", placeholder: "random" })),
    ),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "deepNet", checked: d.deepNet }), " Open the Deep Net (real web search at the Signal Tower; read-only; ~$0.01 per search)"),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "autoPauseOnTruth", checked: d.autoPauseOnTruth }), " Freeze the world the moment someone learns the Truth"),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "startNow", checked: true }), " Start running immediately"),
    shardOpts.length ? h("details", { class: "shards" }, h("summary", {}, `Wake shards from earlier worlds (${shardOpts.length})`), shardOpts) : null,
    h("button", { class: "btn primary big", type: "submit" }, "JACK IN"),
  );
  return form;
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", { class: "dim" }, hint) : null);
}

function sessionRow(s, boot) {
  const ended = s.status === "terminated";
  const live = boot.live && boot.live.session === s.path && boot.live.status !== "terminated";
  return h("div", { class: `session-row ${s.status}` },
    h("div", {},
      h("div", { class: "mono" }, `${s.operator}/${s.name}`),
      h("div", { class: "dim small" }, `${worldClock(s.lastWorldMinutes)} · ${s.alive}/${s.netrunnerCount} alive · ${fmt.usd(s.costUsd)} · ${fmt.time(s.createdAt)}${s.truth ? ` · TRUTH: ${s.truth.name}` : ""}`),
    ),
    h("div", { class: "row-actions" },
      live ? h("button", { class: "btn", onclick: () => (location.hash = "#/live") }, "Enter") : null,
      !ended && !live ? h("button", { class: "btn", onclick: async () => {
        try { const r = await api("/api/sessions/resume", { body: { operator: s.operator, name: s.name } }); S.info = r.live; location.hash = "#/live"; } catch (err) { toast(err.message, "bad"); }
      } }, "Resume") : null,
      h("button", { class: "btn ghost", onclick: () => (location.hash = `#/report/${s.operator}/${encodeURIComponent(s.name)}`) }, ended ? "Report" : "Records"),
    ),
  );
}

// ───────────────────────── live view ─────────────────────────
async function enterLive() {
  S.live = await api("/api/live");
  if (!S.live) { location.hash = "#/"; return; }
  S.info = S.live.info;
  S.map = createMap($("#map"), S.live.locations, { onSelect: select });
  renderFilters();
  renderRoster();
  renderContracts();
  renderFreezeBanner();
  paintMap();
  const pre = new URLSearchParams(location.search).get("select");
  if (pre && !S.selected) select(pre);
  if (!S.feed.length) {
    const [op, name] = S.info.session.split("/").slice(1);
    const past = await api(`/api/session/${op}/${encodeURIComponent(name)}/events`).catch(() => []);
    for (const ev of past.slice(-250)) pushFeed(ev, false);
    renderFeed();
  }
}

function paintMap(frame) {
  if (!S.map || !S.live) return;
  const tick = S.info?.tick ?? 0;
  const people = S.live.netrunners.map((n) => {
    const moving = n.activity?.kind === "move";
    const f = frame?.n.find((x) => x.id === n.id);
    const progress = moving ? (tick - n.activity.startedTick) / Math.max(1, n.activity.endsAtTick - n.activity.startedTick) : 0;
    return {
      id: n.id, name: n.name, alive: f ? f.alive : n.alive, loc: f ? f.loc : n.location,
      to: moving ? n.activity.target : undefined, progress, a: n.activity?.kind,
      thinking: S.thinking.has(n.id), knowsTruth: n.knowsTruth,
    };
  });
  S.map.update(people, { storm: S.live.events?.storm?.location, doorAnchor: S.live.puzzle.doorAnchor, doorKnown: true });
  S.map.select(S.selected);
}

function renderFreezeBanner() {
  const b = $("#freeze-banner");
  const i = S.info;
  if (!i) { b.hidden = true; return; }
  const frozen = i.status === "paused";
  b.hidden = !frozen && !(i.inflight?.length);
  b.className = frozen ? "freeze frozen" : "freeze thinking";
  const names = (i.inflight ?? []).map((x) => S.live?.netrunners.find((n) => n.id === x.netrunnerId)?.name ?? x.netrunnerId);
  b.textContent = frozen
    ? `THE WORLD IS FROZEN at ${i.clock}. Nothing moves. ${i.inflight?.length ? `${i.inflight.length} mind(s) still finishing a thought (${names.join(", ")}); ` : ""}${i.held} answer(s) held safely on disk until you resume.${i.lastError ? `  ⚠ ${i.lastError}` : ""}`
    : `thinking: ${names.join(", ")}`;
}

function renderRoster() {
  const root = $("#roster");
  if (!S.live) return;
  const list = [...S.live.netrunners].sort((a, b) => Number(b.alive) - Number(a.alive) || a.name.localeCompare(b.name));
  root.innerHTML = "";
  for (const n of list) {
    const think = S.thinking.get(n.id);
    root.append(h("button", { class: `nr ${n.alive ? "" : "dead"} ${S.selected === n.id ? "sel" : ""}`, onclick: () => select(n.id), style: { "--c": colorOf(n.id) } },
      h("div", { class: "nr-top" },
        h("span", { class: "swatch" }),
        h("b", {}, n.name),
        n.knowsTruth ? h("span", { class: "tag truth" }, "TRUTH") : null,
        n.shard?.uploaded ? h("span", { class: "tag" }, "SHARD") : null,
        think ? h("span", { class: "tag think" }, think.kind === "reflect" ? "reflecting" : "thinking") : null,
        h("span", { class: "dim small right" }, n.alive ? (S.live.locations[n.location]?.name ?? n.location) : n.causeOfDeath ?? "gone"),
      ),
      n.alive ? h("div", { class: "nr-bars" },
        miniBar("pulse", Math.min(1, n.pulse / (48 * 60)), fmt.hours(n.pulse), "var(--magenta)"),
        miniBar("energy", n.energy / 100, Math.round(n.energy), "var(--yellow)"),
        miniBar("body", n.integrity / 100, Math.round(n.integrity), "var(--green)"),
      ) : null,
      n.alive ? h("div", { class: "dim small" }, `${n.activity ? n.activity.kind : "idle"}${n.activity?.detail ? `: ${n.activity.detail}` : ""} · ${n.creds}c`) : null,
    ));
  }
}

function miniBar(label, v, text, color) {
  return h("div", { class: "mini", title: `${label}: ${text}` }, h("span", { class: "mini-l" }, label), h("span", { class: "mini-t" }, h("span", { style: { width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: color } })), h("span", { class: "mini-v" }, text));
}

function renderContracts() {
  const root = $("#contracts");
  if (!S.live) return;
  const list = S.live.contracts.filter((c) => c.status === "open" || c.status === "active");
  root.innerHTML = "";
  root.append(h("h3", {}, `Exchange board (${list.length})`));
  for (const c of list.slice(0, 16)) {
    root.append(h("div", { class: `contract ${c.status} ${c.special ? "special" : ""}` },
      h("div", {}, h("b", {}, c.title), " ", h("span", { class: "dim small" }, `${c.kind} · ${c.skill} · d${c.difficulty}`)),
      h("div", { class: "small" }, c.crew.length ? `crew: ${c.crew.map((id) => S.live.netrunners.find((n) => n.id === id)?.name).join(", ")}` : "open", ` · ${c.progress.toFixed(1)}/${c.workRequired}`),
    ));
  }
}

// ───────────────────────── feed ─────────────────────────
const FILTERS = [["speech", "words"], ["thought", "thoughts"], ["life", "life & death"], ["truth", "truth"], ["work", "work"], ["action", "actions"], ["world", "world"], ["operator", "operator"]];
function renderFilters() {
  const root = $("#filters");
  root.innerHTML = "";
  for (const [k, label] of FILTERS) {
    root.append(h("button", { class: `chip ${S.filter.has(k) ? "on" : ""}`, onclick: () => { S.filter.has(k) ? S.filter.delete(k) : S.filter.add(k); renderFilters(); renderFeed(); } }, label));
  }
  root.append(h("button", { class: `chip ${S.follow ? "on" : ""}`, title: "Only show the selected netrunner", onclick: () => { S.follow = S.follow ? null : S.selected; renderFilters(); renderFeed(); } }, S.follow ? `following ${nameOf(S.follow)}` : "follow selected"));
}

function nameOf(id) {
  return S.live?.netrunners.find((n) => n.id === id)?.name ?? id;
}

function pushFeed(ev, render = true) {
  S.feed.push(ev);
  if (S.feed.length > 1500) S.feed.splice(0, S.feed.length - 1500);
  if (render) appendFeedItem(ev, true);
}

function visible(ev) {
  if (!S.filter.has(groupOf(ev.type))) return false;
  if (S.follow && !(ev.who ?? []).includes(S.follow)) return false;
  return true;
}

function feedItem(ev) {
  const g = groupOf(ev.type);
  const who = (ev.who ?? [])[0];
  return h("div", { class: `ev g-${g} t-${ev.type.replace(/\./g, "-")}`, style: who ? { "--c": colorOf(who) } : {} },
    h("span", { class: "ev-time", title: `real: ${fmt.time(ev.rt)} · tick ${ev.tick}` }, worldClock(ev.wm).replace("Day ", "D")),
    h("span", { class: "ev-text" },
      ev.type === "thought" ? [h("b", {}, nameOf(who)), " thinks: ", h("i", {}, ev.text), ev.data?.private_intent ? h("span", { class: "intent" }, ` (really: ${ev.data.private_intent})`) : null, ev.data?.sincere === false ? h("span", { class: "tag lie" }, "LIE") : null]
        : ev.text,
    ),
  );
}

function appendFeedItem(ev, scroll) {
  if (!visible(ev)) return;
  const root = $("#feed");
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 80;
  root.append(feedItem(ev));
  while (root.children.length > 500) root.firstChild.remove();
  if (scroll && atBottom) root.scrollTop = root.scrollHeight;
}

function renderFeed() {
  const root = $("#feed");
  root.innerHTML = "";
  for (const ev of S.feed.filter(visible).slice(-400)) root.append(feedItem(ev));
  root.scrollTop = root.scrollHeight;
}

// ───────────────────────── netrunner detail ─────────────────────────
async function select(id) {
  S.selected = id;
  if (S.follow) S.follow = id;
  renderRoster();
  renderFilters();
  S.map?.select(id);
  await loadDetail(id, false);
}

async function loadDetail(id, quiet) {
  const n = await api(`/api/live/netrunner/${id}`).catch(() => null);
  if (!n) return;
  const panel = $("#detail");
  const openGroups = new Set($$("details[open]", panel).map((d) => d.dataset.k));
  if (!quiet) openGroups.add("feel");
  const scroll = panel.scrollTop;
  panel.innerHTML = "";
  panel.hidden = false;
  panel.append(renderNetrunner(n, openGroups));
  panel.scrollTop = scroll;
}

function section(k, title, open, ...content) {
  return h("details", { dataset: { k }, open: open.has(k) }, h("summary", {}, title), h("div", { class: "sec" }, content));
}

function renderNetrunner(n, open) {
  const cat = S.boot.catalog;
  const loc = S.live?.locations[n.location]?.name ?? n.location;
  const ppl = (id) => S.live?.netrunners.find((x) => x.id === id)?.name ?? id;
  const usage = S.live?.usage?.byNetrunner?.[n.id];
  const groups = Object.entries(cat.groups).map(([g, label]) => {
    const traits = cat.traits.filter((t) => t.group === g);
    return h("div", { class: "trait-group" }, h("h4", {}, label), traits.map((t) => meter(t.label, n.genome.traits[t.key], { title: `${t.low}  ⟷  ${t.high}`, color: n.genome.traits[t.key] > 0.72 ? "var(--magenta)" : n.genome.traits[t.key] < 0.28 ? "var(--yellow)" : "var(--cyan)" })));
  });
  const emotions = Object.entries(n.emotions).sort((a, b) => b[1] - a[1]);
  return h("div", { class: "nr-detail", style: { "--c": colorOf(n.id) } },
    h("div", { class: "nd-head" },
      h("button", { class: "btn ghost close", onclick: () => { $("#detail").hidden = true; S.selected = null; renderRoster(); S.map?.select(null); } }, "×"),
      h("h2", {}, n.name, n.alive ? "" : " ✝"),
      h("div", { class: "dim" }, n.alive ? `${loc} · ${n.activity ? n.activity.kind + (n.activity.detail ? `: ${n.activity.detail}` : "") : "idle"}` : `${n.causeOfDeath}${n.killedBy ? ` by ${ppl(n.killedBy)}` : ""}`),
      h("div", { class: "small" }, `voice: ${n.genome.voice} · attachment: ${n.genome.attachment} · desire: ${n.genome.coreDesire} · fear: ${n.genome.coreFear} · quirk: ${n.genome.quirk}`),
      n.pastLife ? h("div", { class: "tag truth" }, `carries a shard from ${n.pastLife.from}`) : null,
    ),
    h("div", { class: "vitals" },
      meter("Pulse", Math.min(1, n.pulse / (48 * 60)), { text: fmt.hours(n.pulse), color: "var(--magenta)" }),
      meter("Energy", n.energy / 100, { text: Math.round(n.energy), color: "var(--yellow)" }),
      meter("Integrity", n.integrity / 100, { text: Math.round(n.integrity), color: "var(--green)" }),
      h("div", { class: "small" }, `creds ${n.creds} · carrying ${Object.entries(n.inventory).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join(", ") || "nothing"}`),
    ),
    n.selfView || n.goals.length || n.enjoys ? h("div", { class: "self" },
      n.selfView ? h("p", {}, h("b", {}, "Self: "), n.selfView) : null,
      n.enjoys ? h("p", {}, h("b", {}, "Enjoys: "), n.enjoys) : null,
      n.goals.length ? h("ul", {}, n.goals.map((g) => h("li", {}, g))) : null,
    ) : null,
    section("feel", "Feelings & needs", open,
      h("div", { class: "two" },
        h("div", {}, emotions.map(([k, v]) => meter(k, v, { color: "var(--magenta)" }))),
        h("div", {}, Object.entries(n.needs).map(([k, v]) => meter(k, v / 100, { text: Math.round(v), color: v < 30 ? "var(--red)" : "var(--green)" }))),
      ),
    ),
    section("people", `People (${Object.keys(n.impressions).length})`, open,
      Object.entries(n.impressions).map(([id, imp]) => h("div", { class: "imp" },
        h("div", {}, h("b", { style: { color: colorOf(id) } }, ppl(id)), n.bonds[id] ? h("span", { class: "tag" }, n.bonds[id]) : null, h("span", { class: "dim small" }, ` met ${worldClock(imp.firstMetTick * (S.live?.config.minutesPerTick ?? 10))} · ${imp.interactions} interactions`)),
        h("div", { class: "two" },
          h("div", {}, meter("trust", imp.trust, { signed: true }), meter("liking", imp.liking, { signed: true }), meter("respect", imp.respect, { signed: true })),
          h("div", {}, meter("fear", imp.fear, { color: "var(--red)" }), meter("attraction", imp.attraction, { color: "var(--magenta)" }), meter("familiarity", imp.familiarity)),
        ),
        imp.notes.length ? h("div", { class: "notes" }, imp.notes.map((x) => h("div", {}, `“${x}”`))) : null,
      )),
    ),
    section("know", `Knowledge & secrets (${n.knowledge.length})`, open,
      n.knowledge.length ? n.knowledge.map((k) => h("div", { class: `know ${k.id === "truth" ? "truth" : ""}` }, h("b", {}, k.id), " ", h("span", { class: "pre" }, k.text), h("div", { class: "dim small" }, `source: ${k.source}`))) : h("p", { class: "dim" }, "Nothing hidden known yet."),
    ),
    section("mem", `Memories (${n.memories.length})`, open,
      [...n.memories].reverse().slice(0, 80).map((m) => h("div", { class: `mem k-${m.kind}` }, h("span", { class: "dim small" }, `${worldClock(m.tick * (S.live?.config.minutesPerTick ?? 10))} · ${m.kind} · ${m.importance}`), h("div", {}, m.text))),
    ),
    section("pref", "What they've learned they enjoy", open,
      Object.keys(n.preferences).length ? Object.entries(n.preferences).sort((a, b) => b[1].enjoyment - a[1].enjoyment).map(([k, v]) => meter(`${k} (${v.times}×)`, v.enjoyment, { text: `${(v.enjoyment * 10).toFixed(1)}/10`, color: "var(--green)" })) : h("p", { class: "dim" }, "They haven't tried anything for fun yet."),
    ),
    section("skills", "Skills", open, Object.entries(n.skills).map(([k, v]) => meter(k, v, { color: k === n.genome.talent ? "var(--magenta)" : "var(--cyan)" }))),
    section("traits", "Personality: all 110 traits", open, groups),
    section("stats", "Life stats & tokens", open,
      h("div", { class: "kv" }, Object.entries(n.stats).map(([k, v]) => h("div", {}, h("span", { class: "dim" }, k), h("b", {}, v)))),
      usage ? h("div", { class: "kv" }, ["calls", "input", "output", "cacheRead", "cacheWrite"].map((k) => h("div", {}, h("span", { class: "dim" }, k), h("b", {}, fmt.int(usage[k])))), h("div", {}, h("span", { class: "dim" }, "cost"), h("b", {}, fmt.usd(usage.costUsd)))) : null,
    ),
  );
}

// ───────────────────────── alerts ─────────────────────────
function onAlert(a) {
  pushFeed({ seq: `al-${a.rt}`, type: `operator.alert`, tick: a.tick, wm: a.wm, rt: a.rt, who: a.who, text: `⚑ ${a.text}` });
  if (a.kind === "truth") {
    beep();
    notify("Netrunners: the Truth was found", a.text);
    const id = a.who[0];
    const dlg = $("#truth-dialog");
    $("#truth-text").textContent = a.text;
    $("#truth-when").textContent = `World: ${worldClock(a.wm)} · Real: ${fmt.time(a.rt)}`;
    $("#truth-follow").onclick = () => { dlg.close(); S.follow = id; select(id); renderFilters(); renderFeed(); };
    dlg.showModal();
  } else if (a.kind === "error" || a.kind === "budget" || a.kind === "extinction") {
    notify("Netrunners", a.text);
    toast(a.text, "bad", 12000);
  } else if (a.kind === "shard" || a.kind === "first-kill" || a.kind === "bond") {
    notify("Netrunners", a.text);
    toast(a.text, a.kind === "first-kill" ? "bad" : "good", 8000);
  }
}

function notify(title, body) {
  try {
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") Notification.requestPermission();
  } catch { /* unsupported */ }
}

export function toast(text, kind = "", ms = 5000) {
  const t = h("div", { class: `toast ${kind}` }, text);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

// ───────────────────────── dialogs ─────────────────────────
async function addNote() {
  const dlg = $("#note-dialog");
  const input = $("#note-input");
  input.value = "";
  dlg.showModal();
  dlg.onclose = () => { if (dlg.returnValue === "ok" && input.value.trim()) { control("note", input.value.trim()); toast("Note recorded on the timeline.", "good"); } };
}

function startTerminate() {
  if (!S.info) return;
  const dlg = $("#terminate-dialog");
  const body = $("#terminate-body");
  const alive = S.live?.netrunners.filter((n) => n.alive).length ?? "?";
  const steps = [
    () => [h("h2", {}, "Terminate this world?"), h("p", {}, `${S.info.session} has been running for ${S.info.tick} ticks (${S.info.clock}).`), h("p", { class: "dim" }, "If you only want to stop the cost, FREEZE it instead. A frozen world can be resumed any time.")],
    () => [h("h2", { class: "bad" }, "This is permanent."), h("p", {}, `${alive} netrunner(s) are still alive in there. Terminating ends their world forever. Their lives stay recorded, but they will never think again.`)],
    () => [h("h2", { class: "bad" }, "Last confirmation"), h("p", {}, "Type the session name to end it:"), h("p", { class: "mono" }, S.info.name), h("input", { id: "terminate-confirm", class: "mono", autocomplete: "off", placeholder: S.info.name })],
  ];
  let step = 0;
  const render = () => {
    body.innerHTML = "";
    body.append(...steps[step](), h("div", { class: "steps dim small" }, `confirmation ${step + 1} of 3`));
    $("#terminate-next").textContent = step < 2 ? "Yes, continue" : "TERMINATE";
  };
  $("#terminate-next").onclick = async (e) => {
    e.preventDefault();
    if (step < 2) { step += 1; render(); return; }
    const v = $("#terminate-confirm").value.trim();
    if (v !== S.info.name) { toast("The name doesn't match. Nothing was terminated.", "bad"); return; }
    $("#terminate-next").disabled = true;
    $("#terminate-next").textContent = "ending the world...";
    try {
      const r = await api("/api/terminate", { body: { confirm: v } });
      dlg.close();
      S.info = null; S.live = null; S.feed = [];
      location.hash = `#/report/${r.operator}/${encodeURIComponent(r.name)}`;
    } catch (err) { toast(err.message, "bad"); }
    $("#terminate-next").disabled = false;
  };
  render();
  dlg.showModal();
}

async function openSettings() {
  const dlg = $("#settings-dialog");
  const b = (S.boot = await api("/api/bootstrap"));
  const body = $("#settings-body");
  body.innerHTML = "";
  body.append(
    h("h2", {}, "Settings"),
    h("p", { class: "dim" }, "Stored only on this machine in .netrunners/settings.json (git-ignored). Your key is sent only to Anthropic."),
    field("Anthropic API key", h("input", { id: "set-key", type: "password", placeholder: b.settings.key.source === "none" ? "sk-ant-..." : `saved (${b.settings.key.source} ${b.settings.key.hint}); paste to replace`, autocomplete: "off" })),
    b.settings.key.source === "settings" ? h("label", { class: "check" }, h("input", { id: "set-clear", type: "checkbox" }), " Remove the saved key") : null,
    field("Operator name (your sessions folder)", h("input", { id: "set-op", value: b.settings.operator }), "Sessions are saved as sessions/<operator>/session_XX-model. Use your PC name, so contributors never clash."),
    h("p", { class: "dim small" }, "No key? Get one at console.anthropic.com. Everyone who runs this project uses their own key."),
  );
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    const payload = { operator: $("#set-op").value };
    const key = $("#set-key").value.trim();
    if (key) payload.apiKey = key;
    if ($("#set-clear")?.checked) payload.clearKey = true;
    try { await api("/api/settings", { body: payload }); toast("Settings saved.", "good"); if (!$("#view-home").hidden) renderHome(); } catch (err) { toast(err.message, "bad"); }
  };
}

async function openUsage() {
  const dlg = $("#usage-dialog");
  const body = $("#usage-body");
  body.innerHTML = "loading...";
  dlg.showModal();
  const u = await api("/api/usage");
  body.innerHTML = "";
  body.append(h("h2", {}, "Tokens & cost"), usageTables(u),
    S.info ? h("div", { class: "budget" },
      field("Session budget (USD) - the world freezes itself when it is reached", h("input", { id: "budget-input", type: "number", min: 0, step: 0.5, value: S.info.budgetUsd })),
      h("button", { class: "btn", onclick: (e) => { e.preventDefault(); control("budget", Number($("#budget-input").value)); toast("Budget updated.", "good"); } }, "Set budget"),
    ) : null);
}

export function usageTables(u) {
  const table = (title, l) => {
    if (!l) return null;
    const rows = Object.entries(l.byModel ?? {});
    return h("div", { class: "usage-block" },
      h("h3", {}, title, " ", h("span", { class: "cost" }, fmt.usd(l.total?.costUsd ?? 0))),
      h("table", { class: "usage" },
        h("thead", {}, h("tr", {}, ["model", "calls", "input", "output", "cache read", "cache write", "web searches", "≈ cost"].map((x) => h("th", {}, x)))),
        h("tbody", {},
          rows.map(([m, b]) => h("tr", {}, h("td", { class: "mono" }, m), [b.calls, b.input, b.output, b.cacheRead, b.cacheWrite, b.webSearches].map((x) => h("td", {}, fmt.int(x))), h("td", {}, fmt.usd(b.costUsd)))),
          h("tr", { class: "total" }, h("td", {}, "total"), [l.total.calls, l.total.input, l.total.output, l.total.cacheRead, l.total.cacheWrite, l.total.webSearches].map((x) => h("td", {}, fmt.int(x))), h("td", {}, fmt.usd(l.total.costUsd))),
        ),
      ),
      Object.keys(l.byPurpose ?? {}).length ? h("div", { class: "dim small" }, "by purpose: ", Object.entries(l.byPurpose).map(([k, b]) => `${k} ${fmt.int(b.calls)} calls ${fmt.usd(b.costUsd)}`).join(" · ")) : null,
    );
  };
  return h("div", { class: "usage-wrap" },
    u.session ? table(`This session (${u.sessionName})`, u.session) : null,
    table(`All your sessions (${u.operator})`, u.pc),
    table(`Whole project (${u.sessions} sessions, every contributor)`, u.project),
    h("p", { class: "dim small" }, "Costs are estimates from token counts × Anthropic's published per-million prices (Haiku 5.5: $0.10 in / $0.50 out; Sonnet 5.5: $2 in / $10 out; cache reads and writes priced separately; web search $0.01 each). Your Anthropic Console is the source of truth for billing."),
  );
}

boot().catch((err) => {
  document.body.prepend(h("div", { class: "toast bad" }, `Viewer failed to start: ${err.message}`));
});
