// Engine Room: the Join Race page. Races and their step counts live in races.js, the
// close-up examples in closeup.js; this file draws them and runs the animation.
import { RACES, raceById, defaultState, paramsFor, standings, fmt, compact, drillUrl } from "./races.js";
import { closeupFor } from "./closeup.js";

// ---------- saved state (this browser only). The Pages origin is shared with Rudy's other
// sites, so everything sits under one prefixed key.
const KEY = "engineroom:v1";
const store = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === "object") return { guesses: s.guesses || {}, last: s.last || null };
  } catch { /* private mode or bad JSON: start fresh */ }
  return { guesses: {}, last: null };
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* not fatal */ } };

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RUN_MS = 6000; // the slowest lane always takes this long; faster lanes finish early
const CU_MS = 450;   // close-up step at 1× speed
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ORD = ["first", "second", "third"];
const $ = (sel, root = document) => root.querySelector(sel);

let view = null; // the race on screen: { race, state, log, t, raf, pending, cu }

// ---------- routing

function route() {
  const race = raceById(location.hash.slice(1)) || raceById(store.last) || RACES[0];
  if (view) { stopRun(); stopCloseup(); }
  store.last = race.id; save();
  view = { race, state: defaultState(race), log: false, t: 0, raf: null, pending: false,
    cu: { m: 0, step: 0, speed: 1, timer: null } };
  drawNav();
  drawRace();
}

function drawNav() {
  $("#races").innerHTML = RACES.map((r) => {
    const g = store.guesses[r.id];
    const sub = g ? `<span class="sub solved">Guessed · ${esc(laneName(r, g))}</span>` : `<span class="sub">${esc(r.blurb)}</span>`;
    return `<a class="race-link" href="#${r.id}"${r === view.race ? ' aria-current="page"' : ""}>` +
      `<b><span class="long">${esc(r.title)}</span><span class="short">${esc(r.short)}</span></b>${sub}</a>`;
  }).join("");
}

function laneName(race, id) {
  const l = race.lanes(paramsFor(race, defaultState(race))).find((x) => x.id === id);
  return l ? l.name : id;
}

// ---------- race page

function drawRace() {
  const { race } = view;
  const idx = RACES.indexOf(race) + 1;
  const guess = store.guesses[race.id];
  const lanes = race.lanes(paramsFor(race, view.state));
  const defLanes = race.lanes(paramsFor(race, defaultState(race)));

  $("#race").innerHTML = `
    <div>
      <p class="eyebrow">Join Race · race ${idx} of ${RACES.length}</p>
      <h1>${esc(race.title)}</h1>
      <p class="intro">${esc(race.intro)}</p>
    </div>
    <section class="card question" aria-labelledby="q">
      <span class="q" id="q">${esc(race.question(paramsFor(race, defaultState(race))))}</span>
      <div class="choices">${defLanes.map((l) =>
        `<button class="choice" data-choice="${l.id}" aria-pressed="${guess === l.id}"${guess ? " disabled" : ""}>${esc(l.name)}</button>`).join("")}</div>
      <p class="verdict" id="verdict" aria-live="polite"></p>
    </section>
    <div class="race-head">
      <span class="eyebrow">Steps of work</span>
      <label class="switch"><input type="checkbox" id="log"> Zoom out (log scale)</label>
    </div>
    <p class="scale-note" id="scale-note"></p>
    <div>
      <div class="lane axisrow" aria-hidden="true"><span></span><div class="axis" id="axis"></div><span></span></div>
      <ol class="lanes" id="lanes">${lanes.map((l) => `
        <li class="lane" data-lane="${l.id}">
          <span class="name">${esc(l.name)}</span>
          <div class="track"><div class="ticks"></div><div class="fill"></div></div>
          <div class="gauge"><span class="count">0</span><span class="status">waiting</span></div>
        </li>`).join("")}
      </ol>
    </div>
    <p class="result" id="result" aria-live="polite"></p>
    ${race.id === "broadcast" ? `<div class="workers" id="workers"></div>` : ""}
    <section class="caption" id="caption" aria-label="What's happening"></section>
    <div class="controls">
      ${race.controls.map(controlHtml).join("")}
      <button class="btn primary" id="run">Run again</button>
      <button class="btn" id="skip" hidden>Skip to end</button>
      <span class="locked" id="locked">Make your guess to unlock the sliders.</span>
    </div>
    <details class="how"><summary>How the steps are counted</summary>
      <ul>${race.howWeCount.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </details>
    <div class="drills"><span class="eyebrow">Try it in SQL</span>
      ${race.drills.map((d) => `<a href="${drillUrl(d.id)}">Query Workbook: ${esc(d.title)} →</a>`).join("")}
    </div>
    <section class="card closeup" id="closeup" aria-label="Watch it up close"></section>`;

  // events
  for (const b of document.querySelectorAll("[data-choice]")) b.addEventListener("click", () => makeGuess(b.dataset.choice));
  $("#log").addEventListener("change", (e) => { view.log = e.target.checked; drawLanes(view.t); });
  $("#run").addEventListener("click", startRun);
  $("#skip").addEventListener("click", () => { if (view.raf) { stopRun(); drawLanes(1); finishRun(); } });
  for (const c of race.controls) {
    const el = $("#ctl-" + c.key);
    if (c.type === "range") {
      el.addEventListener("input", () => {
        view.state[c.key] = +el.value;
        $("#out-" + c.key).textContent = c.show(c.values[+el.value]);
        stopRun(); view.t = 0; drawLanes(0); $("#result").textContent = ""; drawCaption();
      });
      el.addEventListener("change", startRun);
    } else {
      el.addEventListener("change", () => { view.state[c.key] = el.checked; drawCaption(); startRun(); });
    }
  }

  setLocked(!guess);
  drawCaption();
  drawCloseup();
  if (guess) { drawVerdict(); drawLanes(1); finishRun(); } else { drawLanes(0); }
}

