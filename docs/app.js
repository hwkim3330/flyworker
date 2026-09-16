/**
 * 초파리 직원 — 회사 운영 (메인 스레드)
 *
 * 직원 한 명 = 워커 하나 = 커넥톰 138,639 뉴런 한 벌.
 * 메인 스레드는 게임을 돌리고, 화면을 눈으로 바꿔 워커에 보내고,
 * 워커가 돌려준 조향·전진으로 게임을 움직이고, QA 감지기를 돌린다.
 */
import { Game, BUGS } from "./game.js";
import { Doom } from "./doom.js";
import { Brain3D } from "./brain3d.js";
import { Gta } from "./gta.js";
import { Byo } from "./byo.js";
import { normalizeField } from "./vision.js";
import { POLICIES, MEASURED } from "./policy.js";
import { QA, replay } from "./qa.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const GW = 16, GH = 12;                     // 눈 격자
const NAMES = ["Pip", "Mote", "Zip", "Nib", "Fen", "Lux", "Dot", "Kit"];

const company = [];
let sel = null, runs = 0, totalBugs = 0, t0 = Date.now();

// 둠은 무겁다. 한 번에 한 명만 배치한다.
let doom = null, doomEmp = null, doomLoading = false;
let gta = null, gtaEmp = null, gtaLoading = false;
const gtaQA = { last: 0, same: 0, recent: [], reported: new Set() };
const doomQA = { last: 0, same: 0, recent: [], reported: new Set() };

// 사용자가 붙인 게임. 우리가 아무것도 모르는 표적이다.
let byo = null, byoEmp = null;
const byoQA = { last: 0, same: 0, recent: [], reported: new Set() };
let byoRestarting = false;

// 3D 뇌
let b3d = null, lastFrameAt = performance.now();
new Brain3D($("#b3d")).load(new URL("./data/pos.bin", import.meta.url).href)
  .then((v) => { b3d = v; addEventListener("resize", () => b3d.resize()); })
  .catch((e) => console.warn("Could not start the 3D brain:", e));

const gctx = $("#game").getContext("2d", { willReadFrequently: true });
const dctx = $("#doom").getContext("2d");
const rctx = $("#replay").getContext("2d");
const eyeLc = $("#eyeL").getContext("2d");
const eyeRc = $("#eyeR").getContext("2d");

$("#planted").innerHTML = Object.entries(BUGS)
  .map(([k, v]) => `<div style="margin-bottom:7px"><b>${esc(v.name)}</b>
     <span class="mono" style="color:var(--fg3)">${k}</span><br>
     <span style="color:var(--fg2)">${esc(v.desc)}</span></div>`).join("");

/* ── 직원 한 명 ───────────────────────────────── */
function hire() {
  if (company.length >= 6) return;
  const n = company.length;
  const emp = {
    id: "E" + String(n + 1).padStart(2, "0"),
    name: NAMES[n % NAMES.length],
    phase: "Hiring", detail: "", progress: 0, ready: false,
    game: new Game(1000 + n * 37), qa: null,
    steer: 0, thrust: 0, dnHz: 0, spikes: 0, brainMs: 0,
    bugs: [], vision: new Float32Array(GW * GH), runs: 0, startedAt: Date.now(),
  };
  emp.qa = new QA({ seed: 1000 + n * 37, W: emp.game.W, H: emp.game.H });

  const w = new Worker(new URL("./fly.worker.js", import.meta.url), { type: "module" });
  emp.worker = w;
  w.onmessage = (e) => onMsg(emp, e.data);
  w.postMessage({
    t: "hire", id: emp.id, grid: { w: GW, h: GH },
    brainUrl: new URL("./data/brain.bin", import.meta.url).href,
    metaUrl: new URL("./data/meta.json", import.meta.url).href,
  });

  company.push(emp);
  if (!sel) sel = emp;
  renderEmps();
}

