// A world's page: the film, the moments, the minds, their life lines, the setup and what the world showed.
import { createFilm } from "./film.js";
import { veilPortrait } from "./lib/portrait.js";
import { hueOf } from "./lib/lib.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const num = (v) => Number(v).toLocaleString("en-US");
const MODEL = { "claude-code": "Claude Code agents (Sonnet)", "claude-haiku-5-5": "Claude Haiku 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", offline: "offline rule-based minds" };
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

const slug = new URLSearchParams(location.search).get("w") || "world-01";
let W;
try { W = await (await fetch(`data/${encodeURIComponent(slug)}.json`)).json(); }
catch {
  $("#w-title").textContent = "This world has no record yet.";
  $("#w-tag").innerHTML = 'It may still be running, or not exist. <a href="./#worlds">See all worlds</a>.';
  throw new Error("no world data");
}
const mpt = W.setup.minutesPerTick;
const clock = (t) => { const m = t * mpt + 360; return { day: Math.floor(m / 1440) + 1, hm: `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }; };
const stamp = (t) => { const c = clock(t); return `Day ${c.day}, ${c.hm}`; };
const lastT = W.frames[W.frames.length - 1][0], firstT = W.frames[0][0];
const N = W.numbers;

// ── head ──
document.title = `World ${W.number}: ${W.title} · Netrunners`;
$("#crumb").textContent = `World ${W.number}`;
$("#w-no").textContent = `World ${W.number}`;
$("#w-title").textContent = W.title;
$("#w-tag").textContent = W.tagline;
const extinct = W.people.every((p) => !p.alive);
const pills = [
  [extinct ? `ended · extinction ${stamp(lastT)}` : W.setup.status, extinct ? "end" : ""],
  [`${N.minds} minds`, ""],
  [MODEL[W.setup.models.routine] ?? W.setup.models.routine, ""],
  [`the rewrite ${W.setup.rules.rewrite ? "on" : "off"}`, W.setup.rules.rewrite ? "on" : ""],
  [`Deep Net ${W.setup.rules.deepNet ? "on" : "off"}`, ""],
  [`${N.truthKnowers} of ${N.minds} found the truth`, N.truthKnowers ? "on" : ""],
];
$("#w-pills").replaceChildren(...pills.map(([t, c]) => el("span", `pill ${c}`, esc(t))));

// ── the film ──
const film = createFilm($("#film"), W);
const startT = Number(new URLSearchParams(location.search).get("t"));
if (startT) film.seek(startT);

// ── moments ──
$("#w-moments").replaceChildren(...W.chapters.map((c) => {
  const k = clock(c.t);
  const b = el("button", "moment reveal", `<span class="t">Day ${k.day} · ${k.hm}</span><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><span class="watch">watch this moment ▸</span>`);
  b.type = "button";
  b.addEventListener("click", () => { film.seek(c.t); $("#film").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); film.play(); });
  return b;
}));

// ── the minds ──
$("#w-cast").replaceChildren(...W.people.map((p) => {
  const card = el("article", "person reveal");
  const face = veilPortrait(p, { size: 104, alive: true, truth: p.truthT != null });
  face.style.width = face.style.height = "104px";
  face.setAttribute("role", "img");
  face.setAttribute("aria-label", `${p.name}, dithered portrait`);
  const fate = p.alive ? `alive at the end` : `${p.killedBy ? `killed by ${p.killedBy}` : p.cause === "faded" ? "faded" : p.cause} · ${stamp(p.diedT)}${p.transcended ? " · Shard through the door" : ""}`;
  const head = el("div", "top-row");
  head.append(face, el("div", "", `<h3><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:hsl(${hueOf(p.id)} 52% 72%);margin-right:10px;vertical-align:8px"></span>${esc(p.name)}</h3><div class="fate ${p.alive ? "alive" : ""}">${esc(fate)}</div>`));
  card.append(head);
  if (p.selfView) card.append(el("p", "self", `“${esc(p.selfView)}”`));
  const bonds = Object.entries(p.bonds ?? {}).map(([n, k]) => `${k} of ${n}`).join(" · ");
  card.append(el("dl", "", [
    ["wants", `<em>${esc(p.desire)}</em>`], ["fears", `<em>${esc(p.fear)}</em>`], ["speaks", esc(p.voice)],
    ["loves by", esc(p.loveLanguage)], ["gift", esc(String(p.talent).replace(/_/g, " "))], ["bonds", esc(bonds || "none")],
    ["the truth", p.truthT != null ? `learned ${esc(stamp(p.truthT))}` : "never learned"],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")));
  const s = p.stats ?? {};
  card.append(el("div", "nums", [["decisions", s.decisions], ["words", s.wordsSpoken], ["gifts", s.giftsGiven], ["jobs", s.contractsDone], ["books", s.booksRead], ["lies", s.lies]]
    .filter(([, v]) => v != null).map(([k, v]) => `<span><b>${num(v)}</b> ${k}</span>`).join("")));
  if (p.lastWords?.text) {
    card.append(el("div", "last", `<div class="k">last words${p.lastWords.to ? `, to ${esc(p.lastWords.to)}` : ""}</div><q>${esc(p.lastWords.text)}</q><span class="n">${esc(stamp(p.lastWords.t))}${p.lastWords.note ? ` · ${esc(p.lastWords.note)}` : ""}</span>`));
  }
  return card;
}));

// ── life lines: small multiples, one labelled panel per series (identity never rests on colour) ──
const tip = $(".tip");
function smallMultiples(host, { title, sub, series, maxY, valueFmt, tableTitle }) {
  const Wd = 640, padL = 6, padR = 10, panelH = 46, labelH = 18, gap = 14, axisH = 26;
  const H = series.length * (labelH + panelH + gap) + axisH;
  const x = (t) => padL + ((t - firstT) / Math.max(1, lastT - firstT)) * (Wd - padL - padR);
  const days = [];
  for (let d = 1; ; d++) { const t = Math.round(((d - 1) * 1440) / mpt); if (t > lastT) break; if (t >= firstT) days.push({ d, t }); }
  const truthT = N.firstTruthT;
  let svg = `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(title)}">`;
  for (const { d, t } of days) svg += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - axisH + 4}"/><text class="tick" x="${x(t) + 3}" y="${H - 8}">D${d}</text>`;
  if (truthT) svg += `<line class="m-truth" x1="${x(truthT)}" x2="${x(truthT)}" y1="0" y2="${H - axisH + 4}"/>`;
  series.forEach((s, i) => {
    const top = i * (labelH + panelH + gap);
    const y0 = top + labelH, yb = y0 + panelH;
    const my = s.maxY ?? maxY;
    const y = (v) => yb - (Math.max(0, Math.min(my, v)) / my) * panelH;
    svg += `<text class="lbl" x="${padL}" y="${top + 12}">${esc(s.label)}</text>`;
    if (s.note) svg += `<text class="tick" x="${Wd - padR}" y="${top + 12}" text-anchor="end">${esc(s.note)}</text>`;
    svg += `<line class="grid" x1="${padL}" x2="${Wd - padR}" y1="${yb}" y2="${yb}"/>`;
    if (s.points.length > 1) {
      const d = s.points.map(([t, v], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
      svg += `<path class="area" d="${d}L${x(s.points[s.points.length - 1][0]).toFixed(1)},${yb}L${x(s.points[0][0]).toFixed(1)},${yb}Z"/><path class="ln" d="${d}"/>`;
    }
    if (s.truthT != null) { const pv = valueAt(s.points, s.truthT); if (pv != null) svg += `<circle class="m-truthdot" cx="${x(s.truthT)}" cy="${y(pv)}" r="4.5"><title>learned the truth, ${stamp(s.truthT)}</title></circle>`; }
    if (s.deathT != null) svg += `<circle class="m-death" cx="${x(s.deathT)}" cy="${yb}" r="5"><title>faded, ${stamp(s.deathT)}</title></circle>`;
  });
  svg += `<line class="cross" x1="0" x2="0" y1="0" y2="${H - axisH + 4}" visibility="hidden"/><rect class="hit" x="0" y="0" width="${Wd}" height="${H - axisH + 4}"/></svg>`;
  host.innerHTML = `<h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p>${svg}`;
  const svgEl = host.querySelector("svg"), cross = host.querySelector(".cross"), hit = host.querySelector(".hit");
  const move = (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * Wd;
    const t = Math.round(firstT + ((px - padL) / (Wd - padL - padR)) * (lastT - firstT));
    if (t < firstT || t > lastT) return leave();
    cross.setAttribute("x1", x(t)); cross.setAttribute("x2", x(t)); cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="tt">${esc(stamp(t))}</div>` + series.map((s) => { const v = valueAt(s.points, t, s.deathT); return `<div class="r"><span>${esc(s.label)}</span><span>${v == null ? (s.deathT != null && t >= s.deathT ? "gone" : "-") : esc(valueFmt(v, s))}</span></div>`; }).join("");
    tip.hidden = false;
    const tx = Math.min(innerWidth - tip.offsetWidth - 12, ev.clientX + 16), ty = Math.min(innerHeight - tip.offsetHeight - 12, ev.clientY + 16);
    tip.style.left = `${tx}px`; tip.style.top = `${ty}px`;
  };
  const leave = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", leave);
  // a legend and a table view, so nothing depends on colour or hovering
  const legend = el("div", "legend", `${truthT ? `<span><i class="dash"></i>the truth is first found, ${esc(stamp(truthT))}</span>` : ""}${series.some((s) => s.truthT != null) ? '<span><i style="background:var(--lilac)"></i>this one learns it</span>' : ""}${series.some((s) => s.deathT != null) ? '<span><i style="background:var(--blood)"></i>fades</span>' : ""}`);
  host.append(legend);
  const det = el("details", "table", `<summary>${esc(tableTitle)}</summary>`);
  const rows = days.map(({ d }) => Math.min(lastT, Math.round((d * 1440) / mpt) - 1)).filter((t, i, a) => a.indexOf(t) === i);
  det.append(el("div", "tbl-wrap", `<table><thead><tr><th>end of</th>${series.map((s) => `<th>${esc(s.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((t) => `<tr><td>${esc(stamp(t))}</td>${series.map((s) => { const v = valueAt(s.points, t, s.deathT); return `<td>${v == null ? (s.deathT != null && t >= s.deathT ? "gone" : "-") : esc(valueFmt(v, s))}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`));
  host.append(det);
}
function valueAt(points, t, deathT) {
  if (deathT != null && t >= deathT) return null;
  let v = null;
  for (const [pt, pv] of points) { if (pt > t) break; v = pv; }
  return v;
}
const step = (i) => i % 2 === 0;
const life = W.people.map((p, i) => {
  const pts = [];
  W.frames.forEach((f, k) => { const s = f[2][i]; if (s && s[3] && (step(k) || f[0] === p.diedT - 1)) pts.push([f[0], s[4]]); });
  if (p.diedT) pts.push([p.diedT, 0]);
  return { label: p.name, points: pts, deathT: p.diedT, truthT: p.truthT, note: p.diedT ? `faded ${stamp(p.diedT)}` : "alive" };
});
smallMultiples($("#chart-life"), {
  title: "Pulse, hours of life left",
  sub: "One panel per mind. Work buys life; after Day 5 nobody worked again.",
  series: life, maxY: Math.max(24, ...life.flatMap((s) => s.points.map(([, v]) => v))), valueFmt: (v) => `${Math.round(v)} h`, tableTitle: "Show as a table",
});
const SYS = [["power", 100], ["signal", 100], ["trams", 100], ["order", 100], ["the desk", 100], ["pulse stock", null]];
const city = SYS.map(([label, max], j) => {
  const pts = [];
  W.frames.forEach((f, k) => { if (f[3] && step(k)) pts.push([f[0], f[3][j]]); });
  const peak = Math.max(1, ...pts.map(([, v]) => v));
  return { label, points: pts, maxY: max ?? Math.ceil(peak), note: pts.length ? `${Math.round(pts[0][1])} → ${Math.round(pts[pts.length - 1][1])}${max ? "" : " packs"}` : "not yet built" };
});
smallMultiples($("#chart-city"), {
  title: "The city's body",
  sub: W.setup.upgrades?.length ? `Tracked from ${stamp(W.setup.upgrades[0].t)}, when the rules gave the city a body.` : "Each system wears out unless someone does the upkeep.",
  series: city, maxY: 100, valueFmt: (v, s) => (s.label === "pulse stock" ? `${Math.floor(v)} packs` : String(Math.round(v))), tableTitle: "Show as a table",
});

// ── setup ──
const S = W.setup;
const cells = [
  ["Minds", `${N.minds} netrunners<small>${esc(W.people.map((p) => p.name).join(", "))}</small>`],
  ["Who thinks for them", `${esc(MODEL[S.models.routine] ?? S.models.routine)}<small>${esc(W.minds ?? "")}</small>`],
  ["Seed", `${S.seed}<small>The same seed builds the same city, the same people and the same hiding places.</small>`],
  ["Their time", `${stamp(firstT)} → ${stamp(lastT)}<small>${mpt} world minutes per tick · ${num(lastT)} ticks · reflection every ${S.reflectEveryWorldHours} world hours</small>`],
  ["Our time", `${dur(Date.parse(S.realEnd) - Date.parse(S.realStart))}<small>${esc(S.realStart?.replace("T", " ").slice(0, 16))} → ${esc(S.realEnd?.replace("T", " ").slice(0, 16))} UTC${N.realActiveMs ? ` · ${dur(N.realActiveMs)} actually running, the rest frozen between runs` : ""}</small>`],
  ["Model calls", `${N.calls != null ? num(N.calls) : "-"}<small>cost $${(N.costUsd ?? 0).toFixed(2)}${N.costUsd ? "" : ": the agents ran through Claude Code, not a paid API"}</small>`],
  ["Rules", `the rewrite ${S.rules.rewrite ? "on" : "off"}<small>Deep Net ${S.rules.deepNet ? "on" : "off"} · freeze on the Truth ${S.rules.freezeOnTruth ? "on" : "off"}</small>`],
  ["Rule changes", S.upgrades?.length ? `${S.upgrades.length} upgrade${S.upgrades.length > 1 ? "s" : ""}<small>${S.upgrades.map((u) => `${esc(stamp(u.t))}: ${esc(u.detail)}`).join("<br>")}</small>` : "none<small>The world ran under one set of rules.</small>"],
  ["The buried words", `${esc(S.words.join(" · "))}<small>Randomized from the seed. First word hidden at ${esc(W.locations[S.alphaLocation]?.name ?? S.alphaLocation)}; the door anchored at ${esc(W.locations[S.doorAnchor]?.name ?? S.doorAnchor)}.</small>`],
  ["The truth found", N.firstTruthT ? `${esc(stamp(N.firstTruthT))}<small>${N.firstTruthRealMs ? `${dur(N.firstTruthRealMs)} of our time after the world began, ` : ""}${N.truthKnowers} of ${N.minds} learned it.</small>` : "never"],
  ["Operator actions", `${S.operatorTouches.length}<small>${esc([...new Set(S.operatorTouches.map((o) => o.kind))].join(", "))}. The Operator never spoke to them or changed anything in their world.</small>`],
  ["The end", extinct ? `extinction, ${esc(stamp(lastT))}<small>${esc(W.ending ?? "")}</small>` : `${esc(S.status)}<small>${esc(W.ending ?? "")}</small>`],
];
$("#w-setup").replaceChildren(...cells.map(([k, v]) => el("div", "cell reveal", `<div class="k">${k}</div><div class="v">${v}</div>`)));

// ── results ──
$("#w-results").replaceChildren(...(W.results ?? []).map((r) => el("article", "result reveal", `<h3>${esc(r.big)}</h3><p>${esc(r.text)}</p>`)));
const tiles = [["thoughts", "private thoughts"], ["words", "things said aloud"], ["lies", "lies"], ["gifts", "gifts"], ["attacks", "attacks"], ["thefts", "thefts"], ["contracts", "jobs completed"], ["upkeep", "upkeep jobs for the city"], ["books", "books finished"], ["bonds", "bonds formed"], ["truthKnowers", "found the truth"], ["shards", "Shards uploaded"], ["deaths", "deaths"], ["rewrites", "rewrites"]];
$("#w-stats").replaceChildren(...tiles.filter(([k]) => N[k] != null && !(k === "rewrites" && !S.rules.rewrite)).map(([k, l]) => el("div", `stat ${k === "deaths" || k === "upkeep" ? "blood" : k === "truthKnowers" || k === "shards" ? "lilac" : ""}`, `<div class="v">${num(N[k])}</div><div class="l">${l}</div>`)));
$("#w-findings").replaceChildren(...(W.findings ?? []).map((f) => {
  const d = el("details", "", `<summary><span class="id">${esc(f.id)}</span><span class="d">${esc(f.when)}</span><span class="ti">${esc(f.title)}</span><span class="pm">+</span></summary><div class="body"><p>${f.html}</p>${f.reading ? `<p class="reading"><span class="rl">reading</span>${f.reading}</p>` : ""}</div>`);
  return d;
}));
$("#w-caveats ul").innerHTML = (W.caveats ?? []).map((c) => `<li>${c}</li>`).join("");

// ── the record ──
const gh = `${W.repo}/tree/main`, blob = `${W.repo}/blob/main`;
const links = [
  ["The raw session", `${gh}/sessions/${W.session}`],
  ["Findings notebook", `${blob}/${W.research}/findings.md`],
  ["Day by day", `${blob}/${W.research}/days.md`],
  ...W.digests.map((f) => [`Day ${Number(f.match(/\d+/)[0])}`, `${blob}/${W.research}/${f}`]),
  ["Design document", `${blob}/docs/DESIGN.md`],
  ["Run it yourself", "./#run"],
];
$("#w-links").replaceChildren(...links.map(([t, href], i) => { const a = el("a", `btn ${i === 0 ? "solid" : ""}`, esc(t)); a.href = href; return a; }));