function controlHtml(c) {
  const v = view.state[c.key];
  if (c.type === "range") {
    return `<label class="slider">${esc(c.label)}
      <input type="range" id="ctl-${c.key}" min="0" max="${c.values.length - 1}" step="1" value="${v}">
      <output id="out-${c.key}" for="ctl-${c.key}">${esc(c.show(c.values[v]))}</output></label>`;
  }
  return `<label class="switch"><input type="checkbox" id="ctl-${c.key}"${v ? " checked" : ""}> ${esc(c.label)}</label>`;
}

function setLocked(locked) {
  for (const c of view.race.controls) $("#ctl-" + c.key).disabled = locked;
  $("#run").disabled = locked;
  $("#locked").hidden = !locked;
}

function makeGuess(id) {
  store.guesses[view.race.id] = id; save();
  for (const b of document.querySelectorAll("[data-choice]")) {
    b.disabled = true;
    b.setAttribute("aria-pressed", String(b.dataset.choice === id));
  }
  view.pending = true; // the verdict waits until the race has been watched
  view.state = defaultState(view.race);
  setLocked(false);
  drawNav();
  drawCaption();
  startRun();
}

function drawVerdict() {
  const race = view.race;
  const guess = store.guesses[race.id];
  const order = standings(race.lanes(paramsFor(race, defaultState(race))));
  const win = order[0];
  const place = order.findIndex((l) => l.id === guess);
  const text = place === 0
    ? `<b class="right">Right.</b> ${esc(win.name)} finished first.`
    : `<b class="wrong">Not quite.</b> ${esc(win.name)} finished first; ${esc(order[place].name.toLowerCase())} came ${place === order.length - 1 ? "last" : ORD[place]}.`;
  $("#verdict").innerHTML = text + ` Now try the slider${race.controls.length > 1 ? "s" : ""}. <button class="link" id="again">Guess again</button>`;
  $("#again").addEventListener("click", () => {
    delete store.guesses[race.id]; save();
    route();
  });
}

function drawCaption() {
  const el = $("#caption");
  if (!store.guesses[view.race.id]) {
    el.innerHTML = `<p class="muted">The explanation shows up once you've made a guess.</p>`;
    return;
  }
  const paras = view.race.caption(paramsFor(view.race, view.state));
  el.innerHTML = paras.map((p, i) => `<p>${i === 0 ? "<b>What's happening.</b> " : ""}${esc(p)}</p>`).join("");
}

// ---------- the race animation. Every lane does the same number of steps per frame, so a lane
// with less work really does finish first; the slowest lane always takes RUN_MS.