function onMsg(emp, m) {
  if (m.t === "status") { emp.phase = m.phase; emp.detail = m.detail || ""; renderEmps(); }
  else if (m.t === "hired") {
    emp.ready = true; emp.phase = "On shift"; emp.detail = "";
    emp.info = m;
    emp.worker.postMessage({ t: "start" });
    renderEmps();
    maybeStartGta();
  }
  else if (m.t === "motor") {
    emp.steer = m.steer; emp.thrust = m.drive;
    emp.dnHz = m.hz; emp.spikes = m.totalSpikes; emp.brainMs = m.brainMs;
  }
  else if (m.t === "act") {
    if (b3d && emp === sel) b3d.setActivity(m.act);
    // 소유권이 넘어온 버퍼는 워커로 돌려주지 않고 버린다 (워커가 새로 만든다)
  }
  else if (m.t === "lesioned") {
    emp.nCut = m.nCut;
    if (b3d) b3d.setCut(m.indices || "all", m.what !== "heal");
    $("#lesionNote").innerHTML = m.what === "heal"
      ? `Healed. Watch the steering bar come back.`
      : `<b>${m.nCut.toLocaleString()} neurons cut.</b> Watch the steering bar.
         Press Heal to restore them.`;
  }
  else if (m.t === "error") { emp.phase = "Error"; emp.detail = m.msg; renderEmps(); }
}

/* ── 게임 루프 ───────────────────────────────── */
function tick() {
  for (const e of company) {
    if (!e.ready) continue;

    // 정책이 초파리가 아니면 여기서 입력을 만든다. 뇌는 계속 돌며 화면에 보인다.
    if (policyFn) { const [sv, tv] = policyFn(); e.steer = sv; e.thrust = tv; }

    // ── 사용자가 붙인 게임 ──
    if (e === byoEmp && byo && byo.ready) {
      byo.drive(e.steer, e.thrust);
      byo.vision(GW, GH, e.vision, normalizeField);
      e.worker.postMessage({ t: "vision", frame: e.vision });
      checkScreenQA(e, byo.screenHash(), byoQA, byo.label, byo.frameNo);
      // 화면이 죽은 표적을 계속 두드려도 새 증상은 안 나온다. 새 판을 연다.
      if (byoQA.same > 180 && !byoRestarting) {
        byoRestarting = true;
        byoQA.same = 0; byoQA.recent.length = 0; byoQA.last = 0;
        byo.restart()
          .then(() => { e.runs++; runs++; })
          .catch((err) => console.warn("Could not restart the target:", err))
          .finally(() => { byoRestarting = false; });
      }
      continue;
    }

    // ── GTA1 근무 ──
    if (e === gtaEmp && gta && gta.ready) {
      gta.drive(e.steer, e.thrust);
      gta.vision(GW, GH, e.vision, normalizeField);
      e.worker.postMessage({ t: "vision", frame: e.vision });
      checkScreenQA(e, gta.screenHash(), gtaQA, "GTA1", gta.frame);
      continue;
    }

    // ── 둠 근무 ──
    if (e === doomEmp && doom && doom.ready) {
      doom.drive(e.steer, e.thrust, e.dnHz > 30);
      doom.tick();
      doom.vision(GW, GH, e.vision);
      e.worker.postMessage({ t: "vision", frame: e.vision });
      checkScreenQA(e, doom.screenHash(), doomQA, "DOOM", doom.frame);
      continue;
    }

    const g = e.game;
    g.step(e.steer, e.thrust);
    const st = g.state();
    const before = e.qa.findings.length;
    e.qa.observe(st, e.steer, e.thrust);
    e.qa.progress(st, Math.hypot(st.x - g.goal.x, st.y - g.goal.y));
    let wedged = false;
    if (e.qa.findings.length > before) {
      const fresh = e.qa.findings.slice(before);
      for (const f of fresh) { f.by = e.name; e.bugs.push(f); totalBugs++; }
      // 끼었거나 더 진행하지 못한다고 확인되면 그 판에서 더 볼 것이 없다.
      // 기록만 남기고 새 판으로 넘어간다. 실제 퍼저가 하는 일이다.
      // 같은 계산량에서 버그 13건 → 60건, 탐색률 15% → 28% (24,000프레임 실측)
      wedged = fresh.some((f) => f.code === "STUCK" || f.code === "NOPROG" || f.code === "FREEZE");
      renderBugs();
    }

    // 초파리가 자기 자리에서 보는 1인칭 시야를 만들어 보낸다
    g.visionField(GW, GH, e.vision);
    e.worker.postMessage({ t: "vision", frame: e.vision });

    // 한 판이 끝나면 다음 판
    if (st.won || st.escaped || wedged || st.frame > 6000) {
      e.runs++; runs++;
      g.reset(); e.qa.reset();
      e.worker.postMessage({ t: "reset" });
    }
  }
  draw();
  if (b3d) b3d.render(performance.now());
  requestAnimationFrame(tick);
}

/**
 * 외부 게임에는 심어둔 버그가 없다. 내부 상태도 못 본다.
 * 그래서 화면 해시만으로 정지·반복을 본다.
 */