function startRun() {
  stopRun();
  $("#result").textContent = "";
  if (reduced) { drawLanes(1); finishRun(); return; }
  $("#skip").hidden = false;
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / RUN_MS);
    drawLanes(t);
    if (t < 1) view.raf = requestAnimationFrame(tick);
    else { stopRun(); finishRun(); }
  };
  view.raf = requestAnimationFrame(tick);
}

function stopRun() {
  if (view && view.raf) cancelAnimationFrame(view.raf);
  if (view) view.raf = null;
  const skip = $("#skip");
  if (skip) skip.hidden = true;
}

function finishRun() {
  const race = view.race;
  const order = standings(race.lanes(paramsFor(race, view.state)));
  const parts = order.map((l, i) => `${l.name.toLowerCase()} ${i === order.length - 1 ? "last" : ORD[i]} (${fmt(l.steps)} steps)`);
  const ratio = order.at(-1).steps / order[0].steps;
  $("#result").textContent = `At these sizes: ${parts.join(", ")}. ` +
    (ratio >= 1.05 ? `${order.at(-1).name} did ${ratio >= 10 ? fmt(ratio) : ratio.toFixed(1)}× the work of ${order[0].name.toLowerCase()}.`
                   : `Practically a tie.`);
  if (view.pending) { view.pending = false; drawVerdict(); }
}

// Bar position for a step count, on the linear or log scale.
function pos(x, max) {
  if (x <= 0) return 0;
  return view.log ? Math.log10(x + 1) / Math.log10(max + 1) : x / max;
}

function drawLanes(t) {
  view.t = t;
  const race = view.race;
  const lanes = race.lanes(paramsFor(race, view.state));
  const max = Math.max(...lanes.map((l) => l.steps));
  const order = standings(lanes).map((l) => l.id);
  const started = t > 0;

  // axis + gridlines
  let ticks;
  if (view.log) {
    ticks = [];
    const top = Math.floor(Math.log10(max));
    const every = top > 7 ? 2 : 1; // keep labels readable on a phone
    for (let e = 0; e <= top; e += every) ticks.push(10 ** e);
    $("#scale-note").textContent = `Log scale: each mark is ${every === 2 ? "100" : "10"}× the one before, so small lanes stay visible.`;
  } else {
    ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    $("#scale-note").textContent = "";
  }
  $("#axis").innerHTML = ticks.map((v, i) => {
    const p = pos(v, max) * 100;
    return `<span${i === ticks.length - 1 && p > 92 ? ' class="end"' : ""} style="left:${p}%">${compact(v)}</span>`;
  }).join("");
  const grid = ticks.slice(1).map((v) => `<i style="left:${pos(v, max) * 100}%"></i>`).join("");

  for (const l of lanes) {
    const li = $(`[data-lane="${l.id}"]`);
    const done = Math.min(l.steps, max * t);
    const fin = started && done >= l.steps;
    li.classList.toggle("done", fin);
    const fill = $(".fill", li);
    fill.style.width = pos(done, max) * 100 + "%";
    fill.style.minWidth = done > 0 ? "4px" : "0";
    $(".ticks", li).innerHTML = grid;
    $(".count", li).textContent = fmt(done);
    const place = order.indexOf(l.id);
    $(".status", li).textContent = !started ? "waiting"
      : fin ? `finished ${place === lanes.length - 1 ? "last" : ORD[place]}` : `running · of ${fmt(l.steps)}`;
  }
  if (race.id === "broadcast") drawWorkers(lanes, max, t);
}

function drawWorkers(lanes, max, t) {
  const top = Math.max(...lanes.flatMap((l) => l.loads));
  $("#workers").innerHTML = lanes.map((l) => {
    const f = Math.min(1, (max * t) / l.steps);
    const hot = Math.max(...l.loads);
    const skewed = Math.min(...l.loads) < hot * 0.8;
    return `<div class="wcard"><h3>${esc(l.name)}</h3>
      <span class="net">${fmt(l.net * f)} rows sent over the network</span>
      ${l.loads.map((x, i) => `<div class="wrow${skewed && x === hot ? " hot" : ""}">
        <span>worker ${i + 1}</span><div class="track"><div class="fill" style="width:${(x * f) / top * 100}%"></div></div>
        <span>${compact(x * f)}</span></div>`).join("")}
    </div>`;
  }).join("");
}

// ---------- close-up

function drawCloseup() {
  const cu = closeupFor(view.race.id);
  const st = view.cu;
  const method = cu.methods[st.m];
  const snap = st.step === 0 ? method.idle : method.steps[st.step - 1];
  const done = st.step >= method.steps.length;
  const playing = !!st.timer;

  // The panel is redrawn on every step; remember which control had focus so keyboard users keep their place.
  const had = document.activeElement && $("#closeup").contains(document.activeElement) ? document.activeElement : null;
  const hadSel = had && (had.id ? "#" + had.id : had.dataset.m ? `[data-m="${had.dataset.m}"]` : had.dataset.speed ? `[data-speed="${had.dataset.speed}"]` : null);

  const chips = (items) => `<div class="chips">${items.map((c) => `<span class="chipx ${c.tone}">${esc(c.label)}</span>`).join("")}</div>`;
  const groups = snap.groups.map((g) => `<div class="cu-group"><span>${esc(g.title)}</span>${g.rows
    ? g.rows.map((r) => `<div class="bucket${r.active ? " active" : ""}"><span>${esc(r.title)}</span>${r.items.map((c) => `<span class="chipx ${c.tone}">${esc(c.label)}</span>`).join("")}</div>`).join("")
    : chips(g.items)}</div>`).join("");

  $("#closeup").innerHTML = `
    <div class="cu-head">
      <div><p class="eyebrow">Watch it up close</p><h2>${esc(cu.heading)}</h2></div>
      <div class="tabs">${cu.methods.map((m, i) => `<button class="tab" data-m="${i}" aria-pressed="${i === st.m}">${esc(m.label)}</button>`).join("")}</div>
    </div>
    <div class="cu-groups">${groups}</div>
    <div class="cu-stats">
      ${snap.counters.map((c) => `<div class="stat"><b class="${c.tone}">${typeof c.value === "number" ? fmt(c.value) : esc(c.value)}</b><span>${esc(c.label)}</span></div>`).join("")}
      <p class="cu-note" aria-live="polite">${esc(snap.note)}</p>
    </div>
    <div class="cu-controls">
      <div class="speeds" role="group" aria-label="Play speed">${[[0.5, "½×"], [1, "1×"], [2, "2×"]].map(([v, l]) =>
        `<button class="speed" data-speed="${v}" aria-pressed="${v === st.speed}">${l}</button>`).join("")}</div>
      <button class="btn primary" id="cu-play">${playing ? "Pause" : done ? "Replay" : "Play"}</button>
      <button class="btn" id="cu-step"${done ? " disabled" : ""}>Step</button>
      <button class="btn" id="cu-reset">Reset</button>
      <span class="mono muted">step ${st.step} of ${method.steps.length}</span>
    </div>`;

  for (const b of document.querySelectorAll("#closeup [data-m]")) {
    b.addEventListener("click", () => { stopCloseup(); st.m = +b.dataset.m; st.step = 0; drawCloseup(); });
  }
  for (const b of document.querySelectorAll("#closeup [data-speed]")) {
    b.addEventListener("click", () => {
      st.speed = +b.dataset.speed;
      if (st.timer) startCloseupTimer();
      drawCloseup();
    });
  }
  $("#cu-play").addEventListener("click", () => {
    if (st.timer) { stopCloseup(); drawCloseup(); return; }
    if (done) st.step = 0;
    startCloseupTimer();
    drawCloseup();
  });
  $("#cu-step").addEventListener("click", () => { stopCloseup(); advanceCloseup(); });
  $("#cu-reset").addEventListener("click", () => { stopCloseup(); st.step = 0; drawCloseup(); });
  if (hadSel) { const el = $("#closeup " + hadSel); if (el && !el.disabled) el.focus(); }
}

function startCloseupTimer() {
  stopCloseup();
  view.cu.timer = setInterval(advanceCloseup, CU_MS / view.cu.speed);
}
function stopCloseup() {
  if (view && view.cu.timer) { clearInterval(view.cu.timer); view.cu.timer = null; }
}
function advanceCloseup() {
  const st = view.cu;
  const total = closeupFor(view.race.id).methods[st.m].steps.length;
  if (st.step < total) st.step++;
  if (st.step >= total) stopCloseup();
  drawCloseup();
}

// ---------- start

$("#reset").addEventListener("click", () => {
  store.guesses = {}; save();
  route();
});
addEventListener("hashchange", route);
route();