function checkScreenQA(e, h, st, placeName, frame) {
  if (h === st.last) st.same++; else { st.same = 0; st.last = h; }
  st.recent.push(h);
  if (st.recent.length > 240) st.recent.shift();

  const add = (code, label, sev, detail) => {
    if (st.reported.has(code)) return;
    st.reported.add(code);
    e.bugs.push({ code, label, sev, detail, frame, at: { x: 0, y: 0 },
                  by: e.name, ts: Date.now(), repro: { seed: 0, inputs: [] }, place: placeName });
    totalBugs++; renderBugs();
  };
  if (st.same === 150)
    add("FREEZE", "Frozen screen", "high", `${placeName} rendered 150 identical frames — not a single pixel changed.`);
  // 멈춘 화면은 자동으로 '반복'으로도 보인다. 같은 사건을 두 번 세지 않는다.
  if (st.recent.length === 240 && new Set(st.recent).size <= 3 && !st.reported.has("FREEZE"))
    add("LOOP", "Screen loop", "medium",
        `The last 240 frames cycled through only ${new Set(st.recent).size} distinct screens — likely stuck in a menu or a dead end.`);
}

function draw() {
  const e = sel;
  if (!e) return;
  const onDoom = e === doomEmp && doom && doom.ready;
  const onGta = e === gtaEmp && gta && gta.ready;
  const onByo = e === byoEmp && byo && byo.ready;
  $("#game").classList.toggle("showing", !onDoom && !onGta && !onByo);
  $("#doom").classList.toggle("showing", onDoom);
  $("#gta").classList.toggle("showing", onGta);
  $("#byo").classList.toggle("showing", onByo);
  $("#who").textContent = `${e.name} · ${e.id}`;
  // 초파리가 보는 것은 근무지와 무관하게 늘 보여준다
  drawEye(eyeLc, e.vision, 0);
  drawEye(eyeRc, e.vision, 1);

  if (onByo) {
    $("#bPos").textContent = byo.label;
    $("#bFrame").textContent = `${byo.frameNo}f`;
    $("#bState").textContent = byo.tainted ? "Canvas unreadable" : "Playing";
    drawMeters(e); return;                              // 남의 게임은 자기 iframe 에 그린다
  }
  if (onGta) {
    $("#bPos").textContent = "GTA1";
    $("#bFrame").textContent = `${gta.frame}f`;
    $("#bState").textContent = gta.boot < 600 ? "Getting past the menu" : "Driving";
    drawMeters(e); return;                              // GTA는 자기 캔버스에 직접 그린다
  }
  if (onDoom) {
    doom.draw(dctx);
    $("#bPos").textContent = "DOOM";
    $("#bFrame").textContent = `${doom.frame}f`;
    $("#bState").textContent = doom.bootFrames < 140 ? "Getting past the menu" : "Playing";
    drawMeters(e); return;
  }

  e.game.draw(gctx);
  const st = e.game.state();
  $("#bPos").textContent = `(${st.x}, ${st.y})`;
  $("#bFrame").textContent = `${st.frame}f`;
  $("#bState").textContent = !e.ready ? e.phase
    : st.escaped ? "Out of bounds" : st.won ? "Reached goal"
    : st.hasKey ? (st.doorOpen ? "Door open" : "Has key") : "Exploring";
  drawMeters(e);
}

function drawMeters(e) {
  const s = e.steer;
  const mi = $("#mSteer");
  mi.style.left = s < 0 ? `${50 + s * 50}%` : "50%";
  mi.style.width = `${Math.abs(s) * 50}%`;
  mi.style.background = Math.abs(s) < .08 ? "var(--dim)" : "var(--accent)";
  $("#vSteer").textContent = (s > 0 ? "→" : s < 0 ? "←" : "·") + Math.abs(s * 100).toFixed(0);
  $("#mThr").style.width = `${e.thrust * 100}%`;
  $("#vThr").textContent = (e.thrust * 100).toFixed(0);
  $("#mDn").style.width = `${Math.min(100, e.dnHz)}%`;
  $("#vDn").textContent = e.dnHz.toFixed(1) + "Hz";

  $("#sTime").textContent = Math.floor((Date.now() - t0) / 60000) + "m";
  $("#sBugs").textContent = totalBugs;
  $("#sSpk").textContent = company.reduce((a, x) => a + x.spikes, 0).toLocaleString();
  $("#sRuns").textContent = runs;
  renderEmpsLive();
}

function drawEye(ctx, v, half) {
  const w = GW / 2, img = ctx.createImageData(w, GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) {
    const val = v[y * GW + x + half * w] * 255;
    const i = (y * w + x) * 4;
    img.data[i] = val * .5; img.data[i + 1] = val * .85; img.data[i + 2] = val; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ── 렌더 ────────────────────────────────────── */
function renderEmps() {
  $("#emps").innerHTML = company.map((e) => `
    <div class="emp ${e === sel ? "sel" : ""}" data-id="${e.id}">
      <span class="av">🪰</span>
      <div style="min-width:0">
        <div class="nm">${esc(e.name)}</div>
        <div class="st"><i class="dot ${e.ready ? "ok" : e.phase === "Error" ? "err" : "busy"}"></i>${esc(e.detail || e.phase)}</div>
      </div>
      <div class="kv">
        <b class="bn">${e.bugs.length}</b> bugs
        <div style="font-size:11px"><span class="tn">${(e.brainMs / 1000).toFixed(0)}s</span> brain · <span class="rn">${e.runs}</span> runs</div>
      </div>
    </div>`).join("");
  $("#emps").querySelectorAll(".emp").forEach((el) =>
    el.onclick = () => { sel = company.find((x) => x.id === el.dataset.id); renderEmps(); });
  $("#hire").disabled = company.length >= 6;
}
function renderEmpsLive() {
  $("#emps").querySelectorAll(".emp").forEach((el) => {
    const e = company.find((x) => x.id === el.dataset.id);
    if (!e) return;
    el.querySelector(".bn").textContent = e.bugs.length;
    el.querySelector(".rn").textContent = e.runs;
    el.querySelector(".tn").textContent = (e.brainMs / 1000).toFixed(0) + "s";
  });
}

function renderBugs() {
  const all = company.flatMap((e) => e.bugs).sort((a, b) => b.ts - a.ts).slice(0, 30);
  $("#bugN").textContent = all.length ? `(${all.length})` : "";
  if (!all.length) return;
  $("#bugs").innerHTML = all.map((f, i) => {
    const canRepro = f.repro && f.repro.inputs && f.repro.inputs.length > 0;
    return `
    <div class="bug">
      <div class="t">
        <span class="lb">${esc(f.label)}</span>
        <span class="sev ${f.sev}">${f.sev === "critical" ? "critical" : f.sev === "high" ? "high" : "medium"}</span>
        <span class="mt">${esc(f.place || "Lab")} · ${f.frame}f · ${esc(f.by)}</span>
      </div>
      <div class="de">${esc(f.detail)}</div>
      ${canRepro ? `<div class="ac">
        <button class="plain" data-r="${i}">Replay</button>
        <button class="plain" data-d="${i}">Download</button>
      </div>` : ""}
    </div>`;
  }).join("");
  $("#bugs").querySelectorAll("[data-r]").forEach((b) =>
    b.onclick = () => doReplay(all[+b.dataset.r]));
  $("#bugs").querySelectorAll("[data-d]").forEach((b) =>
    b.onclick = () => {
      const f = all[+b.dataset.d];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(QA.reproBlob(f));
      a.download = `bug_${f.code}_${f.frame}.json`; a.click();
      URL.revokeObjectURL(a.href);
    });
}

/* ── 재현 ────────────────────────────────────── */
let replayTimer = null;
function doReplay(f) {
  clearInterval(replayTimer);
  const g = new Game(f.repro.seed);
  const inp = f.repro.inputs;
  let i = 0;
  const speed = Math.max(1, Math.floor(inp.length / 240));   // 4초 안에 끝나게
  $("#rState").textContent = "Replaying…";
  replayTimer = setInterval(() => {
    for (let k = 0; k < speed && i < inp.length; k++, i++) g.step(inp[i][0], inp[i][1]);
    g.draw(rctx);
    if (i >= inp.length) {
      clearInterval(replayTimer);
      const ok = (g.x | 0) === f.at.x && (g.y | 0) === f.at.y;
      $("#rState").textContent = ok
        ? `Exact match — (${g.x | 0}, ${g.y | 0})`
        : `Replay (${g.x | 0}, ${g.y | 0}) vs original (${f.at.x}, ${f.at.y})`;
    }
  }, 16);
}

/* ── 시작 ────────────────────────────────────── */
$("#hire").onclick = hire;
let humanMode = false;
let policyId = "fly", policyFn = null;
function setPolicy(id) {
  policyId = id;
  policyFn = POLICIES[id].make();
  document.querySelectorAll(".pol").forEach((b) => b.classList.toggle("on", b.dataset.p === id));
  $("#polNote").innerHTML = esc(POLICIES[id].note);
}
function setDriver(human) {
  humanMode = human;
  if (doom) doom.byHuman = human;
  if (gta) { gta.byHuman = human; if (human) gta.skipBoot(); }
  if (byo) byo.byHuman = human;
  $("#byFly").classList.toggle("on", !human);
  $("#byHuman").classList.toggle("on", human);
  $("#humanNote").innerHTML = human
    ? "<b>You are driving.</b> Click the screen and use the arrow keys. The fly has let go. " +
      "A few seconds is enough to feel how badly it drives — that is the honest part of this project."
    : "";
}

function setPlaceButtons(which) {
  for (const [id, k] of [["#toLab", "lab"], ["#toDoom", "doom"], ["#toGta", "gta"], ["#toByo", "byo"]])
    $(id).classList.toggle("on", k === which);
  // 붙이기 UI 는 그 자리에 있을 때만 보인다
  $("#byoBox").style.display = which === "byo" ? "block" : "none";
}

/**
 * GTA1 을 기본 근무지로 쓴다. 14.8MB 라 커넥톰과 나란히 미리 받아둔다.
 * 둘 다 준비되면 직원을 바로 GTA1 에 배치한다.
 */
let gtaAuto = true;
async function preloadGta() {
  if (gta || gtaLoading) return;
  gtaLoading = true;
  try {
    gta = await new Gta($("#gta")).load();
    gta.byHuman = humanMode;
  } catch (e) {
    console.warn("Could not load GTA1:", e);
    setPlaceButtons("lab");
    $("#placeNote").innerHTML = "GTA1 failed to load — starting in the Lab instead.";
    gtaAuto = false;
  } finally { gtaLoading = false; }
  maybeStartGta();
}
function maybeStartGta() {
  if (!gtaAuto || !gta || !gta.ready) return;
  const e = company.find((x) => x.ready);
  if (!e) return;
  gtaEmp = e; doomEmp = null;
  gtaQA.reported.clear(); gtaQA.recent.length = 0; gtaQA.same = 0;
  setPlaceButtons("gta");
  notePlace("gta");
  gtaAuto = false;
}
function notePlace(k) {
  const t = {
    gta: "<b>GTA1</b> — the Carnage3D (MIT) WebAssembly build. It exposes no clean interface, so " +
         "the fly drives it with <b>synthetic key events</b>, and we intercept " +
         "<span class=\"mono\">getContext</span> to preserve the WebGL framebuffer and read the screen. " +
         "No bugs are planted here, so we only watch for freezes and loops.",
    doom: "<b>DOOM</b> — 10 imports, 4 exports. We read the framebuffer straight out of linear memory " +
          "and inject keys directly. The shareware WAD ships inside the module. No planted bugs here either.",
    byo: "<b>Your game</b> — the claim of this project is that the <b>framework</b> is the product " +
         "and the policy is a part. That is only true if it attaches to a game we have never seen. " +
         "Drop one below. We load it into a same-origin frame, inject keys, read the canvas back, " +
         "and run the same freeze and loop detectors.",
    lab: "<b>Lab</b> — a test game with four bugs deliberately planted in it. The detector does not know " +
         "where they are; it only watches symptoms. This is where finding and <b>reproducing</b> bugs is proven.",
  };
  $("#placeNote").innerHTML = t[k] || "";
}

document.querySelectorAll(".pol").forEach((b) => b.onclick = () => setPolicy(b.dataset.p));
$("#compare").innerHTML = MEASURED.map((m) => `
  <tr class="${m.id === "fly" ? "hi" : ""}">
    <td>${esc(POLICIES[m.id].label)}</td>
    <td class="mono">${m.pct}%</td>
    <td class="mono">${m.kinds}</td>
    <td class="mono" style="color:var(--fg3)">${esc(m.types)}</td>
  </tr>`).join("");

$("#byFly").onclick = () => setDriver(false);
$("#byHuman").onclick = () => {
  setDriver(true);
  (byoEmp ? $("#byo") : gtaEmp ? $("#gta") : doomEmp ? $("#doom") : $("#game")).focus?.();
};

$("#toLab").onclick = () => {
  doomEmp = null; gtaEmp = null; byoEmp = null;
  if (gta) gta.releaseAll();
  if (byo) byo.releaseAll();
  setPlaceButtons("lab");
  notePlace("lab");
};

$("#toGta").onclick = async () => {
  if (!sel || !sel.ready || gtaLoading) return;
  if (!gta) {
    gtaLoading = true;
    $("#toGta").textContent = "Loading…";
    try {
      gta = await new Gta($("#gta")).load();
    } catch (err) {
      $("#placeNote").textContent = "Could not load GTA1: " + (err.message || err);
      gtaLoading = false; $("#toGta").textContent = "GTA1"; return;
    }
    gtaLoading = false; $("#toGta").textContent = "GTA1";
  }
  doomEmp = null; gtaEmp = sel; byoEmp = null;
  if (byo) byo.releaseAll();
  gta.byHuman = humanMode;
  gtaQA.reported.clear(); gtaQA.recent.length = 0; gtaQA.same = 0;
  setPlaceButtons("gta"); notePlace("gta"); gtaAuto = false;
};

$("#toDoom").onclick = async () => {
  if (!sel || !sel.ready) return;
  if (doomLoading) return;
  if (!doom) {
    doomLoading = true;
    $("#toDoom").textContent = "Loading…";
    try {
      doom = await new Doom().load(new URL("./data/doom.wasm", import.meta.url).href);
    } catch (err) {
      $("#placeNote").textContent = "Could not load DOOM: " + (err.message || err);
      doomLoading = false; $("#toDoom").textContent = "DOOM"; return;
    }
    doomLoading = false; $("#toDoom").textContent = "DOOM";
  }
  gtaEmp = null; doomEmp = sel; byoEmp = null;
  if (byo) byo.releaseAll();
  doom.byHuman = humanMode;
  if (gta) gta.releaseAll();
  doomQA.reported.clear(); doomQA.recent.length = 0; doomQA.same = 0;
  setPlaceButtons("doom"); notePlace("doom"); gtaAuto = false;
};

/* ── 아무 게임이나 붙이기 ─────────────────────── */
function goByo() {
  gtaEmp = null; doomEmp = null;
  if (gta) gta.releaseAll();
  setPlaceButtons("byo"); notePlace("byo"); gtaAuto = false;
  if (byo && byo.ready && sel && sel.ready) byoEmp = sel;
}

/** 붙인다. 실패하면 이유를 그대로 화면에 쓴다 — 조용히 실패하지 않는다. */
async function attach(work, what) {
  $("#byoNote").innerHTML = `Attaching <b>${esc(what)}</b>…`;
  byo = byo || new Byo($("#byo"));
  byo.byHuman = humanMode;
  try {
    await work(byo);
  } catch (err) {
    byoEmp = null;
    $("#byoNote").innerHTML =
      `<span style="color:var(--red)">Could not attach ${esc(what)}.</span> ${esc(err.message || err)}`;
    return;
  }
  byoQA.reported.clear(); byoQA.recent.length = 0; byoQA.same = 0; byoQA.last = 0;
  goByo();
  byoEmp = sel && sel.ready ? sel : null;
  $("#byoNote").innerHTML =
    `Attached <b>${esc(byo.label)}</b> — ${byo.canvas.width}×${byo.canvas.height} canvas. ` +
    `The fly is driving it with arrow keys and WASD. Findings appear on the right.`;
}

$("#toByo").onclick = goByo;
addEventListener("resize", () => byo && byo.ready && byo.fit());
$("#byoSample").onclick = () => attach(
  (b) => fetch(new URL("./samples/rover.html", import.meta.url).href)
    .then((r) => r.text()).then((t) => b.loadHtml(t, "rover.html")),
  "the sample");
$("#byoGo").onclick = () => {
  const u = $("#byoUrl").value.trim();
  if (u) attach((b) => b.loadUrl(u), u);
};
$("#byoUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#byoGo").click(); });

const drop = $("#drop");
const picker = Object.assign(document.createElement("input"),
  { type: "file", accept: ".html,.htm,text/html" });
picker.onchange = () => picker.files[0] && attach((b) => b.loadFile(picker.files[0]), picker.files[0].name);
drop.onclick = () => picker.click();
for (const ev of ["dragenter", "dragover"])
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"])
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) attach((b) => b.loadFile(f), f.name);
});

for (const [btn, what] of [["#cutSteer", "steer"], ["#cutEyeL", "eyeL"], ["#heal", "heal"]])
  $(btn).onclick = () => sel && sel.ready && sel.worker.postMessage({ t: "lesion", what });
setPolicy("fly");
hire();                       // 링크를 열면 바로 한 명 채용해 일을 시작한다
preloadGta();                 // 커넥톰과 나란히 GTA1 을 받아둔다
requestAnimationFrame(tick);
